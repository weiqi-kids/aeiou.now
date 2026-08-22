// aeiou.now — 主機 cron 管線共用工具(Track D / W4)
//
// 只用 node 內建模組(node:sqlite / fetch / node:crypto),零 npm 依賴。
//
// 內容:
//   - 設定(Worker 網址、主機 SQLite 路徑、SYNC_SECRET 檔路徑)全走環境變數,預設值寫在此
//   - readSecret():只從 ~/.config/aeiou/sync-secret 讀,**永不進 log、永不進 git**
//   - api():內部端點呼叫,Authorization: Bearer <SYNC_SECRET>
//   - jobs 表:beginJob / finishJob,含重試曲線(+5 分 → +10 分 → 第三次 DLQ)
//   - job_locks 表:acquireLock,同一 (scope, job_name, scheduled_at) 只跑一次,
//     並用 pid 存活檢查擋掉「前一輪還在跑」的重入
//
// 契約矛盾備註:docs/02-data-model.md §7 的 status 註解列舉為
//   queued|running|success|partial_success|failed|skipped(沒有 dlq),
//   但 Track D 交辦書明文要求「第三次進 DLQ 狀態」。
//   依 _shared-context.md「與各 Track 工作項目衝突時以該 Track 為準」,此處採 status='dlq'。
//   判準等價寫法:status='dlq' ⇔ 已達 3 次失敗、不再自動重試(next_retry_at IS NULL)。

import { DatabaseSync } from "node:sqlite";
import { randomFillSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const LOCALES = ["zh-TW", "en", "ja", "zh-CN", "hi", "id", "pt-BR"];

export const CONFIG = {
  // 日後切自訂網域只改這個環境變數,碼與 cron 不用動
  apiUrl: (process.env.AEIOU_API_URL || "https://aeiou-api.lightman-chang.workers.dev").replace(/\/+$/, ""),
  dbPath: process.env.AEIOU_DB_PATH || join(ROOT, "db", "aeiou.sqlite"), // 介面常數,不得改
  secretPath:
    process.env.AEIOU_SYNC_SECRET_FILE ||
    join(process.env.HOME || "/root", ".config", "aeiou", "sync-secret"),
};

export const nowSec = () => Math.floor(Date.now() / 1000);

// cron 槽對齊:*/15 的槽 = floor(now/900)*900
export const slotStart = (period, t = nowSec()) => Math.floor(t / period) * period;

// ---------- ULID(Crockford base32,26 字元;與 Worker 端同構) ----------
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function ulid(now = Date.now()) {
  let ts = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    ts = B32[t % 32] + ts;
    t = Math.floor(t / 32);
  }
  const rnd = randomFillSync(new Uint8Array(16));
  let r = "";
  for (let i = 0; i < 16; i++) r += B32[rnd[i] % 32];
  return ts + r;
}

// ---------- secret ----------
let _secret = null;
export function readSecret() {
  if (_secret !== null) return _secret;
  try {
    _secret = readFileSync(CONFIG.secretPath, "utf8").trim();
  } catch (e) {
    throw new Error(`cannot read sync secret from ${CONFIG.secretPath}: ${e.code || e.message}`);
  }
  if (!_secret) throw new Error(`sync secret file is empty: ${CONFIG.secretPath}`);
  return _secret;
}

// ---------- Worker 內部端點 ----------
// 錯誤訊息只帶 status + 回應 body,**絕不帶 Authorization**(避免 secret 進 log/jobs.error_message)
export async function api(path, { method = "GET", body = undefined, timeoutMs = 60000 } = {}) {
  const url = CONFIG.apiUrl + path;
  const headers = { Authorization: `Bearer ${readSecret()}` };
  if (body !== undefined) headers["Content-Type"] = "application/json; charset=utf-8";
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 500)}`);
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${method} ${path} -> non-JSON response: ${text.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

// ---------- SQLite ----------
export function openDb(readOnly = false) {
  const db = new DatabaseSync(CONFIG.dbPath, { readOnly });
  // */15 與 0 * * * * 兩條 cron 在整點會同時醒來,都要寫 jobs 表;
  // 給足 busy_timeout 才不會其中一支被 SQLITE_BUSY 打掉。
  db.exec("PRAGMA busy_timeout = 15000");
  return db;
}

// ---------- job_locks ----------
const LOCK_TTL = 6 * 3600; // 超過這個歲數的鎖一律清掉(避免 job_locks 無限長大)
// 只有「pid 還活著 **且** 鎖沒超過這個歲數」才算前一輪還在跑。
// 沒有這道上限的話,pid 被系統回收再指派給別的行程時,會被誤判成「前一輪還在跑」而永久卡住。
const MAX_INFLIGHT = 3 * 3600;

function pidAlive(lockedBy) {
  // locked_by 格式 "<hostname>:<pid>";非本機的鎖無法判斷,一律當作存活(保守)
  const idx = lockedBy.lastIndexOf(":");
  if (idx < 0) return true;
  const host = lockedBy.slice(0, idx);
  const pid = Number.parseInt(lockedBy.slice(idx + 1), 10);
  if (host !== hostname() || !Number.isFinite(pid)) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 取得排程槽鎖。回傳 { ok: true } 或 { ok: false, reason }。
 *  - 同一 (scope, job_name, scheduled_at) 只跑一次 → PK 衝突即 skip
 *  - 前一槽的行程還活著 → skip(擋住「跑很久的前一輪」被下一輪 cron 追撞)
 * 鎖列**不在結束時刪除**(那正是「同槽只跑一次」的依據),靠 TTL 與 pid 死亡判定回收。
 */
export function acquireLock(db, { scope = "global", jobName, scheduledAt }) {
  const now = nowSec();
  db.prepare("DELETE FROM job_locks WHERE job_name = ? AND scope = ? AND locked_at < ?").run(
    jobName,
    scope,
    now - LOCK_TTL
  );

  const live = db
    .prepare(
      "SELECT scheduled_at, locked_by, locked_at FROM job_locks WHERE scope = ? AND job_name = ? AND scheduled_at <> ?"
    )
    .all(scope, jobName, scheduledAt)
    .filter((r) => r.locked_at > now - MAX_INFLIGHT && pidAlive(r.locked_by));
  if (live.length > 0) {
    return {
      ok: false,
      reason: `previous run still in flight (slot ${live[0].scheduled_at}, holder ${live[0].locked_by})`,
    };
  }

  try {
    db.prepare(
      "INSERT INTO job_locks (scope, job_name, scheduled_at, locked_by, locked_at) VALUES (?, ?, ?, ?, ?)"
    ).run(scope, jobName, scheduledAt, `${hostname()}:${process.pid}`, now);
  } catch (e) {
    if (String(e.message || e).includes("UNIQUE") || String(e.code || "").includes("CONSTRAINT"))
      return { ok: false, reason: `slot ${scheduledAt} already claimed` };
    throw e;
  }
  return { ok: true };
}

// ---------- jobs ----------
const RETRY_BACKOFF = [300, 600]; // 第 1 次失敗 +5 分、第 2 次 +10 分;第 3 次 → dlq
export const MAX_ATTEMPTS = 3;

/**
 * 開一筆 job。若上一輪同名 job 是「失敗且已到重試時間」,就沿用該列累加 attempt
 * (重試鏈同一個 job_id,才看得出這是第幾次)。否則開新列 attempt=1。
 */
export function beginJob(db, { jobName, scope = "global", scheduledAt = nowSec() }) {
  const now = nowSec();

  // 收掉早已死掉卻卡在 running 的列。行程被硬殺(OOM、逾時、機器重開、開發時 Ctrl-C)
  // 時沒有人會去改狀態,於是它永遠停在 running —— finishJob 只在 try/catch 走得到的
  // 路徑上被呼叫,行程整個消失時那兩條路都不會走。
  // 同一個坑 trend-pipeline.mjs 已經為 trend_runs 修過(見該檔「收斂卡住的 running run」),
  // jobs 表當時漏了同一道;2026-08-20 開發期間就留下 19 筆 compute-topic-scores 的殘留,
  // 讓手冊裡「最近的 job 成敗」那條查法讀起來像現在壞掉。
  // 判準用 6 小時的絕對值,不用「兩倍 slot」——jobs 表混著 15 分、每小時、每日三種節奏,
  // 沒有共用的 slot 間隔可以推。6 小時遠大於最長的一支(hourly-export 必須在一小時內
  // 跑完,否則會撞上下一輪),又遠小於「隔天才被發現」。
  // **刻意標成 failed 而不是刪列**:這一次執行的真實結果是「沒有收尾」,那就是失敗;
  // 刪掉等於把它從沒發生過。next_retry_at 保持 NULL,所以不會觸發重試鏈
  // (下面那個 SELECT 要求 next_retry_at IS NOT NULL)。
  const stale = db.prepare(
    `UPDATE jobs SET status = 'failed',
                     finished_at = COALESCE(finished_at, started_at),
                     error_message = COALESCE(error_message,
                       'stale: 行程未正常結束(未走到 finishJob),由後續執行收斂')
      WHERE status = 'running' AND started_at < ?`
  ).run(now - 6 * 3600);
  if (stale.changes) log(`[jobs] 收斂 ${stale.changes} 筆卡住的 running job`);

  const prev = db
    .prepare(
      `SELECT job_id, attempt FROM jobs
        WHERE job_name = ? AND scope = ? AND status = 'failed'
          AND next_retry_at IS NOT NULL AND next_retry_at <= ?
        ORDER BY scheduled_at DESC, rowid DESC LIMIT 1`
    )
    .get(jobName, scope, now);

  if (prev) {
    const attempt = prev.attempt + 1;
    db.prepare(
      `UPDATE jobs SET scheduled_at = ?, started_at = ?, finished_at = NULL,
                       status = 'running', attempt = ?, next_retry_at = NULL,
                       records_read = 0, records_created = 0, records_updated = 0,
                       records_failed = 0, error_message = NULL
        WHERE job_id = ?`
    ).run(scheduledAt, now, attempt, prev.job_id);
    return { job_id: prev.job_id, job_name: jobName, scope, scheduled_at: scheduledAt, attempt };
  }

  const jobId = "job_" + ulid();
  db.prepare(
    `INSERT INTO jobs (job_id, job_name, scope, scheduled_at, started_at, finished_at,
                       status, attempt, next_retry_at,
                       records_read, records_created, records_updated, records_failed, error_message)
     VALUES (?, ?, ?, ?, ?, NULL, 'running', 1, NULL, 0, 0, 0, 0, NULL)`
  ).run(jobId, jobName, scope, scheduledAt, now);
  return { job_id: jobId, job_name: jobName, scope, scheduled_at: scheduledAt, attempt: 1 };
}

/**
 * 收尾一筆 job。
 * status:success | partial_success | skipped | failed
 * 失敗時自動排重試:attempt 1 → +5 分、attempt 2 → +10 分、attempt 3 → status='dlq'(不再自動重試)。
 */
export function finishJob(db, job, { status, read = 0, created = 0, updated = 0, failed = 0, error = null }) {
  const now = nowSec();
  let finalStatus = status;
  let nextRetryAt = null;
  let message = error == null ? null : String(error).slice(0, 2000);

  if (status === "failed") {
    if (job.attempt >= MAX_ATTEMPTS) {
      finalStatus = "dlq";
      message = `DLQ(第 ${job.attempt} 次失敗,不再自動重試):${message || "unknown error"}`;
    } else {
      nextRetryAt = now + RETRY_BACKOFF[job.attempt - 1];
    }
  }

  db.prepare(
    `UPDATE jobs SET finished_at = ?, status = ?, next_retry_at = ?,
                     records_read = ?, records_created = ?, records_updated = ?,
                     records_failed = ?, error_message = ?
      WHERE job_id = ?`
  ).run(now, finalStatus, nextRetryAt, read, created, updated, failed, message, job.job_id);

  return { ...job, status: finalStatus, next_retry_at: nextRetryAt };
}

export function log(...args) {
  console.log(new Date().toISOString(), ...args);
}
