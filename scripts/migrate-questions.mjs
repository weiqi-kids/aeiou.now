#!/usr/bin/env node
// 補上每日世界一問(daily-question)四張表(供舊庫補表;規格見 docs/briefs/daily-question.md §2)。
//
// CREATE TABLE IF NOT EXISTS 模式,可重跑;新庫已由 db/schema-host.sql 建好這四張表,
// 這支腳本讓「還沒跑過 init-db.mjs 重建」的舊庫也補得到。仿 scripts/migrate-topic-observances.mjs。
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, 'db', 'aeiou.sqlite');

if (!existsSync(DB_PATH)) {
  console.log(`找不到 ${DB_PATH},略過每日世界一問(questions)遷移。`);
  process.exit(0);
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA busy_timeout = 15000;'); // 整點 */15 與 0 * * * * 兩條 cron 會併發碰同一顆 DB;遇鎖等待而非 SQLITE_BUSY 直接炸(同 lib openDb)
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS questions (
  question_id   TEXT PRIMARY KEY,
  qdate         TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('poll','guess')),
  topic_id      TEXT NOT NULL,
  asker_locale  TEXT,
  target_locale TEXT,
  answer_option TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS question_i18n (
  question_id TEXT NOT NULL, locale TEXT NOT NULL,
  text TEXT NOT NULL, explain TEXT,
  PRIMARY KEY (question_id, locale)
);
CREATE TABLE IF NOT EXISTS question_options (
  question_id TEXT NOT NULL, option_id TEXT NOT NULL,
  ord INTEGER NOT NULL, emoji TEXT,
  PRIMARY KEY (question_id, option_id)
);
CREATE TABLE IF NOT EXISTS question_option_i18n (
  question_id TEXT NOT NULL, option_id TEXT NOT NULL, locale TEXT NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (question_id, option_id, locale)
);
`);

db.close();
console.log('每日世界一問(questions)schema 已就緒(四張表 CREATE TABLE IF NOT EXISTS)。');
