#!/usr/bin/env node
// aeiou.now — 主機 SQLite → D1 每日世界一問精簡副本(2026-08-15 新增,仿 sync-topics-to-d1.mjs)
//   node scripts/sync-questions-to-d1.mjs
//
// 主機 questions/question_options(全欄+文案)→ POST /internal/sync/questions
// → D1 questions(精簡副本,見 docs/briefs/daily-question.md §3;文案與答案**不進 D1**,D1 只驗票)。
// 語意 = upsert 覆蓋(以 question_id 為準)。
//
// 內容沒變就不推(比照 sync-topics-to-d1.mjs 2026-08-13 的教訓):題庫只在人工改
// content/questions.json 才會變,但本支掛在 */15 的 cron 上,不比對 hash 就會每輪
// 無條件全量寫入同樣的列。比對 payload 的 sha256:一樣 → 不發請求,只記 success。
//
// 保底:hash 一樣但距上次真正同步已超過 FORCE_INTERVAL_SEC,仍強制推一次
// (D1 那側若掉資料或被手動改過,主機這邊才不會因為「我沒變」永遠不再補)。
//
// 環境變數:
//   AEIOU_API_URL          Worker base URL(預設 workers.dev;切自訂網域只改這裡)
//   AEIOU_DB_PATH          主機 SQLite(預設 /root/aeiou.now/db/aeiou.sqlite)
//   AEIOU_SYNC_SECRET_FILE secret 檔(預設 ~/.config/aeiou/sync-secret)
//   AEIOU_QUESTIONS_SYNC_STATE_FILE  上次同步指紋(預設 db/.sync-state-questions.json;不進 git;
//                                     刻意跟 sync-topics 的 db/.sync-state.json 用不同檔,別撞 key)
//   AEIOU_SYNC_FORCE=1     忽略 hash,強制全量推(等同 --force)
//
// 失敗:寫 jobs(job_name='sync-questions'),重試 +5 分 / +10 分 / 第三次 dlq。

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { CONFIG, ROOT, api, openDb, beginJob, finishJob, slotStart, nowSec, log } from "./lib/aeiou-lib.mjs";

const JOB_NAME = "sync-questions";

// 獨立的狀態檔路徑與 key,不與 sync-topics-to-d1.mjs 的 db/.sync-state.json 共用。
const STATE_FILE = process.env.AEIOU_QUESTIONS_SYNC_STATE_FILE || resolve(ROOT, "db", ".sync-state-questions.json");
const FORCE_INTERVAL_SEC = Number(process.env.AEIOU_SYNC_FORCE_INTERVAL_SEC || 6 * 3600);
const FORCE = process.env.AEIOU_SYNC_FORCE === "1" || process.argv.includes("--force");

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

/** 讀上次同步指紋;檔不存在或壞掉一律當成「沒有紀錄」→ 照推,不因為狀態檔而漏同步 */
function readState() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) || {};
  } catch {
    log(`[${JOB_NAME}] state 檔讀取失敗,視為無紀錄:${STATE_FILE}`);
    return {};
  }
}

/** 只在 Worker 真的回應成功之後才寫,失敗的那輪下次仍會重推 */
function writeState(state, entry) {
  writeFileSync(STATE_FILE, `${JSON.stringify({ ...state, [JOB_NAME]: entry }, null, 2)}\n`, "utf8");
}

const db = openDb();
const job = beginJob(db, { jobName: JOB_NAME, scheduledAt: slotStart(900) });
log(`[${JOB_NAME}] job_id=${job.job_id} attempt=${job.attempt} api=${CONFIG.apiUrl} db=${CONFIG.dbPath}`);

try {
  const rows = db
    .prepare(
      `SELECT question_id, qdate, kind, topic_id, status
         FROM questions
        ORDER BY question_id`
    )
    .all();

  const optionRows = db
    .prepare("SELECT question_id, option_id FROM question_options ORDER BY question_id, ord")
    .all();
  const optionsByQuestion = new Map();
  for (const r of optionRows) {
    if (!optionsByQuestion.has(r.question_id)) optionsByQuestion.set(r.question_id, []);
    optionsByQuestion.get(r.question_id).push(r.option_id);
  }

  // payload 照 docs/briefs/api-contract.md §7.4:
  //   { questions: [ { question_id, qdate, kind, topic_id, options: [option_id...ord], status } ] }
  const payload = {
    questions: rows.map((r) => ({
      question_id: r.question_id,
      qdate: r.qdate,
      kind: r.kind,
      topic_id: r.topic_id,
      options: optionsByQuestion.get(r.question_id) ?? [],
      status: r.status,
    })),
  };

  const read = payload.questions.length;
  log(`[${JOB_NAME}] host: ${payload.questions.length} questions`);

  // payload 的陣列已在 SQL 層 ORDER BY,物件鍵序也是字面常數 → 同內容必得同 hash
  const hash = sha256(JSON.stringify(payload));
  const state = readState();
  const prev = state[JOB_NAME];
  const age = prev?.synced_at ? nowSec() - prev.synced_at : Infinity;
  const stale = age >= FORCE_INTERVAL_SEC;

  if (!FORCE && prev?.hash === hash && !stale) {
    finishJob(db, job, { status: "success", read, updated: 0 });
    log(`[${JOB_NAME}] 內容未變(hash=${hash.slice(0, 12)},距上次同步 ${age}s)— skip,不發請求`);
    log(`[${JOB_NAME}] success (nothing to do)`);
    db.close();
    process.exit(0);
  }

  const reason = FORCE ? "強制" : prev?.hash === hash ? `保底重推(距上次 ${age}s ≥ ${FORCE_INTERVAL_SEC}s)` : "內容有變";
  log(`[${JOB_NAME}] ${reason},全量 upsert(hash=${hash.slice(0, 12)})`);
  for (const q of payload.questions) log(`  - ${q.question_id} ${q.qdate} ${q.kind} status=${q.status}`);

  const res = await api("/internal/sync/questions", { method: "POST", body: payload });
  log(`[${JOB_NAME}] worker: ${JSON.stringify(res)}`);

  // Worker 回應成功之後才記指紋;上面 api() 若 throw 就走 catch,這行不會執行 → 下輪重推
  writeState(state, { hash, synced_at: nowSec() });

  finishJob(db, job, {
    status: "success",
    read,
    // upsert 覆蓋語意下 Worker 不回報 insert/update 之分,一律計 updated
    updated: res.questions_upserted || 0,
  });
  log(`[${JOB_NAME}] success`);
  db.close();
} catch (e) {
  const done = finishJob(db, job, { status: "failed", error: e && (e.stack || e.message || e) });
  log(`[${JOB_NAME}] FAILED status=${done.status} next_retry_at=${done.next_retry_at ?? "NULL"}: ${e.message || e}`);
  db.close();
  process.exit(1);
}
