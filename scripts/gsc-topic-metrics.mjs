#!/usr/bin/env node
// ===========================================================================
// aeiou.now — Google Search Console「每日 x Topic x 國家」曝光累積(2026-08-20 新增)
// ===========================================================================
//
// 用法(裸執行＝正確且完整的行為:補最近 REACH_DAYS 天,冪等覆蓋):
//   node scripts/gsc-topic-metrics.mjs
//   node scripts/gsc-topic-metrics.mjs --days 90    一次回補更長區間
//   node scripts/gsc-topic-metrics.mjs --dry-run    只印不寫
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
//
// -- 資料語意 ------------------------------------------------------------
// GSC 的 date 是**資料日**不是抓取日,而且有 2-3 天延遲 → 每次都重抓一段區間覆蓋,
// 讓延遲補齊的數字自動更新(PRIMARY KEY 冪等 upsert,不是 append)。
// position 是曝光加權平均,不能直接相加 → 存 position_sum(=position x impressions),
// 讀的時候再除。平均名次 = SUM(position_sum)/SUM(impressions)。
//
// 憑證:~/.config/aeiou/ga4-sa.json(GCP 專案 aeiou-seo 的 SA,只看得到 aeiou.now)。
// Google API 存取沿用 /root/seo-ops/lib/google.mjs,不重造輪子。
// 失敗:寫 jobs(job_name='gsc-topic-metrics'),重試 +5 分 / +10 分 / 第三次 dlq。

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { openDb, beginJob, finishJob, slotStart, nowSec, log } from "./lib/aeiou-lib.mjs";
import { alpha2From } from "./lib/country-codes.mjs";

const JOB_NAME = "gsc-topic-metrics";
const SA = process.env.AEIOU_GSC_SA || join(homedir(), ".config", "aeiou", "ga4-sa.json");
const GSC_SITE = "sc-domain:aeiou.now";
const GOOGLE_LIB = "/root/seo-ops/lib/google.mjs";
const PAGE_SIZE = 25000; // GSC searchAnalytics rowLimit 上限

// 每次重抓的區間。預設 10 天:蓋過 GSC 的 2-3 天延遲還有餘裕,
// 又不會每輪都把整段歷史重拉一遍。回補用 --days。
const REACH_DAYS = Number(process.env.AEIOU_GSC_REACH_DAYS || 10);

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
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
  `);
}

const dayStr = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const db = openDb();
if (!DRY_RUN) ensureQueryMetricsSchema(db);
const job = DRY_RUN ? null : beginJob(db, { jobName: JOB_NAME, scheduledAt: slotStart(86400) });

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
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    written = agg.size;
    queryWritten = queryAgg.size;
  }

  // -- 就緒度:什麼時候可以拿來驅動 HotScore(判準見檔頭) --
  const readiness = db
    .prepare(
      `SELECT topic_id, SUM(impressions) imp
         FROM topic_search_metrics
        WHERE scope = 'global' AND metric_date >= ?
        GROUP BY topic_id ORDER BY imp`,
    )
    .all(dayStr(28));
  const median = readiness.length ? readiness[Math.floor(readiness.length / 2)].imp : 0;
  log(
    `[${JOB_NAME}] 就緒度:近 28 天有曝光的 Topic ${readiness.length} 個,中位曝光 ${median}`
      + `(判準 >=30 才可驅動 HotScore;現在${median >= 30 ? "已達標" : "未達標,繼續累積"})`,
  );

  if (!DRY_RUN) finishJob(db, job, { status: "success", read: rows.length + queryRows.length, created: written + queryWritten });
  log(`[${JOB_NAME}] success(讀 ${rows.length} + ${queryRows.length} 列,寫 ${written} + ${queryWritten} 筆)`);
} catch (err) {
  if (!DRY_RUN) finishJob(db, job, { status: "failed", error: String(err && err.message ? err.message : err) });
  log(`[${JOB_NAME}] failed:${err && err.stack ? err.stack : err}`);
  process.exit(1);
}
