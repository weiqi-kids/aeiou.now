#!/usr/bin/env node
// merge-staged-topic.mjs — 把 subagent 產出的單一 Topic 片段併進共用檔(2026-08-26)
//
// 為什麼存在:一次派多個 agent 寫 Topic 時,三個共用檔會互相覆蓋 ——
//   content/observance-occurrences.json / content/topic-regional-notes.json /
//   scripts/check-final-topic-taxonomy.mjs 的 FINAL_SLUGS
// 所以 agent 只准寫「自己的 md + 兩個片段檔」,合併一律由這支序列化處理。
//
// 用法:node scripts/merge-staged-topic.mjs <slug> <stageDir> [--note "FINAL_SLUGS 註解"]
// 冪等:同一個 slug 重跑會先移除舊列再寫入。
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [slug, stageDir] = process.argv.slice(2);
if (!slug || !stageDir) { console.error('用法:merge-staged-topic.mjs <slug> <stageDir> [--note "…"]'); process.exit(2); }
const noteIdx = process.argv.indexOf('--note');
const note = noteIdx > -1 ? process.argv[noteIdx + 1] : null;

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
// tmp+rename:整點 cron 可能同時在讀這些檔,不要讓它讀到寫到一半的 JSON
const writeJson = (p, v, indent) => { const t = `${p}.tmp`; writeFileSync(t, `${JSON.stringify(v, null, indent)}\n`); renameSync(t, p); };
const errs = [];

// ── 1. occurrences ────────────────────────────────────────────────────────
const occPath = join(ROOT, 'content', 'observance-occurrences.json');
const occFrag = join(stageDir, `${slug}.occ.json`);
if (!existsSync(occFrag)) { console.error(`缺片段:${occFrag}`); process.exit(1); }
const doc = readJson(occPath);
const rows = readJson(occFrag);
if (!Array.isArray(rows) || rows.length === 0) { console.error(`${occFrag} 必須是非空陣列`); process.exit(1); }
const CAL = new Set(['gregorian','chinese-lunisolar','hindu-lunisolar','islamic','solar-term','local']);
const ST = new Set(['confirmed','estimated','local-variant']);
const seen = new Set();
for (const [i, r] of rows.entries()) {
  const at = `${slug}.occ[${i}]`;
  if (r.topic_slug !== slug) errs.push(`${at}: topic_slug 應為 ${slug},實際 ${r.topic_slug}`);
  if (!/^[A-Z]{2}$/.test(r.country_code || '')) errs.push(`${at}: country_code 要 ISO2 大寫`);
  if (!/^[a-z0-9-]+$/.test(r.observance_key || '')) errs.push(`${at}: observance_key 只准 a-z0-9-`);
  if (!CAL.has(r.calendar_system)) errs.push(`${at}: calendar_system 無效(${r.calendar_system})`);
  if (!ST.has(r.date_status)) errs.push(`${at}: date_status 無效(${r.date_status})`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.starts_on || '')) errs.push(`${at}: starts_on 格式錯`);
  if (r.ends_on && r.ends_on < r.starts_on) errs.push(`${at}: ends_on 早於 starts_on`);
  if (!Array.isArray(r.source_urls) || !r.source_urls.length) errs.push(`${at}: source_urls 必填`);
  const k = `${r.country_code}/${r.observance_key}/${r.occurrence_year}`;
  if (seen.has(k)) errs.push(`${at}: 重複 ${k}`); else seen.add(k);
}
// 每個 observance 都要 2026/2027/2028 三年 —— 少一年年度閘門會擋,但那時已經進管線了
const byObs = new Map();
for (const r of rows) {
  const k = `${r.country_code}/${r.observance_key}`;
  if (!byObs.has(k)) byObs.set(k, new Set());
  byObs.get(k).add(r.occurrence_year);
}
for (const [k, years] of byObs) {
  for (const y of [2026, 2027, 2028]) if (!years.has(y)) errs.push(`${slug}: ${k} 缺 ${y} 年度 occurrence`);
}
if (errs.length) { console.error(`片段驗證失敗:\n  - ${errs.join('\n  - ')}`); process.exit(1); }

const before = doc.occurrences.length;
doc.occurrences = doc.occurrences.filter((r) => r.topic_slug !== slug).concat(rows);
writeJson(occPath, doc, 1);
console.log(`occurrences: ${before} → ${doc.occurrences.length}(本 Topic ${rows.length} 列、${byObs.size} 個 observance)`);

// ── 2. regional notes ─────────────────────────────────────────────────────
const noteFrag = join(stageDir, `${slug}.notes.json`);
if (existsSync(noteFrag)) {
  const notes = readJson(noteFrag);
  const n = Object.keys(notes).length;
  if (n) {
    const LOCALES = ['zh-TW','en','ja','zh-CN','hi','id','pt-BR'];
    for (const [cc, row] of Object.entries(notes)) {
      if (!/^[A-Z]{2}$/.test(cc)) errs.push(`notes: ${cc} 不是 ISO2 大寫`);
      if (row.country_code !== cc) errs.push(`notes.${cc}: country_code 不一致`);
      for (const l of LOCALES) if (!row.text?.[l]?.trim()) errs.push(`notes.${cc}: 缺 ${l}`);
      if (!Array.isArray(row.source_urls) || !row.source_urls.length) errs.push(`notes.${cc}: source_urls 必填`);
    }
    if (errs.length) { console.error(`regional notes 驗證失敗:\n  - ${errs.join('\n  - ')}`); process.exit(1); }
    const rnPath = join(ROOT, 'content', 'topic-regional-notes.json');
    const rn = readJson(rnPath);
    rn.topics[slug] = { source_urls: [], notes };
    writeJson(rnPath, rn, 1);
    console.log(`regional notes: ${slug} → ${n} 國`);
  } else console.log('regional notes: 片段為空,略過');
} else console.log('regional notes: 無片段,略過');

// ── 3. FINAL_SLUGS ────────────────────────────────────────────────────────
const gate = join(ROOT, 'scripts', 'check-final-topic-taxonomy.mjs');
let src = readFileSync(gate, 'utf8');
if (src.includes(`'${slug}'`)) console.log('FINAL_SLUGS: 已存在,略過');
else {
  const anchor = "const FINAL_SLUGS = [\n";
  if (!src.includes(anchor)) { console.error('找不到 FINAL_SLUGS 錨點'); process.exit(1); }
  const lines = note ? `${note.split('\n').map((l) => `  // ${l}`).join('\n')}\n  '${slug}',\n` : `  '${slug}',\n`;
  src = src.replace(anchor, anchor + lines);
  writeFileSync(gate, src);
  console.log(`FINAL_SLUGS: 加入 ${slug}`);
}

// ── 4. md 搬進管線 ────────────────────────────────────────────────────────
const from = join(ROOT, 'content', 'topics-pending', `${slug}.md`);
const to = join(ROOT, 'content', 'topics', `${slug}.md`);
if (existsSync(from)) { renameSync(from, to); console.log(`md: topics-pending → topics/${slug}.md`); }
else if (existsSync(to)) console.log('md: 已在 content/topics/');
else { console.error(`找不到 ${from}`); process.exit(1); }
console.log(`\n✓ ${slug} 已併入。下一步:產封面 → import-topics → import-topic-occurrences → export-data → 四道閘門`);
