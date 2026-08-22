#!/usr/bin/env node
// ===========================================================================
// aeiou.now — Job 9 Feed Expiration + Job 10 Comment Activity(草案 §23 §25)
// ===========================================================================
//
// 用法(裸執行＝完整正確行為):
//   node scripts/feed-maintenance.mjs
//
// 這一支是**薄的**:真正的邏輯在 Worker 的 `/internal/jobs/feed-maintenance`,
// 因為那兩個 job 動的是 D1 的 posts/comments,而主機沒有 D1 的直接寫入路徑
// (與 sync-reactions-from-d1.mjs 相反的方向:那支是讀,這支是改)。
// 主機端存在的理由只有兩個:記進 `jobs` 表(否則維護查詢看不到它跑過沒),
// 以及沿用同一條重試曲線。
//
// 兩個 job 在 Worker 端合成**一次掃描** —— 它們都要走 posts 全表,而 D1 免費額度
// 按 rows_read 計。分兩支跑等於白讀一遍。判準與紅線寫在該端點的註解裡。
//
// 失敗:寫 jobs(job_name='feed-maintenance')。

import { CONFIG, api, openDb, beginJob, finishJob, slotStart, log } from "./lib/aeiou-lib.mjs";

const JOB_NAME = "feed-maintenance";
const db = openDb();
const job = beginJob(db, { jobName: JOB_NAME, scheduledAt: slotStart(3600) });
log(`[${JOB_NAME}] job_id=${job.job_id} attempt=${job.attempt} api=${CONFIG.apiUrl}`);

try {
  const r = await api("/internal/jobs/feed-maintenance", { method: "POST", body: {} });
  log(`[${JOB_NAME}] 活性重算 ${r.activity_updated} 則;復活 ${r.revived}、降溫 ${r.cooled}、封存 ${r.archived}`);
  finishJob(db, job, {
    status: "success",
    read: r.activity_updated || 0,
    updated: (r.revived || 0) + (r.cooled || 0) + (r.archived || 0),
  });
  log(`[${JOB_NAME}] success`);
  db.close();
} catch (e) {
  const done = finishJob(db, job, { status: "failed", error: e && (e.stack || e.message || e) });
  log(`[${JOB_NAME}] FAILED status=${done.status} next_retry_at=${done.next_retry_at ?? "NULL"}: ${e.message || e}`);
  db.close();
  process.exit(1);
}
