import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DISCOVERED_NOT_INDEXED,
  coverageMatrix,
  inspectionRow,
  isQuotaError,
  latestPerUrl,
  pageTypeOf,
  persistentlyUnindexed,
  planSweep,
  urlsFromSitemap,
} from "../../scripts/lib/url-inspection.mjs";

test("page_type:七種 URL 形狀各歸各的類", () => {
  assert.equal(pageTypeOf("https://aeiou.now/"), "home");
  assert.equal(pageTypeOf("https://aeiou.now/topic/ramadan-and-eid/"), "topic");
  assert.equal(pageTypeOf("https://br.aeiou.now/topic/ramadan-and-eid/id/"), "country");
  assert.equal(pageTypeOf("https://jp.aeiou.now/holidays/jp/2026/"), "holiday");
  assert.equal(pageTypeOf("https://aeiou.now/questions/"), "question");
  assert.equal(pageTypeOf("https://aeiou.now/questions/2026-09-17/"), "question");
  assert.equal(pageTypeOf("https://aeiou.now/rankings/3m/"), "ranking");
  assert.equal(pageTypeOf("https://aeiou.now/topics/today/"), "other");
  assert.equal(pageTypeOf("https://aeiou.now/about/"), "other");
  assert.equal(pageTypeOf("not a url"), "other");
});

test("page_type:逐國頁的國碼必須是兩碼小寫,否則不是逐國頁", () => {
  assert.equal(pageTypeOf("https://aeiou.now/topic/x/ID/"), "other");
  assert.equal(pageTypeOf("https://aeiou.now/topic/x/idn/"), "other");
});

test("urlsFromSitemap:取全部 loc、去重、可改掛 origin", () => {
  const xml = `<urlset>
    <url><loc>https://aeiou.now/</loc></url>
    <url><loc>https://aeiou.now/topic/a/</loc></url>
    <url><loc>https://aeiou.now/topic/a/</loc></url>
    <url><loc> https://aeiou.now/holidays/tw/2026/ </loc></url>
  </urlset>`;
  assert.deepEqual(urlsFromSitemap(xml), [
    "https://aeiou.now/",
    "https://aeiou.now/topic/a/",
    "https://aeiou.now/holidays/tw/2026/",
  ]);
  assert.deepEqual(urlsFromSitemap(xml, "https://en.aeiou.now"), [
    "https://en.aeiou.now/",
    "https://en.aeiou.now/topic/a/",
    "https://en.aeiou.now/holidays/tw/2026/",
  ]);
});

test("planSweep:從沒掃過的優先,其次上次最舊,同 sweep 已掃的跳過", () => {
  const urls = ["u1", "u2", "u3", "u4", "u5"];
  const history = new Map([
    ["u1", { lastInspectedAt: 300, lastSweepId: "2026-09-15" }],
    ["u2", { lastInspectedAt: 100, lastSweepId: "2026-09-13" }],
    ["u4", { lastInspectedAt: 900, lastSweepId: "2026-09-17" }], // 今天掃過
  ]);
  const plan = planSweep({ urls, history, sweepId: "2026-09-17", limit: 100 });
  assert.deepEqual(plan.planned, ["u3", "u5", "u2", "u1"]);
  assert.equal(plan.skippedInSweep, 1);
  assert.equal(plan.neverInspected, 2);
  assert.equal(plan.candidates, 4);
});

test("planSweep:配額截斷,limit 0 一筆都不排", () => {
  const urls = ["a", "b", "c", "d"];
  const plan = planSweep({ urls, history: new Map(), sweepId: "2026-09-17", limit: 2 });
  assert.deepEqual(plan.planned, ["a", "b"]);
  assert.equal(plan.candidates, 4);
  assert.deepEqual(planSweep({ urls, history: new Map(), sweepId: "2026-09-17", limit: 0 }).planned, []);
  assert.deepEqual(planSweep({ urls, history: new Map(), sweepId: "2026-09-17", limit: -3 }).planned, []);
});

test("planSweep:同一 URL 在 sitemap 重複只排一次", () => {
  const plan = planSweep({ urls: ["a", "a", "b"], history: new Map(), sweepId: "s", limit: 10 });
  assert.deepEqual(plan.planned, ["a", "b"]);
});

test("inspectionRow:欄位對應,referringUrls 存數量,缺欄位存 null", () => {
  const row = inspectionRow({
    verdict: "PASS",
    coverageState: "Submitted and indexed",
    indexingState: "INDEXING_ALLOWED",
    robotsTxtState: "ALLOWED",
    lastCrawlTime: "2026-08-20T01:02:03Z",
    googleCanonical: "https://aeiou.now/topic/a/",
    referringUrls: ["x", "y", "z"],
  });
  assert.deepEqual(row, {
    verdict: "PASS",
    coverage_state: "Submitted and indexed",
    indexing_state: "INDEXING_ALLOWED",
    robots_state: "ALLOWED",
    last_crawl_time: "2026-08-20T01:02:03Z",
    google_canonical: "https://aeiou.now/topic/a/",
    referring_count: 3,
  });
  const empty = inspectionRow({});
  assert.equal(empty.coverage_state, null);
  assert.equal(empty.referring_count, null);
  assert.equal(inspectionRow(null).verdict, null);
});

test("isQuotaError:認得配額用盡,不把一般錯誤當配額", () => {
  assert.ok(isQuotaError(new Error("URL Inspection：Quota exceeded for quota metric")));
  assert.ok(isQuotaError(new Error("HTTP 429")));
  assert.ok(!isQuotaError(new Error("URL Inspection timeout after 30000ms")));
});

test("latestPerUrl:每個 URL 取最新 sweep,可用 since 排除舊紀錄", () => {
  const rows = [
    { url: "a", sweep_id: "2026-09-10", coverage_state: "X" },
    { url: "a", sweep_id: "2026-09-13", coverage_state: "Y" },
    { url: "b", sweep_id: "2026-09-01", coverage_state: "Z" },
  ];
  const latest = latestPerUrl(rows);
  assert.equal(latest.length, 2);
  assert.equal(latest.find((r) => r.url === "a").coverage_state, "Y");
  const recent = latestPerUrl(rows, "2026-09-05");
  assert.deepEqual(recent.map((r) => r.url), ["a"]);
});

test("coverageMatrix:page_type × coverage_state 計數,state 依總數排序", () => {
  const m = coverageMatrix([
    { page_type: "country", coverage_state: DISCOVERED_NOT_INDEXED },
    { page_type: "country", coverage_state: DISCOVERED_NOT_INDEXED },
    { page_type: "country", coverage_state: "Submitted and indexed" },
    { page_type: "topic", coverage_state: "Submitted and indexed" },
    { page_type: "topic", coverage_state: "Submitted and indexed" },
    { page_type: "weird", coverage_state: null },
  ]);
  assert.deepEqual(m.types, ["topic", "country", "other"]);
  assert.deepEqual(m.states, ["Submitted and indexed", DISCOVERED_NOT_INDEXED, "(空)"]);
  assert.equal(m.counts.country[DISCOVERED_NOT_INDEXED], 2);
  assert.equal(m.counts.other["(空)"], 1);
});

test("persistentlyUnindexed:連續 3 輪未索引且首見 >= 21 天才列", () => {
  const D = DISCOVERED_NOT_INDEXED;
  const rows = [
    // a:三輪連續、首見 24 天前 → 列
    { url: "a", page_type: "country", host: "h", sweep_id: "2026-08-24", coverage_state: D },
    { url: "a", page_type: "country", host: "h", sweep_id: "2026-08-30", coverage_state: D },
    { url: "a", page_type: "country", host: "h", sweep_id: "2026-09-10", coverage_state: D },
    // b:三輪但中間曾被索引 → 連續只剩 2,不列
    { url: "b", page_type: "country", host: "h", sweep_id: "2026-08-20", coverage_state: D },
    { url: "b", page_type: "country", host: "h", sweep_id: "2026-08-27", coverage_state: "Submitted and indexed" },
    { url: "b", page_type: "country", host: "h", sweep_id: "2026-09-03", coverage_state: D },
    { url: "b", page_type: "country", host: "h", sweep_id: "2026-09-10", coverage_state: D },
    // c:三輪連續但首見只有 10 天 → 不列
    { url: "c", page_type: "country", host: "h", sweep_id: "2026-09-07", coverage_state: D },
    { url: "c", page_type: "country", host: "h", sweep_id: "2026-09-10", coverage_state: D },
    { url: "c", page_type: "country", host: "h", sweep_id: "2026-09-14", coverage_state: D },
    // d:最新一筆已索引 → 不列(從最新往回數)
    { url: "d", page_type: "country", host: "h", sweep_id: "2026-08-01", coverage_state: D },
    { url: "d", page_type: "country", host: "h", sweep_id: "2026-08-10", coverage_state: D },
    { url: "d", page_type: "country", host: "h", sweep_id: "2026-08-20", coverage_state: D },
    { url: "d", page_type: "country", host: "h", sweep_id: "2026-09-10", coverage_state: "Submitted and indexed" },
  ];
  const out = persistentlyUnindexed(rows, { minRounds: 3, minDays: 21, today: "2026-09-17" });
  assert.deepEqual(out.map((r) => r.url), ["a"]);
  assert.equal(out[0].rounds, 3);
  assert.equal(out[0].firstSeen, "2026-08-24");
  assert.equal(out[0].lastSeen, "2026-09-10");
  assert.equal(out[0].ageDays, 24);
});

test("persistentlyUnindexed:輸入順序不影響結果", () => {
  const D = DISCOVERED_NOT_INDEXED;
  const rows = [
    { url: "a", sweep_id: "2026-09-10", coverage_state: D },
    { url: "a", sweep_id: "2026-08-20", coverage_state: D },
    { url: "a", sweep_id: "2026-08-30", coverage_state: D },
  ];
  const out = persistentlyUnindexed(rows, { today: "2026-09-17" });
  assert.equal(out.length, 1);
  assert.equal(out[0].firstSeen, "2026-08-20");
  assert.equal(out[0].page_type, "other");
});
