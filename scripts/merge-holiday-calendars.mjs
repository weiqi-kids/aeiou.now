#!/usr/bin/env node
// merge-holiday-calendars.mjs — 把逐國片段併成 content/national-holiday-calendars.json
//
// 為什麼有這份資料(2026-08-27,用戶核准;設計提案見 docs/briefs/holidays-index.md):
//   `/holidays/<國碼>/<年>/` 這個頁型要回答「某一國某一年,哪幾天不上班」。
//   🔴 **不能從站上的 Topic 反推** —— Topic 覆蓋不等於一國的法定假日清單
//      (巴西 2027 就算 13 個新 Topic 全上線,仍會缺 Independência、Aparecida)。
//      一份漏掉國慶日的「假日清單」比沒有這一頁更糟。
//   所以這是**獨立的權威資料**:七國各一份年度公告,Topic 只是掛進去加值。
//
// 用法:node scripts/merge-holiday-calendars.mjs <stageDir>
//   讀 <stageDir>/holidays-<CC>.json,驗證後併入 content/national-holiday-calendars.json。
//   冪等:同一國重跑會整份替換該國。
import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'content', 'national-holiday-calendars.json');
const LOCALES = ['zh-TW', 'en', 'ja', 'zh-CN', 'hi', 'id', 'pt-BR'];
const COUNTRIES = ['TW', 'US', 'JP', 'CN', 'IN', 'ID', 'BR'];
const STATUS = new Set(['statutory', 'discretionary', 'commemorative']);
const DSTATUS = new Set(['confirmed', 'estimated', 'local-variant']);
const YEARS = ['2026', '2027', '2028'];

const stageDir = process.argv[2];
if (!stageDir) { console.error('用法:merge-holiday-calendars.mjs <stageDir>'); process.exit(2); }

const doc = existsSync(OUT)
  ? JSON.parse(readFileSync(OUT, 'utf8'))
  : { version: 1, as_of: null, note: '國家×年份的法定假日母表。逐國權威公告抄錄,不從 Topic 反推。', countries: {} };

const errs = [];
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

let merged = 0;
for (const file of readdirSync(stageDir).filter((f) => /^holidays-[A-Z]{2}\.json$/.test(f)).sort()) {
  const cc = file.slice(9, 11);
  const frag = JSON.parse(readFileSync(join(stageDir, file), 'utf8'));
  const at = (i, k) => `${cc}.holidays[${i}].${k}`;
  if (frag.country_code !== cc) errs.push(`${cc}: country_code 不一致(${frag.country_code})`);
  if (!Array.isArray(frag.holidays) || !frag.holidays.length) { errs.push(`${cc}: holidays 必須是非空陣列`); continue; }
  const keys = new Set();
  for (const [i, h] of frag.holidays.entries()) {
    if (!/^[a-z0-9-]+$/.test(h.key || '')) errs.push(`${at(i, 'key')}: 只准 a-z0-9-(${h.key})`);
    if (keys.has(h.key)) errs.push(`${at(i, 'key')}: 重複 ${h.key}`); else keys.add(h.key);
    for (const l of LOCALES) if (!h.name?.[l]?.trim()) errs.push(`${at(i, 'name')}: 缺 ${l}`);
    if (!STATUS.has(h.status)) errs.push(`${at(i, 'status')}: 無效(${h.status})`);
    if (!Array.isArray(h.source_urls) || !h.source_urls.length) errs.push(`${at(i, 'source_urls')}: 必填`);
    // 半天假(2026-08-27 補):巴西的聖灰星期三「到下午兩點」、聖誕夜「下午一點後」,
    // 中國的婦女節/青年節「放假半天」。少了這一格,頁面會把半天講成整天 —— 那是誇大,不是簡化。
    // 格式 `until-HHMM` / `from-HHMM`,渲染時由 i18n 模板轉成該語言的說法。
    if (h.partial_day != null && !/^(until|from)-\d{4}$/.test(h.partial_day)) {
      errs.push(`${at(i, 'partial_day')}: 只准 until-HHMM 或 from-HHMM(${h.partial_day})`);
    }
    // `dates[y] === null` 是**合法**的:代表那一年沒有這一天。
    // 日本的振替休日只在祝日逢星期日時成立(2028 一天都沒有)、巴西的 ponto facultativo
    // 橋接日逐年才決定、印尼的 cuti bersama 未發布年度不列 —— 硬要每年都有值反而會逼出捏造。
    const years = Object.keys(h.dates || {}).filter((y) => h.dates[y] != null);
    // 全年無日期**只有一種情況合法**:那個假日本來就沒有單一日期。
    // 實例:台灣的原住民族歲時祭儀 —— 由原民會逐族公告日期區間,具原住民身分者自行擇定三日。
    // 它是真實的制度事實(放假三天),不該因為放不進日期排序的表格就被丟掉;
    // 頁面會把它列在表格下方的「無固定日期」一節。判準是 date_status 全部標 local-variant。
    const allLocalVariant = Object.values(h.date_status || {}).length > 0
      && Object.values(h.date_status || {}).every((v) => v === 'local-variant');
    if (!years.length && !allLocalVariant) errs.push(`${at(i, 'dates')}: 至少要有一年有日期(除非 date_status 全為 local-variant)`);
    for (const y of Object.keys(h.dates || {})) {
      if (!YEARS.includes(y)) errs.push(`${at(i, 'dates')}: 年份 ${y} 不在 ${YEARS.join('/')}`);
    }
    for (const y of years) {
      if (!isDate(h.dates[y])) errs.push(`${at(i, 'dates')}.${y}: 日期格式錯(${h.dates[y]})`);
      const ds = h.date_status?.[y];
      if (!DSTATUS.has(ds)) errs.push(`${at(i, 'date_status')}.${y}: 無效(${ds})`);
      const end = h.ends_on?.[y];
      if (end != null && (!isDate(end) || end < h.dates[y])) errs.push(`${at(i, 'ends_on')}.${y}: 無效或早於起日`);
    }
  }
  doc.countries[cc] = frag;
  merged += 1;
  console.log(`  ${cc}: ${frag.holidays.length} 筆 ` +
    YEARS.map((y) => `${y}=${frag.holidays.filter((h) => h.dates?.[y] != null).length}`).join(' '));
}

if (errs.length) { console.error(`\n驗證失敗:\n  - ${errs.join('\n  - ')}`); process.exit(1); }
if (!merged) { console.error(`${stageDir} 裡沒有 holidays-<CC>.json`); process.exit(1); }

const missing = COUNTRIES.filter((c) => !doc.countries[c]);
doc.as_of = new Date().toISOString().slice(0, 10);
const tmp = `${OUT}.tmp`;
writeFileSync(tmp, `${JSON.stringify(doc, null, 1)}\n`);
renameSync(tmp, OUT);
console.log(`\n✓ 併入 ${merged} 國 → ${OUT}`);
if (missing.length) console.log(`⚠ 還缺:${missing.join(', ')}(頁型只會產出有資料的國家)`);
