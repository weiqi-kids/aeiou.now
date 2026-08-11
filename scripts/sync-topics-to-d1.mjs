#!/usr/bin/env node
// aeiou.now — 主機 SQLite → D1 Topic 副本同步(Track D / W4.1)
//   node scripts/sync-topics-to-d1.mjs
//
// 主機 topics(全欄版)→ POST /internal/sync/topics → D1 topics / topic_i18n(精簡副本)。
// 語意 = upsert 覆蓋(以 PK 為準);M1 不刪除 D1 上多出來的列(W3.5 測試 topic 會留著)。
//
// current_cycle_id:主機 topic_cycles 裡 ended_at IS NULL 的那一筆(進行中的期);沒有就 NULL。
// 這欄是 D1 副本特有(主機 topics 沒有),Worker 寫 posts.cycle_id 時直接取它。
//
// 環境變數:
//   AEIOU_API_URL          Worker base URL(預設 workers.dev;切自訂網域只改這裡)
//   AEIOU_DB_PATH          主機 SQLite(預設 /root/aeiou.now/db/aeiou.sqlite)
//   AEIOU_SYNC_SECRET_FILE secret 檔(預設 ~/.config/aeiou/sync-secret)
//
// 失敗:寫 jobs(job_name='sync-topics'),重試 +5 分 / +10 分 / 第三次 dlq。

import { CONFIG, api, openDb, beginJob, finishJob, slotStart, log } from "./lib/aeiou-lib.mjs";

const JOB_NAME = "sync-topics";

const db = openDb();
const job = beginJob(db, { jobName: JOB_NAME, scheduledAt: slotStart(900) });
log(`[${JOB_NAME}] job_id=${job.job_id} attempt=${job.attempt} api=${CONFIG.apiUrl} db=${CONFIG.dbPath}`);

try {
  // 進行中的期別:一個 topic 至多一筆 ended_at IS NULL(取最新起始的那筆保底)
  const rows = db
    .prepare(
      `SELECT t.topic_id, t.slug, t.status, t.access_level, t.is_perennial, t.global_score,
              (SELECT c.cycle_id FROM topic_cycles c
                WHERE c.topic_id = t.topic_id AND c.ended_at IS NULL
                ORDER BY c.started_at DESC LIMIT 1) AS current_cycle_id
         FROM topics t
        ORDER BY t.topic_id`
    )
    .all();

  const i18n = db
    .prepare("SELECT topic_id, locale, title FROM topic_i18n ORDER BY topic_id, locale")
    .all();

  const payload = {
    topics: rows.map((r) => ({
      topic_id: r.topic_id,
      slug: r.slug,
      status: r.status,
      access_level: r.access_level,
      is_perennial: r.is_perennial,
      global_score: r.global_score,
      current_cycle_id: r.current_cycle_id ?? null,
    })),
    topic_i18n: i18n.map((r) => ({ topic_id: r.topic_id, locale: r.locale, title: r.title })),
  };

  log(`[${JOB_NAME}] host: ${payload.topics.length} topics / ${payload.topic_i18n.length} topic_i18n`);
  for (const t of payload.topics) log(`  - ${t.topic_id} ${t.slug} cycle=${t.current_cycle_id ?? "NULL"}`);

  const res = await api("/internal/sync/topics", { method: "POST", body: payload });
  log(`[${JOB_NAME}] worker: ${JSON.stringify(res)}`);

  finishJob(db, job, {
    status: "success",
    read: payload.topics.length + payload.topic_i18n.length,
    // upsert 覆蓋語意下 Worker 不回報 insert/update 之分,一律計 updated
    updated: (res.topics_upserted || 0) + (res.topic_i18n_upserted || 0),
  });
  log(`[${JOB_NAME}] success`);
  db.close();
} catch (e) {
  const done = finishJob(db, job, { status: "failed", error: e && (e.stack || e.message || e) });
  log(`[${JOB_NAME}] FAILED status=${done.status} next_retry_at=${done.next_retry_at ?? "NULL"}: ${e.message || e}`);
  db.close();
  process.exit(1);
}
