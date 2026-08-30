#!/usr/bin/env node
// aeiou.now — Ask the World(草案 §45)冷啟動題上線。
//
//   node scripts/seed-ask-the-world.mjs              裸執行 = 正確且完整的行為
//   node scripts/seed-ask-the-world.mjs --dry-run    只印要做什麼,不寫 D1
//
// 題目來源:content/ask-the-world.json(人工編輯的唯一入口)。
//
// ── 為什麼直接寫 D1,而不是打 POST /v1/posts ────────────────────────────────
// Worker 的 country_code 取自 request.cf,也就是**發請求那台機器**在哪。主機在日本
// (2026-08-21 實測:從主機打 /v1/posts 建出來的貼文 country_code='JP'),那會把
// 站方自己放的題標成「來自日本」。題是台灣這邊放的,所以直接寫 D1 並明寫 TW。
// 另外入口限流是 3 篇/5 分鐘,一次放一批也會被自己的限流擋住(那道限流是對的,
// 不該為了種子資料放寬)。
//
// ── 冪等怎麼做:原地刷新,不是補一則新的 ────────────────────────────────────
// 契約 §1 的 feed 只回 `created_at >= now - 8h`,所以種子題會在 8 小時後淡出。
// 第一版寫成「淡出就補一則新的」,那是錯的 —— 掛上 cron 之後每天會多出十幾列
// 一模一樣的貼文,而且**每一列都是 translation_status='pending',會再花六次
// claude 呼叫翻同一段話**;D1 的寫入量也會變成自己在灌
// (CLAUDE.md 紅線:寫入量應與真人流量同一個量級)。
//
// 所以一題只有一列,淡出時把 created_at / last_activity_at 推到現在,讓它重新進入時間窗:
//   近 8h 內還在        → 跳過
//   淡出了、且沒人碰過  → 原地刷新(不重翻,譯文本來就掛在同一個 post_id 上)
//   淡出了、但有人回應  → **不動它**。有留言或 reaction 之後它就不再是種子,
//                         而是一串有歷史的討論,不該被站方的排程改時間。
//   還沒有這一列        → 新增(pending,交給 15 分 cron 的 translate-posts 翻六語)
//
// ⚠ 刷新只改 D1。主機那份副本(由 translate-posts 回流)的 created_at 不跟著動,
//   兩邊會有時間差;主機那份是歸檔與分析用,不餵讀者,所以不追。
//
// 驗證:topic slug 必須存在,target_country 必須是該 Topic 真的涵蓋的國家
// (問一個沒有這個節日的國家可以,但那個國家要在 regional_notes 裡有一格,
//  否則前端的國家選單也選不到它,標示會因為查不到國名而不顯示)。

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { openDb, beginJob, finishJob } from "./lib/aeiou-lib.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API_DIR = join(ROOT, "api");
const DATA = join(ROOT, "data", "topics");
const SOURCE = join(ROOT, "content", "ask-the-world.json");
const DRY_RUN = process.argv.includes("--dry-run");

// 站方放題時的匿名身分。與真人貼文用同一個欄位,沒有特權;固定一組是因為
// 這些題確實出自同一個人(站方),不是假裝成很多人。Crockford base32,不含 I/L/O/U。
const SEED_ANON_ID = "01M0SEEDATW000000000000000";
const WINDOW_SEC = 8 * 3600;   // 契約 §1 的 feed 時間窗;改這裡不會改 Worker,只會讓判斷失準

const log = (msg) => console.log(`${new Date().toISOString()} [ask-the-world] ${msg}`);

// 掛在 cron 上就要進 jobs 表 —— 不然 /etc/cron.d/aeiou 檔尾那條維護查詢看不到這一支
// 有沒有在跑、有沒有失敗(失敗語意與其他 job 一致:+5 分 / +10 分,第三次 dlq)。
// --dry-run 不記 job(它不改任何東西)。
const db = DRY_RUN ? null : openDb();
const job = DRY_RUN ? null : beginJob(db, { jobName: "ask-the-world-seed" });
const done = (result) => { if (job) finishJob(db, job, result); };
const bail = (err) => {
  done({ status: "failed", error: err });
  console.error(`✗ ${err}`);
  process.exit(1);
};
process.on("uncaughtException", (err) => bail(err?.stack || err?.message || String(err)));

// ── ULID(與 Worker 的 identity.js 同一種字母表) ────────────────────────────
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulid(nowMs = Date.now()) {
  let ts = "";
  let t = nowMs;
  for (let i = 0; i < 10; i += 1) { ts = B32[t % 32] + ts; t = Math.floor(t / 32); }
  const bytes = randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i += 1) rand += B32[bytes[i] % 32];
  return ts + rand;
}

// wrangler 呼叫。兩件事是踩過才加的:
//
// ① **錯誤要帶 stderr 與 stdout**。第一版只讓 execFileSync 的預設訊息冒出來,
//    於是 2026-08-21 04:25 那次 cron 失敗在 log 與 jobs 表裡只看得到一句
//    「Command failed: npx wrangler d1 execute …」加一整段 SQL,完全查不出原因。
//    這條教訓 translate-posts.mjs 檔頭早就寫著(CLI 的錯誤常印在 stdout,不是 stderr),
//    這裡沒套用是我的疏漏。
//
// ② **重試**。api/ 沒有 package.json,`npx wrangler` 每次都要從 npx 快取解析,
//    而 Cloudflare 的 token 偶爾會回 7403(2026-08-21 手動與 cron 各遇過一次,
//    同一條指令隔幾秒重跑就好)。這一支是冪等的,重試沒有副作用。
//    退避短(2s / 6s)是因為它排 4 小時一次,不該為了一次抖動空等到下一輪。
// ── Cloudflare 認證:優先 API token,OAuth 只是退路 ────────────────────────
// wrangler 預設走 `wrangler login` 存進 ~/.config/.wrangler/config/default.toml 的
// **OAuth** token。那組 token 會過期,而過期是**靜默**的 —— 2026-08-30 實測:
//   04:25 最後一次成功(wrangler 續期後寫回 default.toml,mtime 停在那一刻)
//   12:25 三次重試全掛在「In a non-interactive environment, it's necessary to
//         set a CLOUDFLARE_API_TOKEN」—— refresh token 自己到期,沒有任何人被通知
// OAuth 是為**互動式登入**設計的:續期預設有人在鍵盤前。掛在 cron 上的無人值守
// 排程不該依賴它,不然每隔一段時間就會靜靜停擺,而且只有這一支會停
// (其餘管線走 Worker 的 /internal/sync/*,不碰 wrangler,所以整盤看起來是綠的)。
//
// 取用順序(缺就往下退,裸執行仍是正確且完整的行為):
//   1. 環境變數 CLOUDFLARE_API_TOKEN —— CI 或一次性覆寫
//   2. ~/.config/aeiou/cf-api-token —— 主機常設(chmod 600,**絕不進 git**;
//      與 sync-secret 同一個目錄,secret 只從那裡讀是 CLAUDE.md 紅線)
//   3. 都沒有 → 照舊讓 wrangler 自己找 OAuth
// account_id 不在這裡設:已 pin 在 api/wrangler.jsonc,兩處都寫會多一個漂移點。
const CF_TOKEN_FILE = join(process.env.HOME || "/root", ".config", "aeiou", "cf-api-token");
function wranglerEnv() {
  const env = { ...process.env };
  if (env.CLOUDFLARE_API_TOKEN) return env;
  if (existsSync(CF_TOKEN_FILE)) {
    const token = readFileSync(CF_TOKEN_FILE, "utf8").trim();
    if (token) env.CLOUDFLARE_API_TOKEN = token;
  }
  return env;
}

// 認證失效**不是**暫時性抖動,重試沒有意義:過期的 token 隔 2 秒還是過期的,
// 三次重試只是把一次失敗拖成 8 秒,還讓 jobs 表的 error_message 被重試訊息淹掉。
// 這兩種失敗要分開處理 —— 7403 那種該退避重試,認證該立刻吵出「人要做什麼」。
const AUTH_FAILURE = /CLOUDFLARE_API_TOKEN|Authentication error|credentials|not (?:logged in|authenticated)|\[code: 10000\]/i;
const AUTH_ACTION = [
  "Cloudflare 認證失效,wrangler 打不到 D1。這一支是唯一真的執行 wrangler 的排程,",
  "所以其餘管線照樣是綠的 —— 不要因為儀表板看起來正常就以為沒事。",
  "修法(擇一,建議前者:API token 不過期,也沒有 refresh race):",
  `  A. 建 Cloudflare API token(權限:D1 Edit),寫進 ${CF_TOKEN_FILE} 並 chmod 600`,
  "  B. 互動式重登:cd api && npx wrangler login   (需要有人在瀏覽器完成授權)",
].join("\n");

function d1(sql, { file = false } = {}) {
  const args = ["wrangler", "d1", "execute", "aeiou-ugc", "--remote", "--json"];
  args.push(file ? "--file" : "--command", sql);
  const backoffMs = [2000, 6000];
  const env = wranglerEnv();
  for (let attempt = 0; ; attempt += 1) {
    const r = spawnSync("npx", args, { cwd: API_DIR, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env });
    const stdout = String(r.stdout || "");
    const stderr = String(r.stderr || "");
    if (!r.error && r.status === 0) {
      const start = stdout.indexOf("[");
      if (start >= 0) return JSON.parse(stdout.slice(start));
    }
    const why = r.error
      ? `spawn failed: ${r.error.message}`
      : (r.status !== 0
        ? `wrangler exited ${r.status}: stderr=${stderr.slice(0, 400)} stdout=${stdout.slice(0, 400)}`
        : `wrangler 沒有回傳 JSON:${stdout.slice(0, 400)}`);
    if (AUTH_FAILURE.test(`${stderr}${stdout}`)) throw new Error(`${AUTH_ACTION}\n\nwrangler 原話:${why.slice(0, 300)}`);
    if (attempt >= backoffMs.length) throw new Error(why);
    log(`wrangler 失敗(第 ${attempt + 1} 次),${backoffMs[attempt] / 1000}s 後重試 —— ${why.slice(0, 200)}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, backoffMs[attempt]);
  }
}

// ── 題庫與 Topic 對照 ──────────────────────────────────────────────────────
if (!existsSync(SOURCE)) bail(`缺題庫:${SOURCE}`);
const spec = JSON.parse(readFileSync(SOURCE, "utf8"));
const questions = Array.isArray(spec.questions) ? spec.questions : [];
if (questions.length === 0) { log("題庫是空的,沒事可做"); done({ status: "success" }); process.exit(0); }

const bySlug = new Map();
for (const dir of readdirSync(DATA)) {
  const factsPath = join(DATA, dir, "facts.json");
  if (!existsSync(factsPath)) continue;
  const facts = JSON.parse(readFileSync(factsPath, "utf8"));
  const covered = new Set([
    ...(facts.observances || []).map((o) => o.country_code),
    ...(facts.regional_notes || []).map((n) => n.country_code),
  ].filter(Boolean));
  bySlug.set(facts.slug, { topic_id: facts.topic_id, covered });
}

const problems = [];
for (const [i, item] of questions.entries()) {
  const where = `第 ${i + 1} 題(${item.topic} → ${item.target_country})`;
  const topic = bySlug.get(item.topic);
  if (!topic) { problems.push(`${where}:找不到 slug「${item.topic}」`); continue; }
  if (!/^[A-Z]{2}$/.test(String(item.target_country || ""))) {
    problems.push(`${where}:target_country 必須是 ISO 3166-1 alpha-2 大寫兩碼`); continue;
  }
  if (!topic.covered.has(item.target_country)) {
    problems.push(`${where}:這個 Topic 沒有涵蓋 ${item.target_country},前端的國家選單也不會有它`);
  }
  const content = String(item.content || "").trim();
  if (content.length < 10) problems.push(`${where}:content 太短`);
  if (content.length > 5000) problems.push(`${where}:content 超過 5000 字元(契約 §2)`);
}
if (problems.length) {
  for (const p of problems) console.error(`   ${p}`);
  bail(`題庫有 ${problems.length} 個問題,一題都不送`);
}

// ── 每一題現在是什麼狀態 ───────────────────────────────────────────────────
// touched = 有留言或 reaction。被碰過就交還給它自己的生命週期,排程不再管它。
const now = Math.floor(Date.now() / 1000);
const since = now - WINDOW_SEC;
const q = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

const existing = d1(
  `SELECT p.post_id, p.topic_id, p.content, p.created_at,
          (p.comments + (SELECT COUNT(*) FROM reactions r
                          WHERE r.target_type = 'post' AND r.target_id = p.post_id)) AS touched
     FROM posts p
    WHERE p.anon_id = ${q(SEED_ANON_ID)}`
)[0].results;
const byKey = new Map(existing.map((r) => [`${r.topic_id} ${r.content}`, r]));

const toInsert = [];
const toRefresh = [];
let liveCount = 0;
let touchedCount = 0;
for (const item of questions) {
  const key = `${bySlug.get(item.topic).topic_id} ${String(item.content).trim()}`;
  const row = byKey.get(key);
  if (!row) { toInsert.push(item); continue; }
  if (row.created_at >= since) { liveCount += 1; continue; }
  if (row.touched > 0) { touchedCount += 1; continue; }
  toRefresh.push({ item, row });
}
log(`題庫 ${questions.length} 題:在線 ${liveCount}、要刷新 ${toRefresh.length}、要新增 ${toInsert.length}`
  + (touchedCount ? `、有人回應過所以不動 ${touchedCount}` : ""));

if (DRY_RUN) {
  for (const { item } of toRefresh) log(`DRY_RUN 刷新 ${item.topic} → ${item.target_country}`);
  for (const item of toInsert) log(`DRY_RUN 新增 ${item.topic} → ${item.target_country}:${String(item.content).slice(0, 36)}…`);
  log("DRY_RUN 未寫入");
  process.exit(0);
}
if (toInsert.length === 0 && toRefresh.length === 0) {
  log("不用動");
  done({ status: "success", read: questions.length });
  process.exit(0);
}

const statements = [];

if (toRefresh.length > 0) {
  const ids = toRefresh.map(({ row }) => q(row.post_id)).join(", ");
  statements.push(
    `UPDATE posts SET created_at = ${now}, last_activity_at = ${now} WHERE post_id IN (${ids});`
  );
}

if (toInsert.length > 0) {
  // cycle_id 取 D1 topics 副本的 current_cycle_id(與 Worker 發文時同一個來源)
  const cycleOf = new Map(
    d1("SELECT topic_id, current_cycle_id FROM topics")[0].results
      .map((r) => [r.topic_id, r.current_cycle_id])
  );
  const values = toInsert.map((item) => {
    const topic = bySlug.get(item.topic);
    return "("
      + [
        q(`pst_${ulid()}`), q(topic.topic_id), q(cycleOf.get(topic.topic_id) ?? null),
        "NULL", q(SEED_ANON_ID),
        q(item.locale || "zh-TW"), q(String(item.content).trim()), "NULL", q(item.target_country),
        q("TW"), "NULL",
        "0, 0, 0, 0, 0, 0, 0",
        q("active"), q("pending"), String(now), String(now), "NULL",
      ].join(", ")
      + ")";
  });
  statements.push(
    `INSERT INTO posts (post_id, topic_id, cycle_id, user_id, anon_id,
  original_locale, content, media_json, target_country,
  country_code, city_code,
  views, unique_views, comments, likes, shares, cross_country_engagements, hot_score,
  status, translation_status, created_at, last_activity_at, archived_at)
VALUES\n${values.join(",\n")};`
  );
}

const sqlFile = join(tmpdir(), `aeiou-ask-the-world-${now}.sql`);
writeFileSync(sqlFile, statements.join("\n"), "utf8");
d1(sqlFile, { file: true });

// wrangler 的 meta.changes 在 --file 的多敘述批次上不可靠(2026-08-21 實測:送 8 列回報 9),
// 所以動作數以送出的清單為準,不引用 D1 的回報值。
if (toRefresh.length) log(`刷新 ${toRefresh.length} 題(不重翻,譯文掛在同一個 post_id)`);
if (toInsert.length) log(`新增 ${toInsert.length} 題(pending,15 分 cron 會翻六語)`);
for (const { item } of toRefresh) log(`  ↻ ${item.topic} → ${item.target_country}`);
for (const item of toInsert) log(`  ✓ ${item.topic} → ${item.target_country}`);
done({ status: "success", read: questions.length, created: toInsert.length, updated: toRefresh.length });
