#!/usr/bin/env node
// aeiou.now — 貼文翻譯管線(Track D / W4.2)
//   node scripts/translate-posts.mjs
//
// 整條管線最重要的一支,也是 **UGC 回流主機的唯一通道**:
// 沒有它,主機端 post_highlights 與靜態 highlights.json 永遠拿不到資料。
//
// 流程:
//   1. GET  /internal/ugc/pending-translation?limit=50   撈 D1 待翻 post(Worker 同時標 translating)
//   2. 同一次 `claude -p` 呼叫先做**價值判定**再翻譯(2026-08-15 Bot 防護第二層):
//      判定沒價值(廣告/亂碼/灌水/詐騙)→ D1+主機都標 status='moderation' +
//      translation_status='skipped',不翻譯、feed 自動排除(不露出)。判定從寬,不確定就留。
//      有價值的每則翻**六語**(七語系扣掉 original_locale;原文即該語,不重複翻),
//      用 `claude -p`(訂閱 CLI,/root/.local/bin/claude,**不是 Anthropic API**),
//      一次呼叫處理多則 × 六語,嚴格解析 JSON,解析失敗算「該批」失敗(其他批照跑)。
//   3. **先** upsert 進主機 SQLite posts / post_i18n(回流),**再** POST /internal/translations 回寫 D1。
//      順序刻意:主機先落地,萬一回寫 D1 失敗,D1 那幾則仍是 translating,下一輪重抓、
//      主機端 upsert 冪等 → 不會掉資料。反過來寫則會掉。
//   4. 已經在主機備齊六語的 post 不再呼叫 claude(重試路徑省 token),直接回寫 D1。
//   5. jobs 表記錄;失敗 +5 分 → +10 分 → 第三次 dlq。
//   6. job_locks 防重入(同 scope+job_name+scheduled_at 只跑一次;前一輪還活著也 skip)。
//
// 環境變數:
//   AEIOU_API_URL           Worker base URL(預設 workers.dev)
//   AEIOU_DB_PATH           主機 SQLite
//   AEIOU_SYNC_SECRET_FILE  secret 檔
//   AEIOU_TRANSLATE_LIMIT   一輪抓幾則(預設 50,契約上限 50)
//   AEIOU_TRANSLATE_CHUNK   一次 claude 呼叫處理幾則(預設 4;4 則 × 六語 = 24 段)
//   AEIOU_CLAUDE_BIN        claude CLI 路徑(預設 /root/.local/bin/claude)
//   AEIOU_CLAUDE_TIMEOUT_MS 單次 claude 呼叫逾時(預設 600000)
//   AEIOU_CLAUDE_MODEL      模型(預設 claude-sonnet-5;見下方「為什麼一定要 pin 模型」)
//   AEIOU_CLAUDE_CWD        claude 子行程的工作目錄(預設 /tmp 下的空目錄,見下)
//
// claude 子行程一律在**空目錄**跑(2026-08-13):
//   claude CLI 會自動把 cwd 及其各層父目錄的 CLAUDE.md 讀進 context。
//   cron 是 `cd /mnt/customers/aeiou.now` 之後才呼叫本支,所以原本每次翻譯都會把
//   /mnt/customers/aeiou.now/CLAUDE.md(17KB)與 /root/CLAUDE.md(7.8KB)整份拖進去。
//   實測(claude -p --output-format json,同一則 prompt):
//     cwd=/mnt/customers/aeiou.now → cache_creation 20854 tokens
//     cwd=/tmp 空目錄     → cache_creation  8635 tokens   ── 每次呼叫白花約 12,200 tokens
//   驗證方式:問「context 裡有沒有出現『守門七條』」,repo 目錄答 YES、空目錄答 NO。
//   除了浪費,更要命的是**翻譯結果會被手冊內容影響** —— 手冊被誰改一行,
//   譯文行為就可能跟著變。翻譯要的是這支腳本自己的 prompt,不是專案手冊。
//   空目錄必須在 /root 之外(/root/CLAUDE.md 會被 /root 底下任何 cwd 往上撿到)。

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CONFIG,
  LOCALES,
  api,
  openDb,
  beginJob,
  finishJob,
  acquireLock,
  slotStart,
  nowSec,
  log,
} from "./lib/aeiou-lib.mjs";

const JOB_NAME = "translate-posts";
const LIMIT = Math.min(50, Math.max(1, Number.parseInt(process.env.AEIOU_TRANSLATE_LIMIT || "50", 10) || 50));
const CHUNK = Math.max(1, Number.parseInt(process.env.AEIOU_TRANSLATE_CHUNK || "4", 10) || 4);
const CLAUDE_BIN = process.env.AEIOU_CLAUDE_BIN || "/root/.local/bin/claude";
// 模型必須 pin(2026-08-20):不帶 --model 時 CLI 會落在「當下的預設模型」,實測落點是
// claude-opus-5[1m] —— 1M context 檔次,連「回兩個字 OK」都因為 ~26k tokens 的系統基線
// (cache_creation 9,842 + cache_read 15,900)算出 $0.106。翻譯是機械任務,吃不到 Opus 的
// 推理力,卻要付最貴的檔次;而且「預設模型」會隨 CLI 版本漂移,等於管線成本不受本檔控制。
// seo-ops 全機隊的 reflect/brain 早就統一 sonnet(見 /mnt/customers/seo-ops/sites/*.json),這裡對齊。
const CLAUDE_MODEL = process.env.AEIOU_CLAUDE_MODEL || "claude-sonnet-5";
const CLAUDE_TIMEOUT_MS = Number.parseInt(process.env.AEIOU_CLAUDE_TIMEOUT_MS || "600000", 10);
// 固定路徑(不是 mkdtemp):每輪重用同一個空目錄,不會在 /tmp 累積;
// 被 /tmp 清理掉也沒關係,下面每次呼叫前都 mkdir -p。
const CLAUDE_CWD = process.env.AEIOU_CLAUDE_CWD || join(tmpdir(), "aeiou-translate-cwd");

const LOCALE_NAMES = {
  "zh-TW": "繁體中文(台灣)",
  en: "English",
  ja: "日本語",
  "zh-CN": "简体中文(中国大陆)",
  hi: "हिन्दी (Hindi)",
  id: "Bahasa Indonesia",
  "pt-BR": "Português (Brasil)",
};

// 主機 posts 的 23 欄,與 /internal/ugc/pending-translation 回傳完全對齊 → 可原樣 upsert
const POST_COLS = [
  "post_id", "topic_id", "cycle_id", "user_id", "anon_id",
  "original_locale", "content", "media_json", "target_country",
  "country_code", "city_code",
  "views", "unique_views", "comments", "likes", "shares",
  "cross_country_engagements", "hot_score",
  "status", "translation_status", "created_at", "last_activity_at", "archived_at",
];

// ---------- claude -p ----------

function buildPrompt(items) {
  return `你是全球議題平台的內容把關者兼專業社群翻譯者。以下每一則是**使用者貼文原文**。

第一步:價值判定(每一則都要判)。
只有以下情況判 "valuable": false —— 純廣告/推銷/導流連結、鍵盤亂打或隨機字元的無意義字串、
與表達無關的純灌水複製貼上、詐騙或色情內容。
判斷**從寬**:只要看得出是真人想表達的內容——再短、再口語、錯字連篇、單純一句感想或表情——一律 true。
不確定就 true。這不是品質評分,是垃圾過濾。

第二步:只把 "valuable": true 的則翻成它指定的每一個目標語言;false 的**完全不要翻**。

翻譯規則(逐條遵守):
- 保持原文的語氣、口語感、標點風格與**換行位置**(原文的換行要原樣保留)。
- 逐句忠實翻譯:不要改寫、不要摘要、不要增補、不要刪減、不要加註解或前言。
- 表情符號、@提及、網址、hashtag 原樣保留,不翻譯、不改寫。
- 專有名詞用該語言的慣用譯法;沒有慣用譯法就保留原文。
- 目標語言就是輸出語言,不要夾雜其他語言的說明。

輸出規則(違反即整批作廢):
- **只輸出一個 JSON 物件**,不要 markdown code fence,不要任何 JSON 以外的字元。
- 格式:{"judgments":[{"id":"<原樣抄回輸入的 id>","valuable":true,"reason":null}],
        "translations":[{"id":"<id>","locale":"<目標語言代碼>","content":"<譯文>"}]}
- judgments 必須涵蓋輸入中**每一個 id**,一個都不能少。
- valuable=false 時 "reason" 必填,只能是這五個字串之一:
  "commercial"(廣告/推銷/導流)、"bot"(亂打或隨機字元)、"spam"(灌水複製貼上)、
  "illegal"(詐騙)、"harassment"(色情或攻擊)。valuable=true 時 "reason" 填 null。
  這個值會進審核工作檯給人看,所以要說出**為什麼**被判掉,不能只說被判掉了。
- translations 必須為每一個 valuable=true 的 id 的**每一個目標語言**各輸出一筆,
  一筆都不能少、不能多;valuable=false 的 id 不得出現在 translations。
- content 內的換行用 \\n 轉義(合法 JSON 字串)。

輸入(JSON):
${JSON.stringify(items, null, 1)}
`;
}

function extractJson(raw) {
  let s = String(raw).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in claude output");
  return JSON.parse(s.slice(start, end + 1));
}

function runClaude(prompt) {
  // 空目錄要在這裡確保存在:/tmp 可能被清、cwd 不存在時 spawnSync 直接 ENOENT
  mkdirSync(CLAUDE_CWD, { recursive: true });
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL], {
    input: prompt,
    encoding: "utf8",
    timeout: CLAUDE_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    // cwd 決定 claude 會撿到哪些 CLAUDE.md — 見檔頭說明,不要改成 repo 目錄
    cwd: CLAUDE_CWD,
    env: { ...process.env, HOME: process.env.HOME || "/root" },
  });
  if (r.error) throw new Error(`claude spawn failed: ${r.error.message}`);
  if (r.status !== 0)
    // claude CLI 的錯誤常印在 stdout(不是 stderr),兩者都要留(2026-08-15 排錯教訓)
    throw new Error(
      `claude exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ""}: stderr=${String(r.stderr || "").slice(0, 200)} stdout=${String(r.stdout || "").slice(0, 300)}`
    );
  return r.stdout;
}

/** 判定+翻一批。回傳 { ok: Map<post_id,{locale:content}>, rejected: post_id[] };缺漏 → 整批 throw。 */
function translateChunk(posts) {
  const idOf = new Map(); // 短代號 ↔ post_id(不讓模型抄 26 字元 ULID,降低抄錯風險)
  const items = posts.map((p, i) => {
    const sid = `p${i + 1}`;
    idOf.set(sid, p.post_id);
    const targets = LOCALES.filter((l) => l !== p.original_locale);
    return {
      id: sid,
      source_locale: `${p.original_locale} (${LOCALE_NAMES[p.original_locale] || p.original_locale})`,
      targets: targets.map((l) => `${l} = ${LOCALE_NAMES[l]}`),
      target_codes: targets,
      content: p.content,
    };
  });

  const parsed = extractJson(runClaude(buildPrompt(items)));
  if (!parsed || !Array.isArray(parsed.translations))
    throw new Error("claude output has no translations array");
  if (!Array.isArray(parsed.judgments))
    throw new Error("claude output has no judgments array");

  // 價值判定:每個 id 都要有一筆;缺漏 → 整批作廢
  const valuable = new Map(); // post_id → boolean
  const reasons = new Map();  // post_id → 為什麼被判掉(進審核工作檯,2026-08-22 加)
  const REASONS = new Set(["commercial", "bot", "spam", "illegal", "harassment"]);
  for (const j of parsed.judgments) {
    if (!j || typeof j.id !== "string" || typeof j.valuable !== "boolean")
      throw new Error("malformed judgment entry in claude output");
    const postId = idOf.get(j.id);
    if (!postId) throw new Error(`claude judgment returned unknown id ${j.id}`);
    valuable.set(postId, j.valuable);
    // reason 只在判掉時要求。模型給了不在列舉裡的值就**當成沒給**而不是整批作廢 ——
    // 判定本身是對的,壞掉的只是分類標籤,為了標籤丟掉一整批翻譯不划算。
    if (j.valuable === false) reasons.set(postId, REASONS.has(j.reason) ? j.reason : "spam");
  }
  for (const p of posts)
    if (!valuable.has(p.post_id)) throw new Error(`missing judgment for ${p.post_id}`);
  const rejected = posts.filter((p) => valuable.get(p.post_id) === false).map((p) => p.post_id);

  const out = new Map();
  for (const t of parsed.translations) {
    if (!t || typeof t.id !== "string" || typeof t.locale !== "string" || typeof t.content !== "string")
      throw new Error("malformed translation entry in claude output");
    const postId = idOf.get(t.id);
    if (!postId) throw new Error(`claude returned unknown id ${t.id}`);
    if (valuable.get(postId) === false)
      throw new Error(`claude translated rejected post ${postId}`);
    if (!LOCALES.includes(t.locale)) throw new Error(`claude returned unknown locale ${t.locale}`);
    if (!out.has(postId)) out.set(postId, {});
    out.get(postId)[t.locale] = t.content;
  }

  // 嚴格驗收:valuable 的每則都要六語齊全且非空
  for (const p of posts) {
    if (valuable.get(p.post_id) === false) continue;
    const got = out.get(p.post_id) || {};
    for (const l of LOCALES) {
      if (l === p.original_locale) {
        if (got[l] !== undefined) delete got[l]; // 原文那一語不收(六語不是七語)
        continue;
      }
      if (typeof got[l] !== "string" || got[l].trim() === "")
        throw new Error(`missing/empty translation for ${p.post_id} locale ${l}`);
    }
  }
  return { ok: out, rejected, reasons };
}

// ---------- 主機回流 ----------

function upsertPost(db, post, translationStatus, statusOverride = null) {
  const existed = db.prepare("SELECT 1 FROM posts WHERE post_id = ?").get(post.post_id) !== undefined;
  const values = POST_COLS.map((c) =>
    c === "translation_status"
      ? translationStatus
      : c === "status" && statusOverride
        ? statusOverride
        : post[c] === undefined
          ? null
          : post[c]
  );
  const setClause = POST_COLS.filter((c) => c !== "post_id")
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");
  db.prepare(
    `INSERT INTO posts (${POST_COLS.join(", ")}) VALUES (${POST_COLS.map(() => "?").join(", ")})
     ON CONFLICT (post_id) DO UPDATE SET ${setClause}`
  ).run(...values);
  return existed;
}

function upsertI18n(db, postId, locale, content, at) {
  const existed =
    db.prepare("SELECT 1 FROM post_i18n WHERE post_id = ? AND locale = ?").get(postId, locale) !== undefined;
  db.prepare(
    `INSERT INTO post_i18n (post_id, locale, content, translated_at, translator)
     VALUES (?, ?, ?, ?, 'claude')
     ON CONFLICT (post_id, locale) DO UPDATE SET
       content = excluded.content, translated_at = excluded.translated_at, translator = excluded.translator`
  ).run(postId, locale, content, at);
  return existed;
}

/** 主機已備齊六語 → 這則不必再叫 claude(重試路徑省 token) */
function existingTranslations(db, post) {
  const need = LOCALES.filter((l) => l !== post.original_locale);
  const rows = db.prepare("SELECT locale, content FROM post_i18n WHERE post_id = ?").all(post.post_id);
  const have = {};
  for (const r of rows) if (need.includes(r.locale) && r.content && r.content.trim() !== "") have[r.locale] = r.content;
  return need.every((l) => have[l] !== undefined) ? have : null;
}

// ---------- 主流程 ----------

const db = openDb();
const scheduledAt = slotStart(900);

const lock = acquireLock(db, { jobName: JOB_NAME, scheduledAt });
if (!lock.ok) {
  log(`[${JOB_NAME}] skip: ${lock.reason}`);
  db.close();
  process.exit(0);
}

const job = beginJob(db, { jobName: JOB_NAME, scheduledAt });
log(`[${JOB_NAME}] job_id=${job.job_id} attempt=${job.attempt} api=${CONFIG.apiUrl} limit=${LIMIT} chunk=${CHUNK}`);

let read = 0, created = 0, updated = 0, failed = 0;
const errors = [];

try {
  const fetched = (await api(`/internal/ugc/pending-translation?limit=${LIMIT}`)).posts || [];
  read = fetched.length;
  log(`[${JOB_NAME}] fetched ${read} pending post(s)`);

  if (read === 0) {
    finishJob(db, job, { status: "success", read: 0 });
    log(`[${JOB_NAME}] success (nothing to do)`);
    db.close();
    process.exit(0);
  }

  // 契約檢查:回傳欄位必須夠原樣 upsert 進主機 posts
  const missingCols = POST_COLS.filter((c) => !(c in fetched[0]));
  if (missingCols.length > 0)
    throw new Error(`contract gap: pending-translation is missing host posts columns: ${missingCols.join(",")}`);

  // 已在主機備齊六語的先分流
  const cached = [];
  const todo = [];
  for (const p of fetched) {
    const have = existingTranslations(db, p);
    if (have) cached.push([p, have]);
    else todo.push(p);
  }
  if (cached.length > 0) log(`[${JOB_NAME}] ${cached.length} post(s) already fully translated on host — skipping claude`);

  const okPairs = cached.slice(); // [[post, {locale: content}], ...]
  const rejectedIds = []; // 價值閘門判定沒價值 → moderation + skipped,不翻不露出
  const rejectReasons = new Map(); // post_id → 為什麼(2026-08-22:要進審核工作檯)

  for (let i = 0; i < todo.length; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK);
    const label = `${i / CHUNK + 1}/${Math.ceil(todo.length / CHUNK)}`;
    log(`[${JOB_NAME}] claude batch ${label}: ${chunk.length} post(s) × 6 locales`);
    try {
      const { ok: map, rejected, reasons } = translateChunk(chunk);
      for (const p of chunk) if (map.has(p.post_id)) okPairs.push([p, map.get(p.post_id)]);
      rejectedIds.push(...rejected);
      for (const [pid, why] of reasons) rejectReasons.set(pid, why);
      log(`[${JOB_NAME}] claude batch ${label}: ok (${rejected.length} rejected)`);
    } catch (e) {
      failed += chunk.length;
      const msg = `batch ${label} failed (${chunk.map((p) => p.post_id).join(",")}): ${e.message || e}`;
      errors.push(msg);
      log(`[${JOB_NAME}] ${msg}`);
    }
  }

  const okIds = new Set(okPairs.map(([p]) => p.post_id));
  const rejectedSet = new Set(rejectedIds);
  const at = nowSec();

  // ---- 步驟 A:回流主機(先寫主機,再回寫 D1) ----
  // 被拒的也鏡射(status='moderation'):留紀錄且冪等,不會殘留舊的 translating 狀態
  db.exec("BEGIN");
  try {
    for (const p of fetched) {
      const done = okIds.has(p.post_id);
      const rej = rejectedSet.has(p.post_id);
      const existed = upsertPost(
        db,
        p,
        done ? "done" : rej ? "skipped" : "translating",
        rej ? "moderation" : null
      );
      existed ? updated++ : created++;
    }
    for (const [p, map] of okPairs) {
      for (const [locale, content] of Object.entries(map)) {
        const existed = upsertI18n(db, p.post_id, locale, content, at);
        existed ? updated++ : created++;
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  log(`[${JOB_NAME}] host upsert: ${okPairs.length} post(s) done, ${fetched.length - okPairs.length} left translating`);

  // ---- 步驟 B:回寫 D1 ----
  const translations = [];
  for (const [p, map] of okPairs)
    for (const [locale, content] of Object.entries(map))
      translations.push({ post_id: p.post_id, locale, content, translated_at: at, translator: "claude" });

  if (translations.length > 0 || rejectedIds.length > 0) {
    const res = await api("/internal/translations", {
      method: "POST",
      body: { translations, done_post_ids: [...okIds], rejected_post_ids: rejectedIds },
    });
    log(`[${JOB_NAME}] worker: ${JSON.stringify(res)}`);
  }

  // 價值閘門判掉的貼文進審核工作檯(2026-08-22)。在這一版之前它們只是靜靜地變成
  // status='moderation' —— **沒有任何人看得到那件事發生過**,也沒有翻案的路徑。
  // 建檔用 (target_type, target_id) 冪等;decided_by='llm' 與規則層的 'rule' 分開,
  // 兩層誤判的樣態不同,混在一起就分不出該調哪一層。
  if (rejectedIds.length > 0) {
    const insQ = db.prepare(
      `INSERT INTO moderation_queue
         (item_id, target_type, target_id, reason, reported_by, severity, status,
          decision, decided_by, created_at, resolved_at)
       VALUES (?, 'post', ?, ?, NULL, 'medium', 'resolved', 'hide', 'llm', ?, ?)`,
    );
    const hasQ = db.prepare(
      "SELECT 1 AS x FROM moderation_queue WHERE target_type = 'post' AND target_id = ?",
    );
    const ts = nowSec();
    let queued = 0;
    for (const pid of rejectedIds) {
      if (hasQ.get(pid)) continue;
      insQ.run(`mod_${randomUUID().replace(/-/g, "").slice(0, 24)}`, pid,
        rejectReasons.get(pid) || "spam", ts, ts);
      queued += 1;
    }
    if (queued > 0) log(`[${JOB_NAME}] 價值閘門判掉 ${queued} 則,已建檔進 moderation_queue`);
  }

  const status = failed === 0 ? "success" : okIds.size > 0 ? "partial_success" : "failed";
  finishJob(db, job, {
    status,
    read,
    created,
    updated,
    failed,
    error: errors.length > 0 ? errors.join(" | ") : null,
  });
  log(`[${JOB_NAME}] ${status}: read=${read} created=${created} updated=${updated} failed=${failed} rejected=${rejectedIds.length}`);
  db.close();
  if (status === "failed") process.exit(1);
} catch (e) {
  const done = finishJob(db, job, {
    status: "failed",
    read,
    created,
    updated,
    failed,
    error: [...errors, String((e && (e.stack || e.message)) || e)].join(" | "),
  });
  log(`[${JOB_NAME}] FAILED status=${done.status} next_retry_at=${done.next_retry_at ?? "NULL"}: ${e.message || e}`);
  db.close();
  process.exit(1);
}
