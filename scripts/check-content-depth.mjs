#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// gate：內容厚度撐得起排名嗎。五條規則，全部來自 2026-08-19 的 GA/GSC 診斷。
// ═══════════════════════════════════════════════════════════════════════════
//
// 那次診斷的結論是「索引、部署、埋碼全正常，流量低是因為頁面本身太薄」，而每一項
// 缺陷從第一天就存在、既有六支 gate 全部綠燈放行。本檔補的就是那個缺口：
//
//   R1 國別覆蓋   標題寫「各地差異」就必須真的有多國。當時 30 個 active Topic
//                 有 18 個完全沒有國別敘述、11 個沒有日期；christmas 2 國、diwali/ramadan 各 1 國。
//   R2 唯一內容量 逐段去重後才算數。當時 zh-TW 中位數 137 字元，節日類只有 55–167。
//   R3 來源歸屬   逐國來源必須掛得住那個國家。當時 12 個常青主題把
//                 britannica.com ＋ nic.gov.in（印度戶政）掛在巴西／日本／美國婚俗下。
//   R4 內容形態   observances 與 regional_notes 不得同時為空（頁面會整片「目前沒有資料」）。
//   R5 排行榜厚度 items 太少的視窗不得進 sitemap，且名次必須從 1 起算。
//                 當時每個視窗只有 1 筆、名次印成 319，六視窗 × 七站 = 42 個空頁。
//
// ── 為什麼要 baseline ──────────────────────────────────────────────────────
// ERROR 門檻若直接套在存量上，今天所有部署都會紅——那是擋工作，不是擋錯誤
// （folk.tw check-source-refs ③ 的同一條教訓）。所以：
//   ・存量：以 content/content-depth-baseline.json 凍住，**只能變好不能變差**。
//   ・新 Topic：沒有 baseline 條目 → 直接套 ERROR 門檻，沒有豁免。
// 補完一批就跑 --update-baseline 把新水位鎖進去，退步立刻紅燈。
//
// ⚠️ baseline 只豁免 R1／R2（可量化、要時間補的）。R3／R4／R5 是事實錯誤與結構錯誤，
//    不給豁免——那些是改幾行程式就能修的，沒有「逐步補齊」的理由。
//
// 用法（裸執行＝完整正確的閘門行為，cron 就是這樣呼叫）：
//   node scripts/check-content-depth.mjs                  閘門；違規 exit 1
//   node scripts/check-content-depth.mjs --report         補資料清單（缺口排序，exit 0）
//   node scripts/check-content-depth.mjs --update-baseline 把現況鎖成新水位
//   node scripts/check-content-depth.mjs --strict         忽略 baseline，全部套 ERROR 門檻
//
// ⚠️ 失敗一律 process.exit(1)（本 repo 明列的坑：process.exitCode 會被後續程式覆寫）。

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COUNTRIES, LOCALES, THRESHOLDS, hostOf, countryOfHost, isGenericSource,
  uniqueContentChars, coveredCountries, coverageUnits,
} from './lib/content-depth.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const BASELINE_PATH = join(ROOT, 'content', 'content-depth-baseline.json');

const args = process.argv.slice(2);
const reportMode = args.includes('--report');
const updateBaseline = args.includes('--update-baseline');
const strict = args.includes('--strict');

const errors = [];
const notes = [];
const fail = (rule, msg) => errors.push(`[${rule}] ${msg}`);

// ── 讀資料 ────────────────────────────────────────────────────────────────
const topicsDir = join(DATA, 'topics');
if (!existsSync(topicsDir)) {
  console.error('✗ 找不到 data/topics/——先跑 node scripts/export-data.mjs');
  process.exit(1);
}
const bundles = [];
for (const entry of readdirSync(topicsDir)) {
  if (!entry.startsWith('top_')) continue;
  const dir = join(topicsDir, entry);
  const factsPath = join(dir, 'facts.json');
  const i18nPath = join(dir, 'i18n.json');
  if (!existsSync(factsPath) || !existsSync(i18nPath)) continue;
  const facts = JSON.parse(readFileSync(factsPath, 'utf8'));
  const i18n = JSON.parse(readFileSync(i18nPath, 'utf8'));
  bundles.push({ facts, i18n });
}

// 只驗「讀者真的看得到的頁面」：active、非機器 trend。
// merged/candidate 不出頁面，拿門檻去卡它們等於製造假紅燈。
const publicTopics = bundles.filter(({ facts }) =>
  facts.status === 'active' && !String(facts.slug || '').startsWith('trend-'));

if (publicTopics.length === 0) fail('R0', 'data/topics 裡沒有任何 active 非 trend Topic——export 可能壞了');

const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : { as_of: null, note: '', topics: {} };

// ── 量測 ──────────────────────────────────────────────────────────────────
const measured = publicTopics.map(({ facts, i18n }) => {
  const perLocale = Object.fromEntries(LOCALES.map((l) => [l, uniqueContentChars(facts, i18n, l)]));
  const minChars = Math.min(...Object.values(perLocale));
  const worstLocale = LOCALES.find((l) => perLocale[l] === minChars);
  const countries = coveredCountries(facts, i18n);
  return {
    slug: facts.slug, facts, i18n, perLocale, minChars, worstLocale,
    countries, countryCount: countries.length, units: coverageUnits(facts, i18n),
    observances: (facts.observances || []).length,
    regionalNotes: Object.keys(i18n.regional_notes || {}).length,
    // 真正該回報的是「讀者在自己國家那一格看到空白」的市場數,不是 regional_notes 的筆數。
    // regional_notes 只在該國**沒有** observance 時才會渲染(見 topic/[slug].astro 的
    // regionalOnlyNotes 過濾),所以七國都有 observance 的 Topic,regional_notes=0
    // 是正確狀態,不是缺陷。2026-08-20 就是把這兩件事混為一談,才誤判七個 Topic 太薄。
    blankMarkets: COUNTRIES.filter((cc) => !countries.includes(cc)),
  };
}).sort((a, b) => a.minChars - b.minChars);

// ── R1／R2：覆蓋與厚度（baseline 可豁免，但只能變好） ────────────────────
for (const t of measured) {
  const base = strict ? null : baseline.topics?.[t.slug];
  const unitFloor = base ? Math.max(base.units ?? base.countries ?? 0, 0) : THRESHOLDS.unitsError;
  const charFloor = base ? Math.max(base.min_chars, 0) : THRESHOLDS.uniqueCharsError;

  if (t.units < THRESHOLDS.unitsError && !base) {
    fail('R1', `${t.slug}：只有 ${t.units} 個地方變體（新 Topic 下限 ${THRESHOLDS.unitsError}）`);
  } else if (base && t.units < unitFloor) {
    fail('R1', `${t.slug}：地方變體從 ${unitFloor} 退步到 ${t.units}——baseline 只能升不能降`);
  }

  if (t.minChars < THRESHOLDS.uniqueCharsError && !base) {
    fail('R2', `${t.slug}：${t.worstLocale} 唯一內容僅 ${t.minChars} 字元（新 Topic 下限 ${THRESHOLDS.uniqueCharsError}）`);
  } else if (base && t.minChars < charFloor) {
    fail('R2', `${t.slug}：${t.worstLocale} 唯一內容從 ${charFloor} 退步到 ${t.minChars}——baseline 只能升不能降`);
  }
}

// ── R3：逐國來源必須掛得住那個國家（無 baseline 豁免） ───────────────────
for (const t of measured) {
  const rn = t.facts.regional_notes || [];
  const perCountrySets = [];
  for (const note of rn) {
    const cc = note.country_code;
    const urls = note.source_urls || [];
    perCountrySets.push(JSON.stringify([...urls].sort()));
    const hosts = urls.map(hostOf).filter(Boolean);
    // ① 不得掛到「明確屬於別國」的網域
    for (const h of hosts) {
      const owner = countryOfHost(h);
      if (owner && owner !== cc) {
        fail('R3', `${t.slug}/${cc}：來源 ${h} 是 ${owner} 的網域，掛在 ${cc} 的逐國筆記下`);
      }
    }
    // ② 每國至少要有一個掛得住該國的來源；全部是通用來源＝等於沒有在地佐證
    if (hosts.length && !hosts.some((h) => countryOfHost(h) === cc)) {
      fail('R3', `${t.slug}/${cc}：${hosts.length} 個來源沒有一個屬於 ${cc}（${hosts.join(', ')}）`);
    }
  }
  // ③ 七國來源集合完全相同＝湊數引用
  if (perCountrySets.length >= 3 && new Set(perCountrySets).size === 1) {
    fail('R3', `${t.slug}：${perCountrySets.length} 個國家掛的來源集合完全相同——逐國來源不能是同一份複製`);
  }
}

// ── R6：每個 observance 至少要有一個「該國網域」的來源 ───────────────────
// 立法緣由（2026-08-20，用戶當場指正）：補資料時只用英文搜尋日本、印度、印尼，
// 拿回來的日本來源是 japan.travel 的 /en/ 觀光英文頁，而不是內閣府或文化廳的日文一手資料。
// 英文查詢會系統性地把來源偏向「寫給外國人看的觀光介紹」——內容淺、不是法規權威。
// 這條擋的是結果：某一國的地方變體，必須至少有一個掛在**那個國家網域**的佐證。
// 查法上的對應要求（先用當地語言搜尋）寫在記憶 feedback-search-in-local-language。
// 存量豁免：改用當地語言重查每一筆要人工研究，一次全紅等於擋工作而不是擋錯誤
// （folk.tw check-source-refs ③ 的 grandfather 機制）。豁免名單記在 baseline 的
// r6_exempt，**只能縮不能長**：補好一筆就從名單移除，新增的一律沒有豁免。
// 實測踩到的坑：`japan.travel` 是 .travel 頂級網域，不是 .jp——JNTO 的對外行銷站，
// 不算日本政府網域。看起來像日本來源但不是，正是這條規則要抓的東西。
const r6Exempt = new Set(strict ? [] : (baseline.r6_exempt || []));
const r6Missing = [];
for (const t of measured) {
  for (const o of t.facts.observances || []) {
    const cc = o.country_code;
    const hosts = (o.source_urls || []).map(hostOf).filter(Boolean);
    if (hosts.length === 0) continue;   // 缺來源由 import-topics 擋，不在這裡重複報
    if (hosts.some((hst) => countryOfHost(hst) === cc)) continue;
    const id = `${t.slug}/${cc}/${o.observance_key}`;
    r6Missing.push(id);
    if (r6Exempt.has(id)) continue;
    fail('R6', `${id}：${hosts.length} 個來源沒有一個在 ${cc} 的網域`
      + `（${hosts.join(', ')}）——先用當地語言查該國官方網域，英文頁只能當補充`);
  }
}
if (r6Missing.length) {
  notes.push(`ℹ️ R6 待補（缺該國網域來源，存量豁免中）：${r6Missing.length} 筆`
    + `——${r6Missing.slice(0, 4).join('、')}${r6Missing.length > 4 ? ' …' : ''}`);
}
// R6 附帶警示（不擋）：只掛英文版路徑的來源。同一站通常有當地語言版，那一版才是一手。
for (const t of measured) {
  for (const o of t.facts.observances || []) {
    const enOnly = (o.source_urls || []).filter((u) => /\/en(\/|$)/i.test(u));
    if (enOnly.length && enOnly.length === (o.source_urls || []).length) {
      notes.push(`⚠️ ${t.slug}/${o.country_code}/${o.observance_key}：來源只有英文版路徑`
        + `（${enOnly.join(', ')}）——回頭找同一站的當地語言版`);
    }
  }
}

// ── R4：不得整頁沒有內容形態 ─────────────────────────────────────────────
for (const t of measured) {
  if (t.observances === 0 && t.regionalNotes === 0) {
    fail('R4', `${t.slug}：observances 與 regional_notes 都是空的——頁面三個主要區塊會全部顯示「目前沒有資料」`);
  }
}

// ── R5：排行榜厚度與名次起點 ─────────────────────────────────────────────
const rankDir = join(DATA, 'rankings', 'global');
const thinWindows = [];
if (existsSync(rankDir)) {
  for (const file of readdirSync(rankDir).filter((f) => f.endsWith('.json'))) {
    const win = file.replace(/\.json$/, '');
    const payload = JSON.parse(readFileSync(join(rankDir, file), 'utf8'));
    const items = payload.items || [];
    // 筆數少本身不是罪——那是 topic_scores 管線還沒上線的結果，不是內容缺陷。
    // 要擋的是「筆數少卻沒被標記」：沒有 thin 旗標，sitemap.xml.ts 就會照送，
    // check-seo.mjs 也會要求它 index，於是六個內容相同的空頁被推給 Google
    // （2026-08-19 實測已被判 Crawled / Discovered - currently not indexed）。
    const thin = items.length < THRESHOLDS.rankingItemsMin;
    if (thin && payload.thin !== true) {
      fail('R5', `rankings/${win}：只有 ${items.length} 筆（下限 ${THRESHOLDS.rankingItemsMin}）卻沒有 thin 旗標——` +
        `會被送進 sitemap 當索引候選。export-data.mjs 應標記 thin:true`);
    }
    if (!thin && payload.thin === true) {
      fail('R5', `rankings/${win}：有 ${items.length} 筆卻仍標著 thin:true——` +
        `資料變厚後必須自動恢復索引，旗標不得寫死`);
    }
    if (thin) thinWindows.push(win);
    const first = items[0]?.rank;
    if (items.length && first !== 1) {
      fail('R5', `rankings/${win}：名次從 ${first} 起算——` +
        `畫面會印出「${first}」這種對讀者無意義的全域名次，排序輸出必須重編為 1..n`);
    }
  }
} else {
  notes.push('（沒有 data/rankings/global/——R5 略過）');
}
if (thinWindows.length) {
  notes.push(`ℹ️ 排行榜 thin 視窗（已 noindex 並退出 sitemap，等分數管線上線自動恢復）：${thinWindows.join(', ')}`);
}

// ── --update-baseline ─────────────────────────────────────────────────────
if (updateBaseline) {
  const out = {
    as_of: new Date().toISOString().slice(0, 10),
    note: '存量內容厚度水位。只能升不能降；補完資料後重跑 --update-baseline 鎖住新水位。'
        + ' 目標值見 scripts/lib/content-depth.mjs 的 THRESHOLDS。',
    thresholds_target: { units: THRESHOLDS.unitsTarget, min_chars: THRESHOLDS.uniqueCharsTarget },
    r6_exempt: [...r6Missing].sort(),
    topics: {},
  };
  for (const t of [...measured].sort((a, b) => a.slug.localeCompare(b.slug))) {
    out.topics[t.slug] = { units: t.units, countries: t.countryCount, min_chars: t.minChars };
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`✓ baseline 已更新：${Object.keys(out.topics).length} 個 Topic → ${BASELINE_PATH}`);
  process.exit(0);
}

// ── --report：補資料清單 ─────────────────────────────────────────────────
if (reportMode) {
  const gap = (t) => Math.max(0, THRESHOLDS.uniqueCharsTarget - t.minChars)
                   + Math.max(0, THRESHOLDS.unitsTarget - t.units) * 200;
  const ranked = [...measured].sort((a, b) => gap(b) - gap(a));
  console.log('# 補資料清單（缺口大的排前面；目標 = '
    + `${THRESHOLDS.uniqueCharsTarget} 唯一字元／${THRESHOLDS.unitsTarget} 個地方變體）\n`);
  console.log('缺口  變體 國家 obs note  最薄語系  唯一字元  slug');
  console.log('----  ---- ---- --- ----  --------  --------  ----');
  for (const t of ranked) {
    const flag = gap(t) === 0 ? ' ok ' : String(gap(t)).padStart(4);
    console.log(`${flag}  ${String(t.units).padStart(4)} ${String(t.countryCount).padStart(4)} ${String(t.observances).padStart(3)} `
      + `${String(t.regionalNotes).padStart(4)}  ${t.worstLocale.padEnd(8)}  `
      + `${String(t.minChars).padStart(8)}  ${t.slug}`);
  }
  const need = ranked.filter((t) => gap(t) > 0);
  console.log(`\n未達目標：${need.length} / ${ranked.length} 個 Topic`);
  console.log(`少於 ${THRESHOLDS.unitsError} 個變體：${ranked.filter((t) => t.units < THRESHOLDS.unitsError).length}`
    + `　少於 ${THRESHOLDS.unitsTarget} 個變體：${ranked.filter((t) => t.units < THRESHOLDS.unitsTarget).length}`
    + `　有市場看到空白格：${ranked.filter((t) => t.blankMarkets.length > 0).length}`);
  // 空白格 = 那個站的讀者打開這一頁,自己國家那一欄什麼都沒有。這是唯一該追的國別缺口。
  const blank = ranked.filter((t) => t.blankMarkets.length > 0);
  if (blank.length > 0) {
    console.log('\n讀者看到空白格的 Topic（站台市場 → 缺的國家）：');
    for (const t of blank) console.log(`  ${t.slug.padEnd(34)} ${t.blankMarkets.join(', ')}`);
  }
  process.exit(0);
}

// ── 閘門輸出 ──────────────────────────────────────────────────────────────
for (const n of notes) console.log(n);
if (errors.length) {
  console.error(`✗ 內容厚度守門未通過（${errors.length} 項）：`);
  for (const e of errors) console.error(`  ${e}`);
  console.error('\n看缺口排序：node scripts/check-content-depth.mjs --report');
  process.exit(1);
}
console.log(`✓ 內容厚度守門通過：${measured.length} 個公開 Topic`
  + `（最薄 ${measured[0]?.minChars} 字元／${measured[0]?.slug}）`);
process.exit(0);
