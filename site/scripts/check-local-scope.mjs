#!/usr/bin/env node
// 驗證 Topic 頁的「📍你附近／🎉相關活動」只呈現本語系代表市場。
// 七市場資料仍可同時存在於 data/；跨市場比較只屬於 Topic 的 🌎 區塊。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LOCALE, MARKET_CITY, MARKET_COUNTRY } from '../src/lib/config.mjs';
import {
  listTopicIds,
  getTopicBundle,
  countryName,
  placesForTopic,
  eventsForTopic,
  topicsWithPlacesByCity,
  topicsWithEventsByCity,
} from '../src/lib/data.mjs';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const marketCity = MARKET_CITY[LOCALE];
const marketCountry = MARKET_COUNTRY[LOCALE];

const fail = (message) => { throw new Error(message); };
if (!marketCity || !marketCountry) fail(`LOCALE ${LOCALE} 沒有代表市場設定`);

function linked(entry, topicId) {
  if (Array.isArray(entry.topics)) return entry.topics.some((row) => row?.topic_id === topicId);
  return Array.isArray(entry.topic_ids) && entry.topic_ids.includes(topicId);
}

function sourceEntries(dir) {
  const root = join(ROOT, 'src', 'data', dir);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => name.endsWith('.json'))
    .flatMap((name) => {
      const city = JSON.parse(readFileSync(join(root, name), 'utf8'));
      return (city[dir] || []).map((entry) => ({ ...entry, city_code: city.city_code }));
    });
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function assertSourceScope(topicId) {
  for (const entry of sourceEntries('places')) {
    if (entry.place_type !== 'permanent' || entry.topic_relevance !== 'direct') {
      fail(`${LOCALE}/${topicId} 有非 permanent 地點資料：${entry.name}`);
    }
  }
  for (const entry of sourceEntries('events')) {
    if (entry.start_at == null || !entry.venue || !entry.source_url) {
      fail(`${LOCALE}/${topicId} 有缺日期、場地或來源的活動資料：${entry.name}`);
    }
  }
  const places = placesForTopic(topicId, marketCity);
  const events = eventsForTopic(topicId, marketCity);
  for (const entry of [...places, ...events]) {
    if (entry.city_code !== marketCity || entry.country_code !== marketCountry) {
      fail(`${LOCALE}/${topicId} 篩選後仍有跨市場資料：${entry.name} (${entry.city_code}/${entry.country_code})`);
    }
  }
  return { places, events };
}

function sectionHtml(page, id) {
  const match = page.match(new RegExp(`<section[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?<\\/section>`));
  if (!match) fail(`dist 找不到 #${id} 區塊`);
  return match[0];
}

function assertRenderedScope(topicId) {
  const slug = getTopicBundle(topicId).facts?.slug;
  if (!slug) return;
  const path = join(DIST, 'topic', slug, 'index.html');
  if (!existsSync(path)) fail(`dist 找不到 Topic 頁：${path}`);
  const page = readFileSync(path, 'utf8');
  const nearby = sectionHtml(page, 'nearby');
  const activity = sectionHtml(page, 'events');
  const allPlaces = sourceEntries('places').filter((entry) => linked(entry, topicId));
  const allEvents = sourceEntries('events').filter((entry) => linked(entry, topicId));

  for (const entry of allPlaces) {
    const present = nearby.includes(`data-target-id="${htmlEscape(entry.place_id)}"`);
    if (entry.city_code === marketCity && entry.country_code === marketCountry && !present) {
      fail(`${LOCALE}/${slug} #nearby 缺少本市場地點：${entry.name}`);
    }
    if ((entry.city_code !== marketCity || entry.country_code !== marketCountry) && present) {
      fail(`${LOCALE}/${slug} #nearby 混入跨市場地點：${entry.name}`);
    }
  }
  for (const entry of allEvents) {
    const present = activity.includes(`data-target-id="${htmlEscape(entry.event_id)}"`);
    if (entry.city_code === marketCity && entry.country_code === marketCountry && !present) {
      fail(`${LOCALE}/${slug} #events 缺少本市場活動：${entry.name}`);
    }
    if ((entry.city_code !== marketCity || entry.country_code !== marketCountry) && present) {
      fail(`${LOCALE}/${slug} #events 混入跨市場活動：${entry.name}`);
    }
  }
}

function assertWorldNavPlacement(topicId) {
  const slug = getTopicBundle(topicId).facts?.slug;
  if (!slug) return;
  const path = join(DIST, 'topic', slug, 'index.html');
  if (!existsSync(path)) fail(`dist 找不到 Topic 頁：${path}`);
  const page = readFileSync(path, 'utf8');
  const article = page.match(/<article\b[^>]*>[\s\S]*?<\/article>/)?.[0] || '';
  const summary = article.match(/<summary class="world-summary"[\s\S]*?<\/summary>/)?.[0] || '';
  const articleNavs = [...article.matchAll(/<nav\b[^>]*>/g)];
  for (const match of articleNavs) {
    if (!summary.includes(match[0])) fail(`${LOCALE}/${slug} article 內有不屬於 #world summary 的 nav 區塊`);
  }
  if (!summary) {
    if (articleNavs.length) fail(`${LOCALE}/${slug} 沒有 #world 時不應有 nav 區塊`);
    return;
  }
  if (!summary.includes('<nav class="world-countries"')) {
    fail(`${LOCALE}/${slug} 國家導覽沒有放在 #world > summary 內`);
  }
}

function assertSortPageScope(sort) {
  const path = join(DIST, 'topics', sort, 'index.html');
  if (!existsSync(path)) fail(`dist 找不到排序頁：${path}`);
  const page = readFileSync(path, 'utf8');
  const cities = [...page.matchAll(/<section class="sort-group"[^>]*data-city="([^"]+)"/g)]
    .map((match) => match[1]);
  if (cities.some((city) => city !== marketCity) || cities.length > 1) {
    fail(`${LOCALE}/topics/${sort} 混入代表城市以外的資料：${cities.join(', ') || '空'}`);
  }
  const expectedCities = sort === 'nearby'
    ? topicsWithPlacesByCity(marketCity)
    : topicsWithEventsByCity(marketCity);
  const expected = expectedCities.find((city) => city.city_code === marketCity);
  if (!expected) fail(`${LOCALE}/topics/${sort} 沒有代表城市資料：${marketCity}`);
  // nearby 是在地 Topic 入口，不允許回退成單一全域 Topic；這正是此前全域 topic_slug
  // 造成的回歸。events 至少要有一個可核對的 Topic，不能生成空白索引頁。
  if (sort === 'nearby' && expected.topics.length < 2) {
    fail(`${LOCALE}/topics/${sort} 覆蓋不足：代表城市只有 ${expected.topics.length} 個 Topic`);
  }
  if (sort === 'events' && expected.topics.length < 1) {
    fail(`${LOCALE}/topics/${sort} 沒有可核對活動的 Topic`);
  }
  const renderedRows = [...page.matchAll(/<li\b[^>]*>/g)]
    .map((match) => match[0])
    .filter((tag) => /\bclass="[^"]*\brow\b[^"]*"/.test(tag))
    .map((tag) => tag.match(/\bdata-topic-id="([^"]+)"/)?.[1])
    .filter(Boolean);
  const expectedIds = expected.topics.map((topic) => topic.topic_id);
  if (renderedRows.length !== expectedIds.length || renderedRows.some((id, index) => id !== expectedIds[index])) {
    fail(`${LOCALE}/topics/${sort} rendered Topic 與資料關聯不一致：資料 ${expectedIds.length}、頁面 ${renderedRows.length}`);
  }
}


// 本站市場那一國要排在「什麼時候」答案的最前面。
// 立法緣由（2026-08-20）：id 站 affection-and-reciprocity 的 meta description 開頭是
// 「印度、中國」，印尼自己沒進前兩筆 —— 而 GSC 顯示落在那一頁的查詢正是
// `kapan hari valentine 2027`。讀者問自己的國家，搜尋結果先給他別人的日期。
// 這條只在「該 Topic 確實有本市場的 observance」時才要求，沒有就沒有，不逼人補資料。
function assertHomeCountryFirst(topicId) {
  const { facts } = getTopicBundle(topicId);
  const slug = facts?.slug;
  if (!slug) return;
  const dated = (facts.observances || []).filter((o) => o.next_occurrence);
  if (!dated.some((o) => o.country_code === marketCountry)) return;   // 本市場沒有日期就不管
  const path = join(DIST, 'topic', slug, 'index.html');
  if (!existsSync(path)) fail(`dist 找不到 Topic 頁：${path}`);
  const page = readFileSync(path, 'utf8');
  const desc = page.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']/i)?.[1] || '';
  const home = htmlEscape(countryName(marketCountry));
  const others = [...new Set(dated.map((o) => o.country_code))]
    .filter((code) => code !== marketCountry)
    .map((code) => htmlEscape(countryName(code)));
  const homeAt = desc.indexOf(home);
  if (homeAt < 0) {
    fail(`${LOCALE}/${slug} meta description 沒有提到本市場 ${marketCountry}（${home}）`);
  }
  for (const other of others) {
    const at = desc.indexOf(other);
    if (at >= 0 && at < homeAt) {
      fail(`${LOCALE}/${slug} meta description 把 ${other} 排在本市場 ${home} 前面`
        + `\n        「${desc.slice(0, 90)}…」`
        + '\n        本站服務單一市場,讀者問的是自己的國家;排序見 src/pages/topic/[slug].astro 的 homeFirst()。');
    }
  }
}

const topicIds = listTopicIds();
for (const topicId of topicIds) {
  assertSourceScope(topicId);
  if (process.argv.includes('--dist')) {
    assertRenderedScope(topicId);
    assertWorldNavPlacement(topicId);
    assertHomeCountryFirst(topicId);
  }
}
if (process.argv.includes('--dist')) {
  assertSortPageScope('nearby');
  assertSortPageScope('events');
}

console.log(`本地範圍守門通過：${LOCALE} → ${marketCountry}/${marketCity}；檢查 ${topicIds.length} 個 Topic。`);
