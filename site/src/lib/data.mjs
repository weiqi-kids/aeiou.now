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

/** 全球排行 + topics index 併好的列(首頁看板與排行頁共用)。分數不外流到畫面,
 * 這裡照樣帶著 score 只為了餵 HeatMeter 換算級距(見 src/lib/heat.mjs)。 */
export function globalRankRows(win) {
  const ranking = getGlobalRanking(win) || { items: [] };
  const byId = new Map(getTopicsIndex().map((topic) => [topic.topic_id, topic]));
  return (ranking.items || [])
    .slice()
    .sort((a, b) => a.rank - b.rank)
    .map((item) => ({ ...item, topic: byId.get(item.topic_id) || { slug: item.slug } }));
}

/** 某 topic 在某窗的全球名次(草案 §47:同一議題在不同層級有不同名次)。
 * M1 只有 scope='global' 的排行,國家別名次沒有資料,不補、不猜。 */
export function globalRankOf(topicId, win) {
  const hit = (getGlobalRanking(win) || { items: [] }).items.find(
    (item) => item.topic_id === topicId
  );
  return hit ? hit.rank : null;
}

// ── 「今天當令」判斷 ────────────────────────────────────────────
// facts.json 的 observed_date / date_range_end 是不帶年份的 "MM-DD",所以只能在
// 「一年 365 天的環」上比對:用固定非閏年 2001 換成 day-of-year,再算環狀距離。
// 前後各留 SEASON_DAYS 天的緩衝——節日的話題在當天之前就起來、之後才退。
const SEASON_DAYS = 7;
const YEAR_DAYS = 365;

function doy(mmdd) {
  if (typeof mmdd !== 'string') return null;
  const m = /^(\d{2})-(\d{2})$/.exec(mmdd.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  return Math.round(Date.UTC(2001, month - 1, day) / 86400000) - Math.round(Date.UTC(2001, 0, 1) / 86400000);
}

function ringDistance(a, b) {
  const raw = Math.abs(a - b) % YEAR_DAYS;
  return Math.min(raw, YEAR_DAYS - raw);
}

function inSeason(country, today) {
  const start = doy(country.observed_date);
  if (start === null) return false;
  const end = doy(country.date_range_end);
  if (ringDistance(today, start) <= SEASON_DAYS) return true;
  if (end === null) return false;
  if (ringDistance(today, end) <= SEASON_DAYS) return true;
  const span = (end - start + YEAR_DAYS) % YEAR_DAYS;
  const offset = (today - start + YEAR_DAYS) % YEAR_DAYS;
  return offset <= span;
}

/** 草案 §54 的 Today's Topics:今天(UTC)當令的議題。
 * 判準只有兩個,都是資料裡本來就有的事實:
 *   ① is_perennial=1 的長青 Topic 全年當令;
 *   ② 任一國家的 observed_date / date_range_end 落在今天前後 SEASON_DAYS 天內。
 * 沒有命中就是空——不補、不假造。用 UTC 是為了主機與 CI 的 TZ 差異不會 build 出不同結果。 */
export function todaysTopics(now = new Date()) {
  const today = Math.round(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86400000)
    - Math.round(Date.UTC(now.getUTCFullYear(), 0, 1) / 86400000);
  return getTopicsIndex()
    .map((topic) => {
      if (topic.is_perennial) return { ...topic, season_countries: [] };
      const facts = readJson(`topics/${topic.topic_id}/facts.json`, null);
      const hits = ((facts && facts.countries) || []).filter((c) => inSeason(c, today));
      return hits.length ? { ...topic, season_countries: hits } : null;
    })
    .filter(Boolean);
}

/** 城市代碼 → 顯示名(meta/cities.json = {code: name};專有名詞,不分語系) */
export function cityName(code) {
  const meta = readJson('meta/cities.json', {});
  return (meta && meta[code]) || code;
}

function topicRefs(entry) {
  const ids = Array.isArray(entry.topics)
    ? entry.topics.map((x) => x && x.topic_id).filter(Boolean)
    : Array.isArray(entry.topic_ids)
      ? entry.topic_ids
      : [];
  const byId = new Map(getTopicsIndex().map((topic) => [topic.topic_id, topic]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

/** 首頁 Nearby:所有城市的店家,依城市分組(M1 沒有定位,城市就是誠實的分組單位)。 */
export function allPlacesByCity() {
  return listCityJson('places')
    .map((city) => ({
      city_code: city.city_code,
      places: (city.places || [])
        .slice()
        .sort((a, b) => (b.mention_count || 0) - (a.mention_count || 0))
        .map((pl) => ({ ...pl, topics_ref: topicRefs(pl) })),
    }))
    .filter((city) => city.places.length > 0);
}

/** 首頁 Events:所有城市的活動,依開始時間排序(跨城市混排,近的先來)。 */
export function allEvents() {
  const out = [];
  for (const city of listCityJson('events')) {
    for (const ev of city.events || []) {
      out.push({ ...ev, city_code: city.city_code, topics_ref: topicRefs(ev) });
    }
  }
  return out.sort((a, b) => (a.start_at || 0) - (b.start_at || 0));
}

/** Topic 的「各地叫法」(草案 §44 標題下那一行):
 * 七個 locale 的 localized_title(§18)＋ 各國 local_name(§6),去重、去掉現正顯示的標題。
 * 注意:這是「同一個議題的多個名字」,不是語系切換器——七語系是七個獨立站。 */
export function aliasNames(topicId, currentTitle) {
  const i18n = readJson(`topics/${topicId}/i18n.json`, null);
  const facts = readJson(`topics/${topicId}/facts.json`, null);
  const names = [];
  if (facts && facts.canonical_name) names.push(facts.canonical_name);
  const locales = (i18n && i18n.locales) || {};
  for (const key of Object.keys(locales)) {
    if (locales[key] && locales[key].title) names.push(locales[key].title);
  }
  for (const c of (facts && facts.countries) || []) {
    if (c.local_name) names.push(c.local_name);
  }
  const seen = new Set([currentTitle]);
  return names.filter((name) => {
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
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
