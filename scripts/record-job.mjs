#!/usr/bin/env node
// aeiou.now — 從 shell 腳本寫一筆 jobs 紀錄(Track D / W4.3 用)
//   node scripts/record-job.mjs --job-name hourly-export --status success \
//        [--scope global] [--scheduled-at <epoch>] \
//        [--read N] [--created N] [--updated N] [--failed N] [--error "訊息"]
//
// begin + finish 一次做完(shell 端不需要跨行程持有 job 物件),
// 沿用 lib 的重試曲線:失敗 +5 分 → +10 分 → 第三次 dlq。
// 成功時印出 job_id。

import { openDb, beginJob, finishJob, slotStart } from "./lib/aeiou-lib.mjs";

const argv = process.argv.slice(2);
const arg = (name, dflt = undefined) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
};
const num = (name) => Number.parseInt(arg(name, "0"), 10) || 0;

const jobName = arg("job-name");
const status = arg("status");
if (!jobName || !status) {
  console.error("usage: record-job.mjs --job-name <name> --status <success|partial_success|failed|skipped> [...]");
  process.exit(2);
}

const db = openDb();
const job = beginJob(db, {
  jobName,
  scope: arg("scope", "global"),
  scheduledAt: Number.parseInt(arg("scheduled-at", String(slotStart(3600))), 10),
});
const done = finishJob(db, job, {
  status,
  read: num("read"),
  created: num("created"),
  updated: num("updated"),
  failed: num("failed"),
  error: arg("error", null),
});
db.close();
console.log(`${done.job_id} ${done.status} attempt=${done.attempt} next_retry_at=${done.next_retry_at ?? "NULL"}`);
