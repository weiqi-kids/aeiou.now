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
// 內容沒變就不推(2026-08-13):topics 是人工改 content/topics/*.md 才會變的東西,
// 但本支掛在 */15 的 cron 上,原本每輪都無條件 upsert 同樣的 80 列進 D1
// (每天 96 次全量寫入,資料一個字都沒變)。改成比對 payload 的 sha256:
//   一樣 → 不發請求,直接記 success;不一樣 → 照舊全量 upsert。
// 對照 export-data.mjs 的「hash 沒變不寫檔」,同一個保護這裡本來漏了。
//
// 保底:hash 一樣但距上次真正同步已超過 FORCE_INTERVAL_SEC,仍強制推一次。
// 沒有這道保底的話,D1 那側若掉資料或被手動改過,主機這邊會因為「我沒變」而永遠不再補。
//
// 只推真的變了的列(2026-08-20):上面那道「內容沒變就不推」擋的是「完全沒變」,
// 擋不掉「只改了一個 Topic」——只要有一個字不一樣,原本就整包 355 topics + 2,485 topic_i18n
// 全部重寫一次。那天實測 D1 rows_written_24h 到 124,464,而 rows_read_24h 只有 100,369,
// read_queries 才 382:寫入量與真人流量完全不成比例,壓垮它的是自己的同步。
// 改法:state 檔多記一份逐列 hash,只送 hash 變了的列。
// **安全性來自 Worker 端是純 upsert、不做 delete**(api/src/routes/internal.js):
// 沒送到的列原樣留著,不會被清掉。全量推的路徑照樣保留(--force 與保底重推),
// 所以 D1 那側若掉資料,最多 FORCE_INTERVAL_SEC 之後就會補回來。
//
// 不同步趨勢 Topic(2026-08-20,用戶指示):主機的 355 個 Topic 裡有 317 個是趨勢 Topic,
// 而趨勢 Topic **還沒上線**(前端要先能區分機器/人工 Topic 才會復活,見 docs/TODO.md)。
// 沒有任何頁面連到它們,所以 D1 上也沒有任何貼文/留言/反應/排行指到它們
// (刪除前實查:posts_on_trend=0、comments=0、reactions=0、ranking_items=0)。
// 把它們推進 D1 只是讓每次全量推從 38 + 266 列漲成 355 + 2,485 列。
//
// 🔴 **趨勢 Topic 復活時,要改的就是下面那個 WHERE**。改回來之後跑一次 --force
//    才會把它們補進 D1;差異同步不會自己想起沒送過的列。
//
// 環境變數:
//   AEIOU_API_URL          Worker base URL(預設 workers.dev;切自訂網域只改這裡)
//   AEIOU_DB_PATH          主機 SQLite(預設 /mnt/customer/aeiou.now/db/aeiou.sqlite)
//   AEIOU_SYNC_SECRET_FILE secret 檔(預設 ~/.config/aeiou/sync-secret)
//   AEIOU_SYNC_STATE_FILE  上次同步指紋(預設 db/.sync-state.json;不進 git)
//   AEIOU_SYNC_FORCE=1     忽略 hash,強制全量推(等同 --force)
//
// 失敗:寫 jobs(job_name='sync-topics'),重試 +5 分 / +10 分 / 第三次 dlq。

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { CONFIG, ROOT, api, openDb, beginJob, finishJob, slotStart, nowSec, log } from "./lib/aeiou-lib.mjs";
import { TREND_ACCESS_SOURCE } from "./lib/topics.mjs";

const JOB_NAME = "sync-topics";

const STATE_FILE = process.env.AEIOU_SYNC_STATE_FILE || resolve(ROOT, "db", ".sync-state.json");
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
  // 進行中的期別:一個 topic 至多一筆 ended_at IS NULL(取最新起始的那筆保底)
  const rows = db
    .prepare(
      `SELECT t.topic_id, t.slug, t.status, t.access_level, t.is_perennial, t.global_score,
              (SELECT c.cycle_id FROM topic_cycles c
                WHERE c.topic_id = t.topic_id AND c.ended_at IS NULL
                ORDER BY c.started_at DESC LIMIT 1) AS current_cycle_id
         FROM topics t
        WHERE t.access_source IS NOT ?
        ORDER BY t.topic_id`
    )
    .all(TREND_ACCESS_SOURCE);

  // i18n 也要用同一個條件過濾 —— 否則會把「D1 上沒有那個 topic」的 i18n 列 upsert 進去,
  // 留下一堆指不到 topic 的孤兒。
  const i18n = db
    .prepare(
      `SELECT i.topic_id, i.locale, i.title, i.keywords_json
         FROM topic_i18n i
         JOIN topics t ON t.topic_id = i.topic_id
        WHERE t.access_source IS NOT ?
        ORDER BY i.topic_id, i.locale`
    )
    .all(TREND_ACCESS_SOURCE);

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
    // keywords 2026-08-22 起也送:Worker 的搜尋要用它做**字面命中**那一層
    // (向量把精確名稱稀釋掉了,見 api/src/routes/search.js 的說明)。
    topic_i18n: i18n.map((r) => ({
      topic_id: r.topic_id, locale: r.locale, title: r.title, keywords_json: r.keywords_json ?? null,
    })),
  };

  const read = payload.topics.length + payload.topic_i18n.length;
  log(`[${JOB_NAME}] host: ${payload.topics.length} topics / ${payload.topic_i18n.length} topic_i18n`);

  // payload 兩個陣列都已在 SQL 層 ORDER BY,物件鍵序也是字面常數 → 同內容必得同 hash
  const hash = sha256(JSON.stringify(payload));
  // 逐列 hash:key 要能唯一指到 D1 的一列(topics 以 topic_id、topic_i18n 以 topic_id+locale 為 PK)
  const rowHashes = {};
  for (const t of payload.topics) rowHashes[`t|${t.topic_id}`] = sha256(JSON.stringify(t));
  for (const i of payload.topic_i18n) rowHashes[`i|${i.topic_id}|${i.locale}`] = sha256(JSON.stringify(i));

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

  // 全量推的時機:強制、保底重推、或 state 沒有逐列 hash(第一次跑到新版、或狀態檔壞掉)。
  // 其餘情況只推 hash 變了的列 —— 沒送到的列在 D1 原樣留著(Worker 是純 upsert)。
  const prevRows = prev && prev.rows && typeof prev.rows === "object" ? prev.rows : null;
  const full = FORCE || stale || !prevRows;
  const outgoing = full
    ? payload
    : {
        topics: payload.topics.filter((t) => prevRows[`t|${t.topic_id}`] !== rowHashes[`t|${t.topic_id}`]),
        topic_i18n: payload.topic_i18n.filter(
          (i) => prevRows[`i|${i.topic_id}|${i.locale}`] !== rowHashes[`i|${i.topic_id}|${i.locale}`]
        ),
      };
  const outCount = outgoing.topics.length + outgoing.topic_i18n.length;

  log(`[${JOB_NAME}] ${reason},${full ? "全量" : "差異"} upsert(hash=${hash.slice(0, 12)};`
    + `送 ${outgoing.topics.length} topics / ${outgoing.topic_i18n.length} topic_i18n,`
    + `全量會是 ${payload.topics.length} / ${payload.topic_i18n.length})`);
  // 逐列印出來只在差異模式有意義;全量模式印 355 行只是把 log 洗掉。
  if (!full) for (const t of outgoing.topics) log(`  - ${t.topic_id} ${t.slug} cycle=${t.current_cycle_id ?? "NULL"}`);

  if (outCount === 0) {
    // hash 變了但沒有任何一列變 → payload 的鍵序或非 PK 欄位動過,不必寫 D1,但要更新指紋
    writeState(state, { hash, synced_at: prev?.synced_at ?? nowSec(), rows: rowHashes });
    finishJob(db, job, { status: "success", read, updated: 0 });
    log(`[${JOB_NAME}] 沒有任何一列變 — 不發請求,只更新指紋`);
    log(`[${JOB_NAME}] success (nothing to do)`);
    db.close();
    process.exit(0);
  }

  const res = await api("/internal/sync/topics", { method: "POST", body: outgoing });
  log(`[${JOB_NAME}] worker: ${JSON.stringify(res)}`);

  // Worker 回應成功之後才記指紋;上面 api() 若 throw 就走 catch,這行不會執行 → 下輪重推
  writeState(state, { hash, synced_at: nowSec(), rows: rowHashes });

  finishJob(db, job, {
    status: "success",
    read,
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
