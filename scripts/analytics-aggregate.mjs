#!/usr/bin/env node
// ===========================================================================
// aeiou.now — Job 19 Analytics Aggregation(草案 §35;2026-08-22 上線)
// ===========================================================================
//
// 用法(裸執行＝完整正確行為:把現有的所有面向聚合進 analytics_aggregates,冪等):
//   node scripts/analytics-aggregate.mjs
//   node scripts/analytics-aggregate.mjs --dry-run  只印會寫什麼
//   node scripts/analytics-aggregate.mjs --report   印目前聚合到什麼程度
//
// -- 這一支現在**只做得到一半**,而且那一半是刻意的 ------------------------
// 草案 §35 列了十二個維度,其中 page_views / unique_users 屬**瀏覽面**。
// 這個站的瀏覽面現在有兩個來源,兩個都不能直接用:
//   · GA4  —— 2026-08-20 拍板不接:近 28 天 146 sessions 裡 140 個(96%)是機器
//             (direct + 停留 0–4 秒 + 落在七站根目錄)。七站在 GitHub Pages 上、
//             前面沒有 CDN,擋不掉。而且專屬 property 與 SA 還沒開(見 docs/TODO.md)。
//   · GSC  —— 已經每天累積在 `topic_search_metrics`,是 Google 自己去重過的搜尋面,
//             爬蟲不會出現在裡面。**這一支用的是它。**
// 所以本支輸出的 metric 是 `impressions` / `clicks`(搜尋面)與 `comments` /
// `reactions`(互動面),**沒有 page_views**。
// ⚠ 不要為了「湊滿草案的十二個維度」去填一個沒有來源的欄位:一個恆為 0 的
//   page_views 比沒有這個維度更糟 —— 它看起來像量測結果,實際上是空的。
//   (`posts.views` / `unique_views` 就是這樣的欄位:INSERT 時寫 0,從此沒人動過。)
//
// -- 為什麼 bucket 是每日而不是草案寫的 15 分鐘 ----------------------------
// schema 的 `bucket_at` 註解寫「15 分鐘對齊」,但**來源本身就是每日的**:
// GSC 只給到 date 粒度,而互動面每 15 分鐘也只有個位數。把每日資料攤進 96 個
// 15 分鐘桶,產生的是 95 個 0 與 1 個真值 —— 那不是解析度,是假的解析度。
// 所以 bucket_at 對齊 **UTC 當日 00:00**。等有了真正的即時來源再談 15 分鐘。
//
// 冪等:PRIMARY KEY (bucket_at, dimension, dimension_id, metric),整批 upsert。
//
// 失敗:寫 jobs(job_name='analytics-aggregate')。

import { openDb, beginJob, finishJob, slotStart, nowSec, log } from "./lib/aeiou-lib.mjs";

const JOB_NAME = "analytics-aggregate";
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const REPORT = argv.includes("--report");

/** 回補幾天。GSC 的資料會回頭修正,所以每次重算最近這幾天而不是只算今天。 */
const BACKFILL_DAYS = 14;

const db = openDb();

if (REPORT) {
  const rows = db.prepare(
    `SELECT metric, dimension, COUNT(*) AS n, SUM(value) AS total,
            MIN(bucket_at) AS oldest, MAX(bucket_at) AS newest
       FROM analytics_aggregates GROUP BY metric, dimension ORDER BY metric, dimension`,
  ).all();
  if (rows.length === 0) {
    console.log("analytics_aggregates 是空的。");
  } else {
    console.log("metric       dimension  列數   合計      涵蓋");
    console.log("-----------  ---------  -----  --------  ----------------------");
    const d = (t) => new Date(t * 1000).toISOString().slice(0, 10);
    for (const r of rows) {
      console.log(`${String(r.metric).padEnd(11)}  ${String(r.dimension).padEnd(9)}  `
        + `${String(r.n).padStart(5)}  ${String(r.total).padStart(8)}  ${d(r.oldest)} → ${d(r.newest)}`);
    }
  }
  console.log("\n⚠ 沒有 page_views 是刻意的,不是漏做 —— 見本檔檔頭。");
  db.close();
  process.exit(0);
}

const job = beginJob(db, { jobName: JOB_NAME, scheduledAt: slotStart(3600) });

try {
  const now = nowSec();
  const since = new Date((now - BACKFILL_DAYS * 86400) * 1000).toISOString().slice(0, 10);
  const dayStart = (dateStr) => Math.floor(Date.parse(`${dateStr}T00:00:00Z`) / 1000);

  const rows = []; // {bucket_at, dimension, dimension_id, metric, value}
  const push = (bucket, dimension, id, metric, value) => {
    if (!id || !Number.isFinite(value) || value <= 0) return;
    rows.push({ bucket_at: bucket, dimension, dimension_id: String(id), metric, value: Math.round(value) });
  };

  // ── 搜尋面(GSC;唯一去過機器流量的來源)────────────────────────────────
  for (const r of db.prepare(
    `SELECT metric_date, topic_id, locale, scope, SUM(impressions) AS imp, SUM(clicks) AS clk
       FROM topic_search_metrics WHERE metric_date >= ?
      GROUP BY metric_date, topic_id, locale, scope`,
  ).all(since)) {
    const b = dayStart(r.metric_date);
    // scope='global' 才進 topic 維度;country:XX 另外進 country 維度,
    // 兩者相加會**重複計算同一次曝光**(global 已經含各國)。
    if (r.scope === "global") {
      push(b, "topic", r.topic_id, "impressions", r.imp);
      push(b, "topic", r.topic_id, "clicks", r.clk);
      push(b, "locale", r.locale, "impressions", r.imp);
      push(b, "locale", r.locale, "clicks", r.clk);
    } else if (r.scope.startsWith("country:")) {
      push(b, "country", r.scope.slice("country:".length), "impressions", r.imp);
      push(b, "country", r.scope.slice("country:".length), "clicks", r.clk);
    }
  }

  // ── 互動面(D1 回流到主機的那一份)──────────────────────────────────────
  // ⚠ 留言不回流主機(契約 §3 不翻譯 → translate-posts 不搬它),所以 comments
  //   這個 metric 取自 posts.comments 的合計而不是 comments 表 —— 那張表在主機是空的。
  for (const r of db.prepare(
    `SELECT date(created_at,'unixepoch') AS d, topic_id,
            COUNT(*) AS n, SUM(comments) AS c
       FROM posts WHERE created_at >= ? AND status NOT IN ('deleted','moderation')
      GROUP BY d, topic_id`,
  ).all(now - BACKFILL_DAYS * 86400)) {
    const b = dayStart(r.d);
    push(b, "topic", r.topic_id, "posts", r.n);
    push(b, "topic", r.topic_id, "comments", r.c);
  }

  for (const r of db.prepare(
    `SELECT date(synced_at,'unixepoch') AS d, target_type, SUM(total) AS n
       FROM reaction_totals GROUP BY d, target_type`,
  ).all()) {
    push(dayStart(r.d), "reaction_target", r.target_type, "reactions", r.n);
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

  log(`[${JOB_NAME}] 聚合 ${rows.length} 列(回補 ${BACKFILL_DAYS} 天)`);
  finishJob(db, job, { status: "success", read: rows.length, updated: rows.length });
  log(`[${JOB_NAME}] success`);
  db.close();
} catch (e) {
  const done = finishJob(db, job, { status: "failed", error: e && (e.stack || e.message || e) });
  log(`[${JOB_NAME}] FAILED status=${done.status} next_retry_at=${done.next_retry_at ?? "NULL"}: ${e.message || e}`);
  db.close();
  process.exit(1);
}
