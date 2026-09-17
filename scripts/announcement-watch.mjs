#!/usr/bin/env node
// aeiou.now — 官方假日公告監看(2026-09-17 新增)
//
//   node scripts/announcement-watch.mjs            裸執行 = 正確且完整的行為:逐筆抓、比對狀態檔、寫 jobs 表
//   node scripts/announcement-watch.mjs --report   印每一筆現況(讀狀態檔,不抓、不寫)
//   node scripts/announcement-watch.mjs --dry-run  抓、判斷、印,但不寫狀態檔、不寫 jobs 表
//
// ── 它守什麼 ──────────────────────────────────────────────────────────────────
// content/national-holiday-calendars.json 裡 date_status='estimated' 的格子,要等各國官方公告
// 出爐才能改成 confirmed —— 而「公告出爐」這件事以前沒有任何機制會發現(2026-09-17 實測:
// 印尼 2027 的 SKB 已於 09-15 發布,母表 ID 2027 仍有 11 筆估算)。
// 這一支每天去看 content/announcement-watch.json 列的候選網址,與 db/.announcement-watch-state.json
// 比對,**有變化**(上一輪 404/失敗 → 這一輪 200、清單頁對上那一年、內容指紋變了、
// 慣例月份過完還沒看到)才寫進 jobs 表:job_name='announcement-watch'、status=partial_success、
// error_message 逐筆點名。那是「要人去抄公告」的訊號,不是失敗 —— 標 failed 會進重試與 dlq。
// 沒變化就 success。判斷規則全在 scripts/lib/announcement-watch.mjs(純函式,有測試)。
//
// 🔴 絕不自動改日期。抄公告是人的事;抄完把那一筆的 `resolved` 填上日期,它就不再被監看。
//
// ── 爬蟲守則(草案 §12;每一支會抓外站的腳本都要各自守)────────────────────
//   遵守 robots.txt(每網域取一次)與 Crawl-delay、UA 表明身分、同網域串行、逾時 30s、
//   401/403 一律當「不准抓」:不換 UA、不重試、不繞路,標 blocked。
//   ⚠ dgpa.gov.tw 對所有 UA `Disallow: /` —— 它在候選清單裡只是列給人看,腳本不會去敲。
//
// ── 「回 200」不等於「出了」──────────────────────────────────────────────────
//   dfe.gov.in 的 list-of-gazetted-holidays-2027.pdf 回 200,內容卻是首頁 HTML。要 PDF 拿到 HTML、
//   或跟完 redirect 落到網域根目錄,一律判 missing(軟 404)。這是 CLAUDE.md「驗來源連結不能
//   只看狀態碼」那條紅線在這一支的落實。
//
// 失敗語意:整支抓不到任何一個候選(全部 error)才 failed(走 +5/+10 分重試);
// 個別網址失敗只是那一筆這一輪沒看到,不擋其他筆。

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { ROOT, openDb, beginJob, finishJob, nowSec, log } from "./lib/aeiou-lib.mjs";
import {
  classify, decide, entryFound, entryKey, estimatedRows, htmlToText, isOverdue,
  overdueDecision, parseRobots, robotsAllows, urlKey, validateWatchFile,
} from "./lib/announcement-watch.mjs";

const JOB_NAME = "announcement-watch";
const argv = process.argv.slice(2);
const REPORT = argv.includes("--report");
const DRY_RUN = argv.includes("--dry-run");

const SPEC_PATH = join(ROOT, "content", "announcement-watch.json");
const CALENDAR_PATH = join(ROOT, "content", "national-holiday-calendars.json");
const STATE_PATH = process.env.AEIOU_ANNOUNCEMENT_STATE || join(ROOT, "db", ".announcement-watch-state.json");

/** 表明身分。對方要封鎖我們時要封鎖得掉 —— 那是守則的一部分,不是風險。 */
const UA = "aeiou-now-bot/1.0 (+https://aeiou.now/about/; holiday announcement watch; contact via site)";
const FETCH_TIMEOUT_MS = 30000;
const DEFAULT_DELAY_MS = 2000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (msg) => log(`[${JOB_NAME}] ${msg}`);

// ── 讀輸入 ────────────────────────────────────────────────────────────────────
function readJson(path, fallback = undefined) {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`缺檔案:${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

const spec = readJson(SPEC_PATH);
const problems = validateWatchFile(spec);
if (problems.length) {
  for (const p of problems) console.error(`   ${p}`);
  console.error(`✗ ${SPEC_PATH} 有 ${problems.length} 個問題`);
  process.exit(2);
}
const calendar = readJson(CALENDAR_PATH, { countries: {} });
const state = readJson(STATE_PATH, { version: 1, updated_at: null, urls: {}, entries: {} });
state.urls ||= {};
state.entries ||= {};

const watches = spec.watches;
const active = watches.filter((e) => e.resolved == null);
const KIND_LABEL = { matched: "對上", present: "在", missing: "沒有", blocked: "不准抓", error: "抓不到" };
// present 在「有 match 規則」的筆才叫「在(未對上)」;沒規則(OPM)的 present 就是在。
const kindLabel = (kind, entry) => (kind === "present" && entry.match ? "在(未對上)" : KIND_LABEL[kind] || kind);

// ── --report:只讀狀態檔 ────────────────────────────────────────────────────────
if (REPORT) {
  const today = new Date();
  console.log(`監看 ${watches.length} 筆(${active.length} 筆進行中);狀態檔 ${STATE_PATH}`
    + (state.updated_at ? `(上次執行 ${state.updated_at})` : "(還沒跑過)"));
  for (const e of watches) {
    const { estimated, total } = estimatedRows(calendar, e.country, e.year);
    const es = state.entries[entryKey(e)] || {};
    const head = `${e.country} ${e.year}  慣例 ${e.expected_month ? `${e.year - 1}-${String(e.expected_month).padStart(2, "0")}` : "無(法定)"}`
      + `  母表 estimated ${estimated}/${total}`
      + (e.resolved ? `  已抄錄 ${e.resolved}` : (isOverdue(e, today) ? "  ⚠ 已過慣例月份" : ""))
      + (es.overdue_notified ? "(逾期已提醒)" : "");
    console.log(`\n${head}`);
    for (const u of e.urls) {
      const s = state.urls[urlKey(e, u)];
      const line = s ? `${kindLabel(s.kind, e)}${s.status != null ? ` ${s.status}` : ""}  看過 ${s.checked_at || "-"}` : "還沒看過";
      console.log(`   ${line}  ${u}`);
    }
  }
  process.exit(0);
}

// ── 抓 ────────────────────────────────────────────────────────────────────────
const robotsCache = new Map(); // host → rules
async function robotsFor(url) {
  const { protocol, host } = new URL(url);
  if (robotsCache.has(host)) return robotsCache.get(host);
  let rules = parseRobots("", { defaultDelayMs: DEFAULT_DELAY_MS });
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`${protocol}//${host}/robots.txt`, { headers: { "User-Agent": UA }, signal: ac.signal, redirect: "follow" });
    clearTimeout(t);
    // robots.txt 取不到(404/網路錯)→ 沒有規則 = 允許(RFC 9309 的預設)。
    if (res.ok && /text\/plain/i.test(res.headers.get("content-type") || "")) {
      rules = parseRobots(await res.text(), { defaultDelayMs: DEFAULT_DELAY_MS });
    }
  } catch { /* 同上 */ }
  robotsCache.set(host, rules);
  return rules;
}

/** 抓一個網址。回傳的 text 只在文字類回應才有(給 match 用);PDF 等二進位只留指紋。 */
async function fetchOne(url) {
  const out = { status: null, contentType: "", finalUrl: url, hash: null, text: null, error: null, robotsBlocked: false };
  const rules = await robotsFor(url);
  if (!robotsAllows(rules, new URL(url).pathname)) { out.robotsBlocked = true; return out; }
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/pdf,text/csv,text/calendar,*/*;q=0.5" },
      signal: ac.signal, redirect: "follow",
    });
    clearTimeout(t);
    out.status = res.status;
    out.contentType = res.headers.get("content-type") || "";
    out.finalUrl = res.url || url;
    if (res.status >= 200 && res.status < 300) {
      const buf = Buffer.from(await res.arrayBuffer());
      const body = buf.subarray(0, MAX_BODY_BYTES);
      const isText = /text\/|json|xml|calendar|csv/i.test(out.contentType);
      if (isText) {
        const text = /html/i.test(out.contentType)
          ? htmlToText(new TextDecoder("utf-8", { fatal: false }).decode(body))
          : new TextDecoder("utf-8", { fatal: false }).decode(body);
        out.hash = sha256(text);
        out.text = text;
      } else {
        out.hash = sha256(body); // PDF 等二進位:只看指紋,不跑 match
      }
    }
  } catch (e) {
    out.error = String(e?.message || e).slice(0, 160);
  }
  return out;
}

const REASON_LABEL = {
  appeared: "出現了(上一輪還沒有)",
  matched: "對上了(頁上已列出那一年)",
  changed: "內容變了",
};

async function main() {
  const now = nowSec();
  const nowIso = new Date(now * 1000).toISOString();
  const today = new Date(now * 1000);

  // 同網域串行:先按 host 分組,組內順序抓並在請求之間等 delay;不同網域也順序跑(量很小)。
  const tasks = [];
  for (const e of active) for (const u of e.urls) tasks.push({ entry: e, url: u });
  const byHost = new Map();
  for (const t of tasks) {
    const host = new URL(t.url).host;
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host).push(t);
  }

  const results = new Map(); // urlKey → {kind, ...}
  const fetched = new Map(); // url → 原始回應;同一個網址掛在兩筆(US 2027/2028 共用 OPM 頁)只抓一次
  let fetchedAny = false;
  let errored = 0;
  for (const [host, items] of byHost) {
    const rules = await robotsFor(items[0].url);
    let requests = 0;
    for (const { entry, url } of items) {
      const key = urlKey(entry, url);
      let r = fetched.get(url);
      if (!r) {
        if (requests > 0) await sleep(rules.delayMs);
        requests += 1;
        r = await fetchOne(url);
        fetched.set(url, r);
      }
      // match 是每一筆自己的規則(同一頁對 2027 與 2028 問的是不同的問題),所以在這裡才跑。
      const matched = Boolean(entry.match && r.text && new RegExp(entry.match, "u").test(r.text));
      const kind = classify({
        status: r.status, contentType: r.contentType, requestedUrl: url, finalUrl: r.finalUrl,
        robotsBlocked: r.robotsBlocked, matched, hasMatchRule: Boolean(entry.match),
      });
      if (kind !== "error" && kind !== "blocked") fetchedAny = true;
      if (kind === "error") errored += 1;
      results.set(key, { url, kind, status: r.status, contentType: r.contentType, hash: r.hash, finalUrl: r.finalUrl, error: r.error });
      say(`${host} ${kindLabel(kind, entry)}${r.status != null ? ` ${r.status}` : ""}${r.error ? `(${r.error})` : ""}  ${entry.country} ${entry.year}  ${url}`);
    }
  }

  // ── 比對狀態、決定要說什麼 ───────────────────────────────────────────────
  const speak = [];   // 進 error_message 的逐筆點名
  const notes = [];   // 只進 log
  const nextState = { version: 1, updated_at: nowIso, urls: { ...state.urls }, entries: { ...state.entries } };

  for (const e of active) {
    const key = entryKey(e);
    const { estimated, total } = estimatedRows(calendar, e.country, e.year);
    const tail = estimated > 0 ? `母表 ${key} 仍有 ${estimated}/${total} 筆 estimated` : `母表 ${key} 沒有 estimated 列(可能已抄過,抄完請填 resolved)`;
    const kinds = [];
    for (const u of e.urls) {
      const uk = urlKey(e, u);
      const cur = results.get(uk);
      const prev = state.urls[uk];
      // 這一輪抓不到就沿用上一輪的觀察來判「找到了沒」—— 暫時連不上不代表公告不見了,
      // 否則一次網路抖動就會誤發「逾期」。
      kinds.push(cur.kind === "error" && prev ? prev.kind : cur.kind);
      const d = decide(prev, { kind: cur.kind, hash: cur.hash, contentType: cur.contentType }, { hasMatchRule: Boolean(e.match) });
      if (d.speak) speak.push(`${key}:${REASON_LABEL[d.reason]} ${u} —— ${tail}`);
      if (d.note === "disappeared") notes.push(`${key}:上一輪還在、這一輪 ${kindLabel(cur.kind, e)}(${cur.status ?? "-"}) ${u}`);
      // error 不覆蓋上一輪的觀察 —— 暫時抓不到不代表它變了;只更新 checked_at 與錯誤。
      if (cur.kind === "error" && prev) {
        nextState.urls[uk] = { ...prev, checked_at: nowIso, last_error: cur.error || `HTTP ${cur.status}` };
      } else {
        nextState.urls[uk] = {
          url: u, kind: cur.kind, status: cur.status, content_type: cur.contentType || null, hash: cur.hash,
          final_url: cur.finalUrl, checked_at: nowIso,
          changed_at: prev && prev.kind === cur.kind && prev.hash === cur.hash ? (prev.changed_at || nowIso) : nowIso,
          last_error: cur.error || null,
        };
      }
    }
    const found = entryFound(e, kinds);
    const od = overdueDecision(Boolean(state.entries[key]?.overdue_notified), isOverdue(e, today), found);
    if (od.speak) {
      const blocked = e.urls.filter((u) => results.get(urlKey(e, u)).kind === "blocked");
      speak.push(`${key}:慣例月份(${e.year - 1}-${String(e.expected_month).padStart(2, "0")})已過,候選網址都還沒看到公告 —— `
        + `候選可能猜錯了,請人工去找新入口${blocked.length ? `(其中 ${blocked.length} 個 robots/403 不准抓,只能人開:${blocked.join(" ")})` : ""};${tail}`);
    }
    nextState.entries[key] = { overdue_notified: od.notified, found, last_checked: nowIso };
  }
  // 已 resolved 的從狀態檔清掉,免得檔案無限長大
  for (const k of Object.keys(nextState.urls)) {
    const stillActive = active.some((e) => nextState.urls[k].url && k.startsWith(`${entryKey(e)} `));
    if (!stillActive) delete nextState.urls[k];
  }
  for (const k of Object.keys(nextState.entries)) if (!active.some((e) => entryKey(e) === k)) delete nextState.entries[k];

  for (const n of notes) say(`備註:${n}`);
  if (speak.length) {
    say(`有 ${speak.length} 件事要人去看:`);
    for (const s of speak) say(`  • ${s}`);
  } else {
    say(`監看 ${active.length} 筆、${tasks.length} 個網址:沒有變化`);
  }

  if (!active.length) say("沒有進行中的監看項(全部 resolved)");
  if (tasks.length > 0 && !fetchedAny) {
    throw new Error(`候選網址全部抓不到(${errored} 個 error),這一輪等於沒看 —— 多半是本機網路問題`);
  }

  if (DRY_RUN) { say("DRY_RUN:不寫狀態檔、不寫 jobs 表"); return { speak, read: tasks.length }; }

  mkdirSync(dirname(STATE_PATH), { recursive: true });
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(nextState, null, 1), "utf8");
  renameSync(tmp, STATE_PATH);
  return { speak, read: tasks.length };
}

// --dry-run 不記 job(它不改任何東西)。
const db = DRY_RUN ? null : openDb();
const job = DRY_RUN ? null : beginJob(db, { jobName: JOB_NAME });
try {
  const { speak, read } = await main();
  if (job) {
    finishJob(db, job, {
      status: speak.length ? "partial_success" : "success",
      read, updated: speak.length,
      error: speak.length ? speak.join("\n") : null,
    });
    db.close();
  }
  process.exit(0);
} catch (e) {
  if (job) {
    const done = finishJob(db, job, { status: "failed", error: e && (e.stack || e.message || e) });
    say(`FAILED status=${done.status} next_retry_at=${done.next_retry_at ?? "NULL"}: ${e.message || e}`);
    db.close();
  } else {
    say(`FAILED: ${e.message || e}`);
  }
  process.exit(1);
}
