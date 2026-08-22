#!/usr/bin/env node
// ===========================================================================
// aeiou.now — R2 冷資料歸檔(docs/02-data-model.md §4 §6;2026-08-22 上線)
// ===========================================================================
//
// 用法(裸執行＝完整正確行為:兩個方向都做一輪):
//   node scripts/archive-to-r2.mjs
//   node scripts/archive-to-r2.mjs --dry-run   只印會搬什麼
//   node scripts/archive-to-r2.mjs --report    印目前搬了多少、還剩多少
//   node scripts/archive-to-r2.mjs --days N    改判準天數(預設 30)
//
// -- 搬什麼、為什麼 --------------------------------------------------------
// 兩份冷資料,兩個方向:
//   ① `source_contents.raw_text`(主機 SQLite)—— 抓回來的來源全文。
//      資料模型 §4 早就寫著「30 天後移入 R2,此欄設 NULL,r2_key 記鍵」,只是沒人做。
//      這東西一頁動輒幾十 KB,而爬蟲每小時都在跑 —— 不搬走,主機的 SQLite 會單向長大。
//   ② 已封存貼文的全文(D1)—— 由 Worker 端 `/internal/jobs/archive-posts` 自己搬,
//      因為那份資料在 D1 而主機沒有直接寫入路徑。
//
// **搬走的是全文,不是紀錄。** 列還在、指標還在、統計還在,只有那一大塊字換了地方。
// 歷史排行只需要 snapshot 不需要貼文全文(§6),所以搬走完全不影響 1Y 排行。
//
// -- 唯一一種會真的弄丟資料的失敗 ------------------------------------------
// 「以為存進 R2 了,於是把原文清掉,但其實沒存進去」。所以兩邊都是**先寫 R2、
// 確認回應成功、才清原文**;而且 Worker 端沒綁 R2 時明確回 503 而不是靜靜當成功。
//
// 失敗:寫 jobs(job_name='archive-to-r2')。

import { CONFIG, api, openDb, beginJob, finishJob, slotStart, nowSec, log } from "./lib/aeiou-lib.mjs";

const JOB_NAME = "archive-to-r2";
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const REPORT = argv.includes("--report");
const DAYS = (() => {
  const i = argv.indexOf("--days");
  const n = i >= 0 ? Number(argv[i + 1]) : NaN;
  // `--days 0` 是合法的(全部都搬,用於驗證整條路),所以是 >= 0 而不是 > 0。
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30;
})();
/** 一輪搬幾筆。R2 沒有批次寫入,一筆一次往返,量大要分好幾輪慢慢搬。 */
const BATCH = 50;

const db = openDb();

if (REPORT) {
  const r = db.prepare(
    `SELECT COUNT(*) AS n,
            SUM(CASE WHEN r2_key IS NOT NULL THEN 1 ELSE 0 END) AS archived,
            SUM(CASE WHEN raw_text IS NOT NULL THEN LENGTH(raw_text) ELSE 0 END) AS bytes_local
       FROM source_contents`,
  ).get();
  console.log(`source_contents:${r.n} 筆,已歸檔 ${r.archived || 0},本地仍留 ${((r.bytes_local || 0) / 1024).toFixed(1)} KB`);
  const due = db.prepare(
    "SELECT COUNT(*) AS n FROM source_contents WHERE raw_text IS NOT NULL AND extracted_at < ?",
  ).get(nowSec() - DAYS * 86400).n;
  console.log(`超過 ${DAYS} 天待搬:${due}`);
  // ⚠ `--remote` 不可省。wrangler 的 r2 object get **預設讀本地模擬儲存**,
  //   少了它會回 "The specified key does not exist." —— 而那句話在剛把本地全文清掉之後
  //   讀起來像是資料弄丟了。2026-08-22 實際被這句話嚇過一次(資料好好的在 R2)。
  console.log("\n取回一份看看(--remote 不可省,否則讀的是本地模擬儲存):");
  console.log("  cd api && CLOUDFLARE_ACCOUNT_ID=9d9e58b5e0d1657b8f74bd2cbfc91ee3 \\");
  console.log("    npx wrangler r2 object get aeiou-archive/<r2_key> --remote --file -");
  console.log("列出桶裡有什麼(wrangler 沒有 list 子指令,走 API):");
  console.log("  curl -s \"https://api.cloudflare.com/client/v4/accounts/9d9e58b5e0d1657b8f74bd2cbfc91ee3/r2/buckets/aeiou-archive/objects\" \\");
  console.log("    -H \"Authorization: Bearer $(python3 -c \\\"import re;print(re.search(r'oauth_token = .([^\\\"]+).', open('/root/.config/.wrangler/config/default.toml').read()).group(1))\\\")\" | python3 -m json.tool");
  db.close();
  process.exit(0);
}

const job = beginJob(db, { jobName: JOB_NAME, scheduledAt: slotStart(86400) });
log(`[${JOB_NAME}] job_id=${job.job_id} attempt=${job.attempt} api=${CONFIG.apiUrl} days=${DAYS}`);

try {
  const cutoff = nowSec() - DAYS * 86400;

  // ── ① 主機的來源全文 ─────────────────────────────────────────────────────
  const rows = db.prepare(
    `SELECT source_id, raw_text FROM source_contents
      WHERE raw_text IS NOT NULL AND extracted_at < ? LIMIT ?`,
  ).all(cutoff, BATCH);

  let moved = 0;
  let bytes = 0;
  if (DRY_RUN) {
    for (const r of rows) log(`  ${r.source_id} ${(r.raw_text.length / 1024).toFixed(1)} KB`);
  } else {
    const upd = db.prepare(
      "UPDATE source_contents SET raw_text = NULL, r2_key = ? WHERE source_id = ?",
    );
    for (const r of rows) {
      const key = `sources/${r.source_id}.txt`;
      // 先寫 R2 → 成功了才清本地。反過來就是那唯一一種會弄丟資料的失敗。
      await api("/internal/archive/put", { method: "POST", body: { key, text: r.raw_text } });
      upd.run(key, r.source_id);
      moved += 1;
      bytes += r.raw_text.length;
    }
  }

  // ── ② D1 的封存貼文全文(Worker 自己搬)──────────────────────────────────
  let posts = { moved: 0, candidates: 0 };
  if (!DRY_RUN) {
    posts = await api("/internal/jobs/archive-posts", {
      method: "POST",
      body: { older_than_days: DAYS, limit: 200 },
    });
  }

  log(`[${JOB_NAME}] ${DRY_RUN ? "DRY_RUN:" : ""}來源全文搬 ${moved} 筆(${(bytes / 1024).toFixed(1)} KB)、`
    + `封存貼文搬 ${posts.moved || 0} 則`);
  finishJob(db, job, {
    status: "success",
    read: rows.length + (posts.candidates || 0),
    updated: moved + (posts.moved || 0),
  });
  log(`[${JOB_NAME}] success`);
  db.close();
} catch (e) {
  const done = finishJob(db, job, { status: "failed", error: e && (e.stack || e.message || e) });
  log(`[${JOB_NAME}] FAILED status=${done.status} next_retry_at=${done.next_retry_at ?? "NULL"}: ${e.message || e}`);
  db.close();
  process.exit(1);
}
