#!/usr/bin/env node
// 將一次人工採集的在地資料樣本匯入主機 SQLite。
//
// 來源：content/local-sample-data.json
// 規則：每個七語市場至少一個有官方來源的常設地點；只有來源明確列出日期的
// 活動才進 events。這是可重跑的人工樣本匯入，不是爬蟲，也不使用 Places API。
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "db", "aeiou.sqlite");
const INPUT_PATH = join(ROOT, "content", "local-sample-data.json");
const LOCALES = ["zh-TW", "en", "ja", "zh-CN", "hi", "id", "pt-BR"];

const OLD_DEMO_PLACE_IDS = [
  "plc_01J50000000000000000000P01",
  "plc_01J50000000000000000000P02",
  "plc_01J50000000000000000000P03",
];
const OLD_DEMO_EVENT_IDS = [
  "evt_01J50000000000000000000E01",
  "evt_01J50000000000000000000E02",
];
const OLD_DEMO_SOURCE_IDS = [
  "src_01J50000000000000000000S01",
  "src_01J50000000000000000000S02",
  "src_01J50000000000000000000S03",
  "src_01J50000000000000000000S04",
  "src_01J50000000000000000000S05",
  "src_01J50000000000000000000S06",
];

if (!existsSync(INPUT_PATH)) {
  console.error(`找不到 ${INPUT_PATH}`);
  process.exit(2);
}

const input = JSON.parse(readFileSync(INPUT_PATH, "utf8"));
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA busy_timeout = 15000;"); // 整點 */15 與 0 * * * * 兩條 cron 會併發碰同一顆 DB;遇鎖等待而非 SQLITE_BUSY 直接炸(同 lib openDb)
db.exec("PRAGMA foreign_keys = ON;");

const fail = (message) => { throw new Error(message); };
const requireString = (value, label) => {
  if (typeof value !== "string" || !value.trim()) fail(`${label} 必須是非空字串`);
  return value.trim();
};
const epoch = (iso, label) => {
  const value = Date.parse(iso);
  if (!Number.isFinite(value)) fail(`${label} 不是有效日期：${iso}`);
  return Math.floor(value / 1000);
};
const stableId = (prefix, key) =>
  `${prefix}_${createHash("sha256").update(key).digest("hex").slice(0, 26).toUpperCase()}`;
const sourceId = (url) =>
  `src_${createHash("sha256").update(url).digest("hex").slice(0, 24).toUpperCase()}`;
const mapUrls = (query) => {
  const encoded = encodeURIComponent(query);
  return {
    map_url: `https://www.google.com/maps/search/?api=1&query=${encoded}`,
    nav_urls_json: JSON.stringify({
      google: `https://www.google.com/maps/dir/?api=1&destination=${encoded}`,
      baidu: `https://map.baidu.com/search/?querytype=s&wd=${encoded}`,
      amap: `https://uri.amap.com/search?keyword=${encoded}`,
    }),
  };
};

function validateInput() {
  const markets = input.markets || [];
  if (markets.length !== LOCALES.length) fail(`markets 必須正好有 ${LOCALES.length} 個市場`);
  const marketLocales = new Set();
  const marketCities = new Set();
  for (const market of markets) {
    requireString(market.locale, "market.locale");
    requireString(market.country_code, `market(${market.locale}).country_code`);
    requireString(market.city_code, `market(${market.locale}).city_code`);
    if (!LOCALES.includes(market.locale)) fail(`不支援的市場語系：${market.locale}`);
    if (marketLocales.has(market.locale) || marketCities.has(market.city_code)) fail("markets 不可重複 locale/city_code");
    marketLocales.add(market.locale);
    marketCities.add(market.city_code);
  }
  for (const locale of LOCALES) if (!marketLocales.has(locale)) fail(`缺少市場：${locale}`);

  const placeKeys = new Set();
  for (const place of input.places || []) {
    const key = `${place.country_code}:${place.city_code}:${place.name}`;
    if (placeKeys.has(key)) fail(`地點重複：${key}`);
    placeKeys.add(key);
    requireString(place.name, "place.name");
    requireString(place.city_code, `place(${place.name}).city_code`);
    requireString(place.country_code, `place(${place.name}).country_code`);
    if (place.place_type !== "permanent") fail(`地點必須標為 permanent：${place.name}`);
    if (place.topic_relevance !== "direct") fail(`地點與 Topic 的關聯必須是 direct：${place.name}`);
    if (!Array.isArray(place.topic_slugs) || place.topic_slugs.length === 0) {
      fail(`地點必須明確列出 topic_slugs：${place.name}`);
    }
    const placeTopicSlugs = new Set();
    for (const slug of place.topic_slugs) {
      const value = requireString(slug, `地點 ${place.name} 的 topic_slug`);
      if (placeTopicSlugs.has(value)) fail(`地點 topic_slugs 重複：${place.name}/${value}`);
      placeTopicSlugs.add(value);
    }
    requireString(place.address, `place(${place.name}).address`);
    if (!Array.isArray(place.source_urls) || place.source_urls.length === 0) fail(`地點缺 source_urls：${place.name}`);
    for (const url of place.source_urls) new URL(requireString(url, "place.source_url"));
    for (const locale of LOCALES) requireString(place.descriptions?.[locale], `地點 ${place.name} 缺 ${locale} description`);
  }
  const citiesWithPlaces = new Set((input.places || []).map((place) => place.city_code));
  for (const market of markets) if (!citiesWithPlaces.has(market.city_code)) fail(`市場沒有地點：${market.locale}/${market.city_code}`);

  const eventKeys = new Set();
  const eventSourceUrls = [];
  for (const event of input.events || []) {
    const key = `${event.country_code}:${event.city_code}:${event.name}`;
    if (eventKeys.has(key)) fail(`活動重複：${key}`);
    eventKeys.add(key);
    requireString(event.name, "event.name");
    requireString(event.city_code, `event(${event.name}).city_code`);
    requireString(event.country_code, `event(${event.name}).country_code`);
    requireString(event.venue, `event(${event.name}).venue`);
    requireString(event.source_url, `event(${event.name}).source_url`);
    if (!Array.isArray(event.topic_slugs) || event.topic_slugs.length === 0) {
      fail(`活動必須明確列出 topic_slugs：${event.name}`);
    }
    const eventTopicSlugs = new Set();
    for (const slug of event.topic_slugs) {
      const value = requireString(slug, `活動 ${event.name} 的 topic_slug`);
      if (eventTopicSlugs.has(value)) fail(`活動 topic_slugs 重複：${event.name}/${value}`);
      eventTopicSlugs.add(value);
    }
    new URL(event.source_url);
    eventSourceUrls.push(event.source_url);
    const start = epoch(event.start_at, `event(${event.name}).start_at`);
    const end = event.end_at == null ? null : epoch(event.end_at, `event(${event.name}).end_at`);
    if (end != null && end < start) fail(`活動結束時間早於開始時間：${event.name}`);
    for (const locale of LOCALES) requireString(event.descriptions?.[locale], `活動 ${event.name} 缺 ${locale} description`);
  }
  const managedEventSourceUrls = input.managed_event_source_urls || eventSourceUrls;
  if (!Array.isArray(managedEventSourceUrls)) fail("managed_event_source_urls 必須是陣列");
  for (const url of managedEventSourceUrls) {
    requireString(url, "managed_event_source_urls.url");
    new URL(url);
  }
  for (const url of eventSourceUrls) {
    if (!managedEventSourceUrls.includes(url)) fail(`活動來源未列入 managed_event_source_urls：${url}`);
  }
  const managedPlaceSourceUrls = input.managed_place_source_urls || [...new Set((input.places || []).flatMap((place) => place.source_urls || []))];
  if (!Array.isArray(managedPlaceSourceUrls)) fail("managed_place_source_urls 必須是陣列");
  for (const url of managedPlaceSourceUrls) {
    requireString(url, "managed_place_source_urls.url");
    new URL(url);
  }
  for (const url of (input.places || []).flatMap((place) => place.source_urls || [])) {
    if (!managedPlaceSourceUrls.includes(url)) fail(`地點來源未列入 managed_place_source_urls：${url}`);
  }
  const retiredPlaceIds = input.retired_place_ids || [];
  if (!Array.isArray(retiredPlaceIds)) fail("retired_place_ids 必須是陣列");
  for (const id of retiredPlaceIds) {
    if (!/^plc_[A-Z0-9]{24,26}$/.test(requireString(id, "retired_place_ids.id"))) {
      fail(`retired_place_ids 含無效 place_id：${id}`);
    }
  }
  return { markets, citiesWithPlaces, managedPlaceSourceUrls, retiredPlaceIds };
}

function deleteByIds(table, idColumn, ids) {
  const stmt = db.prepare(`DELETE FROM ${table} WHERE ${idColumn} = ?`);
  for (const id of ids) stmt.run(id);
}

function deleteOldDemoData() {
  deleteByIds("place_i18n", "place_id", OLD_DEMO_PLACE_IDS);
  deleteByIds("place_topics", "place_id", OLD_DEMO_PLACE_IDS);
  deleteByIds("places", "place_id", OLD_DEMO_PLACE_IDS);
  deleteByIds("event_i18n", "event_id", OLD_DEMO_EVENT_IDS);
  deleteByIds("event_topics", "event_id", OLD_DEMO_EVENT_IDS);
  deleteByIds("events", "event_id", OLD_DEMO_EVENT_IDS);

  // 假來源目前只應該被舊 demo 使用；若未來 seed 另有引用，寧可中止也不留下孤兒引用。
  for (const id of OLD_DEMO_SOURCE_IDS) {
    const refs = [
      db.prepare("SELECT count(*) AS n FROM events WHERE source_id = ?").get(id).n,
      db.prepare("SELECT count(*) AS n FROM source_contents WHERE source_id = ?").get(id).n,
      db.prepare("SELECT count(*) AS n FROM source_topics WHERE source_id = ?").get(id).n,
      db.prepare("SELECT count(*) AS n FROM topic_observances, json_each(topic_observances.source_ids_json) WHERE json_each.value = ?").get(id).n,
      db.prepare("SELECT count(*) AS n FROM topic_observance_occurrences, json_each(topic_observance_occurrences.source_ids_json) WHERE json_each.value = ?").get(id).n,
    ].reduce((sum, n) => sum + n, 0);
    if (refs > 0) fail(`假來源仍被引用，停止刪除：${id} (${refs} 筆)`);
    db.prepare("DELETE FROM sources WHERE source_id = ?").run(id);
  }
}

function deleteManagedEventRows(topicIds, managedEventSourceUrls, currentEventIds) {
  const sourceIds = [...new Set(managedEventSourceUrls.map(sourceId))];
  if (sourceIds.length === 0 || topicIds.length === 0) return 0;
  const sourcePlaceholders = sourceIds.map(() => "?").join(",");
  const topicPlaceholders = topicIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT e.event_id
       FROM events e
       JOIN event_topics et ON et.event_id = e.event_id
      WHERE et.topic_id IN (${topicPlaceholders}) AND e.source_id IN (${sourcePlaceholders})`
  ).all(...topicIds, ...sourceIds);
  let removed = 0;
  for (const row of rows) {
    if (currentEventIds.has(row.event_id)) continue;
    db.prepare(`DELETE FROM event_topics WHERE event_id = ? AND topic_id IN (${topicPlaceholders})`)
      .run(row.event_id, ...topicIds);
    // 受管理來源明確退役時，不保留同一活動的舊 Topic 關聯。
    db.prepare("DELETE FROM event_topics WHERE event_id = ?").run(row.event_id);
    const remainingRefs = db.prepare("SELECT count(*) AS n FROM event_topics WHERE event_id = ?").get(row.event_id).n;
    if (remainingRefs === 0) {
      db.prepare("DELETE FROM event_i18n WHERE event_id = ?").run(row.event_id);
      db.prepare("DELETE FROM events WHERE event_id = ?").run(row.event_id);
      removed += 1;
    }
  }
  return removed;
}

function deleteManagedPlaceRows(topicIds, retiredPlaceIds, currentPlaceIds) {
  const placeIds = [...new Set(retiredPlaceIds)];
  if (placeIds.length === 0 || topicIds.length === 0) return 0;
  const placePlaceholders = placeIds.map(() => "?").join(",");
  const topicPlaceholders = topicIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT p.place_id
       FROM places p
       JOIN place_topics pt ON pt.place_id = p.place_id
      WHERE pt.topic_id IN (${topicPlaceholders}) AND p.place_id IN (${placePlaceholders})`
  ).all(...topicIds, ...placeIds);
  let removed = 0;
  for (const row of rows) {
    if (currentPlaceIds.has(row.place_id)) continue;
    db.prepare(`DELETE FROM place_topics WHERE place_id = ? AND topic_id IN (${topicPlaceholders})`)
      .run(row.place_id, ...topicIds);
    // retired_place_ids 是明確的受管理退役清單，清掉該列剩餘的舊關聯，避免孤兒資料復活。
    db.prepare("DELETE FROM place_topics WHERE place_id = ?").run(row.place_id);
    const remainingRefs = db.prepare("SELECT count(*) AS n FROM place_topics WHERE place_id = ?").get(row.place_id).n;
    if (remainingRefs === 0) {
      db.prepare("DELETE FROM place_i18n WHERE place_id = ?").run(row.place_id);
      db.prepare("DELETE FROM places WHERE place_id = ?").run(row.place_id);
      removed += 1;
    }
  }
  return removed;
}

function upsertSource(url, row, collectedAt) {
  const parsed = new URL(url);
  const id = sourceId(url);
  db.prepare(
    `INSERT INTO sources
       (source_id, url, domain, source_type, language, country_code, city_code, title,
        published_at, crawled_at, next_crawl_at, crawl_freq_s, content_hash,
        quality_score, trust_score, status, updated_at)
     VALUES (?, ?, ?, 'official', ?, ?, ?, ?, NULL, ?, ?, 86400, NULL, 0.9, 0.9, 'processed', ?)
     ON CONFLICT(url) DO UPDATE SET
       domain = excluded.domain,
       source_type = excluded.source_type,
       language = excluded.language,
       country_code = excluded.country_code,
       city_code = excluded.city_code,
       title = excluded.title,
       crawled_at = excluded.crawled_at,
       next_crawl_at = excluded.next_crawl_at,
       crawl_freq_s = excluded.crawl_freq_s,
       quality_score = excluded.quality_score,
       trust_score = excluded.trust_score,
       status = excluded.status,
       updated_at = excluded.updated_at`
  ).run(
    id, url, parsed.hostname, row.locale || null, row.country_code || null, row.city_code || null,
    row.title || null, collectedAt, collectedAt + 86400, collectedAt
  );
  return id;
}

function importSample() {
  const { markets, managedPlaceSourceUrls, retiredPlaceIds } = validateInput();
  const topicsBySlug = new Map(
    db.prepare("SELECT topic_id, slug FROM topics WHERE status NOT IN ('merged', 'candidate')")
      .all()
      .map((topic) => [topic.slug, topic.topic_id])
  );
  const topicIds = [...topicsBySlug.values()];
  const resolveTopicIds = (entry, label) => {
    const slugs = entry.topic_slugs || [];
    const ids = slugs.map((slug) => {
      const topicId = topicsBySlug.get(slug);
      if (!topicId) fail(`${label} 指定了不存在或未啟用的 Topic：${slug}`);
      return topicId;
    });
    return [...new Set(ids)];
  };
  const collectedAt = epoch(`${input.as_of}T00:00:00Z`, "as_of");
  const now = Math.floor(Date.now() / 1000);
  const placeIds = [];
  const eventIds = [];
  const currentPlaceIds = new Set((input.places || []).map((place) =>
    stableId("plc", `${place.country_code}:${place.city_code}:${place.name}`)));
  const managedEventSourceUrls = input.managed_event_source_urls || (input.events || []).map((event) => event.source_url);
  const currentEventIds = new Set((input.events || []).map((event) =>
    stableId("evt", `${event.country_code}:${event.city_code}:${event.name}`)));
  let removedManagedEvents = 0;
  let removedManagedPlaces = 0;

  db.exec("BEGIN");
  try {
    deleteOldDemoData();
    removedManagedPlaces = deleteManagedPlaceRows(
      topicIds,
      retiredPlaceIds,
      currentPlaceIds,
    );
    removedManagedEvents = deleteManagedEventRows(topicIds, managedEventSourceUrls, currentEventIds);

    for (const place of input.places || []) {
      const id = stableId("plc", `${place.country_code}:${place.city_code}:${place.name}`);
      const maps = mapUrls(place.map_query || `${place.name} ${place.city_code}`);
      const urls = place.source_urls.map((url) => {
        upsertSource(url, { country_code: place.country_code, city_code: place.city_code, title: place.name }, collectedAt);
        return url;
      });
      db.prepare(
        `INSERT INTO places
           (place_id, name, city_code, country_code, address, map_url, nav_urls_json,
            mention_count, discovered_via, source_urls_json, first_seen_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'search', ?, ?, ?)
         ON CONFLICT(place_id) DO UPDATE SET
           name = excluded.name, city_code = excluded.city_code, country_code = excluded.country_code,
           address = excluded.address, map_url = excluded.map_url, nav_urls_json = excluded.nav_urls_json,
           mention_count = excluded.mention_count, discovered_via = excluded.discovered_via,
           source_urls_json = excluded.source_urls_json, updated_at = excluded.updated_at`
      ).run(id, place.name, place.city_code, place.country_code, place.address, maps.map_url, maps.nav_urls_json,
        JSON.stringify(urls), collectedAt, now);
      db.prepare("DELETE FROM place_i18n WHERE place_id = ?").run(id);
      for (const locale of LOCALES) {
        db.prepare("INSERT INTO place_i18n (place_id, locale, description) VALUES (?, ?, ?)")
          .run(id, locale, place.descriptions[locale]);
      }
      db.prepare("DELETE FROM place_topics WHERE place_id = ?").run(id);
      const placeTopicIds = resolveTopicIds(place, `地點 ${place.name}`);
      const placeTopicStmt = db.prepare("INSERT INTO place_topics (place_id, topic_id, relevance) VALUES (?, ?, 0.9)");
      for (const topicId of placeTopicIds) placeTopicStmt.run(id, topicId);
      placeIds.push(id);
    }

    for (const event of input.events || []) {
      const id = stableId("evt", `${event.country_code}:${event.city_code}:${event.name}`);
      const srcId = upsertSource(event.source_url, {
        country_code: event.country_code,
        city_code: event.city_code,
        title: event.name,
      }, collectedAt);
      const start = epoch(event.start_at, `event(${event.name}).start_at`);
      const end = event.end_at == null ? null : epoch(event.end_at, `event(${event.name}).end_at`);
      db.prepare(
        `INSERT INTO events
           (event_id, name, city_code, country_code, venue, start_at, end_at, ticket_url, source_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(event_id) DO UPDATE SET
           name = excluded.name, city_code = excluded.city_code, country_code = excluded.country_code,
           venue = excluded.venue, start_at = excluded.start_at, end_at = excluded.end_at,
           ticket_url = excluded.ticket_url, source_id = excluded.source_id, updated_at = excluded.updated_at`
      ).run(id, event.name, event.city_code, event.country_code, event.venue, start, end, event.ticket_url || null, srcId, now);
      db.prepare("DELETE FROM event_i18n WHERE event_id = ?").run(id);
      for (const locale of LOCALES) {
        db.prepare("INSERT INTO event_i18n (event_id, locale, description) VALUES (?, ?, ?)")
          .run(id, locale, event.descriptions[locale]);
      }
      db.prepare("DELETE FROM event_topics WHERE event_id = ?").run(id);
      const eventTopicIds = resolveTopicIds(event, `活動 ${event.name}`);
      const eventTopicStmt = db.prepare("INSERT INTO event_topics (event_id, topic_id, relevance) VALUES (?, ?, 0.9)");
      for (const topicId of eventTopicIds) eventTopicStmt.run(id, topicId);
      eventIds.push(id);
    }

    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }

  const marketSummary = markets.map((market) => `${market.locale}:${market.city_code}`).join(" ");
  console.log(`已匯入 ${placeIds.length} 個地點、${eventIds.length} 個活動；市場 ${marketSummary}`);
  console.log(`已清除受管理來源中不在目前清單的舊地點 ${removedManagedPlaces} 個`);
  console.log(`已清除受管理來源中不在目前清單的舊活動 ${removedManagedEvents} 個`);
  console.log(`已刪除舊 demo 地點 ${OLD_DEMO_PLACE_IDS.length} 個、活動 ${OLD_DEMO_EVENT_IDS.length} 個及未被引用的假來源 ${OLD_DEMO_SOURCE_IDS.length} 個`);
}

try {
  importSample();
} catch (error) {
  console.error(`匯入失敗：${error.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
