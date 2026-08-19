#!/usr/bin/env node
// 年度 Topic 覆蓋與素材驗收：52 週每週至少一個未合併 Topic，且每個 Topic 有 1200×675 PNG。
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, 'db', 'aeiou.sqlite');
const CALENDAR_PATH = join(ROOT, 'content', 'topic-calendar.json');
const COVER_DIR = join(ROOT, 'site', 'public', 'covers');
const calendar = JSON.parse(readFileSync(CALENDAR_PATH, 'utf8'));
const errors = [];

if (!Array.isArray(calendar.weeks)) errors.push('calendar.weeks 必須是陣列');
const weeks = Array.isArray(calendar.weeks) ? calendar.weeks : [];
const weekNumbers = weeks.map((row) => row.week);
if (weeks.length !== 52) errors.push(`週數應為 52,實際 ${weeks.length}`);
for (let week = 1; week <= 52; week++) {
  const rows = weeks.filter((row) => row.week === week);
  if (rows.length !== 1) errors.push(`第 ${week} 週必須恰好一筆`);
  else if (!Array.isArray(rows[0].topics) || rows[0].topics.length === 0) errors.push(`第 ${week} 週沒有 Topic`);
}
if (new Set(weekNumbers).size !== weekNumbers.length) errors.push('calendar.week 不可重複');
if (weeks.some((row) => !Number.isInteger(row.week) || row.week < 1 || row.week > 52)) errors.push('calendar.week 必須是 1–52 的整數');

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 15000;"); // 整點 */15 與 0 * * * * 兩條 cron 會併發碰同一顆 DB;遇鎖等待而非 SQLITE_BUSY 直接炸(同 lib openDb)
// machine-owned trend Topic 沒有人工 cover 檔；它們由 Topic 頁的無 cover 降級顯示，
// 不應被年度文化 Topic 的 cover gate 擋住。manual/既有 Topic 仍維持原驗收。
const activeRows = db.prepare("SELECT slug, status, category FROM topics WHERE status IN ('active','cooling') ORDER BY slug").all();
const active = new Map(activeRows.map((row) => [row.slug, row.status]));
for (const row of weeks) {
  for (const slug of row.topics || []) {
    if (!active.has(slug)) errors.push(`第 ${row.week} 週引用不存在或已合併 Topic:${slug}`);
  }
}
db.close();

const contentSlugs = readdirSync(join(ROOT, 'content', 'topics'))
  .filter((file) => file.endsWith('.md'))
  .map((file) => file.slice(0, -3));
const coverHashes = new Map();
for (const row of activeRows) {
  const slug = row.slug;
  if (row.category === 'trend') continue;
  const cover = join(COVER_DIR, `${slug}.png`);
  if (!existsSync(cover)) {
    errors.push(`Topic ${slug} 缺少 PNG cover:${cover}`);
    continue;
  }
  const bytes = readFileSync(cover);
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const width = isPng ? bytes.readUInt32BE(16) : null;
  const height = isPng ? bytes.readUInt32BE(20) : null;
  if (!isPng || width !== 1200 || height !== 675) {
    errors.push(`Topic ${slug} cover 必須是 PNG 1200 x 675,實際 ${isPng ? `${width} x ${height}` : '非 PNG'}`);
    continue;
  }
  const hash = createHash('sha256').update(bytes).digest('hex');
  const previous = coverHashes.get(hash);
  if (previous) errors.push(`Topic ${slug} 與 ${previous} 共用同一張 cover；每個 active Topic 必須有獨立圖片`);
  else coverHashes.set(hash, slug);
}

if (errors.length) {
  console.error('Topic calendar / cover 驗收失敗:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Topic calendar / cover 驗收通過:52 週、${activeRows.length} 個 active Topic、每週至少 1 個、每個 Topic 有獨立 cover 1200×675。`);
