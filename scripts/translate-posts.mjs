#!/usr/bin/env node
// aeiou.now — 貼文翻譯管線(Track D / W4.2)
//   node scripts/translate-posts.mjs
//
// 整條管線最重要的一支,也是 **UGC 回流主機的唯一通道**:
// 沒有它,主機端 post_highlights 與靜態 highlights.json 永遠拿不到資料。
//
// 流程:
//   1. GET  /internal/ugc/pending-translation?limit=50   撈 D1 待翻 post(Worker 同時標 translating)
//   2. 每則翻**六語**(七語系扣掉 original_locale;原文即該語,不重複翻),
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

import { spawnSync } from "node:child_process";
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
const CLAUDE_TIMEOUT_MS = Number.parseInt(process.env.AEIOU_CLAUDE_TIMEOUT_MS || "600000", 10);

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
  return `你是專業的社群內容翻譯者。以下每一則是全球議題平台上的**使用者貼文原文**,請把每一則翻成它指定的每一個目標語言。

翻譯規則(逐條遵守):
- 保持原文的語氣、口語感、標點風格與**換行位置**(原文的換行要原樣保留)。
- 逐句忠實翻譯:不要改寫、不要摘要、不要增補、不要刪減、不要加註解或前言。
- 表情符號、@提及、網址、hashtag 原樣保留,不翻譯、不改寫。
- 專有名詞用該語言的慣用譯法;沒有慣用譯法就保留原文。
- 目標語言就是輸出語言,不要夾雜其他語言的說明。

輸出規則(違反即整批作廢):
- **只輸出一個 JSON 物件**,不要 markdown code fence,不要任何 JSON 以外的字元。
- 格式:{"translations":[{"id":"<原樣抄回輸入的 id>","locale":"<目標語言代碼>","content":"<譯文>"}]}
- 必須為輸入中**每一組 (id, locale) 組合**都輸出一筆,一筆都不能少、不能多。
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
  const r = spawnSync(CLAUDE_BIN, ["-p"], {
    input: prompt,
    encoding: "utf8",
    timeout: CLAUDE_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, HOME: process.env.HOME || "/root" },
  });
  if (r.error) throw new Error(`claude spawn failed: ${r.error.message}`);
  if (r.status !== 0)
    throw new Error(`claude exited ${r.status}${r.signal ? ` (signal ${r.signal})` : ""}: ${String(r.stderr || "").slice(0, 300)}`);
  return r.stdout;
}

/** 翻一批(多則 × 六語)。回傳 Map<post_id, {locale: content}>;任何一組缺漏 → 整批 throw。 */
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

  const out = new Map();
  for (const t of parsed.translations) {
    if (!t || typeof t.id !== "string" || typeof t.locale !== "string" || typeof t.content !== "string")
      throw new Error("malformed translation entry in claude output");
    const postId = idOf.get(t.id);
    if (!postId) throw new Error(`claude returned unknown id ${t.id}`);
    if (!LOCALES.includes(t.locale)) throw new Error(`claude returned unknown locale ${t.locale}`);
    if (!out.has(postId)) out.set(postId, {});
    out.get(postId)[t.locale] = t.content;
  }

  // 嚴格驗收:每則都要六語齊全且非空
  for (const p of posts) {
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
  return out;
}

// ---------- 主機回流 ----------

function upsertPost(db, post, translationStatus) {
  const existed = db.prepare("SELECT 1 FROM posts WHERE post_id = ?").get(post.post_id) !== undefined;
  const values = POST_COLS.map((c) =>
    c === "translation_status" ? translationStatus : post[c] === undefined ? null : post[c]
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

  for (let i = 0; i < todo.length; i += CHUNK) {
    const chunk = todo.slice(i, i + CHUNK);
    const label = `${i / CHUNK + 1}/${Math.ceil(todo.length / CHUNK)}`;
    log(`[${JOB_NAME}] claude batch ${label}: ${chunk.length} post(s) × 6 locales`);
    try {
      const map = translateChunk(chunk);
      for (const p of chunk) okPairs.push([p, map.get(p.post_id)]);
      log(`[${JOB_NAME}] claude batch ${label}: ok`);
    } catch (e) {
      failed += chunk.length;
      const msg = `batch ${label} failed (${chunk.map((p) => p.post_id).join(",")}): ${e.message || e}`;
      errors.push(msg);
      log(`[${JOB_NAME}] ${msg}`);
    }
  }

  const okIds = new Set(okPairs.map(([p]) => p.post_id));
  const at = nowSec();

  // ---- 步驟 A:回流主機(先寫主機,再回寫 D1) ----
  db.exec("BEGIN");
  try {
    for (const p of fetched) {
      const done = okIds.has(p.post_id);
      const existed = upsertPost(db, p, done ? "done" : "translating");
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

  if (translations.length > 0) {
    const res = await api("/internal/translations", {
      method: "POST",
      body: { translations, done_post_ids: [...okIds] },
    });
    log(`[${JOB_NAME}] worker: ${JSON.stringify(res)}`);
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
  log(`[${JOB_NAME}] ${status}: read=${read} created=${created} updated=${updated} failed=${failed}`);
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
