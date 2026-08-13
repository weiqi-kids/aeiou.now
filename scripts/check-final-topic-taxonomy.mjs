#!/usr/bin/env node
// Final taxonomy release gate。
// 驗證 active Topic、七語 index、年度排程、在地資料與 merge alias 使用同一版
// taxonomy；舊 slug 只能留在明確的 migration/alias source，不可混進發布資料。
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, 'db', 'aeiou.sqlite');
const LOCALES = ['zh-TW', 'en', 'ja', 'zh-CN', 'hi', 'id', 'pt-BR'];
const FINAL_SLUGS = [
  'new-year', 'lantern-festival', 'diwali', 'ramadan-and-eid', 'eid-al-adha', 'affection-and-reciprocity',
  'easter', 'dragon-boat-festival', 'ghosts-ancestors-and-remembrance', 'mid-autumn-and-moon-viewing',
  'harvest-and-gratitude', 'christmas', 'national-days', 'labour-day', 'mothers-day', 'fathers-day',
  'childrens-day', 'teachers-day', 'newborn-and-full-moon', 'back-to-school', 'graduation-season',
  'coming-of-age', 'birthdays-and-blessings', 'proposals-and-engagements', 'weddings-and-customs',
  'farewells-and-funerals', 'moving-home', 'homecoming-and-reunion', 'caregiving-across-generations',
  'ask-the-world',
].sort();
const FINAL = new Set(FINAL_SLUGS);
const errors = [];
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const fail = (message) => errors.push(message);

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const active = db.prepare("SELECT slug FROM topics WHERE status NOT IN ('candidate', 'merged') ORDER BY slug").all().map((row) => row.slug);
if (!same(active, FINAL_SLUGS)) fail(`SQLite active taxonomy 不符：${active.join(', ')}`);

for (const locale of LOCALES) {
  const index = readJson(`data/topics/index/${locale}.json`);
  const slugs = Array.isArray(index) ? index.map((row) => row.slug) : [];
  if (!same(slugs, FINAL_SLUGS)) fail(`data/topics/index/${locale}.json 不符 final taxonomy`);
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
}

const exportedMerges = readJson('data/topic-merges.json').merges || [];
if (JSON.stringify(exportedMerges) !== JSON.stringify(merges)) fail('data/topic-merges.json 與 content/topic-merges.json 不一致');

db.close();
if (errors.length) {
  console.error(`Final Topic taxonomy 驗收失敗，共 ${errors.length} 項：\n${errors.map((error) => `- ${error}`).join('\n')}`);
  process.exit(1);
}
console.log(`Final Topic taxonomy 驗收通過：${FINAL_SLUGS.length} active Topic、${LOCALES.length} 語系 index、52 週排程與在地關聯均使用 final slug。`);
