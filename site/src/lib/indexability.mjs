// 逐國頁 `/topic/<slug>/<cc>/` 要不要給 Google 收錄,由這裡說了算(2026-10-14 用戶拍板)。
//
// 「產不產出」與「給不給收錄」是兩件事:前者是 country-cells.mjs(撐不起一頁就不產),
// 這裡管後者 —— 頁面照樣存在、照樣可點,只是標 `noindex, follow` 並移出 sitemap。
// 頁面模板與 sitemap 兩處都吃這一支,判準只有一份(逐國頁那次的教訓)。
//
// ── 為什麼要縮(實測,2026-10-14 診斷) ─────────────────────────────────
// 2026-09-02 起全站降權:崩盤前 6 天曝光 11,447、有曝光的網址 1,134 個;
// 之後 30 天曝光 442、網址 143 個。en/jp/hi/id/br 五站首頁與多數 Topic 頁是
// 「Crawled - currently not indexed」,而「已收錄」的頁也幾乎拿不到曝光。
// 一個新網域三週內上了七站 × 約 580 個模板頁,逐國頁是其中最大宗。
// 所以先把**撐不起獨立一頁**的逐國頁從收錄範圍拿掉,讓 Google 看到的是比較厚的那一批。
//
// ── 判準(全部可量測,數字見下方常數) ──────────────────────────────────
// 一格 = (Topic, 國家)。對**每一格**算一次,七站共用同一個結論:
//   ① 該國獨有內容字數 < MIN_UNIQUE_CHARS → 薄
//   ② 與同 Topic 他國格的文字相似度 ≥ MAX_SIBLING_SIMILARITY → 薄(模板換國名)
// 量的是 zh-TW 那一段(QUALITY_LOCALE):七語是同一份事實的翻譯,資訊量相同,
// 但字元數差兩三倍(CJK 一字 ≈ 拉丁語系兩三個字元,見 country-cells.mjs 的門檻註解),
// 用同一個語系量,同一格在七站才會得到同一個答案(白名單例外是逐網址的)。
// 「獨有」= 只屬於這一國的文字:習俗、日期規則、地方說明。Topic 共用的摘要
// (每個國家頁都印同一段)不算 —— 那正是讓逐國頁彼此長得像的部分。
//
// 判薄之後,以下情況仍保留可收錄:
//   · 本站是 zh-TW 或 zh-CN(ALWAYS_INDEX_LOCALES;用戶指示優先保留繁中主站與 cn,
//     這兩站目前是全站僅剩有曝光的地方)
//   · 該網址近 90 天在 GSC 有過曝光或點擊(index-keep.generated.mjs;
//     Google 已經拿它回答過真實查詢,實測勝過推估)
//
// ── hreflang(這一版沒處理,2026-10-14) ──────────────────────────────────
// hreflang 由 layouts/BaseLayout.astro 依 LOCALES 全列,頁面無法傳入,所以被 noindex 的頁
// 仍會出現在其他語系頁的 hreflang 裡(七站的產出門檻各自算,也可能指向沒產出的頁)。
// 要修得改 BaseLayout(共用版面),另案處理;下面的 countryPageLocales 是給那時用的。
import { LOCALE, LOCALES } from './config.mjs';
import { countryCellsFor } from './country-cells.mjs';
import {
  observancesForFacts, regionalNotesForFacts, customsText, dateRuleText, regionalNoteText,
} from './topics-data.mjs';
import { LOCALE_ORIGINS } from './seo.mjs';
import { INDEX_KEEP_URLS } from './index-keep.generated.mjs';

export const QUALITY_LOCALE = 'zh-TW';
export const ALWAYS_INDEX_LOCALES = ['zh-TW', 'zh-CN'];

// 門檻怎麼定的(2026-10-14 實測,zh-TW 段,全部 (Topic, 國家) 格):
//   獨有字數分佈 p10 148、p25 178、中位 241、p75 336。
//   300 字約是一段完整的「這一國怎麼過、哪天、為什麼」;中位數那一格(241 字)
//   大約只有兩三句習俗描述,剩下的版面全是 Topic 共用段與兄弟國連結。
//   取 300:五站約一半的逐國頁判薄,扣掉白名單後實際 noindex 的數字見 dry-run
//   (site/scripts/indexability-report.mjs)。要調先跑那支看前後數,不要憑感覺改。
export const MIN_UNIQUE_CHARS = 300;
// 相似度:字元三連詞的 Jaccard。2026-10-14 實測 zh-TW 全部格子兩兩最高 0.089,
// 現在沒有任何一格會被這條擋;它是給未來「批次生成、只換國名」的內容當護欄。
export const MAX_SIBLING_SIMILARITY = 0.5;

const KEEP = new Set(INDEX_KEEP_URLS);

/** 一格只屬於該國的文字(去空白)。Topic 共用摘要不算。 */
export function uniqueCountryText(facts, i18n, code, locale = QUALITY_LOCALE) {
  const observances = observancesForFacts(facts).filter((o) => o.country_code === code);
  const note = regionalNotesForFacts(facts).find((n) => n.country_code === code) || null;
  return [
    ...observances.map((o) => customsText(i18n, o, locale) || ''),
    ...observances.map((o) => dateRuleText(i18n, o, locale) || ''),
    note ? regionalNoteText(i18n, note, locale) || '' : '',
  ].join('').replace(/\s+/g, '');
}

function trigrams(text) {
  const out = new Set();
  for (let i = 0; i + 3 <= text.length; i += 1) out.add(text.slice(i, i + 3));
  return out;
}

/** 字元三連詞 Jaccard,0~1。任一邊空字串回 0(沒有內容不算「相似」,由字數那條處理)。 */
export function similarity(a, b) {
  const A = trigrams(a);
  const B = trigrams(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const g of A) if (B.has(g)) shared += 1;
  return shared / (A.size + B.size - shared);
}

/** 一個 Topic 底下所有出現過的國家(不論哪一站有沒有產出)。 */
export function allCellCodes(facts) {
  return [...new Set([
    ...observancesForFacts(facts).map((o) => o.country_code),
    ...regionalNotesForFacts(facts).map((n) => n.country_code),
  ].filter(Boolean))];
}

const qualityCache = new Map();

/** 一格的品質量測:{ chars, similarity, thin, reasons }。同一個 Topic 只算一次。 */
export function cellQuality(facts, i18n, code) {
  const key = facts?.slug;
  if (!key) return { chars: 0, similarity: 0, thin: true, reasons: ['no-slug'] };
  if (!qualityCache.has(key) || qualityCache.get(key).i18n !== i18n) {
    const codes = allCellCodes(facts);
    const texts = new Map(codes.map((c) => [c, uniqueCountryText(facts, i18n, c)]));
    const result = new Map();
    for (const c of codes) {
      let max = 0;
      for (const d of codes) if (d !== c) max = Math.max(max, similarity(texts.get(c), texts.get(d)));
      const chars = texts.get(c).length;
      const reasons = [];
      if (chars < MIN_UNIQUE_CHARS) reasons.push('unique-chars');
      if (max >= MAX_SIBLING_SIMILARITY) reasons.push('sibling-similarity');
      result.set(c, { chars, similarity: Number(max.toFixed(3)), thin: reasons.length > 0, reasons });
    }
    qualityCache.set(key, { i18n, result });
  }
  return qualityCache.get(key).result.get(code)
    || { chars: 0, similarity: 0, thin: true, reasons: ['unknown-country'] };
}

export function countryPageUrl(locale, slug, code) {
  return `${LOCALE_ORIGINS[locale]}/topic/${slug}/${String(code).toLowerCase()}/`;
}

/** 這一格在某語系站有沒有被產出(各站門檻各自算,見 country-cells.mjs)。 */
export function countryPageExists(facts, i18n, code, locale = LOCALE) {
  return countryCellsFor(facts, i18n, locale).includes(code);
}

/**
 * 這一格在某語系站可不可以被收錄。回 { indexable, reason }。
 * reason:'missing'(該站沒產出)/'locale'/'gsc-keep'/'quality'/'thin'。
 */
export function countryPageIndexability(facts, i18n, code, locale = LOCALE, keep = KEEP) {
  if (!countryPageExists(facts, i18n, code, locale)) return { indexable: false, reason: 'missing' };
  if (ALWAYS_INDEX_LOCALES.includes(locale)) return { indexable: true, reason: 'locale' };
  if (keep.has(countryPageUrl(locale, facts.slug, code))) return { indexable: true, reason: 'gsc-keep' };
  const q = cellQuality(facts, i18n, code);
  return q.thin ? { indexable: false, reason: 'thin' } : { indexable: true, reason: 'quality' };
}

export function isCountryPageIndexable(facts, i18n, code, locale = LOCALE, keep = KEEP) {
  return countryPageIndexability(facts, i18n, code, locale, keep).indexable;
}

/** 有產出這一格的語系(頁尾語系切換器用 —— 連得到,但不一定可收錄)。 */
export function countryPageLocales(facts, i18n, code) {
  return LOCALES.filter((locale) => countryPageExists(facts, i18n, code, locale));
}
