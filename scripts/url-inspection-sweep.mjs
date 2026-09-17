#!/usr/bin/env node
// ===========================================================================
// aeiou.now — 逐頁 URL Inspection 週掃(2026-09-17 新增)
// ===========================================================================
//
// 用法(裸執行＝正確且完整的行為:掃今天配額內最該掃的那批,寫 url_inspections):
//   node scripts/url-inspection-sweep.mjs
//   node scripts/url-inspection-sweep.mjs --dry-run       只列會掃哪些,不打 API、不寫庫
//   node scripts/url-inspection-sweep.mjs --sample 5      只掃 N 筆(逃生口;測試用)
//   node scripts/url-inspection-sweep.mjs --report        最近一輪 page_type × coverage_state,
//                                                         與「連續 >=3 輪未索引且首見 >=21 天」清單
//
// -- 為什麼要有它 ------------------------------------------------------------
// 用戶拍板「逐國頁縮不縮,用 Google 的判決(持續 N 天 Discovered - currently not indexed)」。
// 但 crawl-freshness.mjs 與 seo-health.mjs 都只印不存:沒有任何一張表存得到逐頁
// coverageState 的時間序列,「持續 N 天」無從判起。這一支把每一頁的判決存成時間序列
// (url_inspections),--report 把退場判準的輸入算出來。**它不做退場決定**,只給輸入。
//
// -- 配額 ----------------------------------------------------------------------
// URL Inspection 每個 property 2000 次/日,七站共用一個 sc-domain 資源,而且
// crawl-freshness.mjs(改文案前的閘門)也在用。所以每次執行最多 AEIOU_INSPECT_BUDGET
// (預設 1500)筆,留 500 給 crawl-freshness;全站約四千頁要跨三天掃完一輪。
// 配額按 sweep_id(執行日)算:同一天重跑只補到 budget,不重掃已有判決的 URL。
//
// -- 排序 ----------------------------------------------------------------------
// 從沒掃過的優先(連一筆判決都沒有),其次上次 inspected_at 最舊的。
// 判準只有一份:scripts/lib/url-inspection.mjs 的 planSweep(有測試)。
//
// -- 失敗語意 ------------------------------------------------------------------
// 單筆 inspect 失敗(逾時、5xx)只跳過並計數,**不 fail-closed** —— 少一筆判決的代價
// 是那一頁下一輪排最前面,不值得讓整支停掉。配額用盡則提早收工(再打只是燒時間)。
// 一筆都沒成功才記 failed(走重試鏈);有失敗記 partial_success;全成功記 success。
// jobs 表 job_name='url-inspection-sweep'。
//
// 憑證:~/.config/aeiou/ga4-sa.json;Google API 沿用 /mnt/customers/seo-ops/lib/google.mjs。

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { openDb, beginJob, finishJob, slotStart, nowSec, log } from "./lib/aeiou-lib.mjs";
import { CRAWL_ORIGINS } from "./lib/crawl-freshness.mjs";
import {
  DISCOVERED_NOT_INDEXED,
  coverageMatrix,
  hostOf,
  inspectionRow,
  isQuotaError,
  latestPerUrl,
  pageTypeOf,
  persistentlyUnindexed,
  planSweep,
  urlsFromSitemap,
} from "./lib/url-inspection.mjs";

const JOB_NAME = "url-inspection-sweep";
const SA = process.env.AEIOU_GSC_SA || join(homedir(), ".config", "aeiou", "ga4-sa.json");
const GSC_SITE = "sc-domain:aeiou.now";
const GOOGLE_LIB = "/mnt/customers/seo-ops/lib/google.mjs";

const positiveInt = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};
// 每日配額上限(七站共用 2000,留 500 給 crawl-freshness)。
const BUDGET = positiveInt(process.env.AEIOU_INSPECT_BUDGET, 1500);
// 同時幾條 inspect。每筆要換一次 token + 一次 inspect,序列跑 1500 筆約半小時;
// 3 條夠快又不會撞 per-minute 限流。
const CONCURRENCY = positiveInt(process.env.AEIOU_INSPECT_CONCURRENCY, 3);
// 整支的軟上限:到點就不再派新的 inspect,已派的跑完即收尾。沒掃到的下一輪排最前面。
const SOFT_DEADLINE_MS = positiveInt(process.env.AEIOU_INSPECT_TIMEOUT_MS, 50 * 60 * 1000);
const SITEMAP_TIMEOUT_MS = 15_000;
// 退場判準的輸入門檻(拍板的是「持續 N 天」;N 的兩個面向都留旗標,預設值寫在這裡)。
const REPORT_MIN_ROUNDS = positiveInt(process.env.AEIOU_INSPECT_MIN_ROUNDS, 3);
const REPORT_MIN_DAYS = positiveInt(process.env.AEIOU_INSPECT_MIN_DAYS, 21);
// 「最近一輪」只看這麼多天內的紀錄:一輪約 3 天,14 天涵蓋數輪,也讓已下架的 URL 自然淡出。
const ROUND_LOOKBACK_DAYS = positiveInt(process.env.AEIOU_INSPECT_ROUND_DAYS, 14);
// 2026-09-02 站級降權(docs/seo-current-state.md 第一段):之後的「未索引」可能反映站級狀態。
const SITE_DEMOTION_DATE = "2026-09-02";

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const REPORT = argv.includes("--report");
const sampleIdx = argv.indexOf("--sample");
const SAMPLE = sampleIdx >= 0 ? positiveInt(argv[sampleIdx + 1], 0) : null;

const dayStr = (n = 0) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const SWEEP_ID = dayStr(0);

// schema-host.sql 是新庫的權威;這個 CREATE IF NOT EXISTS 讓既有主機庫不必 migration。
function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS url_inspections (
      url              TEXT NOT NULL,
      host             TEXT NOT NULL,
      page_type        TEXT NOT NULL,
      sweep_id         TEXT NOT NULL,
      inspected_at     INTEGER NOT NULL,
      verdict          TEXT,
      coverage_state   TEXT,
      indexing_state   TEXT,
      robots_state     TEXT,
      last_crawl_time  TEXT,
      google_canonical TEXT,
      referring_count  INTEGER,
      PRIMARY KEY (url, sweep_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ui_url_at ON url_inspections(url, inspected_at);
    CREATE INDEX IF NOT EXISTS idx_ui_sweep ON url_inspections(sweep_id, page_type, coverage_state);
  `);
}

function tableExists(db, name) {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name),
  );
}

// ---------------------------------------------------------------------------
// --report
// ---------------------------------------------------------------------------
function report(db) {
  console.log(
    `⚠ 判讀前提:採集期若落在 ${SITE_DEMOTION_DATE} 之後,「未索引」可能反映站級狀態不是頁薄`
    + `(站級降權與凍結,見 docs/seo-current-state.md 第一段)。`,
  );
  if (!tableExists(db, "url_inspections")) {
    console.log("尚無資料:url_inspections 表還沒建(先跑一次 node scripts/url-inspection-sweep.mjs)。");
    return;
  }
  const total = db.prepare("SELECT COUNT(*) n, MIN(sweep_id) lo, MAX(sweep_id) hi FROM url_inspections").get();
  if (!total.n) {
    console.log("尚無資料:url_inspections 是空的(先跑一次 node scripts/url-inspection-sweep.mjs)。");
    return;
  }
  const since = new Date(Date.parse(`${total.hi}T00:00:00Z`) - (ROUND_LOOKBACK_DAYS - 1) * 86400000)
    .toISOString().slice(0, 10);
  const rows = db.prepare(
    "SELECT url, host, page_type, sweep_id, coverage_state FROM url_inspections WHERE sweep_id >= ?",
  ).all(since);
  const latest = latestPerUrl(rows, since);
  const sweeps = [...new Set(latest.map((r) => r.sweep_id))].sort();
  console.log(
    `\n最近一輪(每個 URL 最新一筆;sweep ${sweeps[0]} ~ ${sweeps[sweeps.length - 1]},`
    + ` ${sweeps.length} 個 sweep,${latest.length} 個 URL;全表 ${total.n} 筆,${total.lo} ~ ${total.hi})`,
  );
  const matrix = coverageMatrix(latest);
  const w = Math.max(10, ...matrix.states.map((s) => s.length));
  const header = ["page_type".padEnd(9), "total".padStart(6), ...matrix.states.map((s) => s.padStart(w))];
  console.log(header.join("  "));
  for (const type of matrix.types) {
    const row = matrix.counts[type];
    const sum = Object.values(row).reduce((a, b) => a + b, 0);
    console.log(
      [type.padEnd(9), String(sum).padStart(6), ...matrix.states.map((s) => String(row[s] || 0).padStart(w))].join("  "),
    );
  }
  const colTotal = matrix.states.map((s) => matrix.types.reduce((a, t) => a + (matrix.counts[t][s] || 0), 0));
  console.log(
    ["(all)".padEnd(9), String(latest.length).padStart(6), ...colTotal.map((n) => String(n).padStart(w))].join("  "),
  );

  const allRows = db.prepare(
    "SELECT url, host, page_type, sweep_id, coverage_state FROM url_inspections",
  ).all();
  const stuck = persistentlyUnindexed(allRows, {
    minRounds: REPORT_MIN_ROUNDS, minDays: REPORT_MIN_DAYS, today: dayStr(0),
  });
  console.log(
    `\n連續 >=${REPORT_MIN_ROUNDS} 輪「${DISCOVERED_NOT_INDEXED}」且首見 >=${REPORT_MIN_DAYS} 天:${stuck.length} 個 URL`
    + `(這是退場判準的**輸入**,不是決定;門檻 AEIOU_INSPECT_MIN_ROUNDS / AEIOU_INSPECT_MIN_DAYS)`,
  );
  if (stuck.length) {
    const byType = {};
    for (const s of stuck) byType[s.page_type] = (byType[s.page_type] || 0) + 1;
    console.log(`  依 page_type:${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join("、")}`);
    const firstSeenDates = stuck.map((s) => s.firstSeen).sort();
    if (firstSeenDates[0] >= SITE_DEMOTION_DATE) {
      console.log(`  ⚠ 這批全部首見於 ${SITE_DEMOTION_DATE} 之後 —— 先看站級曲線(gsc-topic-metrics.mjs --report)再下結論。`);
    }
    for (const s of stuck.slice(0, 40)) {
      console.log(`  ${String(s.rounds).padStart(2)} 輪  首見 ${s.firstSeen}(${s.ageDays} 天)  [${s.page_type}] ${s.url}`);
    }
    if (stuck.length > 40) console.log(`  …另外 ${stuck.length - 40} 個(全清單:SELECT url FROM url_inspections … 或加大 --report 的列印上限)`);
  }
}

// ---------------------------------------------------------------------------
// sitemap → URL 清單(七站線上 sitemap;失敗的站只警告,不擋其他站)
// ---------------------------------------------------------------------------
async function fetchSitemapUrls(spec) {
  const url = `${spec.origin}/sitemap.xml`;
  const res = await fetch(url, {
    headers: { "User-Agent": "aeiou.now url-inspection-sweep" },
    signal: AbortSignal.timeout(SITEMAP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  const urls = urlsFromSitemap(await res.text(), spec.origin);
  if (urls.length === 0) throw new Error(`${url} 沒有任何 <loc>`);
  return urls;
}

async function collectUrls() {
  const results = await Promise.all(CRAWL_ORIGINS.map(async (spec) => {
    try { return { ...spec, urls: await fetchSitemapUrls(spec) }; }
    catch (error) { return { ...spec, urls: [], error: String(error?.message || error) }; }
  }));
  const failed = results.filter((r) => r.error);
  for (const r of failed) log(`[${JOB_NAME}] ⚠ ${r.locale} sitemap 讀取失敗,本輪略過該站:${r.error}`);
  const urls = results.flatMap((r) => r.urls);
  log(`[${JOB_NAME}] 線上 sitemap ${results.length - failed.length}/${results.length} 站成功,共 ${urls.length} 個 URL`);
  return { urls, sitemapFailures: failed.length };
}

function loadHistory(db) {
  const history = new Map();
  for (const r of db.prepare(
    "SELECT url, MAX(inspected_at) last_at, MAX(sweep_id) last_sweep FROM url_inspections GROUP BY url",
  ).all()) {
    history.set(r.url, { lastInspectedAt: r.last_at, lastSweepId: r.last_sweep });
  }
  return history;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const db = openDb();

if (REPORT) {
  try { report(db); } finally { db.close(); }
  process.exit(0);
}

if (!DRY_RUN) ensureSchema(db);
const job = DRY_RUN ? null : beginJob(db, { jobName: JOB_NAME, scheduledAt: slotStart(86400) });
const startedAt = Date.now();

try {
  if (!DRY_RUN) {
    if (!existsSync(SA)) throw new Error(`缺 SA 金鑰:${SA}`);
    if (!existsSync(GOOGLE_LIB)) throw new Error(`缺 ${GOOGLE_LIB}`);
  }

  const { urls, sitemapFailures } = await collectUrls();
  if (urls.length === 0) throw new Error("七站 sitemap 都讀不到,沒有東西可掃");

  const history = tableExists(db, "url_inspections") ? loadHistory(db) : new Map();
  const doneToday = tableExists(db, "url_inspections")
    ? db.prepare("SELECT COUNT(*) n FROM url_inspections WHERE sweep_id = ?").get(SWEEP_ID).n
    : 0;
  const remaining = Math.max(0, BUDGET - doneToday);
  const limit = SAMPLE !== null ? Math.min(SAMPLE, remaining) : remaining;
  const plan = planSweep({ urls, history, sweepId: SWEEP_ID, limit });
  log(
    `[${JOB_NAME}] sweep ${SWEEP_ID}:候選 ${plan.candidates}(從沒掃過 ${plan.neverInspected})`
    + `,今天已掃 ${doneToday}/${BUDGET},本次排 ${plan.planned.length}${SAMPLE !== null ? `(--sample ${SAMPLE})` : ""}`,
  );

  if (DRY_RUN) {
    const byType = {};
    const byHost = {};
    for (const u of plan.planned) {
      const t = pageTypeOf(u);
      byType[t] = (byType[t] || 0) + 1;
      const h = hostOf(u);
      byHost[h] = (byHost[h] || 0) + 1;
    }
    console.log(`--dry-run:不打 API、不寫庫。會掃的 ${plan.planned.length} 筆依 page_type:`
      + `${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join("、") || "(無)"}`);
    console.log(`依 host:${Object.entries(byHost).map(([k, v]) => `${k} ${v}`).join("、") || "(無)"}`);
    for (const u of plan.planned.slice(0, 30)) {
      const h = history.get(u);
      console.log(`  ${(h ? new Date(h.lastInspectedAt * 1000).toISOString().slice(0, 10) : "從沒掃過").padEnd(10)} [${pageTypeOf(u)}] ${u}`);
    }
    if (plan.planned.length > 30) console.log(`  …另外 ${plan.planned.length - 30} 筆`);
    db.close();
    process.exit(0);
  }

  const { inspectUrl } = await import(GOOGLE_LIB);
  const insert = db.prepare(
    `INSERT INTO url_inspections
       (url, host, page_type, sweep_id, inspected_at, verdict, coverage_state, indexing_state,
        robots_state, last_crawl_time, google_canonical, referring_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(url, sweep_id) DO UPDATE SET
       inspected_at = excluded.inspected_at, verdict = excluded.verdict,
       coverage_state = excluded.coverage_state, indexing_state = excluded.indexing_state,
       robots_state = excluded.robots_state, last_crawl_time = excluded.last_crawl_time,
       google_canonical = excluded.google_canonical, referring_count = excluded.referring_count`,
  );

  let ok = 0;
  let failed = 0;
  let quotaHit = false;
  let deadlineHit = false;
  const errorSamples = [];
  let cursor = 0;
  const queue = plan.planned;

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (cursor < queue.length && !quotaHit) {
      if (Date.now() - startedAt > SOFT_DEADLINE_MS) { deadlineHit = true; break; }
      const url = queue[cursor++];
      try {
        const result = await inspectUrl(SA, GSC_SITE, url);
        const row = inspectionRow(result);
        // 逐筆寫,不包整批交易:行程被殺時已掃的判決留著,不會白燒配額。
        insert.run(
          url, hostOf(url), pageTypeOf(url), SWEEP_ID, nowSec(),
          row.verdict, row.coverage_state, row.indexing_state, row.robots_state,
          row.last_crawl_time, row.google_canonical, row.referring_count,
        );
        ok += 1;
      } catch (error) {
        failed += 1;
        const msg = String(error?.message || error);
        if (errorSamples.length < 3) errorSamples.push(`${url} → ${msg.slice(0, 80)}`);
        if (isQuotaError(error)) {
          quotaHit = true;
          log(`[${JOB_NAME}] 配額用盡,提早收工:${msg.slice(0, 120)}`);
        }
      }
    }
  }));

  const notReached = queue.length - ok - failed;
  const summary = `掃 ${ok} 成功、${failed} 失敗、${notReached} 未排到`
    + `${quotaHit ? "(配額用盡)" : ""}${deadlineHit ? "(到軟上限)" : ""}`
    + `${sitemapFailures ? `;${sitemapFailures} 站 sitemap 讀取失敗` : ""}`;
  const errorText = [
    ...(sitemapFailures ? [`${sitemapFailures} 站 sitemap 讀取失敗`] : []),
    ...(failed ? [`${failed} 筆 inspect 失敗:${errorSamples.join(" | ")}`] : []),
    ...(quotaHit ? ["配額用盡"] : []),
    ...(deadlineHit ? [`到軟上限 ${SOFT_DEADLINE_MS}ms`] : []),
  ].join(";") || null;

  let status = "success";
  if (queue.length > 0 && ok === 0) status = "failed";
  else if (failed > 0 || sitemapFailures > 0 || quotaHit || deadlineHit) status = "partial_success";

  finishJob(db, job, { status, read: queue.length, created: ok, failed, error: errorText });
  log(`[${JOB_NAME}] ${status}:${summary}`);
  db.close();
  process.exit(status === "failed" ? 1 : 0);
} catch (err) {
  if (job) finishJob(db, job, { status: "failed", error: String(err && err.message ? err.message : err) });
  log(`[${JOB_NAME}] failed:${err && err.stack ? err.stack : err}`);
  try { db.close(); } catch {}
  process.exit(1);
}
