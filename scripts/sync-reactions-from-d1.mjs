#!/usr/bin/env node
// ===========================================================================
// aeiou.now — D1 reaction 計數 → 主機 reaction_totals(2026-08-21 新增)
// ===========================================================================
//
// 用法(裸執行＝完整正確行為:四種 target_type 全拉,整批覆蓋):
//   node scripts/sync-reactions-from-d1.mjs
//   node scripts/sync-reactions-from-d1.mjs --dry-run   只印比對結果,不寫主機庫
//
// -- 這一支在補什麼 -------------------------------------------------------
// reaction 的權威在 D1(讀者按的),主機沒有。於是 `/topics/events/` 與 `/topics/nearby/`
// 的 emoji 排序只能在前端做:靜態先印一個順序,等 JS 拿到 `/v1/reactions/summary`
// 再整批重排。兩個後果:
//   ① 讀者看得到那一跳(尤其在慢速網路上,排序會在眼前跳一次);
//   ② **不執行 JS 的爬蟲看到的永遠是未排序的那一版** —— 而那正是搜尋引擎看到的版本。
// 把計數回流到主機、進 `data/`,靜態就已經是對的順序;前端那一段重排退成微調
// (它仍然有用:回流每小時一次,前端拿到的是這一秒的數字)。
//
// -- 方向是單向的 --------------------------------------------------------
// D1 → 主機,**只讀不寫**。主機端的 `reaction_totals` 是副本不是權威:整批覆蓋,
// 主機不改它、不據此做任何判斷,只餵給 export-data。所以這支跑失敗最多是排序不新鮮,
// 不會讓任何資料失真 —— 它掛在 hourly-export.sh 裡且**不 fail-closed**,理由同
// compute-topic-scores(見該檔頭與 hourly-export.sh 的註解)。
//
// -- 為什麼不存 actor_id --------------------------------------------------
// 端點只回聚合。主機不需要知道誰按的,而把匿名者的行為軌跡搬出 D1 也不是回流該做的事。
//
// 環境變數:
//   AEIOU_API_URL          Worker base URL(預設 workers.dev)
//   AEIOU_DB_PATH          主機 SQLite
//   AEIOU_SYNC_SECRET_FILE secret 檔(預設 ~/.config/aeiou/sync-secret)
//
// 失敗:寫 jobs(job_name='sync-reactions'),重試曲線同其他 job。

import { CONFIG, api, openDb, beginJob, finishJob, slotStart, nowSec, log } from "./lib/aeiou-lib.mjs";

const JOB_NAME = "sync-reactions";
const DRY_RUN = process.argv.includes("--dry-run");

// 契約 §4 的四種。place/event 是靜態排序真正要用的兩種,post/comment 一併拉是因為
// 端點形狀一樣、成本一樣,而 HotScore 的 EngagementScore 遲早會想從主機讀它們
// (現在它讀的是 D1 回流的 posts,reaction 那一半一直是空的)。
const TARGET_TYPES = ["place", "event", "post", "comment"];

const db = openDb();
const job = beginJob(db, { jobName: JOB_NAME, scheduledAt: slotStart(3600) });
log(`[${JOB_NAME}] job_id=${job.job_id} attempt=${job.attempt} api=${CONFIG.apiUrl} db=${CONFIG.dbPath}`);

try {
  const now = nowSec();
  const incoming = [];
  for (const targetType of TARGET_TYPES) {
    const res = await api(`/internal/ugc/reaction-totals?target_type=${targetType}`);
    const items = Array.isArray(res.items) ? res.items : [];
    for (const row of items) {
      if (!row || typeof row.target_id !== "string" || row.target_id === "") continue;
      incoming.push({
        target_type: targetType,
        target_id: row.target_id,
        total: Number(row.total) || 0,
        actors: Number(row.actors) || 0,
      });
    }
    log(`[${JOB_NAME}] ${targetType}: ${items.length} 個目標有 reaction`);
  }

  const before = db.prepare("SELECT COUNT(*) AS n FROM reaction_totals").get().n;

  if (DRY_RUN) {
    log(`[${JOB_NAME}] DRY_RUN:主機現有 ${before} 列,D1 回 ${incoming.length} 列,不寫入`);
    finishJob(db, job, { status: "success", read: incoming.length, updated: 0 });
    db.close();
    process.exit(0);
  }

  // 整批覆蓋而不是 upsert:reaction 可以被收回(op='remove' 會刪列),
  // 只 upsert 的話「歸零的目標」會永遠停在最後一次的非零值 —— 那是會慢慢腐爛的假資料。
  // 副本表整批重寫很便宜(這張表只有被按過的目標才有列)。
  // node:sqlite 沒有 better-sqlite3 的 db.transaction() —— 手開(同 gsc-topic-metrics.mjs)。
  // 一定要包在交易裡:DELETE 與 INSERT 之間如果有人讀這張表,會讀到一張空表。
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM reaction_totals").run();
    const ins = db.prepare(
      `INSERT INTO reaction_totals (target_type, target_id, total, actors, synced_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const r of incoming) ins.run(r.target_type, r.target_id, r.total, r.actors, now);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  log(`[${JOB_NAME}] 主機 reaction_totals:${before} → ${incoming.length} 列`);
  finishJob(db, job, { status: "success", read: incoming.length, updated: incoming.length });
  log(`[${JOB_NAME}] success`);
  db.close();
} catch (e) {
  const done = finishJob(db, job, { status: "failed", error: e && (e.stack || e.message || e) });
  log(`[${JOB_NAME}] FAILED status=${done.status} next_retry_at=${done.next_retry_at ?? "NULL"}: ${e.message || e}`);
  db.close();
  process.exit(1);
}
