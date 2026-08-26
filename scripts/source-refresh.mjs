#!/usr/bin/env node
// ===========================================================================
// aeiou.now — Job 1/2 來源清冊與爬搜(草案 §12 §13;2026-08-22 上線)
// ===========================================================================
//
// 用法(裸執行＝完整正確行為:匯入清冊、抓到期的來源、更新指紋與下次時間):
//   node scripts/source-refresh.mjs
//   node scripts/source-refresh.mjs --import-only  只把清冊匯入 sources 表,不抓
//   node scripts/source-refresh.mjs --dry-run      印出這一輪會抓誰,不發任何請求
//   node scripts/source-refresh.mjs --report       印清冊與抓取現況
//   node scripts/source-refresh.mjs --limit N      這一輪最多抓 N 個(預設 25)
//
// -- 清冊在哪 --------------------------------------------------------------
// `content/source-registry.json` 是**人工編輯的唯一入口**(與 content/topics/*.md
// 同一種慣例)。`sources` 表是它的產物,直接改表會被下次匯入蓋掉。
//
// -- 爬蟲守則(草案 §12,逐條;違反任何一條就不是「抓得比較多」而是不能用)------
//   ✅ 遵守 robots.txt      —— 每個網域抓之前先取 robots.txt 並快取,Disallow 就跳過
//   ✅ 遵守 Crawl-delay     —— robots.txt 有寫就照它,沒寫用預設的網域間隔
//   ✅ 表明身分             —— User-Agent 寫明是誰、為什麼、上哪找聯絡方式
//   ✅ 同網域串行 + 間隔     —— 不對同一個網域並發
//   ❌ 不繞過登入/CAPTCHA/付費牆/存取控制 —— 401/403 一律當「不准抓」,記 status 不重試繞路
//
// -- 分級(草案 §13)--------------------------------------------------------
// 900 / 3600 / 21600 / 86400 四級。Scheduler 每小時醒來,但只抓 `next_crawl_at` 到期的,
// 所以低頻來源一天只被碰一次。**變了才記**:content_hash 沒變就只更新時間,
// 不寫 source_contents —— 那張表要留給真正的變更,不是每次抓取的副本。
//
// -- 這一支不做 Topic Detection ---------------------------------------------
// 草案 §14 的 Job 3(從內容判斷新 Topic)需要 embedding 與 LLM,而且它產生的是
// **機器 Topic** —— 那條線的 kill switch 現在是關的(trend-pipeline.mjs,
// 用戶 2026-08-19 拍板)。在那個開關打開之前,抓回來的內容只進 source_contents,
// 不會自己長出 Topic。**這是刻意的**:先把「抓得乾淨、抓得合規」做對,
// 再談要不要讓它自動產內容。
//
// 失敗:寫 jobs(job_name='source-refresh')。

import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT, openDb, beginJob, finishJob, slotStart, nowSec, log } from "./lib/aeiou-lib.mjs";

const JOB_NAME = "source-refresh";
const argv = process.argv.slice(2);
const IMPORT_ONLY = argv.includes("--import-only");
const DRY_RUN = argv.includes("--dry-run");
const REPORT = argv.includes("--report");
const LIMIT = (() => {
  const i = argv.indexOf("--limit");
  const n = i >= 0 ? Number(argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 25;
})();

/** 表明身分。對方要封鎖我們時要封鎖得掉 —— 那是守則的一部分,不是風險。 */
const UA = "aeiou-now-bot/1.0 (+https://aeiou.now/about/; topic source refresh; contact via site)";
/** robots.txt 沒寫 Crawl-delay 時,同一網域兩次請求之間至少隔這麼久。 */
const DEFAULT_DELAY_MS = 2000;
const FETCH_TIMEOUT_MS = 20000;
const VALID_FREQ = new Set([900, 3600, 21600, 86400]);
/** 草案 §12 的八類。清冊裡不是這八類之一就擋下 —— 不讓 source_type 變成自由字串。 */
const VALID_TYPES = new Set([
  "search_engine", "news", "local_media", "official_website",
  "event_website", "public_community", "public_social", "local_business",
]);

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const db = openDb();

if (REPORT) {
  const rows = db.prepare(
    `SELECT source_type, status, COUNT(*) AS n,
            SUM(CASE WHEN crawled_at IS NOT NULL THEN 1 ELSE 0 END) AS crawled
       FROM sources GROUP BY source_type, status ORDER BY n DESC`,
  ).all();
  console.log("source_type       status      筆數  抓過");
  console.log("----------------  ----------  ----  ----");
  for (const r of rows) {
    console.log(`${String(r.source_type).padEnd(16)}  ${String(r.status).padEnd(10)}  `
      + `${String(r.n).padStart(4)}  ${String(r.crawled).padStart(4)}`);
  }
  // ⚠ 這個數字要與底下真正挑選的條件**一模一樣**,否則報表會說「345 個到期」
  //   而實際只抓得到 42 個(那 303 個 trend 列不在八類裡,根本不會被挑)。
  //   報表的數字說謊比沒有報表更糟。
  const due = db.prepare(
    `SELECT COUNT(*) AS n FROM sources
      WHERE next_crawl_at <= ? AND status != 'ignored'
        AND source_type IN (${[...VALID_TYPES].map(() => "?").join(",")})`,
  ).get(nowSec(), ...VALID_TYPES).n;
  const contents = db.prepare("SELECT COUNT(*) AS n FROM source_contents").get().n;
  console.log(`\n現在到期待抓:${due}　source_contents 已存:${contents}`);
  db.close();
  process.exit(0);
}

const job = beginJob(db, { jobName: JOB_NAME, scheduledAt: slotStart(3600) });

try {
  const now = nowSec();

  // ── 匯入清冊(冪等;以 url 對應既有列,沿用 source_id) ─────────────────────
  const regPath = join(ROOT, "content", "source-registry.json");
  let imported = 0;
  if (existsSync(regPath)) {
    const reg = JSON.parse(readFileSync(regPath, "utf8"));
    const list = Array.isArray(reg.sources) ? reg.sources : [];
    const bad = [];
    for (const s of list) {
      if (!s || typeof s.url !== "string" || !/^https?:\/\//.test(s.url)) { bad.push(`壞網址:${s?.url}`); continue; }
      if (!VALID_TYPES.has(s.type)) bad.push(`type 不在草案 §12 的八類:${s.url} → ${s.type}`);
      if (s.crawl_freq_s != null && !VALID_FREQ.has(s.crawl_freq_s)) bad.push(`crawl_freq_s 不是分級值:${s.url} → ${s.crawl_freq_s}`);
    }
    if (bad.length > 0) {
      // 清冊是人工入口,壞掉要當場說清楚 —— 但不擋整支:已在表裡的來源照樣該被更新。
      for (const b of bad.slice(0, 10)) log(`[${JOB_NAME}] ⚠ 清冊:${b}`);
      if (bad.length > 10) log(`[${JOB_NAME}] ⚠ 清冊另有 ${bad.length - 10} 筆問題`);
    }
    db.exec("BEGIN");
    try {
      const find = db.prepare("SELECT source_id FROM sources WHERE url = ?");
      const ins = db.prepare(
        `INSERT INTO sources (source_id, url, domain, source_type, language, country_code, city_code,
                              title, published_at, crawled_at, next_crawl_at, crawl_freq_s,
                              content_hash, quality_score, trust_score, status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, NULL, NULL, 'new', ?)`,
      );
      // ⚠ next_crawl_at 也要拉回來(2026-08-26 修)。
      // 同一個網址可能**先**被別的匯入器登記過:import-topic-occurrences.mjs 用
      // source_type='calendar'、crawl_freq_s=31536000、next_crawl_at=now+365 天 登記日曆來源,
      // import-topics.mjs 用 'manual' 做同樣的事 —— 那對「人工引用的佐證」是對的,
      // 它們本來就不該被爬(兩個 type 都不在八類裡)。
      // 但這一支的清冊匯入只改 source_type 與 crawl_freq_s,**不動 next_crawl_at**,
      // 於是那個網址變成了八類之一、卻仍然排在一年後 → 永遠選不到。
      // 2026-08-26 實查:event_website 15/15、official_website 136/190 就是這樣卡住的,
      // 全部 crawled_at IS NULL,next_crawl_at 落在 2027-08。
      // 用 MIN() 而不是直接覆寫:已經照自己節奏排好的來源不該被匯入打亂,
      // 只把「排得比自己的週期還遠」的拉回來。
      const upd = db.prepare(
        `UPDATE sources SET source_type = ?, language = ?, country_code = ?, city_code = ?,
                            crawl_freq_s = ?,
                            -- 從沒抓過的直接到期(它本來就欠一次);抓過的退回一個週期,
                            -- 避免匯入變成「每次都重抓一輪」。
                            next_crawl_at = MIN(next_crawl_at,
                              CASE WHEN crawled_at IS NULL THEN ? ELSE ? + ? END),
                            updated_at = ?
          WHERE source_id = ?`,
      );
      for (const s of list) {
        if (!s || typeof s.url !== "string" || !/^https?:\/\//.test(s.url)) continue;
        if (!VALID_TYPES.has(s.type)) continue;
        const freq = VALID_FREQ.has(s.crawl_freq_s) ? s.crawl_freq_s : 86400;
        let host = "";
        try { host = new URL(s.url).hostname.toLowerCase(); } catch { continue; }
        const hit = find.get(s.url);
        if (hit) {
          upd.run(s.type, s.language ?? null, s.country_code ?? null, s.city_code ?? null, freq,
            now, now, freq, now, hit.source_id);
        } else {
          ins.run(`src_${randomUUID().replace(/-/g, "").slice(0, 26)}`, s.url, host, s.type,
            s.language ?? null, s.country_code ?? null, s.city_code ?? null, now, freq, now);
          imported += 1;
        }
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    log(`[${JOB_NAME}] 清冊 ${list.length} 筆:新增 ${imported}`);
  } else {
    log(`[${JOB_NAME}] 沒有 content/source-registry.json,略過匯入`);
  }

  if (IMPORT_ONLY) {
    finishJob(db, job, { status: "success", read: imported, created: imported });
    db.close();
    process.exit(0);
  }

  // ── 挑到期的 ─────────────────────────────────────────────────────────────
  // 只抓清冊管得到的類型。trend/manual 那些歷史列不在八類裡,匯入時不會被碰,
  // 這裡也不抓 —— 它們是別條管線的產物,不是清冊的一部分。
  const due = db.prepare(
    `SELECT source_id, url, domain, crawl_freq_s, content_hash FROM sources
      WHERE next_crawl_at <= ? AND status != 'ignored' AND source_type IN (${
        [...VALID_TYPES].map(() => "?").join(",")})
      ORDER BY next_crawl_at ASC LIMIT ?`,
  ).all(now, ...VALID_TYPES, LIMIT);

  if (DRY_RUN) {
    for (const d of due) log(`  ${d.domain} ${d.url}`);
    log(`[${JOB_NAME}] DRY_RUN:這一輪會抓 ${due.length} 個(上限 ${LIMIT}),不發請求`);
    finishJob(db, job, { status: "success", read: due.length, updated: 0 });
    db.close();
    process.exit(0);
  }

  // ── robots.txt(每網域取一次,本輪快取)───────────────────────────────────
  const robotsCache = new Map(); // host → {allow(path)=>bool, delayMs}
  async function robotsFor(host) {
    if (robotsCache.has(host)) return robotsCache.get(host);
    let rules = { disallow: [], allow: [], delayMs: DEFAULT_DELAY_MS };
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(`https://${host}/robots.txt`, {
        headers: { "User-Agent": UA }, signal: ac.signal, redirect: "follow",
      });
      clearTimeout(t);
      if (res.ok) {
        const text = await res.text();
        // 只讀套用到我們的段落:User-agent: * 與明確指名 aeiou-now-bot 的那一段。
        let applies = false;
        for (const raw of text.split(/\r?\n/)) {
          const line = raw.replace(/#.*$/, "").trim();
          if (!line) continue;
          const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
          if (!m) continue;
          const key = m[1].toLowerCase();
          const val = m[2].trim();
          if (key === "user-agent") {
            applies = val === "*" || val.toLowerCase().includes("aeiou-now-bot");
            continue;
          }
          if (!applies) continue;
          if (key === "disallow" && val) rules.disallow.push(val);
          else if (key === "allow" && val) rules.allow.push(val);
          else if (key === "crawl-delay") {
            const d = Number(val);
            if (Number.isFinite(d) && d > 0) rules.delayMs = Math.min(60000, d * 1000);
          }
        }
      }
      // robots.txt 取不到(404/網路錯)→ 視為沒有限制,這是 RFC 9309 的預設行為。
    } catch {
      // 同上:取不到就用預設值,不因為 robots.txt 讀失敗而放棄整個網域。
    }
    const allow = (path) => {
      // 最長前綴優先;Allow 與 Disallow 同長時 Allow 勝(與主流爬蟲一致)。
      let best = null;
      for (const p of rules.disallow) if (path.startsWith(p) && (!best || p.length > best.len)) best = { len: p.length, ok: false };
      for (const p of rules.allow) if (path.startsWith(p) && (!best || p.length >= best.len)) best = { len: p.length, ok: true };
      return best ? best.ok : true;
    };
    const out = { allow, delayMs: rules.delayMs };
    robotsCache.set(host, out);
    return out;
  }

  // ── 抓 ───────────────────────────────────────────────────────────────────
  // 同網域**串行**:先照 domain 分組,每組內順序抓並在請求之間等 delay。
  const byDomain = new Map();
  for (const d of due) {
    if (!byDomain.has(d.domain)) byDomain.set(d.domain, []);
    byDomain.get(d.domain).push(d);
  }

  let fetched = 0; let changed = 0; let skipped = 0; let errored = 0;
  const updOk = db.prepare(
    `UPDATE sources SET crawled_at = ?, next_crawl_at = ?, content_hash = ?, title = ?,
                        status = 'processed', updated_at = ? WHERE source_id = ?`,
  );
  const updSkip = db.prepare(
    "UPDATE sources SET next_crawl_at = ?, status = ?, updated_at = ? WHERE source_id = ?",
  );
  const upsertContent = db.prepare(
    `INSERT INTO source_contents (source_id, raw_text, r2_key, extracted_at)
     VALUES (?, ?, NULL, ?)
     ON CONFLICT (source_id) DO UPDATE SET raw_text = excluded.raw_text,
       r2_key = NULL, extracted_at = excluded.extracted_at`,
  );

  for (const [host, items] of byDomain) {
    const robots = await robotsFor(host);
    for (let i = 0; i < items.length; i += 1) {
      const s = items[i];
      if (i > 0) await sleep(robots.delayMs);
      let path = "/";
      try { path = new URL(s.url).pathname; } catch { /* 用預設 */ }
      if (!robots.allow(path)) {
        // robots.txt 說不准 → **不抓**,並且把它標成 ignored,下次連挑都不挑。
        updSkip.run(now + 86400 * 30, "ignored", now, s.source_id);
        skipped += 1;
        log(`[${JOB_NAME}] robots 禁止,標為 ignored:${s.url}`);
        continue;
      }
      try {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(s.url, {
          headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
          signal: ac.signal, redirect: "follow",
        });
        clearTimeout(t);
        if (res.status === 401 || res.status === 403) {
          // 存取控制。草案 §12:**不得繞過**。標 ignored 就是「我們不該來這裡」。
          updSkip.run(now + 86400 * 30, "ignored", now, s.source_id);
          skipped += 1;
          log(`[${JOB_NAME}] ${res.status} 存取受限,不繞過,標為 ignored:${s.url}`);
          continue;
        }
        if (!res.ok) {
          updSkip.run(now + s.crawl_freq_s, "error", now, s.source_id);
          errored += 1;
          continue;
        }
        const html = await res.text();
        // 只留可讀文字。這裡不做結構化抽取 —— 那是 Job 3 的事,而 Job 3 的開關是關的。
        const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
          .replace(/\s+/g, " ").trim().slice(0, 300);
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const hash = sha256(text);
        fetched += 1;
        updOk.run(now, now + s.crawl_freq_s, hash, title || null, now, s.source_id);
        // **變了才記**。沒變就只更新時間 —— source_contents 要留給真正的變更,
        // 不是每次抓取的副本(那會讓這張表以抓取次數的速度長大)。
        if (hash !== s.content_hash) {
          upsertContent.run(s.source_id, text.slice(0, 200000), now);
          changed += 1;
        }
      } catch (e) {
        updSkip.run(now + s.crawl_freq_s, "error", now, s.source_id);
        errored += 1;
        log(`[${JOB_NAME}] 抓取失敗 ${s.url}: ${String(e.message || e).slice(0, 120)}`);
      }
    }
  }

  log(`[${JOB_NAME}] 到期 ${due.length}:抓到 ${fetched}(內容有變 ${changed})、`
    + `依守則跳過 ${skipped}、失敗 ${errored}`);
  finishJob(db, job, {
    status: errored > 0 && fetched === 0 ? "partial_success" : "success",
    read: due.length, created: imported, updated: changed, failed: errored,
  });
  log(`[${JOB_NAME}] success`);
  db.close();
} catch (e) {
  const done = finishJob(db, job, { status: "failed", error: e && (e.stack || e.message || e) });
  log(`[${JOB_NAME}] FAILED status=${done.status} next_retry_at=${done.next_retry_at ?? "NULL"}: ${e.message || e}`);
  db.close();
  process.exit(1);
}
