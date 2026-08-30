#!/usr/bin/env node
// ===========================================================================
// aeiou.now — GA4 每日拉取(docs/02-data-model.md §8;2026-08-22 上線)
// ===========================================================================
//
// 用法(裸執行＝完整正確行為:回補最近 14 天,冪等):
//   node scripts/ga4-daily.mjs
//   node scripts/ga4-daily.mjs --days 60   回補更久(GA4 保留期內)
//   node scripts/ga4-daily.mjs --dry-run   只印會寫什麼
//   node scripts/ga4-daily.mjs --report    印已拉到什麼,以及機器流量佔比
//
// -- 這一項先前被我誤記成「卡在外部授權」,那是錯的(2026-08-22 更正)---------
// 真相是:aeiou **早就有自己的 GCP 專案與 SA** ——
// `seo-ops@aeiou-seo.iam.gserviceaccount.com`(專案 `aeiou-seo`),
// 而且 `identity-audit --all` 實測它**不在**那 11 個共用金鑰的群組裡。
// 也就是說「不共用其他站金鑰」那條紅線一直是滿足的,`seo-health.mjs` 也一直在用它讀 GA4。
// 缺的從來不是授權,只是這支腳本沒寫。
//
// -- 但它寫進去的東西要說實話 ----------------------------------------------
// 2026-08-20 查證:GA4 近 28 天的 session 有 96% 是機器(direct + 停留 0–4 秒 +
// 落在七站根目錄,來源集中在資料中心)。七站在 GitHub Pages 上、前面沒有 CDN,擋不掉。
// 所以這支**同時寫兩個 metric**:
//   `page_views`        原始值 —— 它是事實,但不是「有人在看」的證據
//   `page_views_human`  只計 Organic Search 管道 —— 這是本專案認定「可當真人看」的那一部分
// 只寫其中一個都會說謊:只寫原始值會讓人以為有人在看,只寫過濾值會讓人以為 GA4 壞了。
//
// 🔴 **仍然不准拿它算 HotScore 的瀏覽面**(2026-08-20 拍板,紅線未變)。
//    HotScore 的瀏覽面走 GSC(`topic_search_metrics`)。這張表的用途是**報表**。
//
// 失敗:寫 jobs(job_name='ga4-daily')。

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { openDb, beginJob, finishJob, acquireLock, slotStart, log } from "./lib/aeiou-lib.mjs";

const JOB_NAME = "ga4-daily";
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const REPORT = argv.includes("--report");
const DAYS = (() => {
  const i = argv.indexOf("--days");
  const n = i >= 0 ? Number(argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 14;
})();

/** 與 seo-health.mjs 同一個 property —— 七站共用一個 web stream,以 hostname 區分。 */
const GA4_PROPERTY = "549586494";
const SA = process.env.AEIOU_GA4_SA || join(homedir(), ".config", "aeiou", "ga4-sa.json");
/** hostname → locale。與 CLAUDE.md 的映射表同源(ja→jp、zh-CN→cn、pt-BR→br 不同名)。 */
const LOCALE_BY_HOST = {
  "aeiou.now": "zh-TW", "en.aeiou.now": "en", "jp.aeiou.now": "ja", "cn.aeiou.now": "zh-CN",
  "hi.aeiou.now": "hi", "id.aeiou.now": "id", "br.aeiou.now": "pt-BR",
};

const db = openDb();

if (REPORT) {
  const rows = db.prepare(
    `SELECT metric, COUNT(*) AS n, SUM(value) AS total,
            MIN(bucket_at) AS oldest, MAX(bucket_at) AS newest
       FROM analytics_aggregates WHERE metric LIKE 'page_views%'
      GROUP BY metric ORDER BY metric`,
  ).all();
  if (rows.length === 0) {
    console.log("還沒拉過 GA4(analytics_aggregates 裡沒有 page_views)。");
  } else {
    const d = (t) => new Date(t * 1000).toISOString().slice(0, 10);
    console.log("metric             列數   合計      涵蓋");
    console.log("-----------------  -----  --------  ----------------------");
    for (const r of rows) {
      console.log(`${String(r.metric).padEnd(17)}  ${String(r.n).padStart(5)}  ${String(r.total).padStart(8)}  ${d(r.oldest)} → ${d(r.newest)}`);
    }
    const raw = rows.find((r) => r.metric === "page_views")?.total || 0;
    const human = rows.find((r) => r.metric === "page_views_human")?.total || 0;
    if (raw > 0) {
      console.log(`\n可當真人看的佔比:${((human / raw) * 100).toFixed(1)}%(${human}/${raw})`);
      console.log("⚠ 這個佔比低是**已知事實**不是資料壞掉:七站在 GitHub Pages 上、前面沒有 CDN,");
      console.log("  擋不掉機器流量。所以 HotScore 的瀏覽面走 GSC 不走 GA4(2026-08-20 拍板)。");
    }
  }
  db.close();
  process.exit(0);
}

if (!existsSync(SA)) {
  console.error(`✗ 找不到 SA 金鑰 ${SA}`);
  process.exit(2);
}

// ── 為什麼掛在每小時的管線上,卻是「每日」拉取 ─────────────────────────────
// GA4 的資料是每日粒度的,一天拉一次就夠;但**新增 /etc/cron.d/aeiou 的排程行屬 C 級改動**
// (CLAUDE.md),要先問用戶。所以改成掛進 hourly-export,再用 `job_locks` 自我節流:
// scheduledAt 對齊 UTC 當日,同一天的第二次之後一律 skip,不打 GA4、不寫任何一列。
// 效果與獨立的每日 cron 相同,而且少一個要維護的排程行。
const scheduledAt = slotStart(86400);
const lock = acquireLock(db, { jobName: JOB_NAME, scheduledAt });
if (!lock.ok) {
  log(`[${JOB_NAME}] skip: ${lock.reason}(GA4 是每日粒度,同一天只拉一次)`);
  db.close();
  process.exit(0);
}

const job = beginJob(db, { jobName: JOB_NAME, scheduledAt });

try {
  const { ga4RunReport } = await import("/mnt/customers/seo-ops/lib/google.mjs");
  const dayStart = (s) => Math.floor(Date.parse(`${s}T00:00:00Z`) / 1000);
  const rows = [];
  const push = (bucket, dimension, id, metric, value) => {
    if (!id || !Number.isFinite(value) || value <= 0) return;
    rows.push({ bucket_at: bucket, dimension, dimension_id: String(id), metric, value: Math.round(value) });
  };

  // 一次查詢拿到 date × hostname × channel,三個維度都用得上,不必打三次。
  const res = await ga4RunReport(SA, GA4_PROPERTY, {
    dateRanges: [{ startDate: `${DAYS}daysAgo`, endDate: "yesterday" }],
    dimensions: [{ name: "date" }, { name: "hostName" }, { name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "screenPageViews" }, { name: "sessions" }, { name: "activeUsers" }],
    limit: 100000,
  });

  for (const r of res.rows || []) {
    const [date, host, channel] = r.dimensionValues.map((v) => v.value);
    const [views, sessions, users] = r.metricValues.map((v) => Number(v.value) || 0);
    // GA4 的 date 是 YYYYMMDD
    const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
    const b = dayStart(iso);
    if (!Number.isFinite(b)) continue;
    const locale = LOCALE_BY_HOST[host];
    // 不在映射表裡的 hostname(例如舊的 github.io)照樣記進 host 維度,
    // 但**不併進 locale** —— 猜它屬於哪一語系會做出假資料。
    push(b, "host", host, "page_views", views);
    push(b, "host", host, "sessions", sessions);
    push(b, "host", host, "active_users", users);
    if (locale) {
      push(b, "locale", locale, "page_views", views);
      push(b, "locale", locale, "sessions", sessions);
    }
    push(b, "channel", channel, "sessions", sessions);
    // 可當真人看的那一部分:只有 Organic Search。
    // 判準來自 2026-08-20 的查證,不是我在這裡新訂的。
    if (channel === "Organic Search") {
      push(b, "host", host, "page_views_human", views);
      if (locale) push(b, "locale", locale, "page_views_human", views);
    }
  }

  if (DRY_RUN) {
    const byMetric = new Map();
    for (const r of rows) byMetric.set(r.metric, (byMetric.get(r.metric) || 0) + 1);
    for (const [m, n] of [...byMetric].sort()) log(`  ${m}: ${n} 列`);
    log(`[${JOB_NAME}] DRY_RUN:會寫 ${rows.length} 列,不寫入`);
    finishJob(db, job, { status: "success", read: rows.length, updated: 0 });
    db.close();
    process.exit(0);
  }

  db.exec("BEGIN");
  try {
    const ins = db.prepare(
      `INSERT INTO analytics_aggregates (bucket_at, dimension, dimension_id, metric, value)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (bucket_at, dimension, dimension_id, metric)
       DO UPDATE SET value = excluded.value`,
    );
    for (const r of rows) ins.run(r.bucket_at, r.dimension, r.dimension_id, r.metric, r.value);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  const raw = rows.filter((r) => r.metric === "page_views" && r.dimension === "host")
    .reduce((a, r) => a + r.value, 0);
  const human = rows.filter((r) => r.metric === "page_views_human" && r.dimension === "host")
    .reduce((a, r) => a + r.value, 0);
  log(`[${JOB_NAME}] 回補 ${DAYS} 天:寫 ${rows.length} 列;瀏覽 ${raw}、其中可當真人看 ${human}`
    + `(${raw ? ((human / raw) * 100).toFixed(1) : "0"}%)`);
  finishJob(db, job, { status: "success", read: rows.length, updated: rows.length });
  log(`[${JOB_NAME}] success`);
  db.close();
} catch (e) {
  const done = finishJob(db, job, { status: "failed", error: e && (e.stack || e.message || e) });
  log(`[${JOB_NAME}] FAILED status=${done.status} next_retry_at=${done.next_retry_at ?? "NULL"}: ${e.message || e}`);
  db.close();
  process.exit(1);
}
