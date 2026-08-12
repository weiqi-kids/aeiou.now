#!/usr/bin/env node
// 驗證 Topic 頁的「📍你附近／🎉相關活動」只呈現本語系代表市場。
// 七市場資料仍可同時存在於 data/；跨市場比較只屬於 Topic 的 🌎 區塊。
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LOCALE, MARKET_CITY, MARKET_COUNTRY } from '../src/lib/config.mjs';
import { listTopicIds, getTopicBundle, placesForTopic, eventsForTopic } from '../src/lib/data.mjs';

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

const topicIds = listTopicIds();
for (const topicId of topicIds) {
  assertSourceScope(topicId);
  if (process.argv.includes('--dist')) assertRenderedScope(topicId);
}

console.log(`本地範圍守門通過：${LOCALE} → ${marketCountry}/${marketCity}；檢查 ${topicIds.length} 個 Topic。`);
