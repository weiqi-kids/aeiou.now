// ═══════════════════════════════════════════════════════════════════════════
// 內容厚薄的共用量測與門檻。check-content-depth.mjs 與 site/scripts/
// check-rendered-depth.mjs 都吃這一份，避免兩層各自定義「厚」而對不起來。
// ═══════════════════════════════════════════════════════════════════════════
//
// 立法緣由（2026-08-19 GA/GSC 診斷）：站台索引、部署、埋碼全部正常，流量低的
// 成因全是「送上去的頁面本身撐不起排名」，而且**從第一天就存在**：
//   ・30 個 active Topic 有 18 個完全沒有國別敘述（regional_notes=0）、11 個沒有任何日期；
//     有日期的那些又極少國：christmas 2 國、diwali／ramadan 各 1 國
//   ・zh-TW 唯一內容中位數 137 字元（節日類 55–167），對手是 Wikipedia／官方網站
//   ・12 個常青主題逐國共用同兩個來源網域（印度戶政網址掛在巴西婚俗下）
//   ・排行榜每個時窗只有 1 筆，名次還印成 319；六個時窗 × 七站 = 42 個空頁進 sitemap
// 這些缺陷等再久都不會自己好。本檔的存在就是讓它們**在資料進 data/ 之前就紅燈**，
// 而不是三個月後再從 GSC 反推。
//
// 對照基準（2026-08-19 實測 folk.tw，渲染後去重字元）：
//   主力內容頁 1,600–2,930；薄頁 678–793；aeiou topic 頁當時 514–1,765。
//   渲染框架（導覽＋頁尾＋區塊標題）約佔 400，故資料層目標訂 1,200。

/** 七個代表市場（與 export/check-data-completeness 同一組，不要各自定義） */
export const COUNTRIES = ['TW', 'JP', 'CN', 'US', 'IN', 'ID', 'BR'];
export const LOCALES = ['zh-TW', 'en', 'ja', 'zh-CN', 'hi', 'id', 'pt-BR'];

/**
 * 門檻分三層：
 *   ERROR  低於此值＝不准進 data/。存量用 baseline 豁免（見下），新內容沒有豁免。
 *   TARGET 補資料的驗收線，對齊 folk.tw 主力內容頁。
 * ⚠️ ERROR 刻意訂得比 TARGET 低很多：一刀切會讓所有部署紅燈，那是擋工作不是擋錯誤
 *    （folk.tw check-source-refs 的同一條教訓）。收斂靠 baseline 只能降不能升。
 */
export const THRESHOLDS = {
  unitsError: 3,          // 少於 3 個地方變體 → 標題寫「各地差異」卻兌現不了
  unitsTarget: 5,         // ⚠️ 計數單位是「地方變體」不是國家，見 coverageUnits() 的說明
  uniqueCharsError: 250,  // 每語系去重後的唯一內容字元
  uniqueCharsTarget: 1200,
  rankingItemsMin: 5,     // 少於此數的排行榜視窗不得進 sitemap（見 R5）
};

/** 各國官方／在地來源網域。用於 R3：逐國來源必須掛得住那個國家。 */
export const COUNTRY_DOMAINS = {
  TW: [/\.gov\.tw$/, /\.tw$/],
  JP: [/\.go\.jp$/, /\.jp$/],
  CN: [/\.gov\.cn$/, /\.cn$/],
  US: [/\.gov$/, /\.us$/, /^usa\.gov$/],
  IN: [/\.gov\.in$/, /\.nic\.in$/, /\.in$/],
  ID: [/\.go\.id$/, /\.id$/],
  BR: [/\.gov\.br$/, /\.br$/],
};

/** 不綁國家的通用／國際來源，可以掛在 topic 層，但不得下放成某一國的逐國來源。 */
export const GENERIC_SOURCE_DOMAINS = [
  /(^|\.)britannica\.com$/, /(^|\.)unesco\.org$/, /(^|\.)ich\.unesco\.org$/,
  /(^|\.)who\.int$/, /(^|\.)oecd\.org$/, /(^|\.)ilo\.org$/, /(^|\.)timeanddate\.com$/,
];

export const hostOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

/** host 是否屬於某個國家（回傳國碼，或 '' 表示通用／不可判定） */
export function countryOfHost(host) {
  for (const [cc, pats] of Object.entries(COUNTRY_DOMAINS)) {
    if (pats.some((re) => re.test(host))) return cc;
  }
  return '';
}

export const isGenericSource = (host) => GENERIC_SOURCE_DOMAINS.some((re) => re.test(host));

/**
 * 一個 Topic 在某語系的「唯一內容量」。
 * 逐段去重是重點——2026-08-19 的頁面把同一段 lede 印三次，字元數看起來夠但唯一內容只有三分之一。
 */
export function uniqueContentChars(facts, i18n, locale) {
  const loc = i18n?.locales?.[locale] || {};
  const parts = [loc.title, loc.summary];
  for (const o of facts?.observances || []) parts.push(o.local_name, o.date_rule);
  // ⚠️ 節日類 Topic 的主要內文在這裡（每個 observance 的七語 customs），不在 regional_notes。
  //    2026-08-19 初版漏掉這一項，害 christmas 這種「有 customs 沒有 regional note」的 Topic
  //    被算成只有 68 字元。漏算會讓補資料清單排錯優先序，比門檻訂錯更難發現。
  for (const byLocale of Object.values(i18n?.observances || {})) parts.push(byLocale?.[locale]);
  for (const note of Object.values(i18n?.regional_notes || {})) parts.push(note?.[locale]);
  const seen = new Set();
  let n = 0;
  for (const p of parts) {
    const s = typeof p === 'string' ? p.trim() : '';
    if (!s || seen.has(s)) continue;
    seen.add(s);
    n += s.replace(/\s/g, '').length;
  }
  return n;
}

/** 一個 Topic 實際涵蓋的國家（observance 與 regional note 聯集） */
export function coveredCountries(facts, i18n) {
  const set = new Set();
  for (const o of facts?.observances || []) if (o.country_code) set.add(o.country_code);
  for (const cc of Object.keys(i18n?.regional_notes || {})) set.add(cc);
  return [...set].sort();
}

/**
 * 「地方變體」的數量 —— 門檻要用這個，不要用國家數。
 *
 * 為什麼（2026-08-19 補資料時發現）：用國家數當門檻會逼出造假。排燈節在本站七個市場裡
 * 真正有官方地位的只有印度；硬湊到五國就得替日本、中國、巴西編出不存在的節慶。
 * 但排燈節確實有豐富的「各地怎麼過」——那個差異在**印度境內**（北印的 Lakshmi puja、
 * 南印的 Deepavali、孟加拉的 Kali puja、錫克教的 Bandi Chhor Divas）。
 * 資料模型本來就允許同一國多筆 observance（UNIQUE 是 topic+country+key），
 * 所以計數單位改成 (國家, observance_key) 的相異組合數 ＋ 有國別敘述的國家數。
 *
 * 判準沒有變鬆：頁面上仍必須有 N 個具體、各自掛源的地方變體，
 * 只是不再要求那 N 個一定分屬 N 個國家。
 */
export function coverageUnits(facts, i18n) {
  const set = new Set();
  for (const o of facts?.observances || []) {
    if (o.country_code) set.add(`${o.country_code}/${o.observance_key || ''}`);
  }
  for (const cc of Object.keys(i18n?.regional_notes || {})) set.add(`${cc}/note`);
  return set.size;
}
