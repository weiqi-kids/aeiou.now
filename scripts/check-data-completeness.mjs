#!/usr/bin/env node
// 發布前資料完整性守門：檢查 Topic、年度日期、七語內容、長青國別筆記，
// 以及七市場 places/events 的來源與欄位。這支只做結構與一致性檢查，
// 不把「目前沒有真實 UGC 精華」偽造成內容。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isTrendTopic } from "./lib/topics.mjs";
import { CANONICAL_CATEGORIES, isCanonicalCategory } from "./lib/topics.mjs";

const ROOT = process.cwd().endsWith('/site') ? join(process.cwd(), '..') : process.cwd();
const DATA = join(ROOT, 'data');
const CONTENT = join(ROOT, 'content');
const LOCALES = ['zh-TW', 'en', 'ja', 'zh-CN', 'hi', 'id', 'pt-BR'];
// 七個站台市場仍是固定契約；observance 可以補充 GSC 驗證出需求的其他國家。
// 不要因此放寬 perennial regional_notes 的七市場完整性要求。
const MARKET_COUNTRY_CODES = new Set(['TW', 'JP', 'CN', 'US', 'IN', 'ID', 'BR']);
const CONTENT_COUNTRY_CODES = new Set([...MARKET_COUNTRY_CODES, 'SG']);
const errors = [];
const fail = (message) => errors.push(message);
const readJson = (path) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { fail(`JSON 無法讀取：${path} (${error.message})`); return null; }
};
const requireFile = (path, label) => {
  if (!existsSync(path)) { fail(`${label} 缺檔：${path}`); return null; }
  return readJson(path);
};
const isHttp = (value) => typeof value === 'string' && /^https?:\/\//i.test(value);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const unique = (values) => new Set(values).size === values.length;

// 與 export-data.mjs / check-final-topic-taxonomy.mjs 共用的輸出契約：
// 明確標記才是 machine-owned trend；其餘資料仍按既有 manual Topic 驗收。
const isMachineTrendTopic = isTrendTopic;
const isHiddenStatus = (row) => row?.status === 'candidate' || row?.status === 'merged';
const topicKey = (row) => `${row?.topic_id || ''}|${row?.slug || ''}`;
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const indexes = new Map();
for (const locale of LOCALES) {
  const rows = requireFile(join(DATA, 'topics', 'index', `${locale}.json`), `Topic index ${locale}`);
  if (!Array.isArray(rows) || rows.length === 0) continue;
  indexes.set(locale, rows);
}
const baseIndex = indexes.get('zh-TW') || [];
for (const [locale, rows] of indexes) {
  for (const row of rows) {
    if (isHiddenStatus(row)) fail(`${locale}: 不可輸出 ${row.status} Topic：${row.slug || row.topic_id || '(unknown)'}`);
  }
}
const activeTopics = baseIndex.filter((row) => !isHiddenStatus(row));
const activeSlugs = new Set(activeTopics.map((row) => row.slug));
if (activeTopics.length === 0) fail('沒有 active Topic');
const baseTrendKeys = activeTopics.filter(isMachineTrendTopic).map(topicKey);
for (const [locale, rows] of indexes) {
  const activeRows = rows.filter((row) => !isHiddenStatus(row));
  if (activeRows.length !== activeTopics.length) fail(`${locale} active Topic 數量 ${activeRows.length} ≠ zh-TW ${activeTopics.length}`);
  if (new Set(activeRows.map((row) => row.slug)).size !== activeRows.length) fail(`${locale} Topic slug 重複`);
  for (const slug of activeSlugs) if (!activeRows.some((row) => row.slug === slug)) fail(`${locale} 缺 Topic：${slug}`);
  const trendKeys = activeRows.filter(isMachineTrendTopic).map(topicKey);
  if (!same(trendKeys, baseTrendKeys)) fail(`${locale} trend Topic 集合與 zh-TW 不一致`);
}

const currentYear = new Date().getUTCFullYear();
let observanceCount = 0;
let regionalNoteCount = 0;
for (const topic of activeTopics) {
  const facts = requireFile(join(DATA, 'topics', topic.topic_id, 'facts.json'), `${topic.slug} facts`);
  const i18n = requireFile(join(DATA, 'topics', topic.topic_id, 'i18n.json'), `${topic.slug} i18n`);
  if (!facts || !i18n) continue;
  if (isMachineTrendTopic(topic)) {
    if (facts.topic_kind !== 'trend') fail(`${topic.slug}: trend facts 缺 topic_kind=trend`);
    if (i18n.topic_kind !== 'trend') fail(`${topic.slug}: trend i18n 缺 topic_kind=trend`);
    const highlights = requireFile(join(DATA, 'topics', topic.topic_id, 'highlights.json'), `${topic.slug} highlights`);
    if (highlights && highlights.topic_kind !== 'trend') fail(`${topic.slug}: trend highlights 缺 topic_kind=trend`);
  }
  if (facts.slug !== topic.slug) fail(`${topic.slug}: facts.slug 不一致`);
  if (!isHttp(facts.source_urls?.[0])) fail(`${topic.slug}: facts 缺 source URL`);
  for (const locale of LOCALES) {
    const loc = i18n.locales?.[locale];
    if (!nonEmpty(loc?.title) || !nonEmpty(loc?.summary)) fail(`${topic.slug}: ${locale} 缺 title/summary`);
    if (!Array.isArray(loc?.keywords) || loc.keywords.length === 0) fail(`${topic.slug}: ${locale} 缺 keywords`);
  }
  const observances = Array.isArray(facts.observances) ? facts.observances : [];
  observanceCount += observances.length;
  for (const observance of observances) {
    const label = `${topic.slug}/${observance.country_code}/${observance.observance_key}`;
    if (!CONTENT_COUNTRY_CODES.has(observance.country_code)) fail(`${label}: country_code 無效`);
    if (!Array.isArray(observance.source_urls) || !observance.source_urls.every(isHttp)) fail(`${label}: 缺來源`);
    const years = new Set((observance.occurrences || []).map((row) => row.occurrence_year));
    for (const year of [currentYear, currentYear + 1]) if (!years.has(year)) fail(`${label}: 缺 ${year} occurrence`);
    for (const locale of LOCALES) {
      if (!nonEmpty(i18n.observances?.[observance.observance_id]?.[locale])) fail(`${label}: 缺 customs ${locale}`);
    }
  }
  const regional = Array.isArray(facts.regional_notes) ? facts.regional_notes : [];
  if (facts.is_perennial && regional.length !== MARKET_COUNTRY_CODES.size) {
    fail(`${topic.slug}: perennial regional_notes 應有 ${MARKET_COUNTRY_CODES.size} 國，實際 ${regional.length}`);
  }
  if (regional.length) {
    regionalNoteCount += regional.length;
    const countries = regional.map((row) => row.country_code);
    if (!unique(countries)) fail(`${topic.slug}: regional_notes country 重複`);
    for (const row of regional) {
      const label = `${topic.slug}/regional/${row.country_code}`;
      if (!MARKET_COUNTRY_CODES.has(row.country_code)) fail(`${label}: country_code 無效`);
      if (!Array.isArray(row.source_urls) || !row.source_urls.every(isHttp)) fail(`${label}: 缺來源`);
      for (const locale of LOCALES) {
        if (!nonEmpty(i18n.regional_notes?.[row.country_code]?.[locale])) fail(`${label}: 缺 ${locale}`);
      }
    }
  }
}

const sample = requireFile(join(CONTENT, 'local-sample-data.json'), 'local sample data');
const sourceCatalog = requireFile(join(CONTENT, 'local-data-sources.json'), 'local source catalog');
const markets = sample?.markets || [];
const sourceRows = sourceCatalog?.sources || [];
const sourceByUrl = new Map();
for (const source of sourceRows) {
  if (!isHttp(source.url)) fail(`source catalog URL 無效：${source.url}`);
  if (sourceByUrl.has(source.url)) fail(`source catalog URL 重複：${source.url}`);
  sourceByUrl.set(source.url, source);
}
if (markets.length !== LOCALES.length) fail(`markets 應有 ${LOCALES.length} 個，實際 ${markets.length}`);
const marketByCity = new Map();
for (const market of markets) {
  if (!LOCALES.includes(market.locale)) fail(`市場 locale 無效：${market.locale}`);
  if (marketByCity.has(market.city_code)) fail(`市場 city_code 重複：${market.city_code}`);
  marketByCity.set(market.city_code, market);
}
const asOf = sample?.as_of || `${currentYear}-01-01`;
const placeKeys = new Set();
for (const place of sample?.places || []) {
  const label = `place/${place.country_code}/${place.name}`;
  const key = `${place.country_code}:${place.city_code}:${place.name}`;
  if (placeKeys.has(key)) fail(`${label}: 重複`);
  placeKeys.add(key);
  if (place.place_type !== 'permanent' || place.topic_relevance !== 'direct') fail(`${label}: type/relevance 不符合`);
  if (!Array.isArray(place.topic_slugs) || place.topic_slugs.length === 0) fail(`${label}: 缺 topic_slugs`);
  for (const slug of place.topic_slugs) if (!activeSlugs.has(slug)) fail(`${label}: 引用不存在 Topic ${slug}`);
  for (const url of place.source_urls || []) if (sourceByUrl.get(url)?.kind !== 'place') fail(`${label}: 來源未登錄為 place ${url}`);
  for (const locale of LOCALES) if (!nonEmpty(place.descriptions?.[locale])) fail(`${label}: 缺 ${locale} description`);
}
const eventKeys = new Set();
for (const event of sample?.events || []) {
  const label = `event/${event.country_code}/${event.name}`;
  const key = `${event.country_code}:${event.city_code}:${event.name}`;
  if (eventKeys.has(key)) fail(`${label}: 重複`);
  eventKeys.add(key);
  if (!Array.isArray(event.topic_slugs) || event.topic_slugs.length === 0) fail(`${label}: 缺 topic_slugs`);
  for (const slug of event.topic_slugs) if (!activeSlugs.has(slug)) fail(`${label}: 引用不存在 Topic ${slug}`);
  const source = sourceByUrl.get(event.source_url);
  if (source?.kind !== 'event') fail(`${label}: 來源未登錄為 event ${event.source_url}`);
  if (!nonEmpty(event.start_at)) fail(`${label}: 缺 start_at`);
  const start = Date.parse(event.start_at);
  const end = event.end_at ? Date.parse(event.end_at) : start;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) fail(`${label}: 日期無效`);
  if (new Date(end).toISOString().slice(0, 10) < asOf) fail(`${label}: 已過期但仍在 sample`);
  for (const locale of LOCALES) if (!nonEmpty(event.descriptions?.[locale])) fail(`${label}: 缺 ${locale} description`);
}
for (const market of markets) {
  if (!(sample?.places || []).some((row) => row.city_code === market.city_code)) fail(`${market.locale}: 沒有 place`);
  if (!(sample?.events || []).some((row) => row.city_code === market.city_code)) fail(`${market.locale}: 沒有 event`);
}
for (const [label, urls, kind] of [
  ['managed place', sample?.managed_place_source_urls || [], 'place'],
  ['managed event', sample?.managed_event_source_urls || [], 'event'],
]) {
  for (const url of urls) if (sourceByUrl.get(url)?.kind !== kind) fail(`${label} URL kind 不符：${url}`);
}

// ---- category 正典與七語標籤覆蓋 ----------------------------------------
// 缺標籤時前端 tOr() 會退回顯示英文原始 slug。2026-08-19 線上七站首頁實際發生過:
// 12 類裡只有 3 類有標籤,中文站與日文站首頁直接露出 family / civic / seasonal…
{
  const usedCategories = [...new Set(activeTopics.map((t) => t.category).filter(Boolean))];
  for (const c of usedCategories) {
    if (!isCanonicalCategory(c)) errors.push(`Topic category 不是正典取值:${c}`);
  }
  const i18nDir = join(ROOT, "site", "src", "i18n");
  for (const locale of LOCALES) {
    const file = join(i18nDir, `${locale}.json`);
    if (!existsSync(file)) { errors.push(`i18n 缺檔:${locale}.json`); continue; }
    const dict = JSON.parse(readFileSync(file, "utf8"));
    for (const c of CANONICAL_CATEGORIES) {
      const key = `category.${c}`;
      if (!dict[key]) errors.push(`${locale}.json 缺 ${key}(前端會露出英文原始 slug)`);
      else if (String(dict[key]).startsWith("[TODO]")) errors.push(`${locale}.json 的 ${key} 仍是未翻佔位`);
    }
  }
}

if (errors.length) {
  console.error(`資料完整性守門失敗，共 ${errors.length} 項：`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`資料完整性守門通過：${activeTopics.length} Topic、${observanceCount} observance、${regionalNoteCount} regional notes、${sample.places.length} places、${sample.events.length} events、${sourceRows.length} sources。`);
