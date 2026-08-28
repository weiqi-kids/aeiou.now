#!/usr/bin/env node
// 在地資料收件器:把各市場的片段檔驗過、合併進 content/local-sample-data.json,
// 並替新來源產生 content/local-data-sources.json 的目錄項(markers / date_markers)。
//
// ── 為什麼需要這支(2026-08-28)──────────────────────────────────────────────
// 補在地資料是「派 subagent 逐市場收集 → 主對話收件」的流程,而收件那一半有六個坑,
// 每一個都是實際踩過、而且都會讓**每小時的 hourly-export 整條停擺**:
//
//  ① `topic_slugs` 必須是 **active** 的 slug。有七個舊 slug 還留著 .md 檔但狀態是 merged
//     (national-belonging→national-days 等),只查檔案存在會漏掉,匯入器才會擋。
//  ② 每個來源都要有 `local-data-sources.json` 的目錄項,否則 update-local-data 直接失敗。
//  ③ 目錄項的 `markers` 必須是**那一頁真的有的字串**。憑空填 = 每小時核對必失敗 = 全站停更。
//     本支一律抓頁面反推(順便當第二道查證);抓不到就報出來,不硬填。
//  ④ 名稱與頁面語言常常不同(上海的資料存中文名、頁面是 english.shanghai.gov.cn),
//     所以候選要包含各語系描述裡的專名與頁面自己的 <title>。
//  ⑤ 編碼:日本不少神社寺院是 Shift_JIS。只試 utf-8 → big5 會「成功」解出亂碼,
//     於是寫進一個永遠比不到的 marker。要照 meta charset 決定。
//     ⚠ 而且 update-local-data 自己是按 UTF-8 讀的 —— Shift_JIS 頁**永遠核對不了**,
//     那種來源不能用(2026-08-28 因此捨棄湯島天満宮那一筆)。
//  ⑥ 同一個網址不能同時當地點與活動的來源:managed_place/event_source_urls 兩份清單
//     都嚴格驗 catalogue 的 `kind`,撞到就整支失敗。
//
// ── 用法 ────────────────────────────────────────────────────────────────
//   node scripts/local-data-intake.mjs --dir <片段目錄>            # 驗 + 合併 + 產目錄
//   node scripts/local-data-intake.mjs --dir <片段目錄> --check    # 只驗不寫檔
// 片段檔名 `local-<city_code>.json`,內容 `{ "places": [...], "events": [...] }`,
// 形狀與 content/local-sample-data.json 的兩個陣列完全一致。
//
// 合併完**一定要接著跑**(這支不會替你跑,因為它們會動 SQLite 與外部網路):
//   node scripts/update-local-data.mjs      ← 逐頁核對 markers,這關過了才算數
//   node scripts/export-data.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE = join(ROOT, 'content', 'local-sample-data.json');
const CATALOG = join(ROOT, 'content', 'local-data-sources.json');
const MERGES = join(ROOT, 'content', 'topic-merges.json');
const DB = join(ROOT, 'db', 'aeiou.sqlite');
const LOCALES = ['zh-TW', 'en', 'ja', 'zh-CN', 'hi', 'id', 'pt-BR'];
const MARKET_OF = { TW: 'zh-TW', JP: 'ja', CN: 'zh-CN', US: 'en', IN: 'hi', ID: 'id', BR: 'pt-BR' };

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const checkOnly = args.includes('--check');
const DIR = flag('--dir', null);
if (!DIR) { console.error('✗ 需要 --dir <片段目錄>'); process.exit(1); }

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sample = readJson(SAMPLE);
const catalog = readJson(CATALOG);
const mergeMap = new Map((readJson(MERGES).merges || []).map((m) => [m.from, m.to]));
const activeSlugs = new Set(
  execFileSync('sqlite3', [DB, "SELECT slug FROM topics WHERE status='active'"], { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean),
);
const today = new Date().toISOString().slice(0, 10);

const problems = [];
const fragments = readdirSync(DIR).filter((f) => /^local-.+\.json$/.test(f)).sort();
if (fragments.length === 0) { console.error(`✗ ${DIR} 裡沒有 local-*.json`); process.exit(1); }

let remapped = 0;
const incoming = { places: [], events: [] };
for (const file of fragments) {
  const city = basename(file).replace(/^local-/, '').replace(/\.json$/, '');
  const frag = readJson(join(DIR, file));
  const rows = [...(frag.places || []).map((x) => ['place', x]), ...(frag.events || []).map((x) => ['event', x])];
  for (const [kind, x] of rows) {
    if (x.city_code !== city) problems.push(`${file} ${kind} 「${x.name}」 city_code=${x.city_code} 與檔名不符`);
    const keys = Object.keys(x.descriptions || {}).sort().join(',');
    if (keys !== [...LOCALES].sort().join(',')) problems.push(`${file} ${kind} 「${x.name}」 descriptions 不是七語`);
    if (Object.values(x.descriptions || {}).some((v) => !String(v).trim())) problems.push(`${file} ${kind} 「${x.name}」 有空描述`);
    const srcs = kind === 'place' ? (x.source_urls || []) : (x.source_url ? [x.source_url] : []);
    if (srcs.length === 0) problems.push(`${file} ${kind} 「${x.name}」 沒有來源`);
    if (kind === 'event' && String(x.start_at || '').slice(0, 10) < today) {
      problems.push(`${file} event 「${x.name}」 start_at=${String(x.start_at).slice(0, 10)} 已過期`);
    }
    // merged slug 自動改寫成合併後的目標(這是實測最常見的一種交件錯誤)
    x.topic_slugs = [...new Set((x.topic_slugs || []).map((s) => {
      if (activeSlugs.has(s)) return s;
      const to = mergeMap.get(s);
      if (to && activeSlugs.has(to)) { remapped += 1; return to; }
      problems.push(`${file} ${kind} 「${x.name}」 slug ${s} 既非 active 也查不到合併目標`);
      return null;
    }).filter(Boolean))].sort();
    if (x.topic_slugs.length === 0) problems.push(`${file} ${kind} 「${x.name}」 沒有任何有效 topic_slug`);
    // update-local-data 只收 place_type='permanent' + topic_relevance='direct'(見該檔 §驗證)。
    // 這兩條原本只有每小時那一關擋得到,於是收件驗過了、合併寫進檔案了,才在下一步整支失敗
    // (2026-08-28 實測:三個 indirect 地點讓 update-local-data 在第一行就 fail,得整批回滾重來)。
    // 收件端先擋,錯的那一筆才會停在片段檔裡、不會汙染 content/。
    // ⚠ 修法只有「把那一筆拿掉或換一個真的直接相關的 Topic」——**不准為了過關把 indirect 改寫成 direct**,
    //   那個欄位是收集者對「這個地點是不是真的在講這個 Topic」的判斷,改它等於憑空填 marker。
    if (kind === 'place') {
      if (x.place_type !== 'permanent') problems.push(`${file} place 「${x.name}」 place_type=${x.place_type},只收 permanent`);
      if (x.topic_relevance !== 'direct') problems.push(`${file} place 「${x.name}」 topic_relevance=${x.topic_relevance},只收 direct(不要為了過關改寫,拿掉或換 Topic)`);
    }
  }
  incoming.places.push(...(frag.places || []));
  incoming.events.push(...(frag.events || []));
}

// 同一網址不能同時當地點與活動來源(兩份 managed 清單都嚴格驗 kind)
const allEventUrls = new Set([...sample.events, ...incoming.events].map((e) => e.source_url).filter(Boolean));
for (const p of [...sample.places, ...incoming.places]) {
  for (const u of (p.source_urls || [])) {
    if (allEventUrls.has(u)) problems.push(`地點「${p.name}」與某個活動共用來源 ${u}(兩者不可共用,擇一改掉)`);
  }
}

console.log(`片段 ${fragments.length} 份:地點 ${incoming.places.length}、活動 ${incoming.events.length};merged slug 自動改寫 ${remapped} 處`);
if (problems.length) {
  console.error(`\n✗ 收件驗證未過(${problems.length} 項):`);
  for (const p of problems.slice(0, 40)) console.error(`  - ${p}`);
  if (problems.length > 40) console.error(`  …另外 ${problems.length - 40} 項`);
  process.exit(1);
}
console.log('✓ 收件驗證通過(七語齊全、city_code 相符、來源皆有、活動未過期、slug 皆 active)');
if (checkOnly) process.exit(0);

// ── 合併 ──────────────────────────────────────────────────────────────
const keyOf = (x) => `${x.name}|${x.city_code}`;
const seenP = new Set(sample.places.map(keyOf));
const seenE = new Set(sample.events.map(keyOf));
let addedP = 0; let addedE = 0;
for (const p of incoming.places) if (!seenP.has(keyOf(p))) { seenP.add(keyOf(p)); sample.places.push(p); addedP += 1; }
for (const e of incoming.events) if (!seenE.has(keyOf(e))) { seenE.add(keyOf(e)); sample.events.push(e); addedE += 1; }
sample.managed_place_source_urls = [...new Set(sample.places.flatMap((p) => p.source_urls || []))].sort();
sample.managed_event_source_urls = [...new Set([
  ...sample.managed_event_source_urls,
  ...sample.events.map((e) => e.source_url).filter(Boolean),
])].filter((u) => !sample.managed_place_source_urls.includes(u)).sort();
sample.as_of = today;

// ── 目錄項:markers 一律抓頁面反推 ──────────────────────────────────────
const ENC_ALIAS = { 'shift_jis': 'shift_jis', sjis: 'shift_jis', 'x-sjis': 'shift_jis', 'euc-jp': 'euc-jp', big5: 'big5', gb2312: 'gb18030' };
function fetchText(url) {
  let raw;
  try {
    raw = execFileSync('curl', ['-sL', '--max-time', '25', '-A', 'Mozilla/5.0 (compatible; aeiou.now/1.0)', url],
      { maxBuffer: 40 * 1024 * 1024 });
  } catch { return { text: '', declared: null }; }
  const head = raw.subarray(0, 4000).toString('latin1');
  const m = head.match(/charset=["']?([\w-]+)/i);
  const declared = m ? (ENC_ALIAS[m[1].toLowerCase()] || m[1].toLowerCase()) : null;
  for (const enc of [declared, 'utf-8', 'shift_jis', 'euc-jp', 'big5', 'gb18030', 'latin1'].filter(Boolean)) {
    try { return { text: new TextDecoder(enc, { fatal: enc === 'utf-8' }).decode(raw), declared }; } catch { /* 下一個 */ }
  }
  return { text: '', declared };
}
const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
function markerCandidates(entry, html) {
  const out = [entry.name];
  for (const part of String(entry.name).split(/[（(\[\]）)　\-–—|/,]+/)) if (part.trim().length >= 3) out.push(part.trim());
  for (const loc of LOCALES) {
    const desc = entry.descriptions?.[loc] || '';
    for (const w of desc.match(/[A-Z][A-Za-z&'.]{3,}(?:\s+[A-Z][A-Za-z&'.]{2,}){0,3}/g) || []) if (w.length >= 6) out.push(w);
    for (const w of desc.match(/[぀-ヿ一-鿿]{4,12}/g) || []) out.push(w);
  }
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) {
    const title = plain(t[1]).trim();
    for (const piece of title.split(/[|｜\-–—:：]/)) if (piece.trim().length >= 5) out.push(piece.trim());
    if (title.length >= 5) out.push(title.slice(0, 60));
  }
  return [...new Set(out)].filter((s) => s && s.length >= 4);
}
const MON_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MON_PT = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const MON_ID = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
function dateCandidates(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return [...new Set([
    iso, `${m}月${d}日`, `${y}年${m}月${d}日`, `${m}/${d}`,
    `${MON_EN[m - 1]} ${d}`, `${MON_EN[m - 1]} ${d}, ${y}`, `${MON_EN[m - 1].slice(0, 3)} ${d}`, `${MON_EN[m - 1].slice(0, 4)} ${d}`,
    `${d} de ${MON_PT[m - 1]}`, `${d} ${MON_ID[m - 1]}`, `${d}/${String(m).padStart(2, '0')}/${y}`, `${d}/${m}`,
  ])];
}
const catByUrl = new Map(catalog.sources.map((r) => [r.url, r]));
const missing = [];
const todo = [
  ...sample.places.flatMap((p) => (p.source_urls || []).map((u) => ['place', p, u])),
  ...sample.events.filter((e) => e.source_url).map((e) => ['event', e, e.source_url]),
].filter(([, , u]) => !catByUrl.has(u));
for (const [kind, entry, url] of todo) {
  const { text: html, declared } = fetchText(url);
  const text = plain(html);
  const hit = markerCandidates(entry, html).filter((c) => text.includes(c)).slice(0, 2);
  if (hit.length === 0) { missing.push([entry.name, url, `抓到 ${html.length} 字元`]); continue; }
  if (declared && /shift_jis|euc-jp/.test(declared)) {
    missing.push([entry.name, url, `頁面是 ${declared} —— update-local-data 按 UTF-8 讀,永遠核對不了,不能用`]);
    continue;
  }
  const row = { url, market: MARKET_OF[entry.country_code] || 'en', kind, discovery_query: `site:${new URL(url).hostname} ${hit[0]}`, markers: hit };
  if (kind === 'event') {
    const dates = [...new Set([String(entry.start_at).slice(0, 10), String(entry.end_at || entry.start_at).slice(0, 10)])];
    const dm = dates.flatMap(dateCandidates).filter((c) => text.includes(c)).slice(0, 3);
    if (dm.length === 0) { missing.push([entry.name, url, '頁面上找不到這個活動的日期 —— 來源不支持這筆活動']); continue; }
    row.date_markers = dm;
  }
  catalog.sources.push(row); catByUrl.set(url, row);
}
// kind 依實際用途重設(同一網址不可兩用)
const eventUrls = new Set(sample.events.map((e) => e.source_url).filter(Boolean));
for (const row of catalog.sources) row.kind = eventUrls.has(row.url) ? 'event' : row.kind;
catalog.sources = catalog.sources.filter((r, i, a) => a.findIndex((x) => x.url === r.url) === i);

writeFileSync(SAMPLE, `${JSON.stringify(sample, null, 2)}\n`);
writeFileSync(CATALOG, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`✓ 合併:地點 +${addedP}(共 ${sample.places.length})、活動 +${addedE}(共 ${sample.events.length});來源目錄 ${catalog.sources.length} 筆`);
if (missing.length) {
  console.log(`\n⚠ 這 ${missing.length} 筆**沒有**進來源目錄,對應的資料還不能上線(抓不到 marker = 那一頁不支持這筆資料):`);
  for (const [n, u, why] of missing) console.log(`  - ${n}\n      ${u}\n      ${why}`);
  console.log('  處理方式:換一個能開、且內容真的講到它的官方頁;找不到就把那一筆資料拿掉。');
}
console.log('\n接著跑:node scripts/update-local-data.mjs && node scripts/export-data.mjs');
