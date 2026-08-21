// 在地資料:城市、國家名、以及掛在 Topic 上的常設地點與有日期活動。
// 📍 只收可被拜訪的常設地點;🎉 只收有日期與來源的活動 —— 兩者語意不同,別合併。

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LOCALE } from './config.mjs';
import { readJson, DATA_ROOT } from './data-source.mjs';
import { getTopicsIndex } from './topics-data.mjs';

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
 * GET /v1/reactions/summary 問 emoji 數排序。單一語系站傳入代表城市,不把七市場混在同一頁。
 *
 * emoji 排序 2026-08-21 起**先在靜態排好**:data/places/*.json 的 reaction_total 由
 * sync-reactions-from-d1.mjs 每小時從 D1 回流。前端那一段重排仍然在,但退成微調
 * (回流每小時一次,前端拿到的是這一秒的數字)——差別是不執行 JS 的爬蟲也看得到對的順序。 */
export function topicsWithPlacesByCity(cityCode = null) {
  const byId = new Map(getTopicsIndex().map((topic) => [topic.topic_id, topic]));
  const cities = [];
  for (const city of listCityJson('places')) {
    if (cityCode && city.city_code !== cityCode) continue;
    const agg = new Map();
    for (const pl of city.places || []) {
      if (pl.place_type !== 'permanent' || pl.topic_relevance !== 'direct') continue;
      for (const id of entryTopicIds(pl)) {
        const prev = agg.get(id) || { count: 0, reactions: 0, ids: [] };
        prev.count += 1;
        prev.reactions += Number(pl.reaction_total) || 0;
        if (pl.place_id) prev.ids.push(pl.place_id);
        agg.set(id, prev);
      }
    }
    const topics = [...byId.values()]
      .map((topic, index) => {
        const value = agg.get(topic.topic_id) || { count: 0, reactions: 0, ids: [] };
        return {
          ...topic,
          place_count: value.count,
          reaction_total: value.reactions,
          target_ids: value.ids,
          _index: index,
        };
      })
      // 讀者按過的排前面,其次才是地點多寡 —— 與前端拿到 summary 之後的重排同一個判準,
      // 兩處不一致的話畫面會在 JS 載入時跳一次順序。
      .sort((a, b) =>
        b.reaction_total - a.reaction_total || b.place_count - a.place_count || a._index - b._index)
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
        const prev = agg.get(id) || { count: 0, reactions: 0, next_start_at: null, ids: [] };
        const start = typeof ev.start_at === 'number' ? ev.start_at : null;
        const next =
          prev.next_start_at === null
            ? start
            : start === null
              ? prev.next_start_at
              : Math.min(prev.next_start_at, start);
        if (ev.event_id) prev.ids.push(ev.event_id);
        agg.set(id, {
          count: prev.count + 1,
          reactions: prev.reactions + (Number(ev.reaction_total) || 0),
          next_start_at: next,
          ids: prev.ids,
        });
      }
    }
    const topics = [...byId.values()]
      .map((topic, index) => {
        const value = agg.get(topic.topic_id) || { count: 0, reactions: 0, next_start_at: null, ids: [] };
        return {
          ...topic,
          event_count: value.count,
          reaction_total: value.reactions,
          next_start_at: value.next_start_at,
          target_ids: value.ids,
          _index: index,
        };
      })
      // ⚠ 這裡的比較器必須與 pages/topics/[sort].astro 前端那一段**逐項相同**:
      // 前端拿到 /v1/reactions/summary 之後會照 `emoji desc, 原順序` 重排。靜態要是用
      // 另一套鍵,JS 一載入畫面就跳一次順序 —— 那正是這一項待辦要修掉的東西。
      // 所以 emoji 在最前面,「有沒有活動 / 最近一場什麼時候」退成同分時的 tie-break。
      // (單一活動在 Topic 頁 🎉 區塊裡仍然是日期優先 —— 那是另一份清單,見 export-data.mjs。)
      .sort(
        (a, b) =>
          b.reaction_total - a.reaction_total
          || (a.event_count === 0 ? 1 : 0) - (b.event_count === 0 ? 1 : 0)
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