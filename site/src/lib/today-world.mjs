// 首頁「現在」區塊:挑出當下最能代表世界的幾則 observance。
// 規則(視窗天數、最多國家數、每國最多筆數)是顯示層決定,集中在此,不散在頁面裡。

import { readJson } from './data-source.mjs';
import { getTopicsIndex, getTopicBundle, observancesForFacts } from './topics-data.mjs';
import { countryName } from './local-data.mjs';

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