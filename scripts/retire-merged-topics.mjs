#!/usr/bin/env node
// 依 content/topic-merges.json 將舊日期型 Topic 轉為 merged，保留 URL/貼文歷史，
// 讓靜態匯出只展示共通性 Topic。此腳本可重跑。
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, 'db', 'aeiou.sqlite');
const MERGES_PATH = join(ROOT, 'content', 'topic-merges.json');

if (!existsSync(DB_PATH) || !existsSync(MERGES_PATH)) process.exit(0);

const mergeConfig = JSON.parse(readFileSync(MERGES_PATH, 'utf8'));
const merges = Array.isArray(mergeConfig) ? mergeConfig : (mergeConfig.merges || []);
const movePath = Array.isArray(mergeConfig)
  ? join(ROOT, 'content', 'topic-observance-moves.json')
  : join(ROOT, mergeConfig.observance_moves || 'content/topic-observance-moves.json');
const observanceMoves = existsSync(movePath) ? JSON.parse(readFileSync(movePath, 'utf8')) : [];
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA busy_timeout = 15000;'); // 整點 */15 與 0 * * * * 兩條 cron 會併發碰同一顆 DB;遇鎖等待而非 SQLITE_BUSY 直接炸(同 lib openDb)
db.exec('PRAGMA foreign_keys = ON;');
const now = Math.floor(Date.now() / 1000);
let changed = 0;

db.exec('BEGIN');
try {
  // 新 taxonomy 不是把整個舊 Topic 粗暴搬家：同一個舊大分類裡的
  // 排燈節、開齋節、中秋等 observance 要先搬到各自的新 Topic。
  // 來源、customs 與年度 occurrence 一起保留，避免只改標題卻遺失可查證資料。
  const topicBySlug = (slug) => db.prepare('SELECT topic_id FROM topics WHERE slug = ?').get(slug);
  const moveObservance = (move) => {
    const from = topicBySlug(move.from_topic);
    const to = topicBySlug(move.to_topic);
    if (!from || !to) throw new Error(`observance move 找不到 Topic:${move.from_topic} → ${move.to_topic}`);
    const obs = db.prepare(
      `SELECT * FROM topic_observances
         WHERE topic_id = ? AND country_code = ? AND observance_key = ?`
    ).get(from.topic_id, String(move.country_code).toUpperCase(), move.observance_key);
    if (!obs) {
      console.log(`略過不存在的 observance ${move.from_topic}/${move.country_code}/${move.observance_key}`);
      return;
    }
    const existing = db.prepare(
      `SELECT observance_id FROM topic_observances
         WHERE topic_id = ? AND country_code = ? AND observance_key = ?`
    ).get(to.topic_id, obs.country_code, obs.observance_key);
    if (!existing) {
      db.prepare('UPDATE topic_observances SET topic_id = ? WHERE observance_id = ?')
        .run(to.topic_id, obs.observance_id);
      console.log(`搬移 observance ${move.from_topic}/${obs.country_code}/${obs.observance_key} → ${move.to_topic}`);
      return;
    }

    // 目標內容若已經先寫入同一 observance，沿用目標識別並把來源的年度日期
    // 與語系 customs 補進去；兩邊不重複建立第二筆。
    const sourceLocales = db.prepare(
      'SELECT locale, customs_text FROM topic_observance_i18n WHERE observance_id = ?'
    ).all(obs.observance_id);
    for (const row of sourceLocales) {
      db.prepare(
        `INSERT OR IGNORE INTO topic_observance_i18n (observance_id, locale, customs_text)
         VALUES (?, ?, ?)`
      ).run(existing.observance_id, row.locale, row.customs_text);
    }
    const occurrences = db.prepare(
      'SELECT * FROM topic_observance_occurrences WHERE observance_id = ?'
    ).all(obs.observance_id);
    for (const occurrence of occurrences) {
      const occurrenceId = `occ_${existing.observance_id}_${occurrence.occurrence_year}_${occurrence.starts_on}`;
      db.prepare(
        `INSERT OR IGNORE INTO topic_observance_occurrences
          (occurrence_id, observance_id, occurrence_year, starts_on, ends_on, calendar_system,
           timezone, date_status, source_ids_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(occurrenceId, existing.observance_id, occurrence.occurrence_year, occurrence.starts_on,
        occurrence.ends_on, occurrence.calendar_system, occurrence.timezone, occurrence.date_status,
        occurrence.source_ids_json, occurrence.updated_at);
    }
    db.prepare('DELETE FROM topic_observance_occurrences WHERE observance_id = ?').run(obs.observance_id);
    db.prepare('DELETE FROM topic_observance_i18n WHERE observance_id = ?').run(obs.observance_id);
    db.prepare('DELETE FROM topic_observances WHERE observance_id = ?').run(obs.observance_id);
    console.log(`合併重複 observance ${move.from_topic}/${obs.country_code}/${obs.observance_key} → ${move.to_topic}`);
  };
  for (const move of observanceMoves) moveObservance(move);

  for (const merge of merges) {
    const from = db.prepare('SELECT topic_id, status, merged_into FROM topics WHERE slug = ?').get(merge.from);
    const to = db.prepare('SELECT topic_id FROM topics WHERE slug = ?').get(merge.to);
    if (!from || !to || from.topic_id === to.topic_id) continue;
    if (from.status === 'merged' && from.merged_into === to.topic_id) continue;

    db.prepare(
      "UPDATE place_topics SET topic_id = ? WHERE topic_id = ? AND NOT EXISTS (SELECT 1 FROM place_topics p2 WHERE p2.place_id = place_topics.place_id AND p2.topic_id = ?)"
    ).run(to.topic_id, from.topic_id, to.topic_id);
    db.prepare('DELETE FROM place_topics WHERE topic_id = ?').run(from.topic_id);
    db.prepare(
      "UPDATE event_topics SET topic_id = ? WHERE topic_id = ? AND NOT EXISTS (SELECT 1 FROM event_topics e2 WHERE e2.event_id = event_topics.event_id AND e2.topic_id = ?)"
    ).run(to.topic_id, from.topic_id, to.topic_id);
    db.prepare('DELETE FROM event_topics WHERE topic_id = ?').run(from.topic_id);
    db.prepare('UPDATE topic_aliases SET topic_id = ? WHERE topic_id = ?').run(to.topic_id, from.topic_id);
    // Topic Graph 也跟著合併，避免 facts.json 留下指向 merged id 的孤兒關係。
    db.prepare(
      `UPDATE topic_relations SET from_topic_id = ? WHERE from_topic_id = ?
       AND NOT EXISTS (SELECT 1 FROM topic_relations r2
                       WHERE r2.from_topic_id = ? AND r2.to_topic_id = topic_relations.to_topic_id
                         AND r2.relation = topic_relations.relation)`
    ).run(to.topic_id, from.topic_id, to.topic_id);
    db.prepare(
      `UPDATE topic_relations SET to_topic_id = ? WHERE to_topic_id = ?
       AND NOT EXISTS (SELECT 1 FROM topic_relations r2
                       WHERE r2.from_topic_id = topic_relations.from_topic_id AND r2.to_topic_id = ?
                         AND r2.relation = topic_relations.relation)`
    ).run(to.topic_id, from.topic_id, to.topic_id);
    db.prepare('DELETE FROM topic_relations WHERE from_topic_id = ? OR to_topic_id = ?')
      .run(from.topic_id, from.topic_id);
    db.prepare(
      "UPDATE topics SET status = 'merged', merged_into = ?, updated_at = ? WHERE topic_id = ?"
    ).run(to.topic_id, now, from.topic_id);
    changed++;
    console.log(`合併 ${merge.from} → ${merge.to} (${merge.reason})`);
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  throw error;
} finally {
  db.close();
}

if (changed === 0) console.log('沒有需要合併的舊 Topic。');
