#!/usr/bin/env node
// ===========================================================================
// aeiou.now — 每個 (Topic × 站) 的「搜尋需求問的是哪一國」(2026-08-25 新增)
// ===========================================================================
//
// 用法(裸執行＝正確且完整的行為:用近 DEMAND_WINDOW_DAYS 天重算,冪等覆蓋):
//   node scripts/gsc-demand-country.mjs
//   node scripts/gsc-demand-country.mjs --days 180   看更長區間
//   node scripts/gsc-demand-country.mjs --report     只印現況,不寫
//   node scripts/gsc-demand-country.mjs --dry-run    算但不寫
//
// -- 這支解決什麼 ---------------------------------------------------------
// 2026-08-21 拍板「description 第一句是**本市場那一國**的制度答案」。
// 2026-08-25 用 query x page 交叉查下去,發現那條規則正好答錯了每一個排得上去的查詢:
// 站上排進前 15 名的帶國名查詢**全部**是「本市場的人問外國的事」
// (11 個查詢、83 曝光、平均 6.5 名、**0 點擊**),問本國的一個都沒進前 15。
// 最大一筆 `2027印尼齋戒月時間` 排 5.2、41 曝光、0 點擊,落在 zh-TW 站的
// ramadan-and-eid,而摘要開頭是「台灣不把開齋節列為法定假日…」。
// 頁面上**有**印尼那一段(該 Topic 涵蓋 6 國含 ID),只是摘要沒把它擺前面。
//
// 所以這支算出每個 (topic, locale) 的**需求主題國**,讓摘要第一句講那一國。
// ⚠ 這**不是推翻 2026-08-21**:「把日期換成制度」那半是對的(純日期型名次 32.7→18.2),
//    換掉的只是「哪一國」的選法。
//
// -- 資料來源與一個容易搞錯的地方 -----------------------------------------
// 來源是主機庫的 `gsc_query_metrics`(gsc-topic-metrics.mjs 每日累積的 query x page)。
// 不要拿 topic_search_metrics 的 `country:XX` scope 來做這件事 ——
//    那個維度是 GSC 的 country = **搜尋者所在國**,不是**查詢問的那一國**。
//    上面那筆的搜尋者在 TWN/HKG/IDN,問的卻是印尼。兩者是不同的東西。
//
// -- 門檻(見 lib/demand-country.mjs) --------------------------------------
// 這是會改變每個讀者看到什麼的判斷,所以寧可少改也不要靠一兩次曝光就翻盤:
// 勝出國要同時滿足「累積指名曝光 >= DEMAND_MIN_IMPRESSIONS」與
// 「佔該 (topic, locale) 全部指名曝光 >= DEMAND_MIN_SHARE」,否則這一格不寫,
// 前端就退回本市場那一國(＝2026-08-21 的行為)。沒資料時的行為必須是舊行為。
//
// 失敗:寫 jobs(job_name='gsc-demand-country'),重試 +5 分 / +10 分 / 第三次 dlq。

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { openDb, beginJob, finishJob, slotStart, nowSec, log } from "./lib/aeiou-lib.mjs";
import {
  buildCountryMatchers, demandCountryOf,
  DEMAND_MIN_IMPRESSIONS, DEMAND_MIN_SHARE,
} from "./lib/demand-country.mjs";

const JOB_NAME = "gsc-demand-country";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = resolve(ROOT, "data");

// 需求主題國是慢變量(節日的主場不會每週換),窗開長一點比較穩;
// 資料不足那幾格本來就會被門檻擋下,不會因為窗長而亂寫。
const DEMAND_WINDOW_DAYS = Number(process.env.AEIOU_DEMAND_WINDOW_DAYS || 90);

const argv = process.argv.slice(2);
const REPORT = argv.includes("--report");
const DRY_RUN = argv.includes("--dry-run") || REPORT;
const days = Number(argv[argv.indexOf("--days") + 1]) || DEMAND_WINDOW_DAYS;

const dayStr = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

// schema-host.sql 是新庫的權威;這個 CREATE IF NOT EXISTS 讓既有主機庫不必重建。
function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS topic_demand_country (
      topic_id     TEXT NOT NULL,
      locale       TEXT NOT NULL,
      country_code TEXT NOT NULL,
      impressions  INTEGER NOT NULL,
      share        REAL NOT NULL,
      window_days  INTEGER NOT NULL,
      computed_at  INTEGER NOT NULL,
      PRIMARY KEY (topic_id, locale)
    );
    CREATE INDEX IF NOT EXISTS idx_tdc_locale ON topic_demand_country(locale);
  `);
}

const db = openDb();
ensureSchema(db);   // --report 也要能讀;建表本身無副作用
const job = DRY_RUN ? null : beginJob(db, { jobName: JOB_NAME, scheduledAt: slotStart(3600) });

try {
  const matchers = buildCountryMatchers(DATA_DIR);
  if (matchers.length === 0) throw new Error("data/meta/countries.json 讀不到國名,無法解析查詢");

  // slug -> topic_id。GSC 只給網址,對應關係的權威在主機庫。
  const slugToId = new Map(
    db.prepare("SELECT topic_id, slug FROM topics").all().map((r) => [r.slug, r.topic_id]),
  );
  // topic_id -> 該 Topic 真的有內容的國家。lead country 必須在這裡面,
  // 否則摘要會承諾一段頁面上不存在的內容。
  const coveredByTopic = new Map();
  for (const r of db.prepare("SELECT DISTINCT topic_id, country_code FROM topic_observances").all()) {
    if (!coveredByTopic.has(r.topic_id)) coveredByTopic.set(r.topic_id, new Set());
    coveredByTopic.get(r.topic_id).add(r.country_code);
  }

  const rows = db.prepare(
    `SELECT locale, query, page_url, SUM(impressions) imp
       FROM gsc_query_metrics
      WHERE metric_date >= ?
      GROUP BY locale, query, page_url`,
  ).all(dayStr(days));

  // (topic_id, locale) -> { code -> 曝光 }
  const agg = new Map();
  let named = 0;
  for (const r of rows) {
    const m = /\/topic\/([^/?#]+)\/?/.exec(r.page_url || "");
    if (!m) continue;
    const topicId = slugToId.get(m[1]);
    if (!topicId) continue;
    const code = demandCountryOf(r.query, matchers);
    if (!code) continue;                                   // 沒指名國家的查詢不參與(多數如此)
    if (!coveredByTopic.get(topicId)?.has(code)) continue;  // 頁面上沒有那一國就不能當 lead
    named += r.imp;
    const key = `${topicId} ${r.locale}`;
    if (!agg.has(key)) agg.set(key, new Map());
    const byCode = agg.get(key);
    byCode.set(code, (byCode.get(code) || 0) + r.imp);
  }

  const winners = [];
  const rejected = [];
  for (const [key, byCode] of agg) {
    const [topicId, locale] = key.split(" ");
    const total = [...byCode.values()].reduce((a, b) => a + b, 0);
    const [code, imp] = [...byCode.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = total > 0 ? imp / total : 0;
    const row = { topicId, locale, code, imp, share, total };
    if (imp >= DEMAND_MIN_IMPRESSIONS && share >= DEMAND_MIN_SHARE) winners.push(row);
    else rejected.push(row);
  }

  const slugOf = new Map([...slugToId].map(([slug, id]) => [id, slug]));
  log(`[${JOB_NAME}] 窗 ${days} 天:query x page ${rows.length} 列、指名國家的曝光 ${named}、`
    + `(topic,站) 有指名 ${agg.size} 格 -> 過門檻 ${winners.length} 格`);
  for (const w of winners.sort((a, b) => b.imp - a.imp)) {
    log(`[${JOB_NAME}]   [採用] ${slugOf.get(w.topicId)} @ ${w.locale} -> ${w.code}`
      + `(指名曝光 ${w.imp}/${w.total}、佔 ${(w.share * 100).toFixed(0)}%)`);
  }
  for (const r of rejected.sort((a, b) => b.imp - a.imp).slice(0, 10)) {
    log(`[${JOB_NAME}]   [未過門檻] ${slugOf.get(r.topicId)} @ ${r.locale} -> ${r.code}`
      + `(指名曝光 ${r.imp}/${r.total}、佔 ${(r.share * 100).toFixed(0)}%;`
      + `門檻 >=${DEMAND_MIN_IMPRESSIONS} 且 >=${DEMAND_MIN_SHARE * 100}%)`);
  }

  let written = 0;
  if (!DRY_RUN) {
    const at = nowSec();
    db.exec("BEGIN");
    try {
      // 整批覆蓋:掉到門檻以下的格子要能退回本市場那一國,不能留著舊結論。
      db.prepare("DELETE FROM topic_demand_country").run();
      const ins = db.prepare(
        `INSERT INTO topic_demand_country
           (topic_id, locale, country_code, impressions, share, window_days, computed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const w of winners) ins.run(w.topicId, w.locale, w.code, w.imp, w.share, days, at);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    written = winners.length;
  }

  if (!DRY_RUN) finishJob(db, job, { status: "success", read: rows.length, created: written });
  log(`[${JOB_NAME}] ${DRY_RUN ? "dry-run(未寫入)" : "success"}(讀 ${rows.length} 列,寫 ${written} 筆)`);
} catch (err) {
  if (!DRY_RUN) finishJob(db, job, { status: "failed", error: String(err && err.message ? err.message : err) });
  log(`[${JOB_NAME}] failed:${err && err.stack ? err.stack : err}`);
  process.exit(1);
}
