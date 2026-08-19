// 靜態資料讀取:src/data/(結構照 docs/02-data-model.md §9;
// 具體 JSON 形狀對齊 Track A 生產者 2026-08-11 的實際輸出,fixture 同形狀)。
// 檔案缺席一律回退為空集合——不能依賴任何檔存在。
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LOCALE } from './config.mjs';
import { isTrendTopic } from './topic-status.mjs';

const DATA_ROOT = join(process.cwd(), 'src', 'data');

export function readJson(rel, fallback = null) {
  const p = join(DATA_ROOT, rel);
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** Topic 的地方表現。新資料使用 observances；舊 fixture/data 可用 countries 讀取。 */
export function observancesForFacts(facts) {
  if (facts && Array.isArray(facts.observances)) return facts.observances;
  return ((facts && facts.countries) || []).map((country) => ({
    ...country,
    observance_id: country.observance_id || `legacy-${country.country_code}`,
    observance_key: country.observance_key || 'default',
  }));
}

/** Topic 清單(本 locale):topics/index/<locale>.json = 裸陣列。
 * index 檔有 commonality / category / is_perennial / scores / slug / status / title / topic_id,
 * 沒有 summary,也沒有國家資訊——摘要在 topics/<id>/i18n.json 的 locales.<locale>.summary,
 * 地方表現在 topics/<id>/facts.json 的 observances / regional_notes。列表頁要用,所以在讀取層補齊,
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
  const observances = observancesForFacts(facts);
  const regionalNotes = regionalNotesForFacts(facts);
  const countryCodes = [...new Set([
    ...observances.map((o) => o.country_code),
    ...regionalNotes.map((note) => note.country_code),
  ].filter(Boolean))];
  return {
    ...row,
    title: row.title || loc.title || (facts && facts.canonical_name) || id,
    summary: row.summary || loc.summary || null,
    keywords: (loc.keywords || []).slice(),
    country_codes: countryCodes,
    country_count: countryCodes.length,
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
  const indexedIds = new Set(getTopicsIndex().map((row) => row && row.topic_id).filter(Boolean));
  return readdirSync(p).filter(
    (name) => name !== 'index' && indexedIds.has(name) && statSync(join(p, name)).isDirectory()
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

/** customs 文字:i18n.json 的 observances[observance_id][locale]。 */
export function customsText(i18n, observance) {
  if (!i18n || !observance) return null;
  const id = typeof observance === 'string' ? observance : observance.observance_id;
  const current = i18n.observances && i18n.observances[id];
  if (current && current[LOCALE]) return current[LOCALE];
  // 舊 fixture/data 相容:customs 仍以 country_code 為 key。
  const countryCode = typeof observance === 'string' ? observance : observance.country_code;
  const legacy = i18n.countries && i18n.countries[countryCode];
  return (legacy && legacy[LOCALE]) || null;
}

/** 長青 Topic 的國別生活筆記；沒有固定日期，不應被當成 observance 排序。 */
export function regionalNotesForFacts(facts) {
  return Array.isArray(facts?.regional_notes) ? facts.regional_notes : [];
}

/** 取得某國的 regional note 當前語系文字。 */
export function regionalNoteText(i18n, note) {
  if (!i18n || !note?.country_code) return null;
  const row = i18n.regional_notes?.[note.country_code];
  return row?.[LOCALE] || row?.en || null;
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

/** 一個國家的日期離今天還有幾天(往前看)。正在當令中 = 0。無法判讀日期 = null。
 * 「近期」看的是**還有多久到**,不是絕對差距——剛過去的節日已經退燒,要到的才是話題。
 * 只有還在 SEASON_DAYS 緩衝內的才算仍然當令(inSeason 已含這個判斷)。 */
function seasonDistance(country, today) {
  const start = doy(country.observed_date);
  if (start === null) return null;
  if (inSeason(country, today)) return 0;
  const end = doy(country.date_range_end);
  const forward = (d) => (d - today + YEAR_DAYS) % YEAR_DAYS;
  return end === null ? forward(start) : Math.min(forward(start), forward(end));
}

function heatOf(topic, win) {
  const raw = topic && topic.scores && topic.scores[win];
  return typeof raw === 'number' ? raw : 0;
}

/** 首頁的「近期話題」:快要到的議題排前面(用戶 2026-08-11:「像是最近要到的七夕、鬼門開、
 * 普渡……」)。排序鍵 = facts.json 各國 observed_date / date_range_end 離今天(UTC)還有幾天,
 * 由近到遠;is_perennial=1 的長青主題全年當令,距離視為 0。
 * 同距離再比 24h 熱度。日期讀不出來又不是長青的就不列——不補、不假造。
 * 用 UTC 是為了主機與 CI 的 TZ 差異不會 build 出不同結果。 */
export function recentTopics(now = new Date(), win = '24h') {
  const today = Math.round(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86400000)
    - Math.round(Date.UTC(now.getUTCFullYear(), 0, 1) / 86400000);
  return getTopicsIndex()
    .map((topic) => {
      if (topic.is_perennial) return { ...topic, season_countries: [], season_distance: 0 };
      // 外部搜尋趨勢沒有文化日期；在趨勢有效期內視為「近期」入口，
      // 讓趨勢 Topic 不只存在於排行頁，也能被首頁發現。
      // 判準見 topic-status.mjs(輸出層契約 topic_kind,不是 category)。
      if (isTrendTopic(topic)) {
        return { ...topic, season_countries: [], season_distance: 0 };
      }
      const facts = readJson(`topics/${topic.topic_id}/facts.json`, null);
      const dated = observancesForFacts(facts)
        .map((c) => ({ ...c, season_distance: seasonDistance(c, today) }))
        .filter((c) => c.season_distance !== null)
        .sort((a, b) => a.season_distance - b.season_distance);
      if (dated.length === 0) return null;
      return { ...topic, season_countries: dated, season_distance: dated[0].season_distance };
    })
    .filter(Boolean)
    .sort((a, b) => a.season_distance - b.season_distance || heatOf(b, win) - heatOf(a, win));
}

/** 「熱門話題」/topics/today/ 的排序:topics/index/<locale>.json 的 scores[win] 由高到低。
 * 分數本身不上畫面(顯示層規則:熱度只給級距),這裡只拿來排序。 */
export function topicsByHeat(win = '24h') {
  return getTopicsIndex()
    .slice()
    .sort(
      (a, b) => heatOf(b, win) - heatOf(a, win) || String(a.slug).localeCompare(String(b.slug))
    );
}

/** 城市代碼 → 顯示名(meta/cities.json = {code: name};專有名詞,不分語系) */
export function cityName(code) {
  const meta = readJson('meta/cities.json', {});
  return (meta && meta[code]) || code;
}

/** 一筆店家/活動關聯到哪些 topic_id(兩種資料形狀都吃)。 */
function entryTopicIds(entry) {
  if (Array.isArray(entry.topics)) {
    return entry.topics.map((x) => x && x.topic_id).filter(Boolean);
  }
  if (Array.isArray(entry.topic_ids)) return entry.topic_ids.filter(Boolean);
  return [];
}

/** 一個城市檔屬於哪個國家:條目自己帶 country_code(不另建對照表,也不猜)。 */
function cityCountry(entries) {
  for (const entry of entries) {
    if (entry && entry.country_code) return entry.country_code;
  }
  return null;
}

/** 「附近訊息」排序:全部 Topic 都列入,按指定城市的地點數排序。
 *
 * 這一支回的是 Topic 不是店家——導覽上的「附近」是 Topic 的篩選條件,店家本身屬於各自的
 * Topic 頁(草案 §44 的 📍 Near You)。沒有地點的 Topic 仍保留在清單後段,不在靜態頁消失。
 *
 * 城市帶 country_code 與該 Topic 底下的 place_id 清單,供前端向
 * GET /v1/reactions/summary 問 emoji 數排序。單一語系站傳入代表城市,不把七市場混在同一頁。 */
export function topicsWithPlacesByCity(cityCode = null) {
  const byId = new Map(getTopicsIndex().map((topic) => [topic.topic_id, topic]));
  const cities = [];
  for (const city of listCityJson('places')) {
    if (cityCode && city.city_code !== cityCode) continue;
    const agg = new Map();
    for (const pl of city.places || []) {
      if (pl.place_type !== 'permanent' || pl.topic_relevance !== 'direct') continue;
      for (const id of entryTopicIds(pl)) {
        const prev = agg.get(id) || { count: 0, ids: [] };
        prev.count += 1;
        if (pl.place_id) prev.ids.push(pl.place_id);
        agg.set(id, prev);
      }
    }
    const topics = [...byId.values()]
      .map((topic, index) => {
        const value = agg.get(topic.topic_id) || { count: 0, ids: [] };
        return { ...topic, place_count: value.count, target_ids: value.ids, _index: index };
      })
      .sort((a, b) => b.place_count - a.place_count || a._index - b._index)
      .map(({ _index, ...topic }) => topic);
    cities.push({
      city_code: city.city_code,
      country_code: cityCountry(city.places || []),
      topics,
    });
  }
  return cities.sort((a, b) => String(a.city_code).localeCompare(String(b.city_code)));
}

/** 「活動資訊」排序:全部 Topic 都列入,按指定城市的活動數排序(理由同上一支)。
 * 每個 Topic 額外帶最近一場活動的開始時間,讓列表能排序也能給讀者一個時間感。 */
export function topicsWithEventsByCity(cityCode = null) {
  const byId = new Map(getTopicsIndex().map((topic) => [topic.topic_id, topic]));
  const cities = [];
  for (const city of listCityJson('events')) {
    if (cityCode && city.city_code !== cityCode) continue;
    const agg = new Map();
    for (const ev of city.events || []) {
      if (ev.start_at == null || !ev.venue || !ev.source_url) continue;
      for (const id of entryTopicIds(ev)) {
        const prev = agg.get(id) || { count: 0, next_start_at: null, ids: [] };
        const start = typeof ev.start_at === 'number' ? ev.start_at : null;
        const next =
          prev.next_start_at === null
            ? start
            : start === null
              ? prev.next_start_at
              : Math.min(prev.next_start_at, start);
        if (ev.event_id) prev.ids.push(ev.event_id);
        agg.set(id, { count: prev.count + 1, next_start_at: next, ids: prev.ids });
      }
    }
    const topics = [...byId.values()]
      .map((topic, index) => {
        const value = agg.get(topic.topic_id) || { count: 0, next_start_at: null, ids: [] };
        return {
          ...topic,
          event_count: value.count,
          next_start_at: value.next_start_at,
          target_ids: value.ids,
          _index: index,
        };
      })
      .sort(
        (a, b) =>
          (a.event_count === 0 ? 1 : 0) - (b.event_count === 0 ? 1 : 0)
          || (a.next_start_at || Number.MAX_SAFE_INTEGER) - (b.next_start_at || Number.MAX_SAFE_INTEGER)
          || a._index - b._index
      )
      .map(({ _index, ...topic }) => topic);
    cities.push({
      city_code: city.city_code,
      country_code: cityCountry(city.events || []),
      topics,
    });
  }
  return cities.sort((a, b) => String(a.city_code).localeCompare(String(b.city_code)));
}

/** 導覽列尾端「直接跳進某個看板」用的 Topic:當前排序(預設 24h 全球熱度)的前幾名。 */
export function hotTopics(limit = 2, win = '24h') {
  return globalRankRows(win)
    .map((row) => row.topic)
    .filter((topic) => topic && topic.slug)
    .slice(0, limit);
}

/** Topic 頁導覽列尾端要列的「相關議題」:facts.json 的 relations(草案 §48 Topic Graph)。
 * 沒有相關議題時由呼叫端退回 hotTopics()。 */
export function relatedTopics(topicId, limit = 2) {
  const facts = readJson(`topics/${topicId}/facts.json`, null);
  const rels = ((facts && facts.relations) || []).slice();
  const index = getTopicsIndex();
  const byId = new Map(index.map((topic) => [topic.topic_id, topic]));
  const seen = new Set([topicId]);
  const graphRelated = rels
    .sort((a, b) => (b.weight || 0) - (a.weight || 0))
    .map((rel) => rel && rel.to_topic_id)
    .filter((id) => {
      if (!id || seen.has(id) || !byId.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((id) => byId.get(id))
    .slice(0, limit);
  if (graphRelated.length > 0) return graphRelated;

  // 舊資料或新建 Topic 尚未有人工 Topic Graph 時，仍給讀者可理解的內部路徑：
  // 先同分類，再以共同國家數排序；這是導航 fallback，不把相似度偽裝成演算法分數。
  const current = index.find((topic) => topic.topic_id === topicId);
  if (!current) return [];
  const currentCountries = new Set(current.country_codes || []);
  return index
    .filter((topic) => topic.topic_id !== topicId)
    .map((topic) => ({
      topic,
      overlap: (topic.country_codes || []).filter((code) => currentCountries.has(code)).length,
      sameCategory: topic.category === current.category ? 1 : 0,
    }))
    .sort((a, b) => b.sameCategory - a.sameCategory || b.overlap - a.overlap || a.topic.slug.localeCompare(b.topic.slug))
    .slice(0, limit)
    .map(({ topic }) => topic);
}

/** Topic 的 cover 圖(1200×675 = 16:9,Google Discover 建議的大圖尺寸)。
 *
 * 回傳的是**站內相對路徑**(不含 base),呼叫端一律再過 withBase()——GitHub Pages 專案站有
 * base path,寫死 /covers/… 會 404。
 *
 * 正式 Topic 必須提供同尺寸 PNG 真圖；不再以純色 SVG 佔位。
 * PNG 不存在時回 null,呼叫端整個 <figure> 不渲染(不留破圖、不破版)。
 *
 * 為什麼在 build 時查檔而不是交給瀏覽器 onerror:靜態站沒有執行期可以退場,
 * 而且 og:image 指到不存在的檔會被抓取端記成壞連結。 */
const COVER_EXTS = ['.png'];

export function coverPath(slug) {
  if (!slug) return null;
  for (const ext of COVER_EXTS) {
    const rel = `covers/${slug}${ext}`;
    if (existsSync(join(process.cwd(), 'public', rel))) return rel;
  }
  return null;
}

/** 列表用縮圖(480×270 WebP);不存在時回退到 coverPath() 的原圖。 */
export function coverThumbPath(slug) {
  if (!slug) return null;
  const rel = `covers/thumbs/${slug}.webp`;
  return existsSync(join(process.cwd(), 'public', rel)) ? rel : null;
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
export function placesForTopic(topicId, cityCode = null) {
  const out = [];
  for (const city of listCityJson('places')) {
    if (cityCode && city.city_code !== cityCode) continue;
    for (const pl of city.places || []) {
      if (pl.place_type !== 'permanent' || pl.topic_relevance !== 'direct') continue;
      if (linkedToTopic(pl, topicId)) out.push({ ...pl, city_code: city.city_code });
    }
  }
  return out.sort((a, b) => (b.mention_count || 0) - (a.mention_count || 0));
}

/** 跟某 topic 相關的活動(掃 events/<city>.json) */
export function eventsForTopic(topicId, cityCode = null) {
  const out = [];
  for (const city of listCityJson('events')) {
    if (cityCode && city.city_code !== cityCode) continue;
    for (const ev of city.events || []) {
      if (ev.start_at == null || !ev.venue || !ev.source_url) continue;
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

// ── 每日世界一問(docs/briefs/daily-question.md §5、§6.2)────────────────
// 資料來源:questions/<LOCALE>.json(export-data.mjs 的產物,排序已固定
// date ASC、同日 poll 在 guess 前、再依 question_id)。缺檔一律回空陣列。

/** 本 locale 的全部題目(裸陣列,原始匯出順序)。 */
export function getQuestions() {
  const data = readJson(`questions/${LOCALE}.json`, null);
  return (data && Array.isArray(data.questions) && data.questions) || [];
}

function utcDateStr(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

/** 某 kind 的「date <= 今日」中最新一筆:今天沒有就退到最近一題,不開天窗。 */
function latestOfKind(questions, kind, today) {
  return questions
    .filter((q) => q.kind === kind && q.date <= today)
    .reduce((best, q) => {
      if (!best) return q;
      if (q.date !== best.date) return q.date > best.date ? q : best;
      return String(q.question_id) > String(best.question_id) ? q : best;
    }, null);
}

/** 首頁要的 { poll, guess }:各自獨立取「今天(含以前)最新一筆」該 kind,題庫空(或該 kind
 * 沒有任何一筆 date<=今日)則該欄位回 null,呼叫端(index.astro)據此整塊不渲染。 */
export function questionsForDate(now = new Date()) {
  const today = utcDateStr(now);
  const questions = getQuestions();
  return {
    poll: latestOfKind(questions, 'poll', today),
    guess: latestOfKind(questions, 'guess', today),
  };
}

/** /questions/ 題庫頁:全部「date <= 今日」的題目,依日期新到舊、同日依 question_id 倒序(穩定鍵序)。 */
export function pastQuestions(now = new Date()) {
  const today = utcDateStr(now);
  return getQuestions()
    .filter((q) => q.date <= today)
    .sort(
      (a, b) => String(b.date).localeCompare(String(a.date)) || String(b.question_id).localeCompare(String(a.question_id))
    );
}

// ── 「今天的世界」────────────────────────────────────────────────
// 用既有 topics index + 各 topic facts.json 的 observances[].occurrences(starts_on/ends_on),
// 挑「進行中」或「14 天內開始」的場次,依國家分組,依距今天數排序,最多 8 國、每國最多 3 項。
// 這裡的國家是**內容**裡的國家(節日辦在哪國),與投票的語言社群判定無關,允許出現。
const TODAY_WORLD_WINDOW_DAYS = 14;
const TODAY_WORLD_MAX_COUNTRIES = 8;
const TODAY_WORLD_MAX_ITEMS_PER_COUNTRY = 3;

function isoDayNum(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return null;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
}

/** 一個 observance 底下(可能好幾個年份)挑出「進行中或 14 天內開始」中最近的一個 occurrence。
 * 都不符合(已經過去、或超出 14 天窗)就回 null,呼叫端整條 observance 跳過。 */
function bestOccurrence(occurrences, todayNum) {
  let best = null;
  for (const occ of Array.isArray(occurrences) ? occurrences : []) {
    const start = isoDayNum(occ.starts_on);
    if (start === null) continue;
    const end = occ.ends_on ? isoDayNum(occ.ends_on) : start;
    let distance;
    if (start <= todayNum && todayNum <= (end === null ? start : end)) {
      distance = 0; // 進行中
    } else if (start > todayNum && start - todayNum <= TODAY_WORLD_WINDOW_DAYS) {
      distance = start - todayNum; // 14 天內開始
    } else {
      continue;
    }
    if (best === null || distance < best.distance) {
      best = { distance, starts_on: occ.starts_on, ends_on: occ.ends_on };
    }
  }
  return best;
}

export function todayWorld(now = new Date()) {
  const todayNum = Math.round(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 86400000);
  const byCountry = new Map();
  for (const topic of getTopicsIndex()) {
    const facts = readJson(`topics/${topic.topic_id}/facts.json`, null);
    for (const observance of observancesForFacts(facts)) {
      const code = observance && observance.country_code;
      if (!code) continue;
      const hit = bestOccurrence(observance.occurrences, todayNum);
      if (!hit) continue;
      const list = byCountry.get(code) || [];
      list.push({
        distance: hit.distance,
        topic_id: topic.topic_id,
        slug: topic.slug,
        title: topic.title,
        local_name: observance.local_name || null,
        starts_on: hit.starts_on,
        ends_on: hit.ends_on,
      });
      byCountry.set(code, list);
    }
  }
  return [...byCountry.entries()]
    .map(([country_code, items]) => {
      const sorted = items.slice().sort((a, b) => a.distance - b.distance);
      // 同 topic 在同一國可能有多個 observance 都命中,只留最近的一筆,免得吃掉每國配額
      const seen = new Set();
      const unique = sorted.filter((it) => (seen.has(it.topic_id) ? false : (seen.add(it.topic_id), true)));
      return {
        country_code,
        min_distance: unique[0].distance,
        items: unique.slice(0, TODAY_WORLD_MAX_ITEMS_PER_COUNTRY).map(({ distance, ...rest }) => rest),
      };
    })
    .sort((a, b) => a.min_distance - b.min_distance)
    .slice(0, TODAY_WORLD_MAX_COUNTRIES)
    .map(({ min_distance, ...rest }) => rest);
}
