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

const merges = JSON.parse(readFileSync(MERGES_PATH, 'utf8'));
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
const now = Math.floor(Date.now() / 1000);
let changed = 0;

db.exec('BEGIN');
try {
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
