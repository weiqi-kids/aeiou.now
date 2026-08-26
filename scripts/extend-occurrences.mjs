#!/usr/bin/env node
// ===========================================================================
// aeiou.now — 把 content/observance-occurrences.json 延伸到下一個年度(2026-08-26 新增)
// ===========================================================================
//
// 用法(裸執行＝完整正確行為:算出「還缺的那一年」並寫回檔案):
//   node scripts/extend-occurrences.mjs
//   node scripts/extend-occurrences.mjs --year 2029   指定年份
//   node scripts/extend-occurrences.mjs --dry-run     只印,不寫檔
//
// -- 為什麼需要這一支 ------------------------------------------------------
// `import-topic-occurrences.mjs` 的閘門要求 currentYear 與 currentYear+1 都齊,
// 而它在 hourly-export.sh 裡是 **fail-closed**。所以每年一月一日,如果沒有補上
// 新的那一年,整條 hourly 管線會停:資料不再匯出、data/ 不再 commit、CI 不再推站。
// 2026-08-26 把系統年份假裝成 2027 實跑過一次,確認會停,缺 161 筆。
//
// -- 這一支**不猜日期** ----------------------------------------------------
// 它只做兩件事:① 把「規則本來就決定了的」日期算出來,② 把「規則決定不了的」列出來給人查。
// 實測過的反例:Node 內建 ICU 的 `en-u-ca-chinese` 把 2027 年春節算成 2027-02-07,
// 正確是 2027-02-06(香港天文台曆書與本庫既有 confirmed 資料都是 02-06)——
// **差一天**。所以農曆一律讀香港天文台的公曆農曆對照表,不用 ICU 換算。
//
// -- 各曆法怎麼來 ----------------------------------------------------------
//   gregorian(固定 MM-DD)  兩年同月同日 → 直接沿用
//   gregorian(星期規則)     兩年都是「第 N 個星期 W」→ 沿用該規則;對不上就交給人
//   chinese-lunisolar      香港天文台對照表,依既有兩年反推(閏月, 月, 日)後查該年
//   solar-term             同上,查節氣名(清明/立春…)
//   islamic                **不算**。開齋節與宰牲節由各國看月亮後公告,不是曆算問題
//   hindu-lunisolar        **不算**。Panchang 不在任何內建曆法裡
//   local                  不是正式曆法,實務上全是星期規則或固定日 → 走 gregorian 那條
//
// -- 來源怎麼帶 ------------------------------------------------------------
// 既有兩年**共用同一組 source_urls** 的,代表那是規則型來源(法規、常設說明頁),
// 可以延用到新年度。兩年來源不同的是年度公告型(例:CEEC 每年一份學測日期 PDF),
// **不延用**,直接列進「要人查」那一區。2026-08-26 實查:136 組共用、25 組逐年不同。
// 農曆與節氣改帶當年度的天文台對照表網址(那本來就是既有資料在用的來源)。
//
// -- date_status -----------------------------------------------------------
// 兩年狀態一致才沿用,否則一律 estimated。寧可標估算,不要把算出來的東西講成確認。
//
// 產出後必須跑 `node scripts/import-topic-occurrences.mjs` 驗證(它會擋下缺漏)。

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, log } from "./lib/aeiou-lib.mjs";

const INPUT = join(ROOT, "content", "observance-occurrences.json");
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const yearArg = (() => {
  const i = argv.indexOf("--year");
  const n = i >= 0 ? Number(argv[i + 1]) : NaN;
  return Number.isInteger(n) && n >= 2000 && n <= 2200 ? n : null;
})();

// 香港天文台「公曆與農曆日期對照表」。**繁體中文版**(當地語言,不是英文版),
// 純文字、機讀,含節氣欄。這是既有農曆資料本來就在引用的來源。
const HKO_URL = (year) => `https://www.hko.gov.hk/tc/gts/time/calendar/text/files/T${year}c.txt`;
const UA = "aeiou.now/1.0 (+https://aeiou.now; occurrence calendar builder)";

const LUNAR_DAY = {
  初一: 1, 初二: 2, 初三: 3, 初四: 4, 初五: 5, 初六: 6, 初七: 7, 初八: 8, 初九: 9, 初十: 10,
  十一: 11, 十二: 12, 十三: 13, 十四: 14, 十五: 15, 十六: 16, 十七: 17, 十八: 18, 十九: 19, 二十: 20,
  廿一: 21, 廿二: 22, 廿三: 23, 廿四: 24, 廿五: 25, 廿六: 26, 廿七: 27, 廿八: 28, 廿九: 29, 三十: 30,
};
const LUNAR_MONTH = { 正: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };
const MONTH_ONLY = /^(閏?)(正|十一|十二|[二三四五六七八九十])月$/;
const ROW_RE = /^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\S+)\s+星期.\s*(\S*)/;

/** 抓一年的天文台對照表,回 { lunar: Map("leap|month|day" -> YYYY-MM-DD), terms: Map(節氣 -> YYYY-MM-DD) } */
async function fetchTable(year) {
  const res = await fetch(HKO_URL(year), { headers: { "user-agent": UA }, redirect: "follow" });
  if (!res.ok) throw new Error(`香港天文台 ${year} 對照表取不到:HTTP ${res.status}`);
  return res.text();
}

async function hkoTable(year, cache) {
  if (cache.has(year)) return cache.get(year);
  // **要連前一年一起讀**:一月初的那些農曆日子,它們的「月首」那一行在前一年的檔案裡
  // (例:2028-01-25 是十二月廿九,而那個十二月從 2027-12-27 開始)。只讀當年度會讓
  // 一月整段對不出月份 —— 2026-08-26 就是這樣讓 CN 除夕與兩筆年終獎金掉進「要人查」。
  const text = `${await fetchTable(year - 1)}\n${await fetchTable(year)}`;
  const lunar = new Map();
  const terms = new Map();
  let month = null;
  let leap = false;
  for (const line of text.split(/\r?\n/)) {
    const m = ROW_RE.exec(line);
    if (!m) continue;
    const gregorian = `${m[1]}-${String(m[2]).padStart(2, "0")}-${String(m[3]).padStart(2, "0")}`;
    const inYear = Number(m[1]) === year; // 前一年只用來把月份接起來,不進結果
    const mm = MONTH_ONLY.exec(m[4]);
    let day = null;
    if (mm) {
      leap = mm[1] === "閏";
      month = LUNAR_MONTH[mm[2]];
      day = 1; // 月首那一行只印月名,不印「初一」
    } else {
      day = LUNAR_DAY[m[4]] ?? null;
    }
    if (month && day && inYear) {
      // 同一個 (閏,月,日) 在一個**公曆年**裡可能出現兩次:農曆十二月在一月與十二月各出現一段。
      // 只留第一次會讓 CN 春節(除夕 = 十二月三十)對到年初那一次,差了一整個農曆年。
      const key = `${leap ? 1 : 0}|${month}|${day}`;
      if (!lunar.has(key)) lunar.set(key, []);
      lunar.get(key).push(gregorian);
    }
    if (inYear && m[5] && !terms.has(m[5])) terms.set(m[5], gregorian);
  }
  if (lunar.size === 0 || terms.size < 20) {
    throw new Error(`香港天文台 ${year} 對照表解析結果不合理(農曆 ${lunar.size} 格、節氣 ${terms.size} 個)`);
  }
  const out = { lunar, terms };
  cache.set(year, out);
  return out;
}

/** 這一天是當月第幾個星期幾;負數代表倒數第幾個(例:-1 = 最後一個)。 */
function weekdayOrdinal(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = date.getUTCDay();
  const nth = Math.floor((d - 1) / 7) + 1;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const fromEnd = Math.floor((daysInMonth - d) / 7) + 1;
  return { month: m, dow, nth, fromEnd };
}

function nthWeekdayDate(year, month, dow, nth, fromEnd) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const hits = [];
  for (let d = 1; d <= daysInMonth; d += 1) {
    if (new Date(Date.UTC(year, month - 1, d)).getUTCDay() === dow) hits.push(d);
  }
  const day = fromEnd ? hits[hits.length - fromEnd] : hits[nth - 1];
  return day ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
}

/** 復活節(西方教會,Gregorian computus)。Easter 系列在資料裡有五筆。 */
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const shiftDays = (iso, n) => {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
};
const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

const input = JSON.parse(readFileSync(INPUT, "utf8"));
const rows = Array.isArray(input.occurrences) ? input.occurrences : [];
const groups = new Map();
for (const row of rows) {
  const key = `${row.topic_slug} ${row.country_code} ${row.observance_key}`;
  if (!groups.has(key)) groups.set(key, new Map());
  groups.get(key).set(row.occurrence_year, row);
}
const allYears = [...new Set(rows.map((r) => r.occurrence_year))].sort();
const targetYear = yearArg ?? allYears[allYears.length - 1] + 1;
const baseYears = allYears.filter((y) => y < targetYear).slice(-2);
if (baseYears.length < 2) {
  console.error(`需要兩個既有年度當基準,目前只有 ${allYears.join(", ")}`);
  process.exit(2);
}
const [yA, yB] = baseYears;
log(`[extend-occurrences] 目標 ${targetYear} 年,基準 ${yA}/${yB},共 ${groups.size} 組 observance`);

const cache = new Map();
const generated = [];
const manual = [];
const reasonCount = new Map();
const bump = (r) => reasonCount.set(r, (reasonCount.get(r) || 0) + 1);

for (const [key, byYear] of groups) {
  const a = byYear.get(yA);
  const b = byYear.get(yB);
  const label = key.replaceAll(" ", "/");
  if (byYear.has(targetYear)) { bump("已經有了"); continue; }
  if (!a || !b) { manual.push({ label, why: `缺 ${yA}/${yB} 基準列` }); bump("缺基準"); continue; }

  const sameSource = JSON.stringify([...a.source_urls].sort()) === JSON.stringify([...b.source_urls].sort());
  const status = a.date_status === b.date_status ? a.date_status : "estimated";
  const span = a.ends_on ? dayDiff(a.ends_on, a.starts_on) : null;
  const emit = (starts, sourceUrls, forcedStatus) => {
    generated.push({
      topic_slug: a.topic_slug,
      country_code: a.country_code,
      observance_key: a.observance_key,
      occurrence_year: targetYear,
      starts_on: starts,
      ...(span === null ? {} : { ends_on: shiftDays(starts, span) }),
      calendar_system: a.calendar_system,
      timezone: a.timezone,
      date_status: forcedStatus ?? status,
      source_urls: sourceUrls,
    });
  };

  if (a.calendar_system === "chinese-lunisolar" || a.calendar_system === "solar-term") {
    // 農曆與節氣都讀天文台當年度的對照表;來源也換成那一年的網址(既有資料就是這樣引的)。
    let tA; let tT;
    try {
      tA = await hkoTable(yA, cache);
      tT = await hkoTable(targetYear, cache);
    } catch (e) {
      manual.push({ label, why: `天文台對照表取不到:${e.message}` });
      bump("天文台取不到");
      continue;
    }
    if (a.calendar_system === "solar-term") {
      // 有些日子不是節氣本身,而是「某個節氣前後固定幾天」(日本的節分 = 立春前一日)。
      // 位移必須在兩個基準年一致,否則就不是規則。
      let best = null;
      for (const [term, isoA] of tA.terms) {
        const off = dayDiff(a.starts_on, isoA);
        if (Math.abs(off) > 3) continue;
        const isoB = (await hkoTable(yB, cache)).terms.get(term);
        if (!isoB || dayDiff(b.starts_on, isoB) !== off) continue;
        const isoT = tT.terms.get(term);
        if (isoT) { best = shiftDays(isoT, off); break; }
      }
      if (!best) { manual.push({ label, why: "對不出是哪一個節氣" }); bump("節氣對不出"); continue; }
      emit(best, [HKO_URL(targetYear)]);
      bump("節氣");
      continue;
    }
    let cell = null;
    let nth = 0;
    for (const [key, list] of tA.lunar) {
      const i = list.indexOf(a.starts_on);
      if (i >= 0) { cell = key; nth = i; break; }
    }
    const list = cell ? tT.lunar.get(cell) : null;
    const hit = list ? (list[nth] ?? list[list.length - 1]) : null;
    if (!hit) { manual.push({ label, why: "對不出是農曆哪一天" }); bump("農曆對不出"); continue; }
    emit(hit, [HKO_URL(targetYear)]);
    bump("農曆");
    continue;
  }

  if (a.calendar_system !== "gregorian" && a.calendar_system !== "local") {
    // islamic / hindu-lunisolar:規則決定不了,必須查公告。
    // ⚠ islamic **刻意不算**:Node 內建的 `islamic-umalqura` 對得上一半、差一天的也有一半
    //   (2026-08-26 實測:Ramadan 2026 算 02-18、庫裡是 02-19;Eid al-Adha 2027 算 05-16、
    //    庫裡是 05-17)。開齋節與宰牲節本來就由各國看月亮後公告,不是曆算問題 ——
    //   這與農曆不用 ICU 是同一條判準:算得出來不等於算得對。
    manual.push({ label, why: `${a.calendar_system}:要查該國公告` });
    bump(a.calendar_system);
    continue;
  }
  // local:不是正式曆法,但實務上幾乎都是「第 N 個星期幾」或固定日 —— 往下走同一條推導。
  if (!sameSource) {
    manual.push({ label, why: `來源逐年不同(年度公告型),${targetYear} 要重新查` });
    bump("年度公告型");
    continue;
  }
  if (a.starts_on.slice(5) === b.starts_on.slice(5)) {
    emit(`${targetYear}-${a.starts_on.slice(5)}`, a.source_urls);
    bump("公曆固定日");
    continue;
  }
  // 復活節系列:與當年復活節的固定天數位移(受難日 -2、升天日 +39…)。
  const offA = dayDiff(a.starts_on, easterSunday(yA));
  const offB = dayDiff(b.starts_on, easterSunday(yB));
  if (offA === offB && Math.abs(offA) <= 60) {
    emit(shiftDays(easterSunday(targetYear), offA), a.source_urls);
    bump("復活節位移");
    continue;
  }
  const wA = weekdayOrdinal(a.starts_on);
  const wB = weekdayOrdinal(b.starts_on);
  if (wA.month === wB.month && wA.dow === wB.dow && wA.nth === wB.nth) {
    const hit = nthWeekdayDate(targetYear, wA.month, wA.dow, wA.nth, null);
    if (hit) { emit(hit, a.source_urls); bump("第 N 個星期幾"); continue; }
  }
  if (wA.month === wB.month && wA.dow === wB.dow && wA.fromEnd === wB.fromEnd) {
    const hit = nthWeekdayDate(targetYear, wA.month, wA.dow, null, wA.fromEnd);
    if (hit) { emit(hit, a.source_urls); bump("倒數第 N 個星期幾"); continue; }
  }
  manual.push({ label, why: `公曆但日期會動且對不出規則(${a.starts_on} → ${b.starts_on})` });
  bump("公曆規則對不出");
}

log(`[extend-occurrences] 算得出來 ${generated.length} 筆、要人查 ${manual.length} 筆`);
for (const [reason, n] of [...reasonCount].sort((x, y) => y[1] - x[1])) {
  log(`  ${String(n).padStart(3)}  ${reason}`);
}
if (manual.length > 0) {
  log(`[extend-occurrences] ── ${targetYear} 年還缺、必須人工查官方公告的 ──`);
  for (const m of manual) log(`  ${m.label}：${m.why}`);
}

if (DRY_RUN) {
  log("[extend-occurrences] --dry-run:不寫檔");
  process.exit(manual.length > 0 ? 1 : 0);
}
if (generated.length === 0) {
  log("[extend-occurrences] 沒有新增任何一筆,不動檔案");
  process.exit(manual.length > 0 ? 1 : 0);
}
input.occurrences = [...rows, ...generated];
// coverage_through 只在「這一年真的全齊」時才推進 —— 它是對外的承諾,不是進度條。
if (manual.length === 0) input.coverage_through = `${targetYear}-12-31`;
writeFileSync(INPUT, `${JSON.stringify(input, null, 1)}\n`, "utf8");
log(`[extend-occurrences] 已寫回 ${INPUT}:+${generated.length} 筆`
  + (manual.length === 0 ? `,coverage_through → ${targetYear}-12-31` : ",coverage_through 不動(還有缺口)"));
process.exit(manual.length > 0 ? 1 : 0);
