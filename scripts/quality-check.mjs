#!/usr/bin/env node
// ===========================================================================
// aeiou.now — Job 15 Content Quality Check + Job 16 Duplicate Check
//             (草案 §31 §32;2026-08-22 上線)
// ===========================================================================
//
// 用法(裸執行＝完整正確行為:全表檢查一次,冪等):
//   node scripts/quality-check.mjs
//   node scripts/quality-check.mjs --dry-run   只印判定,不寫
//   node scripts/quality-check.mjs --report    印各標籤的分佈與需要人看的清單
//
// -- 這一支補的是「結論沒有留下來」------------------------------------------
// 這個站已經有一整排內容閘門:check-content-depth(厚度)、check-source-urls(來源存活)、
// check-data-completeness(欄位齊全)、check-rendered-depth(渲染後重複)。
// 但它們全是**閘門** —— 只回答「這一輪能不能發布」,然後結論就消失了。
// `quality_checks` 表從建好到今天是 0 筆。後果是:
//   · 沒有辦法問「哪些 Topic 一直在 needs-review」——每次都要重跑全部閘門才知道
//   · 沒有辦法看趨勢:某個 Topic 是變好還是變壞,只有當下的紅綠燈
// 這一支把判定**記下來**,並且補上兩個閘門沒有涵蓋的軸:重複與來源歸屬。
//
// -- 標籤(草案 §31 的五個,判準寫死在這裡,不另立文件)-----------------------
//   verified      每一國 observance 都有來源,且來源都在該國官方網域(R6 通過)
//   source-backed 有來源,但至少一個不在該國官方網域(能查證,權威性次一級)
//   needs-review  沒有來源,或內容厚度未達目標 —— **要人去看**
//   low-quality   厚度明顯不足(未達目標的一半)
//   spam          這一層不判 spam:UGC 的 spam 判定在 moderation(Job 17),
//                 Topic 內容是人工寫的,沒有 spam 這個情形。**保留標籤不代表要用它**。
//
// -- Job 16 Duplicate Check ------------------------------------------------
// 草案 §32 列了五種重複,這裡做得到的是三種:
//   Source duplicate      同一個 URL 掛在多個 Topic 上 → 記一筆 needs-review
//   Topic duplicate       兩個 Topic 的 canonical/alias 正規化後相同
//   Translation duplicate 同一個 Topic 的兩個語系 summary 一字不差
//                         (七語各寫各的,一字不差就是有人複製貼上或漏翻)
// Post/Comment duplicate 屬 UGC,在 Job 17 的規則層(洗版偵測)那一側,不在這裡重複做。
// **不用 embedding_similarity**:Vectorize 是給語意搜尋的,拿它做去重會把
// 「同一件事的兩個面向」誤判成重複(例:中秋與月見)。這裡只用確定性的正規化比對。
//
// 失敗:寫 jobs(job_name='quality-check')。

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT, openDb, beginJob, finishJob, slotStart, nowSec, log } from "./lib/aeiou-lib.mjs";
// ⚠ 厚度一定要用**同一支函式**,不能自己再量一次。
// 第一版自己實作,把「唯一字元」讀成「相異字元數」(Set 的大小)——
// 中文一千八百字大約七百個相異字,英文同樣長度只有四十幾個,於是 35 個 Topic
// 全被判成 low-quality,而閘門說它們全部達標。閘門與標籤用不同量法,
// 就會做出「放行但標記為低品質」這種自相矛盾的狀態。
// 真正的定義是:整段字串去重之後,數非空白字元。
import { uniqueContentChars } from "./lib/content-depth.mjs";

const LOCALES = ["zh-TW", "en", "ja", "zh-CN", "hi", "id", "pt-BR"];
const JOB_NAME = "quality-check";
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const REPORT = argv.includes("--report");

/** 內容厚度目標(**唯一字元數**),與 check-content-depth.mjs 同一個值與同一個量法。
 *  那裡是閘門(擋發布),這裡是標籤(留紀錄)—— 兩者的門檻必須一致,
 *  否則會出現「閘門放行但標籤說 low-quality」這種自相矛盾的狀態。 */
const DEPTH_TARGET = 1200;

/** 各國官方網域,與 docs/03-topic-content.md 的表同源。R6 用它判「來源在不在該國」。 */
const OFFICIAL = {
  TW: [".gov.tw", ".edu.tw"], JP: [".go.jp", ".lg.jp"], CN: [".gov.cn", ".npc.gov.cn"],
  US: [".gov", ".mil"], IN: [".gov.in", ".nic.in"], ID: [".go.id"], BR: [".gov.br", ".jus.br"],
  SG: [".gov.sg", ".edu.sg"],
};

const db = openDb();

if (REPORT) {
  const rows = db.prepare(
    `SELECT label, checked_by, COUNT(*) AS n FROM quality_checks
      GROUP BY label, checked_by ORDER BY n DESC`,
  ).all();
  if (rows.length === 0) {
    console.log("quality_checks 是空的(還沒跑過)。");
  } else {
    console.log("label          by     筆數");
    console.log("-------------  -----  ----");
    for (const r of rows) {
      console.log(`${String(r.label).padEnd(13)}  ${String(r.checked_by).padEnd(5)}  ${r.n}`);
    }
  }
  const review = db.prepare(
    `SELECT q.target_id, q.label FROM quality_checks q
      WHERE q.label IN ('needs-review','low-quality') ORDER BY q.label, q.target_id`,
  ).all();
  if (review.length > 0) {
    console.log(`\n要人看的 ${review.length} 筆:`);
    for (const r of review) console.log(`  ${r.label.padEnd(13)} ${r.target_id}`);
  } else {
    console.log("\n沒有需要人看的項目。");
  }
  db.close();
  process.exit(0);
}

const job = beginJob(db, { jobName: JOB_NAME, scheduledAt: slotStart(3600) });

try {
  const now = nowSec();
  const results = []; // {target_type, target_id, label, checked_by}

  // ── 讀 data/ 的產出而不是重算 ────────────────────────────────────────────
  // facts.json 是 export-data 的輸出,已經把 observance 與來源合併好了;
  // 重新從 SQLite 拼一次只會拼出第二套可能漂移的邏輯。
  const topics = db.prepare(
    "SELECT topic_id, slug FROM topics WHERE status = 'active' AND access_source IS NOT 'trend'",
  ).all();

  const normalize = (s) => String(s || "").toLowerCase().replace(/[\s\-_'’.]/g, "");
  const byNorm = new Map();   // Topic duplicate
  const urlOwners = new Map(); // Source duplicate:url → [slug]

  for (const t of topics) {
    const fp = join(ROOT, "data", "topics", t.topic_id, "facts.json");
    if (!existsSync(fp)) {
      results.push({ target_type: "topic", target_id: t.slug, label: "needs-review", checked_by: "rule" });
      continue;
    }
    const f = JSON.parse(readFileSync(fp, "utf8"));

    // Topic duplicate:正規化後的名稱撞號
    const key = normalize(f.canonical_name || t.slug);
    if (!byNorm.has(key)) byNorm.set(key, []);
    byNorm.get(key).push(t.slug);

    // 來源:每一個**有內容的地方變體**都有來源嗎?來源在該國官方網域嗎?
    // ⚠ 不能只看 observances。常青 Topic(成年禮、婚俗、告別式…)一個 observance
    //   都沒有 —— 它們的逐國內容掛在 regional_notes 上。第一版寫成
    //   `hasAll = obs.length > 0`,於是那 11 個 Topic 全被判 needs-review,
    //   而它們的來源其實一個不缺。這與 compute-topic-scores 的 SourceScore
    //   只讀兩處來源是**同一個錯的兩次發生**:來源掛在三個地方,少讀一處就會誤判一整類。
    const units = [
      ...(f.observances || []).map((o) => ({ country_code: o.country_code, urls: o.source_urls || [] })),
      ...(f.regional_notes || []).map((n) => ({ country_code: n.country_code, urls: n.source_urls || [] })),
    ];
    let hasAll = units.length > 0;
    let allOfficial = true;
    for (const u0 of units) {
      if (u0.urls.length === 0) { hasAll = false; continue; }
      for (const u of u0.urls) {
        if (!urlOwners.has(u)) urlOwners.set(u, []);
        urlOwners.get(u).push(t.slug);
        let host = "";
        try { host = new URL(u).hostname.toLowerCase(); } catch { allOfficial = false; continue; }
        const suffixes = OFFICIAL[u0.country_code];
        // 沒有登記在表上的國家不判 —— 不知道它的官方網域長怎樣,就不要假裝知道。
        if (suffixes && !suffixes.some((sfx) => host === sfx.slice(1) || host.endsWith(sfx))) {
          allOfficial = false;
        }
      }
    }

    // 厚度:取最薄語系。量法**直接用閘門那一支**(見檔頭 import 上的說明)。
    const i18nPath = join(ROOT, "data", "topics", t.topic_id, "i18n.json");
    let thinnest = 0;
    let dupTranslation = false;
    if (existsSync(i18nPath)) {
      const i18n = JSON.parse(readFileSync(i18nPath, "utf8"));
      const perLocale = LOCALES.map((loc) => uniqueContentChars(f, i18n, loc));
      thinnest = perLocale.length ? Math.min(...perLocale) : 0;
      // Translation duplicate:兩個語系的 summary 一字不差 ——
      // 七語各寫各的,一字不差就是有人複製貼上或漏翻。
      const seen = new Map();
      for (const [loc, v] of Object.entries(i18n.locales || {})) {
        const sm = String(v.summary || "").trim();
        if (!sm) continue;
        if (seen.has(sm)) { dupTranslation = true; break; }
        seen.set(sm, loc);
      }
    }

    let label;
    if (thinnest < DEPTH_TARGET / 2) label = "low-quality";
    else if (!hasAll || thinnest < DEPTH_TARGET || dupTranslation) label = "needs-review";
    else if (allOfficial) label = "verified";
    else label = "source-backed";
    results.push({ target_type: "topic", target_id: t.slug, label, checked_by: "rule" });
  }

  // Topic duplicate:同一個正規化名稱有兩個以上 slug
  for (const [key, slugs] of byNorm) {
    if (slugs.length > 1) {
      log(`[${JOB_NAME}] ⚠ Topic 名稱撞號(正規化後 "${key}"):${slugs.join(", ")}`);
      for (const s of slugs) {
        results.push({ target_type: "topic", target_id: s, label: "needs-review", checked_by: "rule" });
      }
    }
  }
  // Source duplicate:同一個 URL 被多個 Topic 當來源。這**不一定是錯**
  // (一份 SKB 同時是好幾個節日的依據),所以只印出來,不改標籤。
  let sharedUrls = 0;
  for (const [, owners] of urlOwners) if (new Set(owners).size > 1) sharedUrls += 1;
  if (sharedUrls > 0) log(`[${JOB_NAME}] ${sharedUrls} 個來源網址被多個 Topic 共用(正常,只記錄)`);

  if (DRY_RUN) {
    const byLabel = new Map();
    for (const r of results) byLabel.set(r.label, (byLabel.get(r.label) || 0) + 1);
    for (const [l, n] of [...byLabel].sort()) log(`  ${l}: ${n}`);
    log(`[${JOB_NAME}] DRY_RUN:會寫 ${results.length} 筆,不寫入`);
    finishJob(db, job, { status: "success", read: results.length, updated: 0 });
    db.close();
    process.exit(0);
  }

  // 整批覆蓋:一個目標只保留**最新一次**判定。歷史趨勢由 jobs 表的執行紀錄承載,
  // 不需要在這裡堆疊每一次的結果(那會讓「現在是什麼標籤」變成一個要 GROUP BY 的問題)。
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM quality_checks WHERE checked_by = 'rule'").run();
    const ins = db.prepare(
      `INSERT INTO quality_checks (check_id, target_type, target_id, label, checked_by, checked_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const seen = new Set();
    for (const r of results) {
      const k = `${r.target_type}:${r.target_id}`;
      if (seen.has(k)) continue;      // 撞號那一輪可能重複 push 同一個 slug
      seen.add(k);
      ins.run(`qc_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
        r.target_type, r.target_id, r.label, r.checked_by, now);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  const counts = db.prepare("SELECT label, COUNT(*) AS n FROM quality_checks GROUP BY label").all();
  log(`[${JOB_NAME}] ${counts.map((c) => `${c.label}=${c.n}`).join(" ")}`);
  finishJob(db, job, { status: "success", read: results.length, updated: results.length });
  log(`[${JOB_NAME}] success`);
  db.close();
} catch (e) {
  const done = finishJob(db, job, { status: "failed", error: e && (e.stack || e.message || e) });
  log(`[${JOB_NAME}] FAILED status=${done.status} next_retry_at=${done.next_retry_at ?? "NULL"}: ${e.message || e}`);
  db.close();
  process.exit(1);
}
