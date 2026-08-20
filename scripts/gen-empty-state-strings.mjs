#!/usr/bin/env node
// 從 site/src/i18n/*.json 產生「空狀態／載入中／已關閉」字串清單，
// 供 site/scripts/check-rendered-depth.mjs 的 D3／D4 辨識狀態標籤。
//
// 為什麼要產生而不是寫死（2026-08-20 踩過）：手寫的英文標記是 'currently closed'，
// 而 en 的實際字串是 'The discussion room is temporarily closed' —— 四個語系的 build
// 因此假紅燈，zh-TW 又剛好因為字串短於門檻而沒事，看起來像「只有英文站壞掉」。
// 狀態字串屬 i18n，會被改；辨識它的清單就必須跟著 i18n 走。
//
// 用法：node scripts/gen-empty-state-strings.mjs（改 i18n 的這些 key 之後要重跑）
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const I18N = join(ROOT, 'site', 'src', 'i18n');
const OUT = join(ROOT, 'site', 'scripts', 'empty-state-strings.json');
const KEYS = [
  'common.empty', 'q.closed', 'q.loading', 'q.today_world_empty',
  'room.closed', 'room.closed_hint', 'room.empty', 'room.loading',
  'sort.events_empty', 'sort.hot_empty', 'sort.nearby_empty', 'topic.highlights_empty',
];

const values = new Set();
for (const file of readdirSync(I18N).filter((f) => f.endsWith('.json'))) {
  const dict = JSON.parse(readFileSync(join(I18N, file), 'utf8'));
  for (const key of KEYS) {
    const v = dict[key];
    if (typeof v === 'string' && v.trim()) values.add(v.trim());
  }
}
if (values.size === 0) { console.error('✗ 一條狀態字串都沒抓到——KEYS 可能已與 i18n 不同步'); process.exit(1); }
writeFileSync(OUT, `${JSON.stringify([...values].sort(), null, 2)}\n`);
console.log(`✓ ${values.size} 條狀態字串 → ${OUT}`);
