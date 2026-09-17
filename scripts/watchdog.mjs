#!/usr/bin/env node
// ===========================================================================
// aeiou.now — 主機看門狗(2026-09-17 用戶核准新增;唯讀,只會說話不會動手)
// ===========================================================================
//
// 用法(裸執行 = 完整正確行為:檢查 → 有狀態變化才發 Slack → 存狀態):
//   node scripts/watchdog.mjs
//   node scripts/watchdog.mjs --dry-run    只印會發什麼,不發、不存狀態
//   node scripts/watchdog.mjs --report     印每一項檢查的現況(不發、不存狀態)
//
// -- 為什麼需要它 --------------------------------------------------------------
// 2026-09-03 ~ 09-17:CI 連紅 14 天、hourly-export 連續 fail-closed、七站凍結在舊版,
// 期間 Slack 頻道**零訊息**。壞掉的東西全都有在記錄(jobs 表、Actions、log),
// 只是沒有任何一支會把「已經壞了」送到人面前。這一支就只做這件事。
//
// -- 它守什麼(每一項都是真的發生過的形狀)---------------------------------------
//   dlq          jobs 表出現新的 dlq 列(第三次失敗,不再自動重試,要人看)
//   cadence:*    某支 job 太久沒有任何紀錄(cron 死了、鎖卡住、機器重開後沒起來)
//   export-fail  hourly-export 最近三輪全是 failed/dlq(fail-closed 正在擋住讀者看到的資料)
//   export-stale hourly-export 超過 3 小時沒有任何一輪走到底(success/skipped;流量歸零時
//                排行可以幾小時不變,skipped 是正常的,failed/dlq 才是停更)
//   branch       主機 checkout 不在 main(2026-08-16 事故:27 次匯出推到已 merge 的分支)
//   ci           GitHub Actions build 在 main 上連續 ≥3 次失敗(第一次失敗由 CI 自己的
//                notify job 說;這裡是**後援**,守的是「CI 連 notify 都說不出話」那種情況)
//   sites        最近一筆已滿 45 分鐘的 data/ commit **沒有綠燈的 CI run**,且七站 .build-id
//                那一版比它舊超過 45 分鐘(CI 沒跑、卡住或失敗,線上停在舊版)
//   readiness    gsc-topic-metrics 印出「需要決策」(通知,一週一次,不催)
//
// -- 它怎麼說話(只在狀態改變時)-------------------------------------------------
//   進入異常 → 說一次;持續異常 → 每 6 小時提醒一次;恢復 → 說「恢復」。
//   dlq 是事件不是狀態:第一筆立刻說,之後 6 小時內的累積在下一次提醒一起說。
//   狀態存 logs/watchdog-state.json(本機營運資料,不進 git)。刪掉只會讓它把現況再說一次。
//
// -- 紅線 ------------------------------------------------------------------------
//   · 唯讀:openDb(readOnly)、不寫 jobs 表、不動任何檔案(狀態檔除外)。
//   · 不 fail-closed:任何一項檢查壞了(gh 沒登入、網路不通)只影響那一項,其餘照發。
//   · secret 只從 ~/.config/aeiou/ 讀(slack-bot-token);頻道 ID 不是 secret,
//     常數在下方,可用 AEIOU_SLACK_CHANNEL 覆寫。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { ROOT, openDb, nowSec, log } from "./lib/aeiou-lib.mjs";

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const REPORT = argv.includes("--report");

const STATE_PATH = join(ROOT, "logs", "watchdog-state.json");
const TOKEN_FILE = process.env.AEIOU_SLACK_TOKEN_FILE || join(homedir(), ".config", "aeiou", "slack-bot-token");
const CHANNEL = process.env.AEIOU_SLACK_CHANNEL || "C0BPMFZ50KG"; // #天天開心-aeiou-now
const SOURCE_REPO = "weiqi-kids/aeiou.now";
const HOSTS = ["aeiou.now", "en.aeiou.now", "jp.aeiou.now", "cn.aeiou.now", "hi.aeiou.now", "id.aeiou.now", "br.aeiou.now"];

const HOUR = 3600;
const REMIND_EVERY = 6 * HOUR;       // 持續異常的提醒間隔
const NOTICE_EVERY = 7 * 86400;      // 「需要決策」這類通知的重複間隔
const EXPORT_STALE_AFTER = 3 * HOUR;
const SITES_LAG_AFTER = 45 * 60;

// 每支 job 「多久沒有任何紀錄就算死了」。判準用 finished_at/started_at 的絕對年齡,
// 不用 slot(jobs 表混著 15 分、每小時、每 4 小時、每日四種節奏)。
// 門檻 = 兩個週期再加餘裕:漏掉一輪可能只是鎖或 busy,連漏兩輪才值得說。
const CADENCE = {
  "translate-posts": 50 * 60,
  "sync-topics": 50 * 60,
  "hourly-export": 135 * 60,
  "ask-the-world-seed": 9 * HOUR,
  "gsc-topic-metrics": 27 * HOUR,
};

const now = nowSec();
const ago = (sec) => (sec >= 2 * 86400 ? `${Math.round(sec / 86400)} 天` : sec >= 2 * HOUR ? `${Math.round(sec / HOUR)} 小時` : `${Math.round(sec / 60)} 分鐘`);

function sh(cmd, args, { timeoutMs = 20000 } = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function loadState() {
  if (!existsSync(STATE_PATH)) return { version: 1, first_run: true, dlq: null, alerts: {}, notices: {}, commit_dates: {} };
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, "utf8"));
    return { version: 1, alerts: {}, notices: {}, commit_dates: {}, ...parsed, first_run: false };
  } catch (error) {
    log(`[watchdog] 狀態檔壞了,視為第一次執行:${error.message}`);
    return { version: 1, first_run: true, dlq: null, alerts: {}, notices: {}, commit_dates: {} };
  }
}

function saveState(state) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 1)}\n`);
  renameSync(tmp, STATE_PATH);
}

// ---------------------------------------------------------------------------
// 檢查。每一支回 { key, text } 表示「現在異常」,回 null 表示正常;
// 壞掉(查不到)就 throw,由呼叫端記成 unknown、不影響其他項。
// ---------------------------------------------------------------------------
function checkCadence(db) {
  const rows = db.prepare(
    `SELECT job_name, MAX(COALESCE(finished_at, started_at, scheduled_at)) AS last FROM jobs GROUP BY job_name`,
  ).all();
  const last = new Map(rows.map((r) => [r.job_name, Number(r.last) || 0]));
  const out = [];
  for (const [job, maxAge] of Object.entries(CADENCE)) {
    const age = now - (last.get(job) || 0);
    if (age > maxAge) out.push({ key: `cadence:${job}`, text: `${job} 已 ${ago(age)} 沒有任何紀錄(門檻 ${ago(maxAge)});cron 死了、鎖卡住或機器重開後沒起來` });
  }
  return out;
}

function checkExportFailing(db) {
  const rows = db.prepare(
    `SELECT status, error_message FROM jobs WHERE job_name = 'hourly-export' ORDER BY scheduled_at DESC, rowid DESC LIMIT 3`,
  ).all();
  if (rows.length < 3) return null;
  if (!rows.every((r) => r.status === "failed" || r.status === "dlq")) return null;
  const why = (rows[0].error_message || "").replace(/\s+/g, " ").slice(0, 160);
  return { key: "export-fail", text: `hourly-export 最近三輪全部失敗(fail-closed,線上資料停更):${why}` };
}

function checkExportStale(db) {
  // 判準是「多久沒有一輪走到底」,不是「data/ 多久沒 commit」:流量歸零時排行可以連續幾小時
  // 不變,那幾輪是 skipped(走到底、沒東西可推),不是停更。failed/dlq 才是沒走到底。
  const row = db.prepare(
    `SELECT MAX(COALESCE(finished_at, started_at)) AS ts FROM jobs
      WHERE job_name = 'hourly-export' AND status IN ('success', 'skipped', 'partial_success')`,
  ).get();
  const age = now - (Number(row?.ts) || 0);
  return age > EXPORT_STALE_AFTER
    ? { key: "export-stale", text: `hourly-export 已 ${ago(age)} 沒有任何一輪走到底(success/skipped),線上資料停更` }
    : null;
}

function checkBranch() {
  const branch = sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch === "main" ? null : { key: "branch", text: `主機 checkout 在 ${branch} 不是 main —— hourly-export 會把資料推到這條分支` };
}

function checkCi() {
  const raw = sh("gh", ["run", "list", "-R", SOURCE_REPO, "--workflow", "build", "--branch", "main", "--status", "completed", "--limit", "6", "--json", "conclusion,databaseId,createdAt"], { timeoutMs: 30000 });
  const runs = JSON.parse(raw || "[]");
  let streak = 0;
  for (const run of runs) {
    if (run.conclusion === "failure") streak += 1; else break;
  }
  const shown = streak >= runs.length ? `≥${streak}` : String(streak); // 只抓了 6 筆,整頁都紅就是「至少」
  return streak >= 3
    ? { key: "ci", text: `GitHub Actions build 在 main 上連續 ${shown} 次失敗(最近一次 ${runs[0]?.createdAt || "?"})` }
    : null;
}

function checkSites(state) {
  // 基準 = 最近一筆「已經超過 45 分鐘」的 data/ commit(CI 該跑完了)。不能拿最新那一筆:
  // 它可能兩分鐘前才 commit、CI 還在跑,回「正常」會把上一輪的異常誤判成恢復。
  const commits = JSON.parse(sh("gh", ["api", `repos/${SOURCE_REPO}/commits?sha=main&path=data&per_page=10`], { timeoutMs: 30000 }));
  const baseline = commits
    .map((c) => ({ sha: c.sha, ts: Math.floor(Date.parse(c.commit.committer.date) / 1000) }))
    .find((c) => now - c.ts >= SITES_LAG_AFTER);
  if (!baseline) throw new Error("最近 10 筆 data/ commit 都不到 45 分鐘,沒有可比的基準");
  // CI 對這一筆已經綠了 = verify 步驟證明七站內容就是這一版(含「dist 無變更、線上本來就對」
  // 那種 skip push),不必再比 .build-id —— .build-id 在 skip push 時本來就會停在上一個真的推過的版本。
  const runs = JSON.parse(sh("gh", ["run", "list", "-R", SOURCE_REPO, "--workflow", "build", "--commit", baseline.sha, "--status", "completed", "--limit", "5", "--json", "conclusion"], { timeoutMs: 30000 }));
  if (runs.some((r) => r.conclusion === "success")) return null;
  // CI 沒綠(沒跑、跑超過 45 分鐘、或失敗):逐站看 .build-id 那一版比基準舊了多久。
  const lagging = [];
  const unreachable = [];
  for (const host of HOSTS) {
    let bid = "";
    try {
      bid = sh("curl", ["-sf", "--retry", "2", "--retry-all-errors", "--max-time", "10", `https://${host}/.build-id`]).replace(/\s+/g, "");
    } catch { unreachable.push(host); continue; }
    if (!/^[0-9a-f]{40}$/.test(bid)) { unreachable.push(`${host}(.build-id 不是 sha)`); continue; }
    if (bid === baseline.sha) continue;
    let bidTs = state.commit_dates[bid];
    if (!bidTs) {
      try {
        const c = JSON.parse(sh("gh", ["api", `repos/${SOURCE_REPO}/commits/${bid}`], { timeoutMs: 30000 }));
        bidTs = Math.floor(Date.parse(c.commit.committer.date) / 1000);
        state.commit_dates[bid] = bidTs;
      } catch { lagging.push(`${host}(${bid.slice(0, 7)} 不在 repo 裡)`); continue; }
    }
    if (baseline.ts - bidTs > SITES_LAG_AFTER) lagging.push(`${host}(${bid.slice(0, 7)},落後 ${ago(baseline.ts - bidTs)})`);
  }
  // commit_dates 只留最近 50 筆,不無限長大
  const keys = Object.keys(state.commit_dates);
  if (keys.length > 50) for (const k of keys.slice(0, keys.length - 50)) delete state.commit_dates[k];
  if (lagging.length) {
    return { key: "sites", text: `線上版本落後 data/ commit ${baseline.sha.slice(0, 7)}(CI 沒有綠燈):${lagging.join("、")}${unreachable.length ? `;讀不到 .build-id:${unreachable.join("、")}` : ""}` };
  }
  // 讀不到不等於落後:一次逾時就報「落後」會每 15 分鐘紅綠交替。當成「查不到」處理。
  if (unreachable.length) throw new Error(`讀不到 .build-id:${unreachable.join("、")}`);
  return null;
}

function checkReadiness() {
  const logPath = join(ROOT, "logs", "gsc-topic-metrics.log");
  if (!existsSync(logPath)) return null;
  const lines = readFileSync(logPath, "utf8").split("\n").filter((l) => l.includes("就緒度"));
  const lastLine = lines[lines.length - 1] || "";
  if (!lastLine.includes("需要決策")) return null;
  const m = lastLine.match(/就緒度:(.*)$/);
  return { key: "readiness", text: `gsc-topic-metrics 就緒度需要決策:${(m ? m[1] : lastLine).slice(0, 200)}` };
}

function checkDlq(db, state) {
  const watermark = state.dlq?.watermark ?? null;
  const rows = watermark == null
    ? db.prepare(`SELECT MAX(COALESCE(finished_at, started_at)) AS ts FROM jobs WHERE status = 'dlq'`).all()
    : db.prepare(
      `SELECT job_name, COALESCE(finished_at, started_at) AS ts, error_message FROM jobs
        WHERE status = 'dlq' AND COALESCE(finished_at, started_at) > ? ORDER BY ts`,
    ).all(watermark);
  if (watermark == null) {
    // 第一次執行:既有的 dlq 列是歷史,不回放;從現在開始算。
    state.dlq = { watermark: Number(rows[0]?.ts) || now, last_sent: 0, pending: 0, pending_text: "" };
    return null;
  }
  if (!rows.length) return null;
  const summary = new Map();
  for (const r of rows) {
    const why = (r.error_message || "").replace(/\s+/g, " ").slice(0, 120);
    summary.set(r.job_name, { n: (summary.get(r.job_name)?.n || 0) + 1, why });
  }
  const text = [...summary].map(([job, v]) => `${job} ×${v.n}:${v.why}`).join(";");
  state.dlq.watermark = Number(rows[rows.length - 1].ts);
  return { count: rows.length, text };
}

// ---------------------------------------------------------------------------
async function postSlack(text) {
  if (!existsSync(TOKEN_FILE)) throw new Error(`缺 Slack token:${TOKEN_FILE}`);
  const token = readFileSync(TOKEN_FILE, "utf8").trim();
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel: CHANNEL, text, unfurl_links: false, unfurl_media: false }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`Slack 回 ${body.error}`);
}

const state = loadState();
const db = openDb(true);
const findings = [];   // 現在異常的 { key, text }
const unknown = [];    // 這一輪查不到的檢查
const run = (name, fn) => {
  try {
    const r = fn();
    if (Array.isArray(r)) findings.push(...r); else if (r) findings.push(r);
  } catch (error) {
    unknown.push(`${name}:${String(error.message || error).split("\n")[0].slice(0, 120)}`);
  }
};
run("cadence", () => checkCadence(db));
run("export-fail", () => checkExportFailing(db));
run("export-stale", () => checkExportStale(db));
run("branch", () => checkBranch());
run("ci", () => checkCi());
run("sites", () => checkSites(state));
let dlqNew = null;
try { dlqNew = checkDlq(db, state); } catch (error) { unknown.push(`dlq:${error.message}`); }
let readiness = null;
try { readiness = checkReadiness(); } catch (error) { unknown.push(`readiness:${error.message}`); }
db.close();

if (REPORT) {
  console.log(`檢查時間 ${new Date(now * 1000).toISOString()}`);
  console.log(findings.length ? `異常 ${findings.length} 項:` : "異常 0 項");
  for (const f of findings) console.log(`  🔴 ${f.key}:${f.text}`);
  if (dlqNew) console.log(`  🔴 dlq:新增 ${dlqNew.count} 筆 —— ${dlqNew.text}`);
  if (readiness) console.log(`  ℹ️ ${readiness.text}`);
  for (const u of unknown) console.log(`  ⚠ 查不到:${u}`);
  const persisting = Object.keys(state.alerts || {});
  if (persisting.length) console.log(`已通知過、仍在異常中:${persisting.join(", ")}`);
  process.exit(0);
}

// ---- 決定要說什麼(只在狀態改變時) -------------------------------------------
const lines = [];
const current = new Map(findings.map((f) => [f.key, f]));
// 新進入異常、或持續異常到了提醒時間
for (const [key, f] of current) {
  const prev = state.alerts[key];
  if (!prev) {
    lines.push(`🔴 ${f.text}`);
    state.alerts[key] = { since: now, last_sent: now, text: f.text };
  } else if (now - prev.last_sent >= REMIND_EVERY) {
    lines.push(`🔴 (持續 ${ago(now - prev.since)})${f.text}`);
    prev.last_sent = now;
    prev.text = f.text;
  }
}
// 恢復:上一輪在異常清單裡、這一輪不在、而且這一輪查得到(查不到不算恢復)
for (const key of Object.keys(state.alerts)) {
  if (key.startsWith("unknown:")) continue; // 「查不到」的進入/恢復在下面另外處理,這裡只管真的異常
  if (current.has(key)) continue;
  const base = key.split(":")[0];
  if (unknown.some((u) => u.startsWith(`${base}:`))) continue;
  lines.push(`🟢 恢復:${state.alerts[key].text.split("(")[0].split(":")[0]}(異常持續了 ${ago(now - state.alerts[key].since)})`);
  delete state.alerts[key];
}
// dlq:事件。第一筆立刻說;6 小時內的累積在下一次一起說。
if (dlqNew) {
  const d = state.dlq;
  d.pending = (d.pending || 0) + dlqNew.count;
  d.pending_text = dlqNew.text;
  if (now - (d.last_sent || 0) >= REMIND_EVERY) {
    lines.push(`🔴 jobs 進了 DLQ(新增 ${d.pending} 筆,不再自動重試):${d.pending_text}`);
    d.last_sent = now; d.pending = 0; d.pending_text = "";
  }
} else if (state.dlq?.pending > 0 && now - (state.dlq.last_sent || 0) >= REMIND_EVERY) {
  lines.push(`🔴 jobs 進了 DLQ(累積 ${state.dlq.pending} 筆,不再自動重試):${state.dlq.pending_text}`);
  state.dlq.last_sent = now; state.dlq.pending = 0; state.dlq.pending_text = "";
}
// 通知類:一週說一次
if (readiness && now - (state.notices.readiness || 0) >= NOTICE_EVERY) {
  lines.push(`ℹ️ ${readiness.text}`);
  state.notices.readiness = now;
}
// 查不到的檢查:也是狀態,進入/離開各說一次(gh 登出、網路不通,本身就是要人看的事)
for (const u of unknown) {
  const key = `unknown:${u.split(":")[0]}`;
  if (!state.alerts[key]) {
    lines.push(`⚠ 看門狗自己查不到 ${u}`);
    state.alerts[key] = { since: now, last_sent: now, text: `看門狗查不到 ${u.split(":")[0]}` };
  }
}
for (const key of Object.keys(state.alerts)) {
  if (!key.startsWith("unknown:")) continue;
  const base = key.slice("unknown:".length);
  if (unknown.some((u) => u.startsWith(`${base}:`))) continue;
  lines.push(`🟢 恢復:看門狗又查得到 ${base} 了`);
  delete state.alerts[key];
}

const status = `${findings.length} 項異常、${unknown.length} 項查不到、${lines.length} 行要說`;
if (!lines.length) {
  log(`[watchdog] ok(${status})`);
  if (!DRY_RUN) saveState(state);
  process.exit(0);
}

const text = `🐶 aeiou.now 看門狗\n${lines.join("\n")}`;
if (DRY_RUN) {
  log(`[watchdog] DRY_RUN(${status}),會送:\n${text}`);
  process.exit(0);
}
try {
  await postSlack(text);
  saveState(state);
  log(`[watchdog] 已送 Slack(${status}):\n${text}`);
} catch (error) {
  // 送不出去就**不存狀態**:下一輪會再試一次,不會把「說過了」記成真的。
  console.error(`[watchdog] Slack 送出失敗,狀態不更新,下一輪重試:${error.message}\n${text}`);
  process.exit(1);
}
