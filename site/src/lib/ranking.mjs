// 熱度、排名、以及「首頁/熱門/相關」這幾種 Topic 清單的排序。
// **原始分數不得上畫面**(顯示層規則);這裡只拿分數排序,級距在 heat.mjs。

import { readJson } from './data-source.mjs';
import { getTopicsIndex, getTopicBundle, observancesForFacts } from './topics-data.mjs';
import { seasonDistance } from './season.mjs';
import { isTrendTopic } from './topic-status.mjs';

export function tiersFor(topicId) {
  const hit = getTopicsIndex().find((topic) => topic.topic_id === topicId);
  return (hit && hit.tiers) || {};
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

// 排序鍵改用**名次**而不是原始分數(2026-08-20 根治,見 scripts/export-data.mjs)。
// 名次是離散的,只在真的換順序時才變;分數是連續的,每天漂移會讓靜態產物天天重建。
// 名次越小越熱,所以比較方向與原本的分數相反;沒有名次的排最後。
function rankOf(topic, win) {
  const raw = topic && topic.ranks && topic.ranks[win];
  return typeof raw === 'number' ? raw : Number.POSITIVE_INFINITY;
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
    .sort((a, b) => a.season_distance - b.season_distance || rankOf(a, win) - rankOf(b, win));
}

/** 「熱門話題」/topics/today/ 的排序:topics/index/<locale>.json 的 ranks[win] 由小到大。
 * 原始分數不再進 data/(顯示層規則本來就規定分數不上畫面),排序改吃名次。 */
export function topicsByHeat(win = '24h') {
  return getTopicsIndex()
    .slice()
    .sort(
      (a, b) => rankOf(a, win) - rankOf(b, win) || String(a.slug).localeCompare(String(b.slug))
    );
}

/** 城市代碼 → 顯示名(meta/cities.json = {code: name};專有名詞,不分語系) */

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