#!/usr/bin/env node
// 將 content/observance-occurrences.json 匯入主機 SQLite。
//
// topic_observances 保存「這個地方怎麼過」的長期文化規則；本檔保存「某一年
// 實際落在哪一天」。兩層刻意分開，避免用自然語言解析器猜農曆、印度曆或伊斯蘭曆。
// 匯入是冪等的；每個 observance 在 JSON 中的整組 occurrence 會被替換。
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, 'db', 'aeiou.sqlite');
const INPUT_PATH = join(ROOT, 'content', 'observance-occurrences.json');
const MOVES_PATH = join(ROOT, 'content', 'topic-observance-moves.json');
const CALENDARS = new Set([
  'gregorian',
  'chinese-lunisolar',
  'hindu-lunisolar',
  'islamic',
  'solar-term',
  'local',
]);
const STATUSES = new Set(['confirmed', 'estimated', 'local-variant']);

if (!existsSync(DB_PATH)) {
  console.error(`找不到 ${DB_PATH}`);
  process.exit(2);
}
if (!existsSync(INPUT_PATH)) {
  console.error(`找不到 ${INPUT_PATH}`);
  process.exit(2);
}

// 讓直接執行本支也一定先套用 occurrence schema；不依賴呼叫端剛好先跑 migrate。
execFileSync(process.execPath, [join(ROOT, 'scripts', 'migrate-topic-observances.mjs')], {
  cwd: ROOT,
  stdio: 'inherit',
});

const input = JSON.parse(readFileSync(INPUT_PATH, 'utf8'));
const rows = Array.isArray(input.occurrences) ? input.occurrences : [];
const observanceMoves = existsSync(MOVES_PATH) ? JSON.parse(readFileSync(MOVES_PATH, 'utf8')) : [];
const moveKey = (row) => `${row.from_topic}\u0000${String(row.country_code || '').toUpperCase()}\u0000${row.observance_key || ''}`;
const moveByKey = new Map(observanceMoves.map((move) => [
  `${move.from_topic}\u0000${String(move.country_code || '').toUpperCase()}\u0000${move.observance_key || ''}`,
  move.to_topic,
]));
const errors = [];
const validDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const validTimezone = (value) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
};
const sourceIdOf = (url) =>
  `src_${createHash('sha256').update(url).digest('hex').slice(0, 24).toUpperCase()}`;
const rawKeyOf = (row) =>
  `${row.topic_slug}\u0000${String(row.country_code || '').toUpperCase()}\u0000${row.observance_key || ''}`;
const keyOf = (row) =>
  `${moveByKey.get(rawKeyOf(row)) || row.topic_slug}\u0000${String(row.country_code || '').toUpperCase()}\u0000${row.observance_key || ''}`;

if (!Number.isInteger(input.version) || input.version < 1) errors.push('version 必須是正整數');
if (!validDate(input.as_of)) errors.push('as_of 必須是 YYYY-MM-DD');
if (!validDate(input.coverage_through)) errors.push('coverage_through 必須是 YYYY-MM-DD');
const currentYear = new Date().getUTCFullYear();
if (validDate(input.coverage_through) && input.coverage_through < `${currentYear + 1}-12-31`) {
  errors.push(`coverage_through 必須至少涵蓋 ${currentYear + 1} 年`);
}
if (!rows.length) errors.push('occurrences 不可為空');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
const observances = db.prepare(
  `SELECT o.observance_id, t.slug AS topic_slug, t.status, o.country_code, o.observance_key
     FROM topic_observances o
     JOIN topics t ON t.topic_id = o.topic_id
    WHERE t.status NOT IN ('candidate', 'merged')
    ORDER BY t.slug, o.country_code, o.observance_key`
).all();
const byKey = new Map(observances.map((row) => [keyOf(row), row]));
const seenKeys = new Set();
const normalized = [];

for (const [index, row] of rows.entries()) {
  const label = `occurrences[${index}]`;
  if (!row || typeof row !== 'object') {
    errors.push(`${label} 必須是物件`);
    continue;
  }
  const key = keyOf(row);
  const observance = byKey.get(key);
  if (!observance) errors.push(`${label} 找不到 active observance: ${key.replaceAll('\u0000', '/')}`);
  if (seenKeys.has(key) && validDate(row.starts_on)) {
    // 同一 observance 可以有多筆日期，但不能重複同一年同一開始日。
    const duplicate = normalized.find(
      (item) => item.key === key && item.row.occurrence_year === row.occurrence_year && item.row.starts_on === row.starts_on
    );
    if (duplicate) {
      // 舊 taxonomy 可能在兩個 Topic 各保存過同一個日期；它們被 move 到
      // 同一個 final Topic 後只留第一份即可。原本同一 observance 的重複仍然報錯。
      if (rawKeyOf(row) === rawKeyOf(duplicate.row)) {
        errors.push(`${label} 與 occurrences[${duplicate.index}] 重複`);
      } else {
        continue;
      }
    }
  }
  seenKeys.add(key);

  const year = row.occurrence_year;
  if (!Number.isInteger(year) || year < 2000 || year > 2200) errors.push(`${label}.occurrence_year 無效`);
  if (!validDate(row.starts_on)) errors.push(`${label}.starts_on 必須是有效 YYYY-MM-DD`);
  if (row.ends_on != null && !validDate(row.ends_on)) errors.push(`${label}.ends_on 必須是有效 YYYY-MM-DD 或 null`);
  if (validDate(row.starts_on) && validDate(row.ends_on) && row.ends_on < row.starts_on) {
    errors.push(`${label}.ends_on 不可早於 starts_on`);
  }
  if (validDate(row.starts_on) && Number.isInteger(year) && !row.starts_on.startsWith(`${year}-`)) {
    errors.push(`${label}.starts_on 年份必須等於 occurrence_year`);
  }
  if (!CALENDARS.has(row.calendar_system)) errors.push(`${label}.calendar_system 無效`);
  if (!validTimezone(row.timezone)) errors.push(`${label}.timezone 不是有效 IANA timezone`);
  if (!STATUSES.has(row.date_status)) errors.push(`${label}.date_status 無效`);
  if (!Array.isArray(row.source_urls) || row.source_urls.length === 0) {
    errors.push(`${label}.source_urls 不可為空`);
  } else if (row.source_urls.some((url) => typeof url !== 'string' || !/^https?:\/\//.test(url))) {
    errors.push(`${label}.source_urls 只能包含 http(s) URL`);
  }
  normalized.push({ index, key, observance, row });
}

for (const key of byKey.keys()) {
  if (!seenKeys.has(key)) errors.push(`active observance 缺年度 occurrence: ${key.replaceAll('\u0000', '/')}`);
}
for (const [key, observance] of byKey.entries()) {
  const years = new Set(normalized.filter((item) => item.key === key).map((item) => item.row.occurrence_year));
  for (const year of [currentYear, currentYear + 1]) {
    if (!years.has(year)) errors.push(`active observance 缺 ${year} 年 occurrence: ${key.replaceAll('\u0000', '/')}`);
  }
}

if (errors.length) {
  db.close();
  console.error('年度 occurrence 匯入驗證失敗:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const upsertSource = db.prepare(
  `INSERT INTO sources (source_id, url, domain, source_type, next_crawl_at, crawl_freq_s, status, updated_at)
   VALUES (?, ?, ?, 'calendar', ?, 31536000, 'processed', ?)
   ON CONFLICT(url) DO UPDATE SET updated_at = excluded.updated_at`
);
const deleteOccurrences = db.prepare('DELETE FROM topic_observance_occurrences WHERE observance_id = ?');
const insertOccurrence = db.prepare(
  `INSERT INTO topic_observance_occurrences
    (occurrence_id, observance_id, occurrence_year, starts_on, ends_on, calendar_system,
     timezone, date_status, source_ids_json, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

db.exec('BEGIN');
try {
  // content/topics/*.md 是 observance 的權威入口；被移除的地方表現不可留下孤兒日期。
  db.exec(
    `DELETE FROM topic_observance_occurrences
      WHERE observance_id NOT IN (SELECT observance_id FROM topic_observances)`
  );
  const affected = new Set();
  for (const item of normalized) {
    const { row, observance } = item;
    const sourceIds = row.source_urls.map((url) => {
      const sourceId = sourceIdOf(url);
      upsertSource.run(sourceId, url, new URL(url).hostname, now + 365 * 86400, now);
      return sourceId;
    });
    if (!affected.has(observance.observance_id)) {
      deleteOccurrences.run(observance.observance_id);
      affected.add(observance.observance_id);
    }
    const occurrenceId = `occ_${observance.observance_id}_${row.occurrence_year}_${row.starts_on}`;
    insertOccurrence.run(
      occurrenceId,
      observance.observance_id,
      row.occurrence_year,
      row.starts_on,
      row.ends_on ?? null,
      row.calendar_system,
      row.timezone,
      row.date_status,
      JSON.stringify(sourceIds),
      now,
    );
  }
  db.exec('COMMIT');
  console.log(`年度 occurrence 匯入完成:${normalized.length} 筆、${new Set(normalized.map((item) => item.key)).size} 個 observance。`);
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
