// ===========================================================================
// aeiou.now — 「這個查詢問的是哪一國」解析(2026-08-25 新增)
// ===========================================================================
//
// -- 為什麼需要這支 -------------------------------------------------------
// 2026-08-25 診斷:站上**排進前 15 名的帶國名查詢全部是「本市場的人問外國的事」**
// (11 個查詢、83 曝光、平均 6.5 名、**0 點擊**),問本國的查詢一個都沒進前 15。
// 最大一筆 `2027印尼齋戒月時間` 排 5.2、41 曝光、0 點擊,落在 zh-TW 站的
// ramadan-and-eid,而 description 開頭是「台灣不把開齋節列為法定假日…」——
// 頁面上**有**印尼那一段,只是摘要沒把它擺前面。一個問印尼的人不點是理性的。
//
// -- 為什麼不能用 topic_search_metrics 的 country scope --------------------
// 🔴 那個維度是 **GSC 的 country = 搜尋者所在國**,不是**查詢問的那一國**。
// 上面那筆的搜尋者在 TWN/HKG/IDN,問的卻是印尼 —— 兩者是不同的東西,不要混用。
// 「查詢問誰」只能從查詢字串本身解析,所以有了這支。
//
// -- 國名對照表為什麼是資料驅動的 -----------------------------------------
// 名稱一律讀 `data/meta/countries.json`(七國 × 七語,export-data.mjs 的產物),
// **不在這裡寫死國名** —— 站上有內容的國家換了,這支要跟著換。
// 只認那七個國家也正好是對的:lead country 必須是頁面上真的有那一段的國家,
// 否則摘要會承諾一段不存在的內容。
// 另備一小張別名表,補三種對照表天生沒有的寫法(理由逐條寫在表上)。

import { readFileSync } from "node:fs";
import { join } from "node:path";

// 音標與大小寫正規化:查詢常寫成 `japao`(無音標)、`JAPÃO`。
// NFD 拆出組合附加符號後移除,`japão` 與 `japao` 才能對上同一個 key。
const norm = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// 對照表天生沒有、但查詢裡真的會出現的寫法。加一條就要寫清楚為什麼。
const ALIASES = Object.freeze({
  // countries.json 的 en 值是 "United States",但沒有人這樣打字。
  US: ["usa", "u.s.", "u.s.a", "america", "american", "estados unidos", "amerika serikat"],
  // 繁中站的查詢會出現簡體寫法(反之亦然);countries.json 一個 locale 只有一個值。
  TW: ["台湾", "台灣", "taiwan", "taiwanese"],
  CN: ["中国", "中國", "china", "chinese", "tiongkok"],
  JP: ["日本", "japan", "japanese", "jepang", "nippon"],
  IN: ["印度", "india", "indian", "bharat", "भारत"],
  ID: ["印尼", "印度尼西亞", "印度尼西亚", "indonesia", "indonesian"],
  BR: ["巴西", "brazil", "brasil", "brazilian"],
});

/**
 * 建立「國名字串 → alpha-2」的比對表。
 * @param {string} dataDir  data/ 的路徑(要讀 meta/countries.json)
 * @returns {Array<[string, string]>} [正規化後的名稱, 國碼],**長的排前面**
 */
export function buildCountryMatchers(dataDir) {
  let meta = {};
  try {
    meta = JSON.parse(readFileSync(join(dataDir, "meta", "countries.json"), "utf8"));
  } catch {
    meta = {};
  }
  const pairs = [];
  for (const [code, names] of Object.entries(meta)) {
    for (const name of Object.values(names || {})) {
      if (typeof name === "string" && name.trim()) pairs.push([norm(name), code]);
    }
    for (const alias of ALIASES[code] || []) pairs.push([norm(alias), code]);
  }
  // 長名先比 —— 「印度尼西亞」必須贏過「印度」,否則 ID 的查詢會被判成 IN。
  // 同理 "indonesia" 要贏過 "india" 的子字串比對。
  return pairs.sort((a, b) => b[0].length - a[0].length);
}

/**
 * 查詢字串問的是哪一國。認不出來回 null（大多數查詢沒指名國家,那是正常的）。
 * @param {string} query
 * @param {Array<[string,string]>} matchers  buildCountryMatchers() 的結果
 */
export function demandCountryOf(query, matchers) {
  const q = norm(String(query || ""));
  if (!q) return null;
  for (const [name, code] of matchers) {
    if (q.includes(name)) return code;
  }
  return null;
}

// 採用門檻。低於這個量就不採用,退回本市場那一國(＝2026-08-21 的行為)。
// 立法理由:這是**會改變每個讀者看到什麼**的判斷,寧可少改也不要靠一兩次曝光就翻盤。
// 兩條都要過,不是二選一。
export const DEMAND_MIN_IMPRESSIONS = 5;   // 該國在該 (topic, locale) 累積的指名曝光
export const DEMAND_MIN_SHARE = 0.5;       // 且要佔該 (topic, locale) 全部指名曝光的多數
