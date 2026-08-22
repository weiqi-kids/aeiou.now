#!/usr/bin/env node
// ===========================================================================
// aeiou.now — Job 17 Moderation Queue(草案 §33;2026-08-22 上線)
// ===========================================================================
//
// 用法(裸執行＝完整正確行為:拉 flag、建檔、套規則、回寫決定):
//   node scripts/moderation-queue.mjs
//   node scripts/moderation-queue.mjs --dry-run    只印會怎麼判,不寫任何一邊
//   node scripts/moderation-queue.mjs --report     印工作檯現況(待複核清單)
//
// -- 啟用範圍(2026-08-22 定版;這一項待辦的標題就是「moderation 啟用範圍」)-----
//   ✅ Post    —— 兩層:寫入時的規則層(Worker)+ 翻譯前的 LLM 價值閘門(translate-posts)
//   ✅ Comment —— 只有規則層。**留言不翻譯,所以永遠不會進 LLM 那條路**,
//                在這一版之前它是完全沒有被看過的(主機 comments 表 0 筆就是證據)。
//   ⬜ Image   —— 沒有圖片上傳,沒有東西可審(R2 接上之後才有意義)
//   ⬜ User    —— 沒有帳號系統(OAuth 未上線),「停權」現在沒有對象
//   ⬜ 人工檢舉 —— 前台的「回報錯誤/補充」刻意走**討論串**而不是這裡:
//                那是內容更正,不是違規檢舉。要做違規檢舉得先有帳號,否則檢舉本身
//                就是新的攻擊面(匿名者可以互相檢舉到對方消失)。
//
// -- 這一支做什麼 ----------------------------------------------------------
//   ① 從 D1 拉 `moderation_flags`(規則層在寫入當下記的)
//   ② 在主機建檔進 `moderation_queue` —— 工作檯在主機,因為判斷需要**歷史**:
//      「同一個 anon_id 第幾次命中」只有把紀錄放在一起才看得出來,而 D1 只存單次事件
//   ③ 套決策規則(見下),把 hide 決定回寫 D1
//   ④ 沒有把握的一律留 `pending` 等人 —— 這張表的存在意義就是「有東西等人看」
//
// -- 決策規則(刻意極少;寧可留著等人,不要自動殺錯)--------------------------
//   high                        → hide(規則層已經在寫入時擋掉了,這裡只是補建檔與決定紀錄)
//   同一 anon_id 累積 >= 3 次命中 → hide(單次可能是誤判,反覆命中不是)
//   其餘                         → pending,decision 留空
// **不做自動 delete、不做自動 suspend**:那兩個不可逆,而這一層沒有語意判斷能力。
//
// 失敗:寫 jobs(job_name='moderation-queue'),重試曲線同其他 job。

import { randomUUID } from "node:crypto";

import { CONFIG, api, openDb, beginJob, finishJob, slotStart, nowSec, log } from "./lib/aeiou-lib.mjs";

const JOB_NAME = "moderation-queue";
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const REPORT = argv.includes("--report");

/** 同一人反覆命中的門檻。1 次可能是誤判,3 次不是。 */
const REPEAT_HIDE_AT = 3;

const db = openDb();

if (REPORT) {
  const rows = db.prepare(
    `SELECT status, severity, reason, COUNT(*) AS n FROM moderation_queue
      GROUP BY status, severity, reason ORDER BY status, severity DESC, n DESC`,
  ).all();
  if (rows.length === 0) {
    console.log("工作檯是空的(沒有任何項目進過 moderation_queue)。");
  } else {
    console.log("status      severity  reason            筆數");
    console.log("----------  --------  ----------------  ----");
    for (const r of rows) {
      console.log(`${String(r.status).padEnd(10)}  ${String(r.severity).padEnd(8)}  ${String(r.reason).padEnd(16)}  ${r.n}`);
    }
  }
  const pending = db.prepare("SELECT COUNT(*) AS n FROM moderation_queue WHERE status = 'pending'").get().n;
  console.log(`\n待人工複核:${pending} 筆`);
  if (pending > 0) {
    console.log("看清單:sqlite3 -header -column db/aeiou.sqlite \"SELECT item_id,target_type,target_id,reason,severity,datetime(created_at,'unixepoch') FROM moderation_queue WHERE status='pending' ORDER BY severity DESC, created_at\"");
  }
  db.close();
  process.exit(0);
}

const job = beginJob(db, { jobName: JOB_NAME, scheduledAt: slotStart(900) });
log(`[${JOB_NAME}] job_id=${job.job_id} attempt=${job.attempt} api=${CONFIG.apiUrl}`);

try {
  const res = await api("/internal/moderation/flags?limit=500");
  const flags = Array.isArray(res.flags) ? res.flags : [];
  log(`[${JOB_NAME}] D1 待建檔 flag:${flags.length} 筆`);

  // 同一 anon_id 的歷史命中次數 —— 這正是工作檯要放在主機的理由。
  const priorByAnon = new Map();
  for (const r of db.prepare(
    "SELECT reported_by AS anon, COUNT(*) AS n FROM moderation_queue WHERE reported_by IS NOT NULL GROUP BY reported_by",
  ).all()) {
    priorByAnon.set(r.anon, r.n);
  }

  const now = nowSec();
  const toQueue = [];
  const hide = [];
  const synced = [];

  for (const f of flags) {
    const anon = f.anon_id || null;
    const prior = anon ? (priorByAnon.get(anon) || 0) : 0;
    const repeat = prior + 1;
    if (anon) priorByAnon.set(anon, repeat);

    // 決策:high 或反覆命中 → hide;其餘留 pending 等人。
    const decide = f.severity === "high" || repeat >= REPEAT_HIDE_AT;
    toQueue.push({
      item_id: `mod_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      target_type: f.target_type,
      target_id: f.target_id,
      reason: f.reason,
      reported_by: anon,           // NULL = 系統自動偵測(schema 註解如此定義)
      severity: f.severity,
      status: decide ? "resolved" : "pending",
      decision: decide ? "hide" : null,
      decided_by: decide ? "rule" : null,
      created_at: f.created_at || now,
      resolved_at: decide ? now : null,
      repeat,
    });
    if (decide) hide.push({ target_type: f.target_type, target_id: f.target_id });
    else synced.push({ target_type: f.target_type, target_id: f.target_id });
  }

  if (DRY_RUN) {
    for (const q of toQueue) {
      log(`  ${q.severity.padEnd(6)} ${q.reason.padEnd(15)} ${q.target_type}/${q.target_id} `
        + `第 ${q.repeat} 次 → ${q.decision || "pending"}`);
    }
    log(`[${JOB_NAME}] DRY_RUN:會建 ${toQueue.length} 筆、hide ${hide.length} 筆,不寫入`);
    finishJob(db, job, { status: "success", read: flags.length, updated: 0 });
    db.close();
    process.exit(0);
  }

  // 建檔。以 (target_type, target_id) 冪等:同一則內容只該在工作檯上出現一次。
  let created = 0;
  if (toQueue.length > 0) {
    db.exec("BEGIN");
    try {
      const exists = db.prepare(
        "SELECT 1 AS x FROM moderation_queue WHERE target_type = ? AND target_id = ?",
      );
      const ins = db.prepare(
        `INSERT INTO moderation_queue
           (item_id, target_type, target_id, reason, reported_by, severity, status,
            decision, decided_by, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const q of toQueue) {
        if (exists.get(q.target_type, q.target_id)) continue;
        ins.run(q.item_id, q.target_type, q.target_id, q.reason, q.reported_by, q.severity,
          q.status, q.decision, q.decided_by, q.created_at, q.resolved_at);
        created += 1;
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }

  // 回寫 D1:hide 的下架、其餘只標已建檔。**先建檔再回寫** —— 反過來的話,
  // 回寫成功但建檔失敗時,那一筆會永遠不再被拉出來,等於無聲遺失。
  if (hide.length > 0 || synced.length > 0) {
    const out = await api("/internal/moderation/decisions", {
      method: "POST",
      body: { synced, hide },
    });
    log(`[${JOB_NAME}] worker: ${JSON.stringify(out)}`);
  }

  const pending = db.prepare("SELECT COUNT(*) AS n FROM moderation_queue WHERE status = 'pending'").get().n;
  log(`[${JOB_NAME}] 建檔 ${created} 筆、下架 ${hide.length} 筆;工作檯待複核 ${pending} 筆`);
  finishJob(db, job, { status: "success", read: flags.length, created, updated: hide.length });
  log(`[${JOB_NAME}] success`);
  db.close();
} catch (e) {
  const done = finishJob(db, job, { status: "failed", error: e && (e.stack || e.message || e) });
  log(`[${JOB_NAME}] FAILED status=${done.status} next_retry_at=${done.next_retry_at ?? "NULL"}: ${e.message || e}`);
  db.close();
  process.exit(1);
}
