#!/usr/bin/env node
// ===========================================================================
// aeiou.now — Topic 語意索引同步(草案 §57;docs/02-data-model.md §2.7;2026-08-22)
// ===========================================================================
//
// 用法(裸執行＝完整正確行為:只推變了的,並清掉不該留在索引裡的):
//   node scripts/sync-search-index.mjs
//   node scripts/sync-search-index.mjs --force     忽略指紋,全部重推
//   node scripts/sync-search-index.mjs --dry-run   印出會推什麼
//   node scripts/sync-search-index.mjs --report    印索引現況與抽查一次搜尋
//
// -- 索引的是名字,不是內容 --------------------------------------------------
// 向量來源 = `canonical_name` + 全部 alias + **七語 title** + **七語 keywords**。
// 刻意不含 summary 與逐國散文:那些字太長,會把「這個 Topic 是什麼」稀釋成
// 「這個 Topic 提到過什麼」,搜「情人節」會被一篇提到情人節的中秋內容拉走。
//
// keywords 是 §2.7 沒寫、但實測必須要的一項。只放 title 時,查「mooncake」
// 或「kue bulan」一個結果都沒有 —— 中秋那個 Topic 的英文與印尼文標題裡沒有「月餅」
// 這個詞。而 keywords 正好是**人工策展的「別人會怎麼稱呼它」**:短、準、每語一份,
// 沒有散文的稀釋問題。加進去之後那兩個查詢就命中了。
//
// -- 只推變了的 --------------------------------------------------------------
// 與 sync-topics-to-d1.mjs 同一個模式:state 檔存逐列 hash,只送 hash 變了的。
// 這裡更需要它 —— 每一次 upsert 都要跑一次 embedding,而 Workers AI 是按用量計的。
// 全量重推只在 `--force` 發生。
//
// -- 不公開的 Topic 要從索引移除 ---------------------------------------------
// candidate/merged 是**不公開**的兩種。留在索引裡會讓搜尋指到一個讀者點不進去的
// 地方 —— 那比搜不到更糟。查詢端也擋一次(兩道),因為索引的更新是非同步的。
//
// 失敗:寫 jobs(job_name='sync-search-index')。

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { CONFIG, ROOT, api, openDb, beginJob, finishJob, slotStart, nowSec, log } from "./lib/aeiou-lib.mjs";

const JOB_NAME = "sync-search-index";
const argv = process.argv.slice(2);
const FORCE = argv.includes("--force");
const DRY_RUN = argv.includes("--dry-run");
const REPORT = argv.includes("--report");
const STATE_FILE = resolve(ROOT, "db", ".sync-state-search.json");
const CHUNK = 25; // 一次 embedding 幾個。端點上限 50,取一半留餘裕。

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const db = openDb();

/** Topic → 要餵進索引的那一串字。主機這邊組好,Worker 不去猜串哪些欄位。 */
function buildRows() {
  const topics = db.prepare(
    `SELECT topic_id, slug, canonical_name, category, status FROM topics
      WHERE access_source IS NOT 'trend' ORDER BY topic_id`,
  ).all();
  const aliases = new Map();
  for (const a of db.prepare("SELECT topic_id, alias FROM topic_aliases ORDER BY topic_id, alias").all()) {
    if (!aliases.has(a.topic_id)) aliases.set(a.topic_id, []);
    aliases.get(a.topic_id).push(a.alias);
  }
  const titles = new Map();
  for (const t of db.prepare(
    "SELECT topic_id, locale, title, keywords_json FROM topic_i18n ORDER BY topic_id, locale",
  ).all()) {
    if (!titles.has(t.topic_id)) titles.set(t.topic_id, []);
    const bucket = titles.get(t.topic_id);
    if (t.title) bucket.push(t.title);
    // keywords 壞掉不該讓整個 Topic 進不了索引 —— 少幾個同義詞比完全搜不到好。
    try {
      const kw = JSON.parse(t.keywords_json || "[]");
      if (Array.isArray(kw)) for (const k of kw) if (typeof k === "string" && k.trim()) bucket.push(k.trim());
    } catch { /* 忽略 */ }
  }
  return topics.map((t) => {
    // 去重後串接:同一個名字重複出現不會讓它「更像自己」,只是浪費 token。
    const parts = [...new Set([
      t.canonical_name,
      ...(aliases.get(t.topic_id) || []),
      ...(titles.get(t.topic_id) || []),
    ].filter(Boolean))];
    return {
      topic_id: t.topic_id,
      slug: t.slug,
      category: t.category,
      status: t.status,
      text: parts.join(" · "),
      hidden: t.status === "candidate" || t.status === "merged",
    };
  });
}

if (REPORT) {
  const rows = buildRows();
  console.log(`可索引 Topic:${rows.filter((r) => !r.hidden).length}(不公開 ${rows.filter((r) => r.hidden).length} 個不進索引)`);
  const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
  console.log(`state 檔記著 ${Object.keys(state.rows || {}).length} 個已推送`);
  console.log("\n抽查一次搜尋(跨語言是這個索引唯一的理由,所以用日文查中文的 Topic):");
  console.log(`  curl -s "${CONFIG.apiUrl}/v1/search?q=$(printf %s 'バレンタイン' | jq -sRr @uri)" | python3 -m json.tool`);
  db.close();
  process.exit(0);
}

const job = beginJob(db, { jobName: JOB_NAME, scheduledAt: slotStart(3600) });

try {
  const rows = buildRows();
  const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
  const prev = state.rows || {};
  const next = {};

  const toPush = [];
  const toDelete = [];
  for (const r of rows) {
    if (r.hidden) {
      // 之前推過才需要刪 —— 沒推過的不必為它多打一次請求。
      if (prev[r.topic_id]) toDelete.push(r.topic_id);
      continue;
    }
    const h = sha256(`${r.text}|${r.slug}|${r.category}|${r.status}`);
    next[r.topic_id] = h;
    if (FORCE || prev[r.topic_id] !== h) toPush.push(r);
  }
  // state 裡有、但這一輪的 Topic 清單裡完全沒有的(被刪掉了)也要清出索引。
  for (const id of Object.keys(prev)) {
    if (!rows.some((r) => r.topic_id === id)) toDelete.push(id);
  }

  log(`[${JOB_NAME}] 可索引 ${rows.filter((r) => !r.hidden).length} 個:要推 ${toPush.length}、要刪 ${toDelete.length}`);

  if (DRY_RUN) {
    for (const r of toPush.slice(0, 10)) log(`  + ${r.slug}: ${r.text.slice(0, 80)}`);
    if (toPush.length > 10) log(`  … 另外 ${toPush.length - 10} 個`);
    log(`[${JOB_NAME}] DRY_RUN:不寫入`);
    finishJob(db, job, { status: "success", read: rows.length, updated: 0 });
    db.close();
    process.exit(0);
  }

  let upserted = 0;
  for (let i = 0; i < toPush.length; i += CHUNK) {
    const chunk = toPush.slice(i, i + CHUNK).map((r) => ({
      topic_id: r.topic_id, slug: r.slug, category: r.category, status: r.status, text: r.text,
    }));
    const res = await api("/internal/search/index", { method: "POST", body: { topics: chunk } });
    upserted += res.upserted || 0;
  }
  if (toDelete.length > 0) {
    await api("/internal/search/delete", { method: "POST", body: { topic_ids: toDelete } });
    for (const id of toDelete) delete next[id];
  }

  // 指紋只在**請求成功之後**才寫 —— 上面任何一步 throw 都不會走到這裡,下輪重推。
  writeFileSync(STATE_FILE, `${JSON.stringify({ rows: next, synced_at: nowSec() }, null, 2)}\n`, "utf8");

  log(`[${JOB_NAME}] upsert ${upserted}、delete ${toDelete.length}`);
  finishJob(db, job, { status: "success", read: rows.length, updated: upserted });
  log(`[${JOB_NAME}] success`);
  db.close();
} catch (e) {
  const done = finishJob(db, job, { status: "failed", error: e && (e.stack || e.message || e) });
  log(`[${JOB_NAME}] FAILED status=${done.status} next_retry_at=${done.next_retry_at ?? "NULL"}: ${e.message || e}`);
  db.close();
  process.exit(1);
}
