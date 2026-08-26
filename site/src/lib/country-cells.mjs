// 逐國頁 `/topic/<slug>/<country>/` 要不要生出來,由這裡說了算(2026-08-26)。
//
// 放在 lib 而不是頁面檔裡,是因為 Astro 把 `getStaticPaths` 抽成獨立的 chunk 執行,
// 同一個 .astro 檔前面宣告的函式在那裡**取不到**(實測 `localTextLength is not defined`)。
// 頁面本體與 getStaticPaths 都得從這裡 import,判準才只有一份。
//
// 為什麼要先估內容量:`check-rendered-depth` 的唯一內容下限是 320 字元,而逐國散文
// 的中位數只有 180 字(2026-08-26 實測 327 筆:最短 52、中位 180、最長 385)。
// 撐不起來的格子**根本不產出**,不是產出了再讓守門擋 —— 後者會讓整個 build 掛掉。
import { LOCALE } from './config.mjs';
import {
  observancesForFacts, regionalNotesForFacts, customsText, dateRuleText, regionalNoteText,
} from './topics-data.mjs';

// 門檻怎麼定的(2026-08-26 實測四個值,七語系各 build 一次):
//   360 → zh-TW 產 141 頁、渲染後最薄 478
//   300 → zh-TW 產 295 頁、最薄 421
//   260 → zh-TW 產 336 頁、最薄 371   ← 取這個
//   220 → zh-TW 產 353 頁、最薄 343   離守門的 320 只剩 23 字,改一次稿就可能翻車
// 取 260 是為了留 50 字左右的餘裕。⚠ 這個數字是**字元數**,而中文一個字的資訊量
// 是拉丁語系的兩三倍 —— 同一個門檻對 CJK 站天生比較嚴(en/id/pt-BR 都產滿 356 頁,
// zh-TW 只有 336)。要再放寬得先讓守門那 320 也改成語系相關,不是動這裡。
export const MIN_LOCAL_TEXT = 260;

/** 這一格會出現在頁面上的本地文字總量(去掉空白後的字元數)。 */
export function localTextLength({ facts, i18n, observances, note }) {
  const parts = [
    ...observances.map((o) => customsText(i18n, o) || ''),
    ...observances.map((o) => dateRuleText(i18n, o) || ''),
    ...observances.map((o) => o.local_name || ''),
    note ? regionalNoteText(i18n, note) || '' : '',
    (i18n?.locales?.[LOCALE]?.summary) || facts?.commonality || '',
  ];
  return parts.join('').replace(/\s+/g, '').length;
}

/**
 * 一個 Topic 底下「撐得起獨立頁」的國家清單(ISO 3166-1 alpha-2 大寫)。
 * 頁面本體列兄弟頁時用同一支,所以不會連到沒被產出的網址。
 */
export function countryCellsFor(facts, i18n) {
  if (!facts?.slug) return [];
  const all = observancesForFacts(facts);
  const notes = regionalNotesForFacts(facts);
  const codes = [...new Set([
    ...all.map((o) => o.country_code),
    ...notes.map((n) => n.country_code),
  ].filter(Boolean))];
  return codes.filter((code) => {
    const observances = all.filter((o) => o.country_code === code);
    const note = notes.find((n) => n.country_code === code) || null;
    return localTextLength({ facts, i18n, observances, note }) >= MIN_LOCAL_TEXT;
  });
}
