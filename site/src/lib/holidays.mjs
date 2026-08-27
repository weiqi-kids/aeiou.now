// 國家×年份假日總表的判準(2026-08-27 用戶核准;設計提案見 docs/briefs/holidays-index.md)。
//
// 放在 lib 而不是頁面檔裡,理由同 country-cells.mjs:Astro 把 `getStaticPaths` 抽成獨立的
// chunk 執行,同一個 .astro 檔前面宣告的函式在那裡**取不到**。頁面本體與 getStaticPaths
// 都得從這裡 import,判準才只有一份(否則 sitemap 會指向 404,或產出頁面卻沒被列出)。
//
// 🔴 資料來源是 data/holidays/<CC>.json —— 由 content/national-holiday-calendars.json 匯出,
//    **不是從 Topic 反推**。Topic 覆蓋不等於一國的法定假日清單;一份漏掉國慶日的假日表
//    比沒有這一頁更糟。Topic 只在日期對得上時掛回去當加值連結。
import { readJson, listTopicIds, getTopicBundle } from './data.mjs';
import { LOCALE } from './config.mjs';

export const YEARS = ['2026', '2027', '2028'];

// 薄頁不產出。**判準是內容量,不是列數** —— 與 country-cells.mjs 同一個做法,理由也一樣:
// `check-rendered-depth` 的 D2 下限是 320 個唯一字元,而一頁的字數取決於「幾列 × 名稱多長」,
// 名稱長度又逐語系不同。實測:美國只有 11 個聯邦假日,在 en 站撐得起來,
// 在 zh-TW 站只有 266 字元(「元旦」「勞動節」這種兩三個字的名稱)—— 同一個國家同一年,
// 七個站有的過得了有的過不了。用列數當門檻會把這件事看漏。
//
// 撐不起來的格子**根本不產出**,不是產出了再讓守門擋(後者會讓整個 build 掛掉)。
export const MIN_HOLIDAY_ROWS = 8;      // 資料完整性的下限:少於這個幾乎一定是沒抄完
// 門檻是**校準**出來的,不是猜的:守門實測 US/zh-TW 那一頁是 266 個唯一字元,
// 而本估計式對同一格給 193 —— 估計式系統性低估約 28%(它不算日期字串、狀態標籤與樣板)。
// 所以要清守門的 320,估計值大約要 >= 232。取 260 留餘裕。
// ⚠ 改動估計式或頁面版面(增減欄位)都會讓這個比值失效,要重新校準,不要只調數字。
export const MIN_HOLIDAY_TEXT = 260;

/** 這一格會出現在頁面上的文字量(去空白後的字元數,逐語系)。 */
export function holidayTextLength(code, year, locale) {
  const rows = holidaysFor(code, year);
  const undated = undatedFor(code, year);
  const parts = [
    ...rows.map((r) => r.name?.[locale] || ''),
    ...undated.map((r) => r.name?.[locale] || ''),
    // 每一列還會印日期、狀態標籤與可能的旗標;這些是重複的樣板字,
    // D2 算的是**唯一**內容,所以不能按列數乘 —— 只計一次。
  ];
  const perRowChrome = 12; // 日期字串(逐列不同,算唯一內容)
  return parts.join('').replace(/\s+/g, '').length + (rows.length * perRowChrome);
}

export function holidayCountries() {
  const idx = readJson('holidays/index.json', null);
  return Array.isArray(idx?.countries) ? idx.countries : [];
}

/** 某一國的假日制度說明(七語)。沒有就回 null,頁面自己少一節。 */
export function holidaySystemNote(code) {
  const all = readJson('holidays/notes.json', null);
  return all?.[String(code).toUpperCase()] || null;
}

export function holidayCalendar(code) {
  return readJson(`holidays/${String(code).toUpperCase()}.json`, null);
}

/** 某一國某一年的假日列,已排序。年份一律以 **year key** 取,不是日期字串裡的年份 —— */
/*  美國 2028 的元旦順延到 2027-12-31,依字串切會讓 2028 少一天、2027 多一天。 */
export function holidaysFor(code, year) {
  const cal = holidayCalendar(code);
  if (!cal || !Array.isArray(cal.holidays)) return [];
  return cal.holidays
    .filter((h) => h?.dates?.[year] != null)  // null = 那一年沒有這一天(振替休日/橋接日/cuti bersama)
    .map((h) => ({
      key: h.key,
      name: h.name || {},
      status: h.status,
      starts_on: h.dates[year],
      ends_on: h.ends_on?.[year] ?? null,
      date_status: h.date_status?.[year] || 'confirmed',
      source_urls: h.source_urls || [],
      makeup_workdays: h.makeup_workdays?.[year] || null,
      nationwide: h.nationwide ?? null,
      partial_day: h.partial_day ?? null,
    }))
    .sort((a, b) => (a.starts_on < b.starts_on ? -1 : a.starts_on > b.starts_on ? 1 : 0));
}

/** 沒有單一日期、但確實存在的假日(台灣的原住民族歲時祭儀)。表格放不下,另立一節。 */
export function undatedFor(code, year) {
  const cal = holidayCalendar(code);
  if (!cal || !Array.isArray(cal.holidays)) return [];
  return cal.holidays
    .filter((h) => h?.dates?.[year] == null && h?.date_status?.[year] === 'local-variant')
    .map((h) => ({ key: h.key, name: h.name || {}, status: h.status, source_urls: h.source_urls || [] }));
}

/** (國, 年) 這一格撐不撐得起一頁。getStaticPaths 與 sitemap 共用這一支。 */
export function holidayCellsFor(code) {
  return YEARS.filter((y) => holidaysFor(code, y).length >= MIN_HOLIDAY_ROWS
    && holidayTextLength(code, y, LOCALE) >= MIN_HOLIDAY_TEXT);
}

/**
 * 日期 → Topic 的對照(只在日期真的對得上時才掛連結)。
 * 走 facts.json 的 observances[].occurrences,與逐國頁吃的是同一份資料。
 */
export function topicsByDate(code, year) {
  const cc = String(code).toUpperCase();
  const out = new Map();
  for (const topicId of listTopicIds()) {
    const bundle = getTopicBundle(topicId);
    const facts = bundle?.facts;
    if (!facts?.slug) continue;
    const title = bundle?.i18n?.locales?.[LOCALE]?.title || facts.canonical_name || facts.slug;
    for (const obs of facts.observances || []) {
      if (obs.country_code !== cc) continue;
      for (const occ of obs.occurrences || []) {
        if (!occ?.starts_on || !occ.starts_on.startsWith(year)) continue;
        if (!out.has(occ.starts_on)) out.set(occ.starts_on, { slug: facts.slug, title });
      }
    }
  }
  return out;
}
