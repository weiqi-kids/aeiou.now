// 逐國頁收錄判準(site/src/lib/indexability.mjs,2026-10-14)。
// sitemap 與頁面 noindex 是否同步,由 build 後的 check-sitemap-noindex 對帳;這裡驗判準本身。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MIN_UNIQUE_CHARS, allCellCodes, cellQuality, countryPageIndexability, countryPageUrl,
  similarity, uniqueCountryText,
} from "../../site/src/lib/indexability.mjs";
import { countryCellsFor } from "../../site/src/lib/country-cells.mjs";

const ROOT = process.cwd();
const INDEX = JSON.parse(readFileSync(join(ROOT, "data/topics/index/zh-TW.json"), "utf8"));
const bundles = INDEX.map((row) => ({
  facts: JSON.parse(readFileSync(join(ROOT, "data/topics", row.topic_id, "facts.json"), "utf8")),
  i18n: JSON.parse(readFileSync(join(ROOT, "data/topics", row.topic_id, "i18n.json"), "utf8")),
}));

/** 找一格在 en 站有產出、且判薄/不薄的 (bundle, code)。 */
function findCell(wantThin) {
  for (const b of bundles) {
    for (const code of countryCellsFor(b.facts, b.i18n, "en")) {
      if (cellQuality(b.facts, b.i18n, code).thin === wantThin) return { ...b, code };
    }
  }
  return null;
}

test("相似度:相同=1、無交集=0、空字串=0", () => {
  assert.equal(similarity("一二三四五六", "一二三四五六"), 1);
  assert.equal(similarity("一二三四", "甲乙丙丁"), 0);
  assert.equal(similarity("", "一二三四"), 0);
});

test("獨有字數不含 Topic 共用摘要", () => {
  const { facts, i18n } = bundles.find((b) => allCellCodes(b.facts).length > 0);
  const code = allCellCodes(facts)[0];
  const summary = (i18n?.locales?.["zh-TW"]?.summary || "").replace(/\s+/g, "");
  const text = uniqueCountryText(facts, i18n, code);
  if (summary.length > 20) assert.ok(!text.includes(summary), "摘要不應算進該國獨有文字");
  assert.equal(cellQuality(facts, i18n, code).chars, text.length);
});

test("薄的格子:五站 noindex,zh-TW/zh-CN 照樣收錄,GSC 白名單救回", () => {
  const cell = findCell(true);
  assert.ok(cell, "資料裡應該至少有一格判薄");
  const { facts, i18n, code } = cell;
  assert.ok(cellQuality(facts, i18n, code).chars < MIN_UNIQUE_CHARS
    || cellQuality(facts, i18n, code).reasons.includes("sibling-similarity"));
  const empty = new Set();
  assert.deepEqual(countryPageIndexability(facts, i18n, code, "en", empty), { indexable: false, reason: "thin" });
  const keep = new Set([countryPageUrl("en", facts.slug, code)]);
  assert.equal(countryPageIndexability(facts, i18n, code, "en", keep).indexable, true);
  for (const locale of ["zh-TW", "zh-CN"]) {
    if (countryCellsFor(facts, i18n, locale).includes(code)) {
      assert.equal(countryPageIndexability(facts, i18n, code, locale, empty).indexable, true);
    }
  }
});

test("不薄的格子在五站可收錄;沒產出的格子一律不可收錄", () => {
  const cell = findCell(false);
  assert.ok(cell, "資料裡應該至少有一格不薄");
  assert.deepEqual(
    countryPageIndexability(cell.facts, cell.i18n, cell.code, "en", new Set()),
    { indexable: true, reason: "quality" },
  );
  assert.equal(countryPageIndexability(cell.facts, cell.i18n, "ZZ", "en", new Set()).reason, "missing");
});

test("白名單網址形狀與 sitemap 的 <loc> 一致(子網域、小寫國碼、結尾斜線)", () => {
  assert.equal(countryPageUrl("pt-BR", "diwali", "IN"), "https://br.aeiou.now/topic/diwali/in/");
  assert.equal(countryPageUrl("ja", "diwali", "IN"), "https://jp.aeiou.now/topic/diwali/in/");
});
