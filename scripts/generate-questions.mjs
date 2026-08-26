#!/usr/bin/env node
// ===========================================================================
// aeiou.now — 每日世界一問題庫產生器(2026-08-26 新增,同日改成並行＋增量寫回)
// ===========================================================================
//
// 用法(裸執行＝把題庫補到「最後一題之後再 90 天」,寫回 content/questions.json):
//   node scripts/generate-questions.mjs
//   node scripts/generate-questions.mjs --until 2027-01-14   補到某一天為止(含)
//   node scripts/generate-questions.mjs --days 30            只補 30 天
//   node scripts/generate-questions.mjs --concurrency 6      同時跑幾個 claude(預設 4)
//   node scripts/generate-questions.mjs --dry-run            只印,不寫檔
//   node scripts/generate-questions.mjs --from 2026-10-17
//
// -- 為什麼要有這一支 ------------------------------------------------------
// 題庫是人工編輯的(content/questions.json,規格見 docs/briefs/daily-question.md),
// 每天吃掉兩題,所以**它會反覆見底**。手寫不是答案:一題 guess 要七語的 explain,
// 單題就是七語共約八千字。這支把它變成可重複執行的一條指令。
//
// -- 最重要的一條:**事實只能來自已經有來源的散文** ------------------------
// 這支**不准** claude 自己生出制度事實。每次呼叫都把該 Topic 已經寫好、已經逐條掛過
// 官方來源的七語內容(topic_i18n 的 summary、topic_observance_i18n 的 customs、
// topic_country_i18n 的 regional note)整份餵進 prompt,並要求:
//   「只能改寫這些段落裡已經出現的事實,不得引入任何段落裡沒有的日期、法條、數字或機構名」
// 理由:explain 讀起來就是一段有法條的敘述,而站上每一條文化事實都要能點回原始來源
// (docs/03-topic-content.md 硬規則 2)。讓模型自由發揮等於在題庫裡種下沒有來源的斷言。
//
// -- 並行與增量寫回(2026-08-26;序列版跑 86 天要四小時,中途被殺全部消失) --
// * **並行**:一次開 N 個 `claude -p` 子行程(--concurrency,預設 4)。
//   claude CLI 是訂閱版,並行度開太高只會排隊或被限流,不會更快 —— 調之前先量吞吐
//   (本支結束時會印「實測吞吐」那一行)。
// * **增量寫回**:每完成一天就把整份題庫重寫回檔(tmp + rename,不會寫到一半被中斷)。
//   所以任何時候被殺,已完成的天數都已經在檔案裡。
// * **冪等**:啟動時讀現有題庫,**已經有題目的日期直接跳過**,只補缺的。
//   中斷了不必算補到哪、也不必挑日期,原指令再跑一次就好。
// * 選題在派工**之前**就一次排定(決定性:同一份題庫 + 同一組日期 → 同一組 Topic),
//   否則並行之下「同一個 Topic 不連續兩天」這條會因為完成順序不同而每次跑出不一樣的結果。
//
// -- 選題怎麼排 ------------------------------------------------------------
// 依日期挑「當令」的 Topic:優先取該日之後 60 天內有 occurrence 的 Topic,
// 沒有就退回長青型(is_perennial)。同一個 Topic 不連續兩天出現,避免題庫看起來只有幾個主題。
//
// -- 驗證 ------------------------------------------------------------------
// 產出後**用與匯入器相同的規則自驗**(七語齊、guess 必有 answer∈option ids 與 explain、
// poll 的 answer/explain 必須是 null、id 不重複、topic 是既有 slug),不過就整題丟掉重試。
// 寫回檔案之後仍然要跑 `node scripts/import-questions.mjs` —— 那才是權威閘門。
//
// -- 檔案格式(不要改) ----------------------------------------------------
// content/questions.json 是**人工編輯的檔**:縮排 2、排序 date ASC 且同日 poll 在 guess 前
// (與 docs/briefs/daily-question.md §5 的匯出順序一致)。寫回時照樣輸出,
// 否則每跑一次就製造一萬行的假 diff,真正新增的那幾天會被埋掉。
//
// claude 子行程一律在 /root 之外的空目錄跑,並明寫 --model
// (兩條都是紅線,緣由見 scripts/translate-posts.mjs 檔頭)。

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, log } from "./lib/aeiou-lib.mjs";

const LOCALES = ["zh-TW", "en", "ja", "zh-CN", "hi", "id", "pt-BR"];
const QUESTIONS = join(ROOT, "content", "questions.json");
const DATA = join(ROOT, "data");
const CLAUDE_BIN = process.env.AEIOU_CLAUDE_BIN || "/root/.local/bin/claude";
const CLAUDE_MODEL = process.env.AEIOU_CLAUDE_MODEL || "claude-sonnet-5";
const CLAUDE_CWD = process.env.AEIOU_CLAUDE_CWD || join(tmpdir(), "aeiou-questions-cwd");
const TIMEOUT_MS = Number(process.env.AEIOU_CLAUDE_TIMEOUT_MS || 600000);

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const numArg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  const n = i >= 0 ? Number(argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};
const strArg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};
const CONCURRENCY = numArg("concurrency", 4);
const ATTEMPTS = numArg("attempts", 2);

const addDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// ---------- 既有題庫 ----------
const bank = JSON.parse(readFileSync(QUESTIONS, "utf8"));
const existing = Array.isArray(bank.questions) ? bank.questions : [];
const seenIds = new Set(existing.map((q) => q.id));
const datesWithQuestions = new Set(existing.map((q) => q.date));
const lastDate = existing.map((q) => q.date).sort().pop();
const FROM = strArg("from") || addDays(lastDate, 1);
const UNTIL = strArg("until");
const DAYS = UNTIL ? Math.max(0, daysBetween(FROM, UNTIL) + 1) : numArg("days", 90);

// ---------- Topic 素材(只用已經有來源的那幾份) ----------
const readJson = (rel, fallback = null) => {
  const p = join(DATA, rel);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : fallback;
};
// Topic 清單直接掃 data/topics/ 底下的目錄 —— index/ 是**逐語系**的七份清單,
// 拿其中一份當唯一來源等於默認那一份最全。掃目錄不會漏。
const topicIds = readdirSync(join(DATA, "topics")).filter((name) => name.startsWith("top_"));

const material = new Map(); // slug -> { slug, isPerennial, dates:[iso], text:{locale:string} }
for (const id of topicIds) {
  const facts = readJson(`topics/${id}/facts.json`);
  const i18n = readJson(`topics/${id}/i18n.json`);
  if (!facts?.slug || !i18n) continue;
  if (facts.status && facts.status !== "active") continue;
  const text = {};
  for (const locale of LOCALES) {
    const parts = [i18n.locales?.[locale]?.summary || ""];
    for (const per of Object.values(i18n.observances || {})) if (per?.[locale]) parts.push(per[locale]);
    for (const per of Object.values(i18n.regional_notes || {})) if (per?.[locale]) parts.push(per[locale]);
    text[locale] = parts.filter(Boolean).join("\n\n");
  }
  const dates = [];
  for (const o of facts.observances || []) {
    for (const occ of o.occurrences || []) if (occ.starts_on) dates.push(occ.starts_on);
  }
  material.set(facts.slug, {
    slug: facts.slug,
    title: i18n.locales?.["zh-TW"]?.title || facts.slug,
    isPerennial: Boolean(facts.is_perennial),
    dates: [...new Set(dates)].sort(),
    text,
  });
}

/** 當令優先:該日之後 60 天內有 occurrence 的 Topic;沒有就退長青。 */
function pickTopic(date, avoid) {
  const soon = [...material.values()]
    .filter((m) => m.slug !== avoid)
    .map((m) => ({ m, d: m.dates.find((x) => x >= date && x <= addDays(date, 60)) }))
    .filter((x) => x.d)
    .sort((a, b) => a.d.localeCompare(b.d) || a.m.slug.localeCompare(b.m.slug));
  if (soon.length > 0) return soon[0].m;
  const perennial = [...material.values()].filter((m) => m.isPerennial && m.slug !== avoid);
  const pool = perennial.length > 0 ? perennial : [...material.values()].filter((m) => m.slug !== avoid);
  // 決定性挑選:用日期字串當種子,避免每次執行結果不同(重跑要可重現)。
  const seed = [...date].reduce((a, c) => a + c.charCodeAt(0), 0);
  return pool[seed % pool.length];
}

// ---------- 派工單:先排定,再並行 ----------
// 「同一個 Topic 不連續兩天」是**沿著日期**判斷的,所以必須在派工前一次算完;
// 放到 worker 裡算會變成「看誰先跑完」,同一份輸入跑兩次結果不同。
const plan = [];
let prev = null;
for (let i = 0; i < DAYS; i += 1) {
  const date = addDays(FROM, i);
  if (datesWithQuestions.has(date)) { prev = null; continue; } // 已有題目 → 冪等跳過
  const topic = pickTopic(date, prev);
  plan.push({ date, topic });
  prev = topic.slug;
}
const skipped = DAYS - plan.length;
log(
  `[generate-questions] 素材:${material.size} 個 Topic;題庫最後一天 ${lastDate};` +
  `範圍 ${FROM} → ${DAYS > 0 ? addDays(FROM, DAYS - 1) : FROM}(${DAYS} 天),` +
  `已有 ${skipped} 天跳過,要產 ${plan.length} 天,並行 ${CONCURRENCY}`
);

// ---------- claude(非同步,可並行) ----------
mkdirSync(CLAUDE_CWD, { recursive: true });
function callClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL], {
      cwd: CLAUDE_CWD, stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`claude 逾時(${TIMEOUT_MS}ms)`));
    }, TIMEOUT_MS);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      reject(new Error(`claude 呼叫失敗:${e.message}`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (code !== 0) { reject(new Error(`claude 非 0 結束(${code}):${String(err).slice(0, 300)}`)); return; }
      const start = out.indexOf("{");
      const end = out.lastIndexOf("}");
      if (start < 0 || end <= start) { reject(new Error(`claude 回傳裡找不到 JSON:${out.slice(0, 200)}`)); return; }
      try { resolve(JSON.parse(out.slice(start, end + 1))); }
      catch (e) { reject(new Error(`JSON 解析失敗:${e.message}`)); }
    });
    child.stdin.on("error", () => {}); // 子行程先死時 EPIPE,已由 close/error 處理
    child.stdin.end(prompt);
  });
}

const localeList = LOCALES.map((l) => `"${l}"`).join(", ");

function buildPrompt(date, topic) {
  return `你在替一個叫 aeiou.now 的網站寫「每日世界一問」。輸出**只有 JSON**,不要任何說明文字、不要 markdown 圍籬。

## 這一天的主題
slug: ${topic.slug}

## 可以使用的事實(以下是這個主題已經寫好、且每一條都掛過官方來源的內容)

${LOCALES.map((l) => `--- ${l} ---\n${topic.text[l]}`).join("\n\n")}

## 硬規則(違反就整題作廢)
1. **事實只能來自上面那些段落。** 不得引入上面沒有出現的日期、法條編號、數字、機構名稱或國家。
   寧可寫得普通,也不要寫出上面查不到的東西。
2. 產出兩題:一題 kind="poll"(問讀者自己的經驗,沒有標準答案),一題 kind="guess"(猜哪一個國家)。
3. 七個語系全部要有,key 恰好是:${localeList}。每一個都要是**該語言自己的說法**,不是直譯。
4. poll:4 個選項,每個有 id(小寫英數與連字號)、emoji、七語 label。answer 與 explain 必須是 null。
5. guess:4 個選項,每個 id 用該國對應的 locale 代碼(${localeList} 之一)、emoji 用該國國旗、七語 label 是國名。
   必須有 answer(等於其中一個 option id)與七語 explain。
   explain 先講答案是哪一國與依據,再用上面段落裡出現過的其他國家做對照,大約 250-400 字(中文)。
6. 語氣:陳述事實,不推銷、不用驚嘆號、不寫「你知道嗎」這類開場。

## 輸出格式(逐字照這個結構,date 與 topic 已經填好,不要改)
{
 "poll": {"id":"q-${date.replaceAll("-", "")}-<英文短名>","date":"${date}","kind":"poll","topic":"${topic.slug}","asker":null,"target":null,"answer":null,"explain":null,
   "text":{${localeList.split(", ").map((l) => `${l}:"…"`).join(",")}},
   "options":[{"id":"…","emoji":"…","label":{${localeList.split(", ").map((l) => `${l}:"…"`).join(",")}}}]},
 "guess": {"id":"q-${date.replaceAll("-", "")}-<英文短名>","date":"${date}","kind":"guess","topic":"${topic.slug}","asker":null,"target":null,
   "answer":"<option id>",
   "text":{…七語…},
   "options":[…4 個…],
   "explain":{…七語…}}
}`;
}

// ---------- 自驗(與 import-questions.mjs 同一套規則) ----------
const hasAll = (o) => o && typeof o === "object" && LOCALES.every((l) => typeof o[l] === "string" && o[l].trim() !== "");
function validate(q, date, slug, ids) {
  const e = [];
  if (typeof q?.id !== "string" || !/^[a-z0-9-]+$/.test(q.id)) e.push("id 格式");
  else if (ids.has(q.id)) e.push(`id 重複:${q.id}`);
  if (q?.date !== date) e.push("date 不符");
  if (q?.topic !== slug) e.push("topic 不符");
  if (!["poll", "guess"].includes(q?.kind)) e.push("kind");
  if (!hasAll(q?.text)) e.push("text 缺語系");
  if (!Array.isArray(q?.options) || q.options.length < 2) e.push("options 太少");
  else {
    const optIds = new Set();
    for (const o of q.options) {
      if (typeof o?.id !== "string" || !/^[a-zA-Z0-9-]+$/.test(o.id)) e.push("option id 格式");
      if (optIds.has(o?.id)) e.push("option id 重複");
      optIds.add(o?.id);
      if (typeof o?.emoji !== "string" || !o.emoji.trim()) e.push("option 缺 emoji");
      if (!hasAll(o?.label)) e.push("option label 缺語系");
    }
    if (q.kind === "guess" && !optIds.has(q?.answer)) e.push("answer 不在 options 裡");
  }
  if (q?.kind === "guess" && !hasAll(q?.explain)) e.push("explain 缺語系");
  if (q?.kind === "poll" && (q?.answer != null || q?.explain != null)) e.push("poll 的 answer/explain 必須是 null");
  return e;
}

// ---------- 增量寫回 ----------
// 檔案格式規定見檔頭:縮排 2、date ASC、同日 poll 在 guess 前。
const KIND_ORD = { poll: 0, guess: 1 };
const generated = [];
function flush() {
  if (DRY_RUN) return;
  const all = [...existing, ...generated].sort(
    (a, b) => a.date.localeCompare(b.date) || (KIND_ORD[a.kind] ?? 9) - (KIND_ORD[b.kind] ?? 9) || a.id.localeCompare(b.id)
  );
  const tmp = `${QUESTIONS}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ ...bank, questions: all }, null, 2)}\n`, "utf8");
  renameSync(tmp, QUESTIONS); // rename 是原子的:被殺時檔案不是舊的就是新的,不會是半份
}

// ---------- 主流程:worker pool ----------
const startedAt = Date.now();
const failures = [];
let cursor = 0;
let doneCount = 0;

async function worker() {
  for (;;) {
    const i = cursor;
    cursor += 1;
    if (i >= plan.length) return;
    const { date, topic } = plan[i];
    let ok = false;
    for (let attempt = 1; attempt <= ATTEMPTS && !ok; attempt += 1) {
      let out;
      const t0 = Date.now();
      try {
        out = await callClaude(buildPrompt(date, topic));
      } catch (err) {
        log(`[generate-questions] ${date} ${topic.slug} 第 ${attempt} 次呼叫失敗(${Math.round((Date.now() - t0) / 1000)}s):${err.message}`);
        continue;
      }
      // 以下到 flush() 之間沒有 await —— 單執行緒下是一段不可分割的臨界區,
      // 所以 seenIds 的唯一性檢查在並行之下仍然成立。
      const pair = [out?.poll, out?.guess];
      const errs = pair.flatMap((q, k) => validate(q, date, topic.slug, seenIds).map((x) => `${k ? "guess" : "poll"}:${x}`));
      if (errs.length > 0) {
        log(`[generate-questions] ${date} ${topic.slug} 第 ${attempt} 次不合格:${errs.slice(0, 4).join("、")}`);
        continue;
      }
      for (const q of pair) { seenIds.add(q.id); generated.push(q); }
      ok = true;
      doneCount += 1;
      flush(); // 每完成一天就落地
      const el = (Date.now() - startedAt) / 1000;
      log(
        `[generate-questions] ${date} ${topic.slug} ✓ (${Math.round((Date.now() - t0) / 1000)}s;` +
        `進度 ${doneCount}/${plan.length},已跑 ${Math.round(el)}s,平均 ${(el / doneCount).toFixed(1)}s/天)`
      );
    }
    if (!ok) { failures.push({ date, slug: topic.slug }); log(`[generate-questions] ⚠ ${date} 放棄(${topic.slug})`); }
  }
}

await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(plan.length, 1)) }, () => worker()));

const elapsed = (Date.now() - startedAt) / 1000;
log(`[generate-questions] 產出 ${generated.length} 題(${generated.length / 2} 天),放棄 ${failures.length} 天`);
if (doneCount > 0) {
  log(
    `[generate-questions] 實測吞吐:並行 ${CONCURRENCY},${doneCount} 天 / ${Math.round(elapsed)}s ` +
    `= ${(elapsed / doneCount).toFixed(1)}s/天(牆鐘),換算 ${(3600 / (elapsed / doneCount)).toFixed(1)} 天/小時`
  );
}
if (failures.length > 0) {
  log(`[generate-questions] 放棄的日期(直接重跑同一條指令就會只補這幾天):${failures.map((f) => f.date).join(" ")}`);
}
if (DRY_RUN) {
  log("[generate-questions] --dry-run:不寫檔");
  console.log(JSON.stringify(generated.slice(0, 2), null, 1));
  process.exit(failures.length > 0 ? 1 : 0);
}
if (generated.length === 0) {
  log(plan.length === 0 ? "[generate-questions] 沒有缺的日期,檔案不動。" : "[generate-questions] 沒有產出,不動檔案");
  process.exit(plan.length === 0 ? 0 : 1);
}
log(`[generate-questions] 已寫回 ${QUESTIONS}:+${generated.length} 題。接著跑 node scripts/import-questions.mjs 驗證。`);
process.exit(failures.length > 0 ? 1 : 0);
