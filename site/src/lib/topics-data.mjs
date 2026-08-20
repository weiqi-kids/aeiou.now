// Topic 的讀取層:索引、單筆 bundle、observance、各語系文字、cover 路徑。
// 排序與熱度不在這裡(見 ranking.mjs);在地資料也不在(見 local-data.mjs)。

import { readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { LOCALE } from './config.mjs';
import { readJson, DATA_ROOT } from './data-source.mjs';

export function observancesForFacts(facts) {
  if (facts && Array.isArray(facts.observances)) return facts.observances;
  return ((facts && facts.countries) || []).map((country) => ({
    ...country,
    observance_id: country.observance_id || `legacy-${country.country_code}`,
    observance_key: country.observance_key || 'default',
  }));
}

/** Topic 清單(本 locale):topics/index/<locale>.json = 裸陣列。
 * index 檔有 commonality / category / is_perennial / ranks / tiers / slug / status / title / topic_id,
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

/** 六窗的名次與級距:topics index 是來源(facts.json 不帶)。
 * 原始分數**不進 data/**——它含時間項、每天漂移,會讓靜態產物天天重建而畫面零變化。
 * 見 scripts/export-data.mjs 的說明。 */

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