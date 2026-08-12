#!/usr/bin/env node
// 將舊的「每 Topic × 每國一列」資料遷移到 observance 模型。
//
// 舊模型:
//   topic_countries(topic_id, country_code)  ← 同一國只能有一個日期/名稱
// 新模型:
//   topic_observances(topic_id, country_code, observance_key) ← 同一國可有多個地方表現
//
// 這支腳本可重跑。舊資料會以 observance_key=default 保留，之後由新的
// content/topics/*.md 匯入器以真正的 observance key 取代；舊表改名保留作為
// 遷移痕跡，不再是任何讀寫路徑的權威來源。
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, 'db', 'aeiou.sqlite');

if (!existsSync(DB_PATH)) {
  console.log(`找不到 ${DB_PATH},略過 Topic observance 遷移。`);
  process.exit(0);
}

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

const tableExists = (name) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(name));

if (tableExists('topics')) {
  const topicColumns = db.prepare("PRAGMA table_info('topics')").all().map((row) => row.name);
  if (!topicColumns.includes('commonality')) {
    db.exec("ALTER TABLE topics ADD COLUMN commonality TEXT NOT NULL DEFAULT ''");
    console.log('已補上 topics.commonality:Topic 以跨國共通性分類,不以日期命名。');
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS topic_observances (
  observance_id  TEXT PRIMARY KEY,
  topic_id       TEXT NOT NULL,
  observance_key TEXT NOT NULL,
  country_code   TEXT NOT NULL,
  local_name     TEXT NOT NULL,
  observed_date  TEXT,
  date_rule      TEXT,
  date_range_end TEXT,
  popularity_rank INTEGER,
  source_ids_json TEXT NOT NULL,
  updated_at     INTEGER NOT NULL,
  UNIQUE (topic_id, country_code, observance_key)
);
CREATE INDEX IF NOT EXISTS idx_topic_observances_topic
  ON topic_observances(topic_id, country_code, observed_date);
CREATE INDEX IF NOT EXISTS idx_topic_observances_date
  ON topic_observances(observed_date, date_range_end);

CREATE TABLE IF NOT EXISTS topic_observance_i18n (
  observance_id TEXT NOT NULL,
  locale        TEXT NOT NULL,
  customs_text  TEXT NOT NULL,
  PRIMARY KEY (observance_id, locale)
);
`);

// 早期第一版曾把 observance_key 誤設成 Topic 全域唯一，導致 TW/CN
// 都叫 mid-autumn、US/BR 都叫 christmas 時無法匯入。重建唯一索引，
// 保留既有資料與 observance_id；真正的穩定識別是 topic + country + key。
const uniqueIndexes = db.prepare("PRAGMA index_list('topic_observances')").all()
  .filter((row) => row.unique);
const wrongUniqueIndex = uniqueIndexes.find((row) => {
  const cols = db.prepare(`PRAGMA index_info('${row.name.replaceAll("'", "''")}')`).all()
    .map((col) => col.name);
  return cols.join('|') === 'topic_id|observance_key';
});
if (wrongUniqueIndex) {
  db.exec('DROP INDEX IF EXISTS idx_topic_observances_topic');
  db.exec('DROP INDEX IF EXISTS idx_topic_observances_date');
  db.exec('ALTER TABLE topic_observances RENAME TO topic_observances_model_legacy_20260811');
  db.exec(`
    CREATE TABLE topic_observances (
      observance_id  TEXT PRIMARY KEY,
      topic_id       TEXT NOT NULL,
      observance_key TEXT NOT NULL,
      country_code   TEXT NOT NULL,
      local_name     TEXT NOT NULL,
      observed_date  TEXT,
      date_rule      TEXT,
      date_range_end TEXT,
      popularity_rank INTEGER,
      source_ids_json TEXT NOT NULL,
      updated_at     INTEGER NOT NULL,
      UNIQUE (topic_id, country_code, observance_key)
    );
    INSERT INTO topic_observances
      (observance_id, topic_id, observance_key, country_code, local_name,
       observed_date, date_rule, date_range_end, popularity_rank, source_ids_json, updated_at)
    SELECT observance_id, topic_id, observance_key, country_code, local_name,
           observed_date, date_rule, date_range_end, popularity_rank, source_ids_json, updated_at
      FROM topic_observances_model_legacy_20260811;
    DROP TABLE topic_observances_model_legacy_20260811;
    CREATE INDEX idx_topic_observances_topic
      ON topic_observances(topic_id, country_code, observed_date);
    CREATE INDEX idx_topic_observances_date
      ON topic_observances(observed_date, date_range_end);
  `);
  console.log('已修正 observance 唯一鍵:同一 Topic 同一國可有多個不同 observance。');
}

const oldCountries = tableExists('topic_countries');
const oldCustoms = tableExists('topic_country_i18n');
if (!oldCountries && !oldCustoms) {
  db.close();
  console.log('Topic observance schema 已存在,沒有舊表需要遷移。');
  process.exit(0);
}

const now = Math.floor(Date.now() / 1000);
db.exec('BEGIN');
try {
  if (oldCountries) {
    const rows = db.prepare('SELECT * FROM topic_countries ORDER BY topic_id, country_code').all();
    const insert = db.prepare(`
      INSERT OR IGNORE INTO topic_observances
        (observance_id, topic_id, observance_key, country_code, local_name,
         observed_date, date_rule, date_range_end, popularity_rank, source_ids_json, updated_at)
      VALUES (?, ?, 'default', ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      insert.run(
        `obs_${row.topic_id}_${row.country_code}_default`,
        row.topic_id,
        row.country_code,
        row.local_name,
        row.observed_date ?? null,
        row.date_rule ?? null,
        row.date_range_end ?? null,
        row.popularity_rank ?? null,
        row.source_ids_json,
        row.updated_at ?? now,
      );
    }
  }

  if (oldCustoms) {
    const rows = db.prepare('SELECT * FROM topic_country_i18n ORDER BY topic_id, country_code, locale').all();
    const insert = db.prepare(`
      INSERT OR IGNORE INTO topic_observance_i18n (observance_id, locale, customs_text)
      VALUES (?, ?, ?)
    `);
    for (const row of rows) {
      insert.run(
        `obs_${row.topic_id}_${row.country_code}_default`,
        row.locale,
        row.customs_text,
      );
    }
  }

  if (oldCountries && !tableExists('topic_countries_legacy_20260811')) {
    db.exec('ALTER TABLE topic_countries RENAME TO topic_countries_legacy_20260811');
  }
  if (oldCustoms && !tableExists('topic_country_i18n_legacy_20260811')) {
    db.exec('ALTER TABLE topic_country_i18n RENAME TO topic_country_i18n_legacy_20260811');
  }
  db.exec('COMMIT');
  console.log('Topic observance 遷移完成:舊資料保留為 *_legacy_20260811,新表為權威來源。');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}
