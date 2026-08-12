#!/usr/bin/env node
// 七個代表市場的 prompt 社會學家人格審查器。
// 它不替代人的文化判斷，而是把共同的最低品質門檻固定成可重跑的驗收：
// 共通性命名、跨國地方表現、日期規則、來源、七語 customs、主圖與 52 週覆蓋。
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, 'db', 'aeiou.sqlite');
const CONTENT_DIR = join(ROOT, 'content', 'topics');
const COVER_DIR = join(ROOT, 'site', 'public', 'covers');
const CALENDAR_PATH = join(ROOT, 'content', 'topic-calendar.json');
const LOCALES = ['zh-TW', 'en', 'ja', 'zh-CN', 'hi', 'id', 'pt-BR'];
const personas = [
  ['台灣人格', '檢查在地日期、七夕與普渡不被誤寫成全球同一個節日。'],
  ['日本人格', '檢查本命巧克力、白色情人節、盂蘭盆等地方表現被分開，且不把日本經驗普遍化。'],
  ['中國人格', '檢查農曆／公曆與地方差異被標示，避免以單一習俗代表所有人。'],
  ['印度人格', '檢查區域、宗教、城市與家庭差異，不把都市流行寫成全國共識。'],
  ['印尼人格', '檢查開齋節與返鄉的日期不被硬編成固定日，也不假定人人都返鄉。'],
  ['巴西人格', '檢查 Dia dos Namorados 的 6 月 12 日、六月節與獨立日等在地時間。'],
  ['美國人格', '檢查 federal holiday、文化節日與家庭選擇不混為一談，避免使用無限上綱的全球化措辭。'],
];
const errors = [];
const fail = (message) => errors.push(message);

const contentFiles = readdirSync(CONTENT_DIR).filter((file) => file.endsWith('.md')).sort();
const contentMeta = new Map();
for (const file of contentFiles) {
  const text = readFileSync(join(CONTENT_DIR, file), 'utf8');
  const slug = /^- slug:\s*(\S+)$/m.exec(text)?.[1];
  const commonality = /^- commonality:\s*(.+)$/m.exec(text)?.[1]?.trim();
  if (!slug) fail(`${file}:缺 slug`);
  if (!commonality) fail(`${file}:缺 commonality(共通性分類依據)`);
  if (slug && file !== `${slug}.md`) fail(`${file}:檔名必須與 slug 相同`);
  contentMeta.set(slug, { file, commonality });
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const activeTopics = db.prepare("SELECT * FROM topics WHERE status NOT IN ('candidate','merged') ORDER BY slug").all();
const activeTopicIds = new Set(activeTopics.map((topic) => topic.topic_id));
const allLocales = new Set(db.prepare('SELECT DISTINCT locale FROM topic_i18n').all().map((row) => row.locale));
for (const locale of LOCALES) if (!allLocales.has(locale)) fail(`資料庫缺全域 locale:${locale}`);

const obsRows = db.prepare('SELECT * FROM topic_observances ORDER BY topic_id, country_code, observance_key').all();
const obsByTopic = new Map();
for (const obs of obsRows) {
  if (!activeTopicIds.has(obs.topic_id)) continue;
  if (!obsByTopic.has(obs.topic_id)) obsByTopic.set(obs.topic_id, []);
  obsByTopic.get(obs.topic_id).push(obs);
  if (!obs.observed_date && !obs.date_rule) fail(`observance ${obs.observance_id}:缺 date/date_rule`);
  if (!obs.source_ids_json) fail(`observance ${obs.observance_id}:缺 source_ids_json`);
  let ids = [];
  try { ids = JSON.parse(obs.source_ids_json); } catch { fail(`observance ${obs.observance_id}:source_ids_json 不是 JSON`); }
  if (!Array.isArray(ids) || ids.length === 0) fail(`observance ${obs.observance_id}:來源陣列為空`);
  for (const id of ids) {
    const source = db.prepare('SELECT url FROM sources WHERE source_id = ?').get(id);
    if (!source?.url) fail(`observance ${obs.observance_id}:找不到來源 ${id}`);
  }
}

const i18nRows = db.prepare('SELECT * FROM topic_i18n ORDER BY topic_id, locale').all();
const i18nByTopic = new Map();
for (const row of i18nRows) {
  if (!i18nByTopic.has(row.topic_id)) i18nByTopic.set(row.topic_id, new Map());
  i18nByTopic.get(row.topic_id).set(row.locale, row);
}
const customsRows = db.prepare('SELECT * FROM topic_observance_i18n ORDER BY observance_id, locale').all();
const customsByObs = new Map();
for (const row of customsRows) {
  if (!customsByObs.has(row.observance_id)) customsByObs.set(row.observance_id, new Set());
  customsByObs.get(row.observance_id).add(row.locale);
}

for (const topic of activeTopics) {
  if (!contentMeta.has(topic.slug)) fail(`active Topic ${topic.slug}:沒有對應 content markdown`);
  const locales = i18nByTopic.get(topic.topic_id) || new Map();
  for (const locale of LOCALES) {
    const row = locales.get(locale);
    if (!row?.title || !row?.summary) fail(`${topic.slug}:locale ${locale} 缺 title/summary`);
  }
  for (const obs of obsByTopic.get(topic.topic_id) || []) {
    const got = customsByObs.get(obs.observance_id) || new Set();
    for (const locale of LOCALES) if (!got.has(locale)) fail(`${topic.slug}/${obs.country_code}:${obs.observance_key} 缺 customs ${locale}`);
  }
  const cover = join(COVER_DIR, `${topic.slug}.png`);
  if (!existsSync(cover)) fail(`${topic.slug}:缺 1200×675 PNG cover`);
  else {
    const bytes = readFileSync(cover);
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!png || bytes.readUInt32BE(16) !== 1200 || bytes.readUInt32BE(20) !== 675) fail(`${topic.slug}:cover 不是 1200×675 PNG`);
  }
}

const affection = activeTopics.find((topic) => topic.slug === 'affection-and-reciprocity');
const affectionObs = affection ? obsByTopic.get(affection.topic_id) || [] : [];
if (affectionObs.filter((obs) => obs.country_code === 'JP').length < 2) fail('共通性回歸測試:日本同一 Topic 必須至少有情人節與白色情人節兩筆');
if (!affectionObs.some((obs) => obs.country_code === 'JP' && obs.observance_key === 'white-day')) fail('共通性回歸測試:缺 JP white-day');
if (!affectionObs.some((obs) => obs.country_code === 'TW' && obs.date_rule)) fail('共通性回歸測試:TW 七夕必須保留非固定日期規則');

const calendar = JSON.parse(readFileSync(CALENDAR_PATH, 'utf8'));
if (!Array.isArray(calendar.weeks) || calendar.weeks.length !== 52) fail('年度排程不是 52 週');
const activeSlugs = new Set(activeTopics.map((topic) => topic.slug));
for (const row of calendar.weeks || []) {
  if (!row.topics?.length) fail(`第 ${row.week} 週沒有 Topic`);
  for (const slug of row.topics || []) if (!activeSlugs.has(slug)) fail(`第 ${row.week} 週引用非 active Topic:${slug}`);
}

db.close();
for (const [name, focus] of personas) {
  if (errors.length) console.log(`[${name}] 發現共通驗收問題：${focus}`);
  else console.log(`[${name}] 無修正、無建議：${focus}`);
}
if (errors.length) {
  console.error(`\n七人格審查未通過，共 ${errors.length} 項：`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('\n七人格審查完成：0 修正事項、0 建議事項。');
