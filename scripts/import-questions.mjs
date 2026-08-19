#!/usr/bin/env node
// import-questions.mjs — 把 content/questions.json 匯入主機 SQLite(每日世界一問題庫的人工維護入口)
//
//   人工編輯 content/questions.json
//     → node scripts/import-questions.mjs      (本腳本;冪等,可重跑)
//     → node scripts/export-data.mjs            (產 data/questions/<locale>.json)
//     → sync-questions-to-d1.mjs 推精簡副本進 D1(供 Worker 驗票)
//
// 格式規格權威:docs/briefs/daily-question.md §1、§2;檔案格式見 content/questions.json 內 $comment。
//
// 寫入語意 = content 是權威:questions / question_i18n / question_options / question_option_i18n
// 四張表**整組 DELETE 重建**,單一 transaction(比 import-topics.mjs 逐檔替換更簡單,
// 因為題庫只有一個檔案)。驗證**先做完、彙總一次 throw**,失敗時完全不碰 DB
// (BEGIN 在驗證通過之後才下)。
//
// 環境變數:
//   QUESTIONS_FILE  題庫檔路徑(預設 content/questions.json;測試逃生口,裸執行請勿設)
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "db", "aeiou.sqlite");
const QUESTIONS_FILE = process.env.QUESTIONS_FILE || join(ROOT, "content", "questions.json");
const LOCALES = ["zh-TW", "en", "ja", "zh-CN", "hi", "id", "pt-BR"];
const KINDS = ["poll", "guess"];

// ---------- 讀檔 ----------
if (!existsSync(QUESTIONS_FILE)) {
  console.error(`找不到 ${QUESTIONS_FILE}——題庫檔在這裡(見 docs/briefs/daily-question.md §1)`);
  process.exit(2);
}
let doc;
try {
  doc = JSON.parse(readFileSync(QUESTIONS_FILE, "utf8"));
} catch (e) {
  console.error(`${QUESTIONS_FILE}:JSON 解析失敗:${e.message}`);
  process.exit(2);
}
const questions = Array.isArray(doc.questions) ? doc.questions : null;
if (!questions) {
  console.error(`${QUESTIONS_FILE}:頂層缺 "questions" 陣列`);
  process.exit(2);
}

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA busy_timeout = 15000;"); // 整點 */15 與 0 * * * * 兩條 cron 會併發碰同一顆 DB;遇鎖等待而非 SQLITE_BUSY 直接炸(同 lib openDb)
db.exec("PRAGMA foreign_keys = ON;");

// slug -> {topic_id, status};import 時把 topic slug 解析成 topic_id
const topicRows = db.prepare("SELECT topic_id, slug, status FROM topics").all();
const topicBySlug = new Map(topicRows.map((r) => [r.slug, r]));

// ---------- 驗證(缺什麼講清楚,彙總一次 throw;此時尚未碰 DB 寫入) ----------
const errs = [];
const seenIds = new Set();
const isLocale = (v) => v === null || LOCALES.includes(v);
const hasAllLocales = (obj) => obj && typeof obj === "object" && LOCALES.every((l) => typeof obj[l] === "string" && obj[l].trim() !== "");
const missingLocales = (obj) => LOCALES.filter((l) => !(obj && typeof obj[l] === "string" && obj[l].trim() !== ""));

const resolved = []; // 驗證通過的題目,附解析後的 topic_id,供寫入階段直接用

questions.forEach((q, idx) => {
  const tag = `questions[${idx}]${q && q.id ? ` (${q.id})` : ""}`;

  if (!q || typeof q !== "object") { errs.push(`${tag}:不是物件`); return; }

  // id 唯一
  if (!q.id || typeof q.id !== "string") errs.push(`${tag}:缺 id`);
  else if (seenIds.has(q.id)) errs.push(`id「${q.id}」重複`);
  else seenIds.add(q.id);

  // date 格式
  if (!q.date || !/^\d{4}-\d{2}-\d{2}$/.test(q.date)) errs.push(`${tag}:date 格式要是 YYYY-MM-DD:「${q.date}」`);

  // kind
  if (!KINDS.includes(q.kind)) errs.push(`${tag}:kind 要是 poll|guess:「${q.kind}」`);

  // topic slug 存在且非 merged/candidate
  let topic = null;
  if (!q.topic || typeof q.topic !== "string") {
    errs.push(`${tag}:缺 topic(slug)`);
  } else {
    topic = topicBySlug.get(q.topic) || null;
    if (!topic) errs.push(`${tag}:topic slug「${q.topic}」在 topics 表不存在`);
    else if (["merged", "candidate"].includes(topic.status)) {
      errs.push(`${tag}:topic slug「${q.topic}」status=${topic.status}(不可為 merged/candidate)`);
    }
  }

  // asker/target:null 或合法 locale
  if (!isLocale(q.asker ?? null)) errs.push(`${tag}:asker 不是合法 locale 或 null:「${q.asker}」`);
  if (!isLocale(q.target ?? null)) errs.push(`${tag}:target 不是合法 locale 或 null:「${q.target}」`);

  // text 七語齊
  if (!hasAllLocales(q.text)) errs.push(`${tag}:text 缺語系:${missingLocales(q.text).join(" ") || "(整個 text 缺)"}`);

  // options:陣列、id 題內唯一、每個 option label 七語齊
  const options = Array.isArray(q.options) ? q.options : null;
  const optionIds = new Set();
  if (!options || options.length === 0) {
    errs.push(`${tag}:options 缺或為空陣列`);
  } else {
    options.forEach((o, oi) => {
      const otag = `${tag} options[${oi}]${o && o.id ? ` (${o.id})` : ""}`;
      if (!o || typeof o !== "object" || !o.id) { errs.push(`${otag}:缺 id`); return; }
      if (optionIds.has(o.id)) errs.push(`${tag}:option id「${o.id}」在題內重複`);
      else optionIds.add(o.id);
      if (!hasAllLocales(o.label)) errs.push(`${otag}:label 缺語系:${missingLocales(o.label).join(" ") || "(整個 label 缺)"}`);
    });
  }

  // kind 相依驗證:guess 必填 answer(∈ option ids)與 explain(七語);poll 兩者必為 null
  if (q.kind === "guess") {
    if (q.answer == null) errs.push(`${tag}:kind=guess 必填 answer`);
    else if (!optionIds.has(q.answer)) errs.push(`${tag}:answer「${q.answer}」不是任何 option id(合法:${[...optionIds].join(" ")})`);
    if (!hasAllLocales(q.explain)) errs.push(`${tag}:kind=guess 的 explain 缺語系:${missingLocales(q.explain).join(" ") || "(整個 explain 缺)"}`);
  } else if (q.kind === "poll") {
    if (q.answer !== null && q.answer !== undefined) errs.push(`${tag}:kind=poll 的 answer 必須是 null`);
    if (q.explain !== null && q.explain !== undefined) errs.push(`${tag}:kind=poll 的 explain 必須是 null`);
  }

  // topic 為 null 時上面已記過 err,errs.length>0 會在下面整批擋下,resolved 不會被用到。
  resolved.push({ q, idx, topicId: topic?.topic_id ?? null, options: options || [] });
});

if (errs.length) {
  console.error(`${QUESTIONS_FILE}:\n  - ` + errs.join("\n  - "));
  db.close();
  process.exit(1);
}

// ---------- 寫入:四張表整組 DELETE 重建,單一 transaction ----------
let questionCount = 0, optionCount = 0, i18nCount = 0, optionI18nCount = 0;
try {
  db.exec("BEGIN");
  db.exec("DELETE FROM question_option_i18n");
  db.exec("DELETE FROM question_options");
  db.exec("DELETE FROM question_i18n");
  db.exec("DELETE FROM questions");

  const insQ = db.prepare(
    `INSERT INTO questions (question_id, qdate, kind, topic_id, asker_locale, target_locale, answer_option, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
  );
  const insQi18n = db.prepare(
    `INSERT INTO question_i18n (question_id, locale, text, explain) VALUES (?, ?, ?, ?)`
  );
  const insOpt = db.prepare(
    `INSERT INTO question_options (question_id, option_id, ord, emoji) VALUES (?, ?, ?, ?)`
  );
  const insOptI18n = db.prepare(
    `INSERT INTO question_option_i18n (question_id, option_id, locale, label) VALUES (?, ?, ?, ?)`
  );

  for (const { q, topicId, options } of resolved) {
    insQ.run(q.id, q.date, q.kind, topicId, q.asker ?? null, q.target ?? null, q.kind === "guess" ? q.answer : null);
    questionCount++;
    for (const locale of LOCALES) {
      insQi18n.run(q.id, locale, q.text[locale], q.kind === "guess" ? q.explain[locale] : null);
      i18nCount++;
    }
    options.forEach((o, ord) => {
      insOpt.run(q.id, o.id, ord, o.emoji ?? null);
      optionCount++;
      for (const locale of LOCALES) {
        insOptI18n.run(q.id, o.id, locale, o.label[locale]);
        optionI18nCount++;
      }
    });
  }

  db.exec("COMMIT");
} catch (e) {
  try { db.exec("ROLLBACK"); } catch {}
  db.close();
  console.error(`寫入失敗,已 ROLLBACK:${e.message}`);
  process.exit(1);
}

db.close();
console.log(
  `完成:匯入 ${questionCount} 題(question_i18n ${i18nCount}、options ${optionCount}、option_i18n ${optionI18nCount})。`
);
