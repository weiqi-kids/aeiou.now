#!/usr/bin/env node
// ===========================================================================
// aeiou.now — Job 18 Ranking Snapshot(草案 §34;2026-08-22 上線)
// ===========================================================================
//
// 用法(裸執行＝完整正確行為:六窗 × 各 scope 各存一張,冪等):
//   node scripts/ranking-snapshot.mjs
//   node scripts/ranking-snapshot.mjs --dry-run   只印會存什麼
//   node scripts/ranking-snapshot.mjs --report    印現況(有幾張、涵蓋多長、最舊多舊)
//   node scripts/ranking-snapshot.mjs --prune     只做保存期修剪,不新增
//
// -- 為什麼是 hourly 而不是草案寫的每 15 分鐘 --------------------------------
// 草案 §34 寫「每 15 分鐘保存」。但這個站的分數**每小時才變一次**
// (`compute-topic-scores.mjs` 掛在 hourly-export),而且分數的時間基準刻意對齊
// 當日 UTC 午夜(見該檔:Proximity 吃 now 會讓每次執行都微幅變動,曾造成每小時
// 重寫 124 個檔)。在分數不變的情況下每 15 分鐘存一次,只會產生四份一模一樣的快照 ——
// 那不是歷史,那是雜訊,而且讓 `--report` 的「涵蓋多長」失去意義。
// 所以 granularity 用 `hourly`;真的需要 15m 時(8H 窗上線、分數改成即時算)再加。
// **這是刻意偏離草案,不是漏做**。
//
// -- 保存策略(docs/02-data-model.md §6)--------------------------------------
//   hourly → 保留 30 天(短窗的歷史趨勢)
//   daily  → 永久保留(支撐 7D/1M/3M/1Y 的長期趨勢;每天 UTC 00 時那一張升級為 daily)
// 歷史排行只需要 snapshot,**不需要貼文全文** —— 所以貼文將來移入 R2 完全不影響 1Y 排行。
//
// -- 冪等 --------------------------------------------------------------------
// UNIQUE (scope, window, taken_at);taken_at 對齊整點。同一小時重跑 → 覆蓋同一張,
// 不會長出第二份。
//
// 失敗:寫 jobs(job_name='ranking-snapshot')。

import { randomUUID } from "node:crypto";

import { openDb, beginJob, finishJob, slotStart, nowSec, log } from "./lib/aeiou-lib.mjs";

const JOB_NAME = "ranking-snapshot";
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const REPORT = argv.includes("--report");
const PRUNE_ONLY = argv.includes("--prune");

const HOURLY_KEEP_S = 30 * 86400;
/** 每張快照最多存幾名。Top 100 是草案 §24 的規則,超過的名次沒有人會回頭看。 */
const TOP_N = 100;

const db = openDb();

if (REPORT) {
  const rows = db.prepare(
    `SELECT granularity, COUNT(*) AS n,
            MIN(taken_at) AS oldest, MAX(taken_at) AS newest
       FROM ranking_snapshots GROUP BY granularity ORDER BY granularity`,
  ).all();
  if (rows.length === 0) {
    console.log("還沒有任何快照。");
  } else {
    console.log("granularity  張數   最舊                 最新");
    console.log("-----------  -----  -------------------  -------------------");
    const fmt = (t) => new Date(t * 1000).toISOString().slice(0, 19).replace("T", " ");
    for (const r of rows) {
      console.log(`${String(r.granularity).padEnd(11)}  ${String(r.n).padStart(5)}  ${fmt(r.oldest)}  ${fmt(r.newest)}`);
    }
  }
  const items = db.prepare("SELECT COUNT(*) AS n FROM ranking_items").get().n;
  console.log(`\nranking_items 共 ${items} 列`);
  db.close();
  process.exit(0);
}

const job = beginJob(db, { jobName: JOB_NAME, scheduledAt: slotStart(3600) });

try {
  const now = nowSec();
  const takenAt = Math.floor(now / 3600) * 3600; // 對齊整點,冪等的鍵
  // UTC 00 時那一張升級成 daily(永久保留)。用 UTC 而不是本地時間:主機與 CI 的 TZ
  // 差異不該決定哪一張被永久保留。
  const granularity = new Date(takenAt * 1000).getUTCHours() === 0 ? "daily" : "hourly";

  let created = 0;
  let itemsWritten = 0;

  if (!PRUNE_ONLY) {
    const combos = db.prepare(
      "SELECT DISTINCT scope, window FROM topic_scores ORDER BY scope, window",
    ).all();
    log(`[${JOB_NAME}] scope×window ${combos.length} 組,granularity=${granularity}`);

    if (!DRY_RUN) db.exec("BEGIN");
    try {
      const findSnap = db.prepare(
        "SELECT snapshot_id FROM ranking_snapshots WHERE scope = ? AND window = ? AND taken_at = ?",
      );
      const insSnap = db.prepare(
        `INSERT INTO ranking_snapshots (snapshot_id, scope, window, taken_at, granularity)
         VALUES (?, ?, ?, ?, ?)`,
      );
      const updSnap = db.prepare("UPDATE ranking_snapshots SET granularity = ? WHERE snapshot_id = ?");
      const delItems = db.prepare("DELETE FROM ranking_items WHERE snapshot_id = ?");
      const insItem = db.prepare(
        "INSERT INTO ranking_items (snapshot_id, rank, topic_id, score) VALUES (?, ?, ?, ?)",
      );
      const topScores = db.prepare(
        `SELECT topic_id, score FROM topic_scores WHERE scope = ? AND window = ?
          ORDER BY score DESC, topic_id ASC LIMIT ?`,
      );

      for (const c of combos) {
        const rows = topScores.all(c.scope, c.window, TOP_N);
        if (rows.length === 0) continue;
        if (DRY_RUN) {
          log(`  ${c.scope}/${c.window}: ${rows.length} 名(第一名 ${rows[0].topic_id} ${rows[0].score})`);
          itemsWritten += rows.length;
          continue;
        }
        const hit = findSnap.get(c.scope, c.window, takenAt);
        let sid;
        if (hit) {
          sid = hit.snapshot_id;
          updSnap.run(granularity, sid);
          delItems.run(sid); // 同一小時重跑 → 整張換掉,不留半舊半新
        } else {
          sid = `snp_${randomUUID().replace(/-/g, "").slice(0, 26)}`;
          insSnap.run(sid, c.scope, c.window, takenAt, granularity);
          created += 1;
        }
        rows.forEach((r, i) => insItem.run(sid, i + 1, r.topic_id, r.score));
        itemsWritten += rows.length;
      }
      if (!DRY_RUN) db.exec("COMMIT");
    } catch (e) {
      if (!DRY_RUN) db.exec("ROLLBACK");
      throw e;
    }
  }

  // 保存期修剪。**只修剪 hourly** —— daily 是永久的,那是 1Y 排行唯一的依據。
  let pruned = 0;
  if (!DRY_RUN) {
    const cutoff = now - HOURLY_KEEP_S;
    const olds = db.prepare(
      "SELECT snapshot_id FROM ranking_snapshots WHERE granularity = 'hourly' AND taken_at < ?",
    ).all(cutoff);
    if (olds.length > 0) {
      db.exec("BEGIN");
      try {
        const delI = db.prepare("DELETE FROM ranking_items WHERE snapshot_id = ?");
        const delS = db.prepare("DELETE FROM ranking_snapshots WHERE snapshot_id = ?");
        for (const o of olds) { delI.run(o.snapshot_id); delS.run(o.snapshot_id); }
        db.exec("COMMIT");
        pruned = olds.length;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
  }

  log(`[${JOB_NAME}] ${DRY_RUN ? "DRY_RUN:" : ""}新增快照 ${created} 張、寫入 ${itemsWritten} 列、修剪 ${pruned} 張`);
  finishJob(db, job, { status: "success", read: itemsWritten, created, updated: pruned });
  log(`[${JOB_NAME}] success`);
  db.close();
} catch (e) {
  const done = finishJob(db, job, { status: "failed", error: e && (e.stack || e.message || e) });
  log(`[${JOB_NAME}] FAILED status=${done.status} next_retry_at=${done.next_retry_at ?? "NULL"}: ${e.message || e}`);
  db.close();
  process.exit(1);
}
