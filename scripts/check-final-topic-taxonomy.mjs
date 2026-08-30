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
  // equinox-and-seasonal-turns(2026-08-26 用戶核准):Bing 實測 `お彼岸 2026` @jp 精準量 4,218、
  // `節分` 裸詞 1,757、`冬至` 1,079、`秋分の日 2026` 500。唯一一類日期由天文計算決定的節日。
  'equinox-and-seasonal-turns',
  // tanabata-and-qixi(2026-08-26 用戶核准):Bing 實測 `七夕` 裸詞 @tw 精準量 1,438、@cn 238。
  // 原本是 affection-and-reciprocity 的 TW qixi / JP tanabata,拿不到自己的 title。
  // ⚠ 刻意偏離草案:§6/§48 把七夕畫成 Valentine's Day 的分支;但 §58 又把它列為搜尋結果的並列項。
  'tanabata-and-qixi',
  'beer-festivals',
  'environment-days',
  'shopping-festivals',
  'jewish-calendar-days',
  'emancipation-and-abolition',
  'founders-and-national-leaders',
  'long-holiday-weeks',
  // indigenous-and-colonial-memory(2026-08-26 用戶核准):Bing 實測 `columbus day 2026` @us 精準量 26,721、
  // `indigenous peoples day 2026` 4,165 —— 同一格日曆上兩個名字在爭。
  'indigenous-and-colonial-memory',
  // halloween(2026-08-26 用戶核准):Bing 實測 `ハロウィン` 裸詞 @jp 精準量 11,047、us 6,893。
  // 原本是 ghosts 的 US rank 1,而 jp 站那頁的 title 是「お盆、節分」,永遠輪不到它。
  'halloween',
  // christian-calendar-days(2026-08-26 用戶核准):Bing 實測 `corpus christi 2027` @br 精準量 2,112。
  // 與 islamic-calendar-days 對稱。刻意不收 ID 的耶穌升天日 —— easter.md 已有同一個 observance。
  'christian-calendar-days',
  // carnival(2026-08-26 用戶核准新增):Bing 實測 br 市場 \`carnaval 2027\` 精準量 38,488,
  // 是所有量過的字裡最大的一個,而站上原本沒有這個 Topic。
  'carnival',
  // war-dead-and-veterans(2026-08-26 用戶核准):Bing 實測 `memorial day 2027` @us 精準量 51,340、
  // `veterans day 2026` 27,169;Memorial Day 原本埋在 ghosts 的 US rank 2,拿不到自己的 title。
  'war-dead-and-veterans',
  'new-year', 'lantern-festival', 'diwali', 'ramadan-and-eid', 'eid-al-adha', 'affection-and-reciprocity',
  'easter', 'dragon-boat-festival', 'ghosts-ancestors-and-remembrance', 'mid-autumn-and-moon-viewing',
  'harvest-and-gratitude', 'christmas', 'national-days', 'labour-day', 'mothers-day', 'fathers-day',
  'childrens-day', 'teachers-day', 'newborn-and-full-moon', 'back-to-school', 'graduation-season',
  'coming-of-age', 'birthdays-and-blessings', 'proposals-and-engagements', 'weddings-and-customs',
  'farewells-and-funerals', 'moving-home', 'homecoming-and-reunion', 'caregiving-across-generations',
  'pets-and-family', 'pet-preparedness', 'ask-the-world', 'womens-day', 'exam-season', 'islamic-calendar-days', 'elders-day', 'year-end-bonus',
  'voting-and-elections', 'parental-leave', 'military-service', 'official-languages', 'compulsory-education', 'religion-and-the-state',
  // ── 2026-08-27「開拓新的區塊」六個(用戶拍板)。挑題與命名都由 Bing 實測需求決定,
  //    工具 /mnt/customers/seo-ops/bin/keyword-demand.mjs,量測區間 2026-05-29 ~ 2026-08-26(exact 比對)。
  //    共同特徵:七國全部有量,而且頭部字都是**制度的專有名稱**——正好是站上排 63 名
  //    的那一類(跨國/比較/制度規則),因為在此之前根本沒有頁面在答。
  // 健保 @tw 5,256、health insurance @us 22,875、健康保険 @jp 9,408、医保 @cn 15,010、SUS @br 12,745
  'health-coverage',
  // 特休 @tw 5,352、有給休暇 @jp 16,085、年假 @cn 13,732、férias @br 4,386、残業 @jp 3,353
  'paid-leave-and-overtime',
  // 租房 @cn 42,701、賃貸 @jp 38,003、aluguel @br 5,153、租屋 @tw 3,743、敷金 @jp 2,125
  'renting-a-home',
  // visa @us 26,071、在留カード @jp 18,957、签证 @cn 6,752、visto @br 3,351、居留證 @tw 2,359
  'residency-and-visas',
  // ⚠ 原本要做「生活成本」,量出來才知道詞選錯了:生活費 @tw 21、生活成本 @cn 76、
  //    custo de vida @br 17。改成制度切面就有量:最低賃金 @jp 29,677、minimum wage @us 14,273、
  //    salário mínimo @br 3,532、最低工資 @tw 1,082。
  'minimum-wage',
  // ⚠ 原本要做「學制與升學」,學制與升學 @tw 都是 0;高考 @cn 382,207 是整份量測最大的字,
  //    vestibular @br 1,628。軸是升學考試不是學制,而學制那一半已經有 compulsory-education。
  'entrance-exams',
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
