import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { countryCellsFor } from "../../site/src/lib/country-cells.mjs";

const ROOT = join(process.cwd());
const INDEX = JSON.parse(readFileSync(join(ROOT, "data/topics/index/zh-TW.json"), "utf8"));

function bundle(slug) {
  const row = INDEX.find((entry) => entry.slug === slug);
  assert.ok(row, `找不到 Topic ${slug}`);
  return {
    facts: JSON.parse(readFileSync(join(ROOT, "data/topics", row.topic_id, "facts.json"), "utf8")),
    i18n: JSON.parse(readFileSync(join(ROOT, "data/topics", row.topic_id, "i18n.json"), "utf8")),
  };
}

test("GSC 的印尼新年查詢有對應的印尼 country landing cell", () => {
  const { facts, i18n } = bundle("new-year");
  assert.ok(
    countryCellsFor(facts, i18n).includes("ID"),
    "new-year/ID 應該被產出，讓『印尼新年』不再落到 Ramadan 通用頁",
  );
});

test("GSC 的 Singapore Teachers' Day 查詢有獨立的 SG observance", () => {
  const { facts } = bundle("teachers-day");
  assert.ok(
    facts.observances.some((observance) => observance.country_code === "SG"),
    "teachers-day 應該包含 Singapore observance，才能生成 /topic/teachers-day/sg/",
  );
});

test("next occurrence 的排序距離不進入持久化內容", async () => {
  const { nextOccurrence } = await import("../../scripts/lib/occurrences.mjs");
  const result = nextOccurrence([
    {
      occurrence_id: "occ-test",
      occurrence_year: 2027,
      starts_on: "2027-09-03",
      ends_on: null,
      calendar_system: "gregorian",
      timezone: "Asia/Singapore",
      date_status: "estimated",
      source_ids_json: "[]",
    },
  ], new Map(), new Date("2026-08-31T12:00:00Z"));
  assert.ok(result);
  assert.equal(result.distance_days, undefined);
  assert.equal(result.starts_on, "2027-09-03");
});

test("crawl freshness 以 sitemap 原始 host 過濾 Topic，且錯誤可被統計", async () => {
  const { topicUrlsFromSitemap, summarizeCrawlRows } = await import("../../scripts/lib/crawl-freshness.mjs");
  const sitemap = [
    "<loc>https://en.aeiou.now/topic/teachers-day/</loc>",
    "<loc>https://aeiou.now/topic/new-year/</loc>",
    "<loc>https://en.aeiou.now/rankings/7d/</loc>",
  ].join("");
  assert.deepEqual(topicUrlsFromSitemap(sitemap), [
    "https://en.aeiou.now/topic/teachers-day/",
    "https://aeiou.now/topic/new-year/",
  ]);
  assert.deepEqual(
    summarizeCrawlRows([
      { url: "https://en.aeiou.now/topic/teachers-day/", crawl: "2026-08-30T00:00:00Z", state: "Indexed" },
      { url: "https://aeiou.now/topic/new-year/", crawl: null, state: "ERR quota" },
    ], "2026-08-27"),
    { crawled: 1, fresh: 1, errors: 1, ratio: 0.5, median: "2026-08-30", dates: ["2026-08-30"] },
  );
});
