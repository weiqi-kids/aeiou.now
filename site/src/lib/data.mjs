// 靜態資料讀取:src/data/(結構照 docs/02-data-model.md §9;
// 具體 JSON 形狀對齊 Track A 生產者 2026-08-11 的實際輸出,fixture 同形狀)。
// 檔案缺席一律回退為空集合——不能依賴任何檔存在。
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LOCALE } from './config.mjs';

const DATA_ROOT = join(process.cwd(), 'src', 'data');

export function readJson(rel, fallback = null) {
  const p = join(DATA_ROOT, rel);
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** Topic 清單(本 locale):topics/index/<locale>.json = 裸陣列。
 * index 檔只有 category / is_perennial / scores / slug / status / title / topic_id,
 * 沒有 summary,也沒有國家資訊——摘要在 topics/<id>/i18n.json 的 locales.<locale>.summary,
 * 國家在 topics/<id>/facts.json 的 countries。列表頁要用,所以在讀取層補齊,
 * 不動 scripts/export-data.mjs(那支是生產者的匯出腳本,不是靜態站的責任範圍)。
 * 缺檔一律回退為 null/空陣列——不能依賴任何檔存在。 */
let topicsIndexCache = null;

export function getTopicsIndex() {
  if (topicsIndexCache) return topicsIndexCache;
  const idx = readJson(`topics/index/${LOCALE}.json`, []);
  const rows = Array.isArray(idx) ? idx : (idx && Array.isArray(idx.topics) && idx.topics) || [];
  topicsIndexCache = rows.map(enrichTopicRow);
  return topicsIndexCache;
}

function enrichTopicRow(row) {
  const id = row && row.topic_id;
  if (!id) return row;
  const i18n = readJson(`topics/${id}/i18n.json`, null);
  const loc = (i18n && i18n.locales && i18n.locales[LOCALE]) || {};
  const facts = readJson(`topics/${id}/facts.json`, null);
  const countries = (facts && facts.countries) || [];
  return {
    ...row,
    title: row.title || loc.title || (facts && facts.canonical_name) || id,
    summary: row.summary || loc.summary || null,
    keywords: (loc.keywords || []).slice(),
    country_codes: countries.map((c) => c.country_code).filter(Boolean),
    country_count: countries.length,
  };
}

/** 依 slug 取列表列(排行頁補資料用)。 */
export function topicRowBySlug(slug) {
  return getTopicsIndex().find((row) => row.slug === slug) || null;
}

/** 全部 topic 目錄(排除 index/) */
export function listTopicIds() {
  const p = join(DATA_ROOT, 'topics');
  if (!existsSync(p)) return [];
  return readdirSync(p).filter(
    (name) => name !== 'index' && statSync(join(p, name)).isDirectory()
  );
}

/** 單一 topic 的三份檔(highlights 條目統一為 items) */
export function getTopicBundle(topicId) {
  const hl = readJson(`topics/${topicId}/highlights.json`, null);
  return {
    facts: readJson(`topics/${topicId}/facts.json`, null),
    i18n: readJson(`topics/${topicId}/i18n.json`, null),
    highlightItems: (hl && (hl.items || hl.highlights)) || [],
  };
}

/** customs 文字:i18n.json 的 countries[country_code][locale] */
export function customsText(i18n, countryCode) {
  const c = i18n && i18n.countries;
  return (c && c[countryCode] && c[countryCode][LOCALE]) || null;
}

/** 六窗分數:topics index 是分數的來源(facts.json 不帶 scores) */
export function scoresFor(topicId) {
  const hit = getTopicsIndex().find((topic) => topic.topic_id === topicId);
  return (hit && hit.scores) || {};
}

/** 全球排行:rankings/global/<window>.json */
export function getGlobalRanking(win) {
  return readJson(`rankings/global/${win}.json`, { items: [] });
}

function listCityJson(dir) {
  const p = join(DATA_ROOT, dir);
  if (!existsSync(p)) return [];
  return readdirSync(p)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(`${dir}/${f}`, null))
    .filter(Boolean);
}

function linkedToTopic(entry, topicId) {
  if (Array.isArray(entry.topics)) return entry.topics.some((x) => x && x.topic_id === topicId);
  if (Array.isArray(entry.topic_ids)) return entry.topic_ids.includes(topicId);
  return false;
}

/** 跟某 topic 相關的店家(掃 places/<city>.json,依 topics 關聯過濾) */
export function placesForTopic(topicId) {
  const out = [];
  for (const city of listCityJson('places')) {
    for (const pl of city.places || []) {
      if (linkedToTopic(pl, topicId)) out.push({ ...pl, city_code: city.city_code });
    }
  }
  return out.sort((a, b) => (b.mention_count || 0) - (a.mention_count || 0));
}

/** 跟某 topic 相關的活動(掃 events/<city>.json) */
export function eventsForTopic(topicId) {
  const out = [];
  for (const city of listCityJson('events')) {
    for (const ev of city.events || []) {
      if (linkedToTopic(ev, topicId)) out.push({ ...ev, city_code: city.city_code });
    }
  }
  return out.sort((a, b) => (a.start_at || 0) - (b.start_at || 0));
}

/** 國家代碼 → 本 locale 顯示名(meta/countries.json = {code: {locale: name}}) */
export function countryName(code) {
  const meta = readJson('meta/countries.json', {});
  const entry = meta && meta[code];
  return (entry && entry[LOCALE]) || code;
}
