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

test("多 observance 的 country page 以實際日期排序，先回答最早節次", async () => {
  const { sortByOccurrenceStart } = await import("../../site/src/lib/topic-dates.mjs");
  const { facts } = bundle("ramadan-and-eid");
  const indonesia = facts.observances.filter((observance) => observance.country_code === "ID");
  assert.deepEqual(
    sortByOccurrenceStart(indonesia).map((observance) => [
      observance.observance_key,
      observance.next_occurrence?.starts_on,
    ]),
    [
      ["ramadan", "2027-02-08"],
      ["eid-al-fitr", "2027-03-09"],
    ],
  );
});

test("crawl freshness 的小樣本會覆蓋七個網域", async () => {
  const { CRAWL_ORIGINS, stratifiedTopicSample } = await import("../../scripts/lib/crawl-freshness.mjs");
  const groups = CRAWL_ORIGINS.map((group, index) => ({
    ...group,
    urls: [`${group.origin}/topic/topic-${index}-a/`, `${group.origin}/topic/topic-${index}-b/`],
  }));
  const sample = stratifiedTopicSample(groups, 7);
  assert.equal(sample.length, 7);
  assert.deepEqual(sample.map((row) => row.locale), CRAWL_ORIGINS.map((group) => group.locale));
});

test("內部連結圖以來源頁去重，且不把自連結算成入口", async () => {
  const { inboundLinkCounts } = await import("../../scripts/lib/internal-links.mjs");
  const target = "https://aeiou.now/topic/target/";
  const result = inboundLinkCounts([target], [
    { url: "https://aeiou.now/", html: `<a href="/topic/target/">一</a><a href="/topic/target/">二</a>` },
    { url: target, html: `<a href="/topic/target/">自己</a>` },
    { url: "https://aeiou.now/topic/source/", html: `<a href="${target}#answers">三</a>` },
  ]);
  assert.equal(result.counts.get(target), 2);
  assert.deepEqual([...result.sources.get(target)].sort(), [
    "https://aeiou.now/",
    "https://aeiou.now/topic/source/",
  ]);
});
