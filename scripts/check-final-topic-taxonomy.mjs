#!/usr/bin/env node
// Final taxonomy release gate。
// 驗證 active Topic、七語 index、年度排程、在地資料與 merge alias 使用同一版
// taxonomy；舊 slug 只能留在明確的 migration/alias source，不可混進發布資料。
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTrendTopic } from "./lib/topics.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['zh-TW', 'en', 'ja', 'zh-CN', 'hi', 'id', 'pt-BR'];
const FINAL_SLUGS = [
  'new-year', 'lantern-festival', 'diwali', 'ramadan-and-eid', 'eid-al-adha', 'affection-and-reciprocity',
  'easter', 'dragon-boat-festival', 'ghosts-ancestors-and-remembrance', 'mid-autumn-and-moon-viewing',
  'harvest-and-gratitude', 'christmas', 'national-days', 'labour-day', 'mothers-day', 'fathers-day',
  'childrens-day', 'teachers-day', 'newborn-and-full-moon', 'back-to-school', 'graduation-season',
  'coming-of-age', 'birthdays-and-blessings', 'proposals-and-engagements', 'weddings-and-customs',
  'farewells-and-funerals', 'moving-home', 'homecoming-and-reunion', 'caregiving-across-generations',
  'ask-the-world', 'womens-day', 'exam-season', 'islamic-calendar-days', 'elders-day',
].sort();
const FINAL = new Set(FINAL_SLUGS);
const errors = [];
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const fail = (message) => errors.push(message);

// 與 export-data.mjs 同一個相容層契約：只有明確 machine/trend marker
// 才會被視為 trend Topic；沒有 marker 的資料維持既有 manual taxonomy。
const isMachineTrendTopic = isTrendTopic;
const isHiddenStatus = (row) => row?.status === 'candidate' || row?.status === 'merged';
const trendKey = (row) => `${row?.topic_id || ''}|${row?.slug || ''}`;

// CI checkout 不包含被 .gitignore 排除的本機 SQLite；發布資料的權威快照是
// data/topics/index/*.json。用它做 gate，才能讓本地與 GitHub Actions 都能
// 從同一份已提交資料重建並驗收，而不依賴開發機狀態。
const primaryIndex = readJson('data/topics/index/zh-TW.json');
if (!Array.isArray(primaryIndex)) fail('data/topics/index/zh-TW.json 必須是陣列');
const primaryRows = Array.isArray(primaryIndex) ? primaryIndex : [];
for (const row of primaryRows) {
  if (isHiddenStatus(row)) fail(`不可輸出 ${row.status} Topic：${row.slug || row.topic_id || '(unknown)'}`);
}
const active = primaryRows
  .filter((topic) => topic.status === 'active' && !isMachineTrendTopic(topic))
  .map((topic) => topic.slug);
if (!same(active, FINAL_SLUGS)) fail(`data/topics/index/zh-TW.json active taxonomy 不符：${active.join(', ')}`);

const primaryManualSlugs = primaryRows.filter((topic) => !isMachineTrendTopic(topic)).map((topic) => topic.slug);
if (!same(primaryManualSlugs, FINAL_SLUGS)) {
  fail(`data/topics/index/zh-TW.json manual taxonomy 不符：${primaryManualSlugs.join(', ')}`);
}
const primaryTrendRows = primaryRows.filter(isMachineTrendTopic);
const primaryTrendKeys = primaryTrendRows.map(trendKey);
if (new Set(primaryTrendKeys).size !== primaryTrendKeys.length) fail('data/topics/index/zh-TW.json trend Topic 重複');
for (const topic of primaryTrendRows) {
  if (FINAL.has(topic.slug)) fail(`trend Topic 不可佔用 final manual slug：${topic.slug}`);
}

for (const locale of LOCALES) {
  const index = readJson(`data/topics/index/${locale}.json`);
  const rows = Array.isArray(index) ? index : [];
  if (!Array.isArray(index)) fail(`data/topics/index/${locale}.json 必須是陣列`);
  for (const row of rows) {
    if (isHiddenStatus(row)) fail(`data/topics/index/${locale}.json 不可輸出 ${row.status} Topic：${row.slug || row.topic_id || '(unknown)'}`);
  }
  const manualSlugs = rows.filter((topic) => !isMachineTrendTopic(topic)).map((topic) => topic.slug);
  if (!same(manualSlugs, FINAL_SLUGS)) fail(`data/topics/index/${locale}.json 不符 final manual taxonomy`);
  const trendRows = rows.filter(isMachineTrendTopic);
  const trendKeys = trendRows.map(trendKey);
  if (new Set(trendKeys).size !== trendKeys.length) fail(`data/topics/index/${locale}.json trend Topic 重複`);
  if (!same(trendKeys, primaryTrendKeys)) fail(`data/topics/index/${locale}.json trend Topic 集合與 zh-TW 不一致`);
}

const calendar = readJson('content/topic-calendar.json');
const calendarSlugs = (calendar.weeks || []).flatMap((week) => week.topics || []);
for (const slug of calendarSlugs) if (!FINAL.has(slug)) fail(`topic-calendar 引用舊/未知 slug：${slug}`);

const sample = readJson('content/local-sample-data.json');
for (const entry of [...(sample.places || []), ...(sample.events || [])]) {
  for (const slug of entry.topic_slugs || []) if (!FINAL.has(slug)) fail(`local sample ${entry.name} 引用舊/未知 slug：${slug}`);
}

const merges = readJson('content/topic-merges.json').merges || [];
for (const merge of merges) {
  if (FINAL.has(merge.from)) fail(`merge from 不可仍是 active：${merge.from}`);
  if (!FINAL.has(merge.to)) fail(`merge target 不在 final taxonomy：${merge.to}`);
  if (primaryTrendRows.some((topic) => topic.slug === merge.from || topic.slug === merge.to)) {
    fail(`trend Topic 不可進入 manual merge：${merge.from} -> ${merge.to}`);
  }
}

const exportedMerges = readJson('data/topic-merges.json').merges || [];
if (JSON.stringify(exportedMerges) !== JSON.stringify(merges)) fail('data/topic-merges.json 與 content/topic-merges.json 不一致');

if (errors.length) {
  console.error(`Final Topic taxonomy 驗收失敗，共 ${errors.length} 項：\n${errors.map((error) => `- ${error}`).join('\n')}`);
  process.exit(1);
}
console.log(`Final Topic taxonomy 驗收通過：${FINAL_SLUGS.length} active manual Topic、${primaryTrendRows.length} trend Topic、${LOCALES.length} 語系 index、52 週排程與在地關聯均使用 final slug。`);
