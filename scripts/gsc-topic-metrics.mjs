#!/usr/bin/env node
// ===========================================================================
// aeiou.now — Google Search Console「每日 x Topic x 國家」曝光累積(2026-08-20 新增)
// ===========================================================================
//
// 用法(裸執行＝正確且完整的行為:補最近 REACH_DAYS 天,冪等覆蓋):
//   node scripts/gsc-topic-metrics.mjs
//   node scripts/gsc-topic-metrics.mjs --days 90    一次回補更長區間
//   node scripts/gsc-topic-metrics.mjs --dry-run    只印不寫
//   node scripts/gsc-topic-metrics.mjs --report     最近 14 天站級曝光/點擊(all 與各 host),不打 API
//   node scripts/gsc-topic-metrics.mjs --report-raw 站級真值曲線 + 裝置/國別留存率,不打 API
//
// 2026-09-17 起同一次執行也把 date × page × country 的列加總成 `site_search_daily`
// (host='all' 與七個 host)。⚠ 那條曲線是**過濾後的尺度,不是站級真值** ——
// Google 對每一列套匿名化門檻,列愈細被遮愈多。2026-09-18 實測(2026-08-15~09-16):
//   dimensions=['date']                   13,702 曝光 / 69 點擊  ← 站級真值
//   dimensions=['date','page','country']   6,639 曝光 / 11 點擊  ← site_search_daily 的來源
// 曝光只留 48.5%、點擊只留 15.9%,而且留存率逐日在 15%~88% 之間跳,不能用常數校正回去。
//
// 2026-09-18 起另打 ['date'] / ['date','device'] / ['date','country'] / ['date','page']
// 四次,原封存進 `gsc_daily_raw`(dim, key)。**站級判準一律讀 gsc_daily_raw 的 dim='date'**;
// site_search_daily 與 gsc_query_metrics 保留原樣(不回填、不換源 —— 換源會讓曲線在
// 切換當天跳 2~7 倍,長得像復原)。2026-09-02 斷崖的回復判準就是 gsc_daily_raw。
//
// 為什麼要 device 與 country:2026-09-18 用這兩個維度才看出斷崖的形狀 ——
// 斷崖前 MOBILE 7,394 曝光/名次 10.0、DESKTOP 5,622/名次 43.5;斷崖後 MOBILE 39(留存 0.5%)、
// DESKTOP 349(6.2%)。站上唯一的好名次一直只在行動裝置上,而那一整塊在 09-02 消失。
// 國別同樣不對稱:ind 0.3%、idn 0.4%、twn 1.7%、bra 1.6%,但 usa 13.7%、can 14.9%、deu 16.9%。
//
// 除了 page/country 的 HotScore 累積，本支也保存 query/page/date 的主機私有聚合
// (`gsc_query_metrics`)。這是 SEO 工作清單的證據來源，不進 data/、D1 或前端。
//
// -- 為什麼是 GSC 而不是 GA4 ---------------------------------------------
// 2026-08-20 實測:GA4 近 28 天 146 sessions,其中 140 個(96%)是機器——
// direct + 平均停留 0-4 秒 + 落在七站根目錄,來源國集中在美/德/波/愛(資料中心)。
// 七站在 GitHub Pages 上、前面沒有 CDN,這個汙染擋不掉,`engagedSessions` 也只是
// 換一個門檻、沒換掉汙染源。GSC 是 Google 自己去重過的搜尋面,爬蟲不在裡面,
// 而且天然按 page 聚合 → 直接對得上 topic slug。
//
// -- 為什麼現在就要開始存 -------------------------------------------------
// GSC API 只回溯 16 個月,而且**沒有「當時的快照」**——今天不開始累積,以後補不回來。
// 這是這支存在的唯一理由;它不算分數、不寫 topic_scores。
//
// -- 什麼時候才可以拿來驅動 HotScore(別提前) ----------------------------
// 判準有兩條,兩條都要過:
//   1. 單一時窗內、單一 Topic 的中位曝光 >= 30。低於這個數,名次由雜訊決定——
//      2026-08-20 當時全站 28 天總曝光才 110,平均一天 4 次,拿來排 30 個 Topic
//      等於擲骰子。本支每次執行都會印出「就緒度」那一行,不必自己算。
//   2. site/src/lib/heat.mjs 的 HEAT_TIERS 依真實分佈重算過(那裡目前是 M1 暫定值,
//      檔內註解已寫明「不得沿用」)。
// 這個門檻不是無限等待條件:預設從第一個觀測日算 28 天,到期仍未達標就印
// `decision_required`,要求明確決定維持門檻、改視窗或先增加流量;
// 不會自動放寬 HotScore 的安全門檻。可用 AEIOU_GSC_READINESS_* 覆寫。
//
// -- 資料語意 ------------------------------------------------------------
// GSC 的 date 是**資料日**不是抓取日,而且有 2-3 天延遲 → 每次都重抓一段區間覆蓋,
// 讓延遲補齊的數字自動更新(PRIMARY KEY 冪等 upsert,不是 append)。
// position 是曝光加權平均,不能直接相加 → 存 position_sum(=position x impressions),
// 讀的時候再除。平均名次 = SUM(position_sum)/SUM(impressions)。
//
// 憑證:~/.config/aeiou/ga4-sa.json(GCP 專案 aeiou-seo 的 SA,只看得到 aeiou.now)。
// Google API 存取沿用 /mnt/customers/seo-ops/lib/google.mjs,不重造輪子。
// 失敗:寫 jobs(job_name='gsc-topic-metrics'),重試 +5 分 / +10 分 / 第三次 dlq。

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { ROOT, openDb, beginJob, finishJob, slotStart, nowSec, log } from "./lib/aeiou-lib.mjs";
import { alpha2From } from "./lib/country-codes.mjs";
import {
  DEFAULT_READINESS_DEADLINE_DAYS,
  DEFAULT_READINESS_THRESHOLD,
  DEFAULT_READINESS_WINDOW_DAYS,
  assessReadiness,
  positiveInt,
  validateReadinessDecision,
} from "./lib/gsc-readiness.mjs";

const JOB_NAME = "gsc-topic-metrics";
const SA = process.env.AEIOU_GSC_SA || join(homedir(), ".config", "aeiou", "ga4-sa.json");
const GSC_SITE = "sc-domain:aeiou.now";
const GOOGLE_LIB = "/mnt/customers/seo-ops/lib/google.mjs";
const PAGE_SIZE = 25000; // GSC searchAnalytics rowLimit 上限
// API 單次請求預設 30 秒,整支 job 再設 120 秒上限;超時先寫 failed 讓既有重試鏈接手。
const JOB_TIMEOUT_MS = (() => {
  const n = Number(process.env.AEIOU_GOOGLE_JOB_TIMEOUT_MS || 120_000);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 120_000;
})();

// 每次重抓的區間。預設 10 天:蓋過 GSC 的 2-3 天延遲還有餘裕,
// 又不會每輪都把整段歷史重拉一遍。回補用 --days。
const REACH_DAYS = Number(process.env.AEIOU_GSC_REACH_DAYS || 10);
const READINESS_WINDOW_DAYS = positiveInt(
  process.env.AEIOU_GSC_READINESS_WINDOW_DAYS,
  DEFAULT_READINESS_WINDOW_DAYS,
);
const READINESS_THRESHOLD = positiveInt(
  process.env.AEIOU_GSC_READINESS_THRESHOLD,
  DEFAULT_READINESS_THRESHOLD,
);
const READINESS_DEADLINE_DAYS = positiveInt(
  process.env.AEIOU_GSC_READINESS_DEADLINE_DAYS,
  DEFAULT_READINESS_DEADLINE_DAYS,
);
// 就緒度的決策紀錄(2026-09-17):到期後的決定寫在這裡(何時、決定什麼、何時再看),
// 不是用環境變數把提醒關掉。檔案壞了就當沒有決策 —— 但要吵出來。
const READINESS_DECISION_PATH = join(ROOT, "content", "gsc-readiness-decision.json");
const readinessDecision = (() => {
  if (!existsSync(READINESS_DECISION_PATH)) return null;
  try {
    return validateReadinessDecision(JSON.parse(readFileSync(READINESS_DECISION_PATH, "utf8")));
  } catch (error) {
    console.error(`[${JOB_NAME}] 就緒度決策檔壞了,視為沒有決策:${error.message}`);
    return null;
  }
})();

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const REPORT = argv.includes("--report");
const REPORT_RAW = argv.includes("--report-raw");
const days = Number(argv[argv.indexOf("--days") + 1]) || REACH_DAYS;

// 子網域 → locale。唯一映射表在 CLAUDE.md 介面常數;ja→jp、zh-CN→cn、pt-BR→br 不同名。
const HOST_LOCALE = {
  "aeiou.now": "zh-TW",
  "en.aeiou.now": "en",
  "jp.aeiou.now": "ja",
  "cn.aeiou.now": "zh-CN",
  "hi.aeiou.now": "hi",
  "id.aeiou.now": "id",
  "br.aeiou.now": "pt-BR",
};

// schema-host.sql 是新庫的權威；這個小型 CREATE IF NOT EXISTS 讓既有主機庫在
// 不需重建、不需停掉其他資料的情況下，第一次跑新版腳本也能安全補上加法欄位。
function ensureQueryMetricsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gsc_query_metrics (
      metric_date TEXT NOT NULL,
      locale TEXT NOT NULL,
      query TEXT NOT NULL,
      page_url TEXT NOT NULL,
      impressions INTEGER NOT NULL DEFAULT 0,
      clicks INTEGER NOT NULL DEFAULT 0,
      position_sum REAL NOT NULL DEFAULT 0,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (metric_date, locale, query, page_url)
    );
    CREATE INDEX IF NOT EXISTS idx_gqm_date ON gsc_query_metrics(metric_date);
    CREATE INDEX IF NOT EXISTS idx_gqm_page ON gsc_query_metrics(page_url, metric_date);
    CREATE INDEX IF NOT EXISTS idx_gqm_query ON gsc_query_metrics(query, metric_date);
    CREATE TABLE IF NOT EXISTS site_search_daily (
      metric_date  TEXT NOT NULL,
      host         TEXT NOT NULL,
      impressions  INTEGER NOT NULL DEFAULT 0,
      clicks       INTEGER NOT NULL DEFAULT 0,
      position_sum REAL NOT NULL DEFAULT 0,
      fetched_at   INTEGER NOT NULL,
      PRIMARY KEY (metric_date, host)
    );
    CREATE INDEX IF NOT EXISTS idx_ssd_host_date ON site_search_daily(host, metric_date);
    CREATE TABLE IF NOT EXISTS gsc_daily_raw (
      metric_date  TEXT NOT NULL,
      dim          TEXT NOT NULL,
      key          TEXT NOT NULL,
      impressions  INTEGER NOT NULL DEFAULT 0,
      clicks       INTEGER NOT NULL DEFAULT 0,
      position_sum REAL NOT NULL DEFAULT 0,
      fetched_at   INTEGER NOT NULL,
      PRIMARY KEY (metric_date, dim, key)
    );
    CREATE INDEX IF NOT EXISTS idx_gdr_dim_date ON gsc_daily_raw(dim, metric_date);
  `);
}

// --report:最近 14 天的站級曲線。只讀表、不打 API、不開 job;空庫印「尚無資料」。
function reportSiteDaily(db, daysBack = 14) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='site_search_daily'").get();
  if (!exists) { console.log("尚無資料:site_search_daily 表還沒建(先跑一次 node scripts/gsc-topic-metrics.mjs)。"); return; }
  const since = dayStr(daysBack);
  const rows = db.prepare(
    `SELECT metric_date, host, impressions, clicks, position_sum FROM site_search_daily
      WHERE metric_date >= ? ORDER BY metric_date, host`,
  ).all(since);
  if (!rows.length) { console.log(`尚無資料:site_search_daily 在 ${since} 之後沒有列。`); return; }
  const hosts = ["all", ...Object.keys(HOST_LOCALE)];
  const byDate = new Map();
  for (const r of rows) {
    if (!byDate.has(r.metric_date)) byDate.set(r.metric_date, {});
    byDate.get(r.metric_date)[r.host] = r;
  }
  const cell = (r) => (r ? `${r.impressions}/${r.clicks}` : "-");
  console.log(`站級每日 曝光/點擊(type=web,byPage 加總;GSC 固定落後 2-3 天,最近兩天偏低是正常的)`);
  console.log(["date".padEnd(10), ...hosts.map((h) => h.replace(".aeiou.now", "").replace("aeiou.now", "zh-TW").padStart(9))].join(" "));
  for (const [date, byHost] of [...byDate.entries()].sort()) {
    console.log([date.padEnd(10), ...hosts.map((h) => cell(byHost[h]).padStart(9))].join(" "));
  }
  const all = rows.filter((r) => r.host === "all");
  const imp = all.reduce((a, r) => a + r.impressions, 0);
  const clk = all.reduce((a, r) => a + r.clicks, 0);
  const pos = all.reduce((a, r) => a + r.position_sum, 0);
  console.log(`合計(all,${all.length} 天):曝光 ${imp}、點擊 ${clk}、平均名次 ${imp ? (pos / imp).toFixed(1) : "-"}`);
}


// --report-raw:站級真值曲線(dim='date')＋裝置/國別的斷崖前後留存率。只讀表、不打 API。
// 為什麼要跟 --report 分開:兩者尺度不同,同一張畫面上並列會讓人以為數字對不上是 bug。
function reportRaw(db, daysBack = 30) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='gsc_daily_raw'").get();
  if (!exists) { console.log("尚無資料:gsc_daily_raw 還沒建(先跑一次 node scripts/gsc-topic-metrics.mjs)。"); return; }
  const CLIFF = process.env.AEIOU_CLIFF_DATE || "2026-09-02";
  console.log(`站級真值(dimensions=['date'],未被匿名化遮罩)。GSC 固定落後 2-3 天,最近兩天偏低是正常的。`);
  const daily = db.prepare(
    `SELECT metric_date, impressions, clicks, position_sum FROM gsc_daily_raw
      WHERE dim = 'date' AND metric_date >= ? ORDER BY metric_date`,
  ).all(dayStr(daysBack));
  if (!daily.length) { console.log(`尚無資料:gsc_daily_raw 在 ${dayStr(daysBack)} 之後沒有 dim='date' 的列。`); return; }
  for (const r of daily) {
    console.log(`  ${r.metric_date}  ${String(r.impressions).padStart(6)} 曝光  ${String(r.clicks).padStart(3)} 點擊  `
      + `名次 ${r.impressions ? (r.position_sum / r.impressions).toFixed(1) : "-"}`);
  }
  const imp = daily.reduce((a, r) => a + r.impressions, 0);
  const clk = daily.reduce((a, r) => a + r.clicks, 0);
  console.log(`  合計 ${daily.length} 天:曝光 ${imp}、點擊 ${clk}、CTR ${imp ? (clk / imp * 100).toFixed(2) : "-"}%`);

  // 對照:同一段區間 site_search_daily(過濾後尺度)留下多少。差額就是匿名化遮罩量。
  const filtered = db.prepare(
    `SELECT SUM(impressions) imp, SUM(clicks) clk FROM site_search_daily
      WHERE host = 'all' AND metric_date >= ? AND metric_date <= ?`,
  ).get(daily[0].metric_date, daily[daily.length - 1].metric_date);
  if (filtered?.imp) {
    console.log(`  同區間 site_search_daily(page×country 尺度):曝光 ${filtered.imp}(留存 ${(filtered.imp / imp * 100).toFixed(1)}%)、`
      + `點擊 ${filtered.clk}(留存 ${clk ? (filtered.clk / clk * 100).toFixed(1) : "-"}%) ← 差額是 Google 的匿名化遮罩,不是 bug`);
  }

  for (const [dim, label] of [["device", "裝置"], ["country", "國別"]]) {
    const rows = db.prepare(
      `SELECT key,
              SUM(CASE WHEN metric_date <  ? THEN impressions ELSE 0 END) b_imp,
              SUM(CASE WHEN metric_date <  ? THEN position_sum ELSE 0 END) b_ps,
              SUM(CASE WHEN metric_date >  ? THEN impressions ELSE 0 END) a_imp,
              SUM(CASE WHEN metric_date >  ? THEN position_sum ELSE 0 END) a_ps
         FROM gsc_daily_raw WHERE dim = ? GROUP BY key HAVING b_imp >= 20 ORDER BY b_imp DESC LIMIT 20`,
    ).all(CLIFF, CLIFF, CLIFF, CLIFF, dim);
    if (!rows.length) continue;
    console.log(`\n${label}(${CLIFF} 前 vs 後;留存率 = 後/前,同樣長度的窗才可比,這裡只看相對大小)`);
    for (const r of rows) {
      console.log(`  ${r.key.padEnd(10)} 前 ${String(r.b_imp).padStart(6)} 名次 ${(r.b_ps / r.b_imp).toFixed(1).padStart(5)}`
        + `  →  後 ${String(r.a_imp).padStart(5)} 名次 ${r.a_imp ? (r.a_ps / r.a_imp).toFixed(1).padStart(5) : "    -"}`
        + `  留存 ${(r.a_imp / r.b_imp * 100).toFixed(1)}%`);
    }
  }
}

const dayStr = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const db = openDb();
if (REPORT || REPORT_RAW) {
  try { if (REPORT_RAW) reportRaw(db); else reportSiteDaily(db); } finally { db.close(); }
  process.exit(0);
}
if (!DRY_RUN) ensureQueryMetricsSchema(db);
const job = DRY_RUN ? null : beginJob(db, { jobName: JOB_NAME, scheduledAt: slotStart(86400) });
const watchdog = setTimeout(() => {
  const error = `${JOB_NAME} hard timeout after ${JOB_TIMEOUT_MS}ms`;
  if (job) {
    try {
      const done = finishJob(db, job, { status: "failed", error });
      log(`[${JOB_NAME}] HARD_TIMEOUT status=${done.status} next_retry_at=${done.next_retry_at ?? "NULL"}`);
    } catch (finishError) {
      console.error(`[${JOB_NAME}] HARD_TIMEOUT 收尾失敗:${finishError.message || finishError}`);
    }
  } else {
    log(`[${JOB_NAME}] HARD_TIMEOUT ${error}`);
  }
  try { db.close(); } catch {}
  process.exit(124);
}, JOB_TIMEOUT_MS);

try {
  if (!existsSync(SA)) throw new Error(`缺 SA 金鑰:${SA}`);
  if (!existsSync(GOOGLE_LIB)) throw new Error(`缺 ${GOOGLE_LIB}`);
  const { gscQuery } = await import(GOOGLE_LIB);

  // slug → topic_id。GSC 只給網址,對應關係的權威在主機庫。
  const slugToId = new Map(
    db.prepare("SELECT topic_id, slug FROM topics").all().map((r) => [r.slug, r.topic_id]),
  );
  log(`[${JOB_NAME}] 主機庫 ${slugToId.size} 個 topic slug 可對應`);

  const startDate = dayStr(days);
  const endDate = dayStr(0);
  log(`[${JOB_NAME}] 抓 GSC ${startDate} -> ${endDate}(date x page x country)`);

  const fetchRows = async (dimensions) => {
    const out = [];
    for (let startRow = 0; ; startRow += PAGE_SIZE) {
      const res = await gscQuery(SA, GSC_SITE, {
        startDate,
        endDate,
        dimensions,
        type: "web", // 預設就是 web;明寫是讓「站級曲線 = 原始 API type=web」這句對得上
        rowLimit: PAGE_SIZE,
        startRow,
      });
      const batch = res.rows || [];
      out.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return out;
  };

  // 一次把三個維度都要下來:date 讓我們存得到每日曲線,country 讓 scope 分得出國別。
  const rows = await fetchRows(["date", "page", "country"]);
  // query/page 不帶 country，避免把同一查詢拆成很多小列；page 的 host 已足以反查 locale。
  const queryRows = await fetchRows(["date", "query", "page"]);

  // 原始維度:每個 dim 各打一次。列愈粗被匿名化遮掉的愈少,所以 ['date'] 才是站級真值。
  // 四者彼此**不可互相加總**(遮罩門檻不同),各自獨立存進 gsc_daily_raw。
  const RAW_DIMS = [
    ["date", (r) => "all"],
    ["device", (r) => r.keys[1] || "UNKNOWN"],
    ["country", (r) => r.keys[1] || "zzz"],
    ["page", (r) => r.keys[1] || ""],
  ];
  const rawAgg = new Map();   // `${date}\t${dim}\t${key}` -> 累計
  for (const [dim, keyOf] of RAW_DIMS) {
    const dims = dim === "date" ? ["date"] : ["date", dim];
    const got = await fetchRows(dims);
    for (const r of got) {
      const date = r.keys[0];
      const key = keyOf(r);
      if (!date || key === "") continue;
      const k = `${date}\t${dim}\t${key}`;
      const cur = rawAgg.get(k) || { impressions: 0, clicks: 0, position_sum: 0 };
      cur.impressions += Number(r.impressions) || 0;
      cur.clicks += Number(r.clicks) || 0;
      cur.position_sum += (Number(r.position) || 0) * (Number(r.impressions) || 0);
      rawAgg.set(k, cur);
    }
    log(`[${JOB_NAME}] 原始維度 ${dims.join("x")}:${got.length} 列`);
  }
  log(`[${JOB_NAME}] GSC 回 ${rows.length} 列 page/country、${queryRows.length} 列 query/page`);

  // 聚合到 (date, topic, locale, scope)。
  const agg = new Map();
  let unmapped = 0;
  const unmappedCountries = new Set();   // GSC 給了但對照表查不到的 alpha-3
  const unmappedSample = new Set();
  for (const r of rows) {
    const [date, pageUrl, country] = r.keys;
    let host;
    let path;
    try {
      const u = new URL(pageUrl);
      host = u.host;
      path = u.pathname;
    } catch {
      continue;
    }
    const locale = HOST_LOCALE[host];
    const m = path.match(/^\/topic\/([^/]+)\/?$/);
    if (!locale || !m) continue; // 非 Topic 頁(首頁/清單頁/questions)不進這張表
    const topicId = slugToId.get(m[1]);
    if (!topicId) {
      unmapped++;
      unmappedSample.add(m[1]);
      continue;
    }

    // GSC 的 country 維度是 **alpha-3**,但本專案的國碼標準是 alpha-2
    // (posts.country_code 來自 Cloudflare、observances/places 的 country_code、
    //  甚至 topic_search_metrics 自己的 schema 註解都寫 'country:XX')。
    // 2026-08-21 之前這裡直接串三碼進 scope,結果同一個國家被切成兩個:
    // `country:TW`(貼文)與 `country:TWN`(GSC),data/rankings/ 也長出兩個目錄。
    // 查不到對照就**吵出來**,不要靜靜地生出第三套代碼。
    const raw = String(country || "").toUpperCase();
    const cc = alpha2From(raw);
    if (!cc) unmappedCountries.add(raw);
    // 查不到對照時**只跳過國別 scope,global 照樣累加** —— 曝光數不能因為
    // 一個沒見過的國碼就整列不算。(第一版寫成 continue,會把 global 也跳掉。)
    for (const scope of cc ? ["global", `country:${cc}`] : ["global"]) {
      const key = `${date} ${topicId} ${locale} ${scope}`;
      const cur = agg.get(key) || { impressions: 0, clicks: 0, position_sum: 0 };
      cur.impressions += r.impressions;
      cur.clicks += r.clicks;
      cur.position_sum += r.position * r.impressions; // 曝光加權,不能直接平均
      agg.set(key, cur);
    }
  }
  if (unmapped > 0) {
    // 這通常代表 Topic 被改名或退役,而舊網址還在被搜尋 —— 是訊號不是噪音,要印出來。
    log(`[${JOB_NAME}] 注意:${unmapped} 列的 slug 在主機庫找不到:${[...unmappedSample].slice(0, 8).join(", ")}`);
  }
  if (unmappedCountries.size > 0) {
    // 吵出來:查不到對照代表 GSC 給了對照表沒有的 alpha-3(新代碼、或表過期了)。
    // 這些列的國別 scope 沒被記,global 有。要補就重產 scripts/lib/country-codes.mjs。
    log(`[${JOB_NAME}] ⚠ ${unmappedCountries.size} 個 alpha-3 查不到 alpha-2 對照,`
      + `該國的國別 scope 本輪未記錄:${[...unmappedCountries].sort().join(", ")}`);
  }
  log(`[${JOB_NAME}] 聚合為 ${agg.size} 筆 (date x topic x locale x scope)`);

  // 聚合到 (date, locale, query, page)。非本站七個正式 host 的舊網址不進來，
  // 但不因為頁面不是 Topic 就丟掉——首頁、問題頁等入口也可能是 CTR 瓶頸。
  const queryAgg = new Map();
  for (const r of queryRows) {
    const [date, query, pageUrl] = r.keys;
    if (!query || !pageUrl) continue;
    let locale;
    try { locale = HOST_LOCALE[new URL(pageUrl).host]; } catch { locale = null; }
    if (!locale) continue;
    const key = `${date}\t${locale}\t${query}\t${pageUrl}`;
    const cur = queryAgg.get(key) || { impressions: 0, clicks: 0, position_sum: 0 };
    cur.impressions += Number(r.impressions) || 0;
    cur.clicks += Number(r.clicks) || 0;
    cur.position_sum += (Number(r.position) || 0) * (Number(r.impressions) || 0);
    queryAgg.set(key, cur);
  }
  log(`[${JOB_NAME}] query/page 聚合為 ${queryAgg.size} 筆 (主機私有)`);

  // 站級逐日:同一批 date × page × country 列直接加總。'all' 是整個 sc-domain 資源
  // (含映射表外的舊網域);七個 host 各自一列。不另打 API。
  const siteAgg = new Map();
  const unknownHosts = new Set();
  const addSite = (date, host, r) => {
    const key = `${date}\t${host}`;
    const cur = siteAgg.get(key) || { impressions: 0, clicks: 0, position_sum: 0 };
    cur.impressions += Number(r.impressions) || 0;
    cur.clicks += Number(r.clicks) || 0;
    cur.position_sum += (Number(r.position) || 0) * (Number(r.impressions) || 0);
    siteAgg.set(key, cur);
  };
  for (const r of rows) {
    const [date, pageUrl] = r.keys;
    let host;
    try { host = new URL(pageUrl).host; } catch { continue; }
    addSite(date, "all", r);
    if (HOST_LOCALE[host]) addSite(date, host, r);
    else unknownHosts.add(host);
  }
  if (unknownHosts.size) {
    log(`[${JOB_NAME}] 站級曲線:${unknownHosts.size} 個非七站 host 只計入 all:${[...unknownHosts].slice(0, 5).join(", ")}`);
  }
  log(`[${JOB_NAME}] 站級逐日聚合為 ${siteAgg.size} 筆 (date x host)`);

  let written = 0;
  let queryWritten = 0;
  if (DRY_RUN) {
    log(`[${JOB_NAME}] --dry-run:不寫入`);
  } else {
    const at = nowSec();
    const stmt = db.prepare(
      `INSERT INTO topic_search_metrics
         (metric_date, topic_id, locale, scope, impressions, clicks, position_sum, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(metric_date, topic_id, locale, scope) DO UPDATE SET
         impressions  = excluded.impressions,
         clicks       = excluded.clicks,
         position_sum = excluded.position_sum,
         fetched_at   = excluded.fetched_at`,
    );
    const queryStmt = db.prepare(
      `INSERT INTO gsc_query_metrics
         (metric_date, locale, query, page_url, impressions, clicks, position_sum, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(metric_date, locale, query, page_url) DO UPDATE SET
         impressions = excluded.impressions,
         clicks = excluded.clicks,
         position_sum = excluded.position_sum,
         fetched_at = excluded.fetched_at`,
    );
    const rawStmt = db.prepare(
      `INSERT INTO gsc_daily_raw
         (metric_date, dim, key, impressions, clicks, position_sum, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(metric_date, dim, key) DO UPDATE SET
         impressions = excluded.impressions,
         clicks = excluded.clicks,
         position_sum = excluded.position_sum,
         fetched_at = excluded.fetched_at`,
    );
    const siteStmt = db.prepare(
      `INSERT INTO site_search_daily
         (metric_date, host, impressions, clicks, position_sum, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(metric_date, host) DO UPDATE SET
         impressions = excluded.impressions,
         clicks = excluded.clicks,
         position_sum = excluded.position_sum,
         fetched_at = excluded.fetched_at`,
    );
    // node:sqlite 沒有 better-sqlite3 的 db.transaction() —— 用 exec 手開,
    // 比照 scripts/import-questions.mjs 的寫法(失敗一律 ROLLBACK,不留半套資料)。
    db.exec("BEGIN");
    try {
      for (const [key, v] of agg.entries()) {
        const [date, topicId, locale, scope] = key.split(" ");
        stmt.run(date, topicId, locale, scope, v.impressions, v.clicks, v.position_sum, at);
      }
      for (const [key, v] of queryAgg.entries()) {
        const [date, locale, query, pageUrl] = key.split("\t");
        queryStmt.run(date, locale, query, pageUrl, v.impressions, v.clicks, v.position_sum, at);
      }
      for (const [key, v] of siteAgg.entries()) {
        const [date, host] = key.split("\t");
        siteStmt.run(date, host, v.impressions, v.clicks, v.position_sum, at);
      }
      for (const [k, v] of rawAgg.entries()) {
        const [date, dim, key] = k.split("\t");
        rawStmt.run(date, dim, key, v.impressions, v.clicks, v.position_sum, at);
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    written = agg.size;
    queryWritten = queryAgg.size + siteAgg.size + rawAgg.size;
  }

  // -- 就緒度:什麼時候可以拿來驅動 HotScore(判準見檔頭) --
  const readiness = db
    .prepare(
      `SELECT topic_id, SUM(impressions) imp
         FROM topic_search_metrics
        WHERE scope = 'global' AND metric_date >= ?
        GROUP BY topic_id ORDER BY imp`,
    )
    .all(dayStr(READINESS_WINDOW_DAYS));
  const median = readiness.length ? readiness[Math.floor(readiness.length / 2)].imp : 0;
  const firstObservedDate = db
    .prepare("SELECT MIN(metric_date) AS metric_date FROM topic_search_metrics WHERE scope = 'global'")
    .get()?.metric_date || null;
  const readinessState = assessReadiness({
    median,
    threshold: READINESS_THRESHOLD,
    windowDays: READINESS_WINDOW_DAYS,
    deadlineDays: READINESS_DEADLINE_DAYS,
    firstObservedDate,
    today: dayStr(0),
    decision: readinessDecision,
  });
  const stateMessage = readinessState.status === "ready"
    ? "已達標"
    : readinessState.status === "deferred"
      ? `已決策(${readinessDecision.decided_at} ${readinessDecision.decision}),${readinessState.reviewOn} 再評估`
      : readinessState.status === "decision_required"
        ? (readinessDecision
          ? `觀測期限已到(${readinessState.deadlineDate}),決策檔 review_on ${readinessDecision.review_on} 已到期,需要重新決策(content/gsc-readiness-decision.json),不自動放寬門檻`
          : `觀測期限已到(${readinessState.deadlineDate}),需要決策,不自動放寬門檻`)
        : readinessState.deadlineDate
          ? `觀測中,期限${readinessState.deadlineDate}`
          : "觀測中,尚無觀測起點";
  log(
    `[${JOB_NAME}] 就緒度:近 ${READINESS_WINDOW_DAYS} 天有曝光的 Topic ${readiness.length} 個,中位曝光 ${median}`
      + `(判準 >=${READINESS_THRESHOLD} 才可驅動 HotScore;${stateMessage})`,
  );

  if (!DRY_RUN) finishJob(db, job, { status: "success", read: rows.length + queryRows.length, created: written + queryWritten });
  clearTimeout(watchdog);
  log(`[${JOB_NAME}] success(讀 ${rows.length} + ${queryRows.length} 列,寫 ${written} + ${queryWritten} 筆)`);
} catch (err) {
  clearTimeout(watchdog);
  if (!DRY_RUN) finishJob(db, job, { status: "failed", error: String(err && err.message ? err.message : err) });
  log(`[${JOB_NAME}] failed:${err && err.stack ? err.stack : err}`);
  process.exit(1);
}
