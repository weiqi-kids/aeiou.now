#!/usr/bin/env node
// import-topics.mjs — 把 content/topics/*.md 匯入主機 SQLite(Topic 內容的人工維護入口)
//
//   人工編輯 content/topics/<slug>.md
//     → node scripts/import-topics.mjs        (本腳本;冪等,可重跑)
//     → node scripts/export-data.mjs          (產 data/*.json,hash 沒變不寫檔)
//     → build / hourly-export.sh 照常
//
// 格式規格(權威版在 docs/03-topic-content.md,兩處同步):
//   # 任意標題(給人看的,解析時忽略)
//   ## meta                    - slug/canonical/category/perennial 的 key: value 清單
//   ## observance <ISO2> <key> - 一個 Topic 在一國的地方表現;可有多個
//                                local_name/date/date_end/date_rule/rank/source 清單
//   ## country <ISO2>          - 舊格式相容讀法,轉成各國唯一的 legacy-<iso2> key
//   ## locale <code>           - 底下用 ### title / ### summary / ### keywords /
//                                ### customs <ISO2> <key>
//                                ### date_rule <ISO2> <key>   ← 非 zh-TW 才需要;
//                                  zh-TW 退回 ## observance 的 `- date_rule:`
//
// 寫入語意:
//   - topics:以 slug 對應;已存在就沿用 topic_id 與 status,不存在就發新 ULID、status='active'
//   - topic_observances / topic_observance_i18n / topic_i18n:**整組替換**(md 是這些表的權威)
//   - sources:每個 source URL upsert 一筆(source_type='manual'),country 的 source_ids_json 指向它們
//   - topic_cycles:沒有進行中 cycle 就開一個(貼文需要 current_cycle_id)
//   - topic_scores:**不碰**(分數屬排程/演算法,不是內容)
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { isCanonicalCategory } from "./lib/topics.mjs";
import { parseSourceLine } from "./lib/topic-sources.mjs";
import { countryOfHost, hostOf } from "./lib/content-depth.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "db", "aeiou.sqlite");
const CONTENT_DIR = join(ROOT, "content", "topics");
const LOCALES = ["zh-TW", "en", "ja", "zh-CN", "hi", "id", "pt-BR"];

const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulid(now = Date.now()) {
  let ts = "";
  let t = now;
  for (let i = 0; i < 10; i++) { ts = B32[t % 32] + ts; t = Math.floor(t / 32); }
  let r = "";
  const { randomBytes } = { randomBytes: (n) => { const a = new Uint8Array(n); for (let i = 0; i < n; i++) a[i] = Math.floor(Math.random() * 256); return a; } };
  for (const b of randomBytes(16)) r += B32[b % 32];
  return ts + r;
}

// ---------- 解析 ----------
// 回傳 { meta:{}, observances:{"XX:key":{...}}, locales:{code:{title,summary,keywords,customs:{"XX:key":text}}} }
function parseTopicMd(text, file) {
  const doc = { meta: {}, observances: {}, locales: {} };
  // 目前所在的容器:['meta'] / ['observance','JP','valentine'] / ['locale','zh-TW'] / ['locale','zh-TW','title'] …
  let h2 = null;      // {kind:'meta'|'observance'|'locale', arg}
  let h3 = null;      // {key:'title'|'summary'|'keywords'|'customs', arg}
  let buf = [];

  const flushH3 = () => {
    if (!h2 || h2.kind !== "locale" || !h3) { buf = []; return; }
    const locObj = doc.locales[h2.arg];
    const textVal = buf.join("\n").trim();
    if (h3.key === "date_rule") {
      if (textVal) locObj.date_rules[h3.arg] = textVal;
    } else if (h3.key === "customs") {
      if (textVal) locObj.customs[h3.arg] = textVal;
    } else if (textVal) {
      locObj[h3.key] = textVal;
    }
    buf = [];
  };

  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const mH2 = line.match(/^##\s+(.+?)\s*$/);
    const mH3 = line.match(/^###\s+(.+?)\s*$/);
    if (line.startsWith("# ") ) continue; // H1 給人看,忽略
    if (mH2 && !line.startsWith("###")) {
      flushH3(); h3 = null;
      const head = mH2[1];
      let m;
      if (head === "meta") h2 = { kind: "meta" };
      else if ((m = head.match(/^observance\s+([A-Za-z]{2})\s+([a-z0-9-]+)$/))) {
        h2 = { kind: "observance", country: m[1].toUpperCase(), key: m[2] };
        h2.id = `${h2.country}:${h2.key}`;
        doc.observances[h2.id] ??= {
          country_code: h2.country,
          observance_key: h2.key,
          sources: [],
        };
      } else if ((m = head.match(/^country\s+([A-Za-z]{2})$/))) {
        // 舊格式可繼續讀,但要為每個國家生成不同 key,避免多國資料互相衝突。
        h2 = { kind: "observance", country: m[1].toUpperCase(), key: `legacy-${m[1].toLowerCase()}` };
        h2.id = `${h2.country}:${h2.key}`;
        doc.observances[h2.id] ??= {
          country_code: h2.country,
          observance_key: h2.key,
          sources: [],
        };
      } else if ((m = head.match(/^locale\s+(\S+)$/))) {
        if (!LOCALES.includes(m[1])) throw new Error(`${file}: 不認識的 locale「${m[1]}」(合法:${LOCALES.join(" ")})`);
        h2 = { kind: "locale", arg: m[1] };
        doc.locales[h2.arg] ??= { customs: {}, date_rules: {} };
      } else throw new Error(`${file}: 不認識的段落「## ${head}」(只准 meta / observance XX key / locale <code>)`);
      continue;
    }
    if (mH3) {
      flushH3();
      if (!h2 || h2.kind !== "locale") throw new Error(`${file}: 「### ${mH3[1]}」只能出現在 ## locale 底下`);
      const head = mH3[1];
      let m;
      if (["title", "summary", "keywords"].includes(head)) h3 = { key: head };
      else if ((m = head.match(/^customs\s+([A-Za-z]{2})\s+([a-z0-9-]+)$/))) {
        h3 = { key: "customs", arg: `${m[1].toUpperCase()}:${m[2]}` };
      } else if ((m = head.match(/^date_rule\s+([A-Za-z]{2})\s+([a-z0-9-]+)$/))) {
        h3 = { key: "date_rule", arg: `${m[1].toUpperCase()}:${m[2]}` };
      } else if ((m = head.match(/^customs\s+([A-Za-z]{2})$/))) {
        // 舊格式相容讀法。
        h3 = { key: "customs", arg: `${m[1].toUpperCase()}:legacy-${m[1].toLowerCase()}` };
      } else throw new Error(`${file}: 不認識的小節「### ${head}」(只准 title/summary/keywords/customs/date_rule XX key)`);
      continue;
    }
    // 清單項(meta 與 observance 用)
    const mLi = line.match(/^-\s+([a-z_]+)\s*:\s*(.*)$/);
    if (mLi && h2 && h2.kind !== "locale") {
      const [, k, v] = mLi;
      if (h2.kind === "meta") doc.meta[k] = v.trim();
      else if (h2.kind === "observance") {
        const c = doc.observances[h2.id];
        if (k === "source") {
          // `retired=YYYY-MM-DD` 語法見 scripts/lib/topic-sources.mjs;格式壞了 throw → 這一檔報錯
          const parsed = parseSourceLine(v);
          if (parsed.retired) (c.retired_sources ??= []).push(parsed);
          else c.sources.push(parsed.url);
        }
        else c[k] = v.trim();
      }
      continue;
    }
    if (h3) buf.push(line);
  }
  flushH3();

  // 驗證(缺什麼講清楚,不要默默吞)
  const errs = [];
  for (const k of ["slug", "canonical", "category", "commonality"]) if (!doc.meta[k]) errs.push(`meta 缺 ${k}`);
  // category 必須是正典取值。原本只驗非空,任何字串都收 —— 分類軸就是這樣漂走的。
  if (doc.meta.category && !isCanonicalCategory(doc.meta.category)) {
    errs.push(`meta.category 不是正典取值:${doc.meta.category}(正典清單見 scripts/lib/topics.mjs)`);
  }
  if (!/^[a-z0-9-]+$/.test(doc.meta.slug || "")) errs.push(`slug 只准小寫英數與連字號:「${doc.meta.slug}」`);
  for (const [id, c] of Object.entries(doc.observances)) {
    if (!c.local_name) errs.push(`observance ${id} 缺 local_name`);
    if (!c.sources.length) errs.push(`observance ${id} 至少要一個**未退役**的 source${c.retired_sources?.length ? `(有 ${c.retired_sources.length} 個 retired=,退役的不算)` : ""}(source_ids_json 是必填,這是 SEO 的抗辯基礎)`);
    // 退役之後剩下的活來源要撐得起 R6(該國網域;check-content-depth.mjs):在這裡擋是單檔失敗、不中斷 export,
    // 留到 hourly 的內容厚度閘門才爆會讓整條匯出停擺 —— 那正是 retired= 要終結的形狀。
    if (c.sources.length && c.retired_sources?.length) {
      const hosts = c.sources.map(hostOf).filter(Boolean);
      if (!hosts.some((hst) => countryOfHost(hst) === c.country_code)) {
        errs.push(`observance ${id} 退役後剩下的活來源沒有一個在 ${c.country_code} 的網域(${hosts.join(", ")});先補一個該國官方來源再退役`);
      }
    }
    if (!c.date && !c.date_rule) errs.push(`observance ${id} 必須有 date 或 date_rule,不可只有名稱`);
    if (c.date && !/^\d{2}-\d{2}$/.test(c.date)) errs.push(`observance ${id} 的 date 要是 MM-DD:「${c.date}」`);
    if (c.date_end && !/^\d{2}-\d{2}$/.test(c.date_end)) errs.push(`observance ${id} 的 date_end 要是 MM-DD:「${c.date_end}」`);
  }
  for (const [code, l] of Object.entries(doc.locales)) {
    if (!l.title) errs.push(`locale ${code} 缺 ### title`);
    for (const id of Object.keys(l.customs)) if (!doc.observances[id]) errs.push(`locale ${code} 有 customs ${id},但沒有對應的 ## observance`);
  }
  const missing = LOCALES.filter((c) => !doc.locales[c]);
  if (missing.length) errs.push(`缺 locale:${missing.join(" ")}(七語都要有;先寫 zh-TW 再請 Claude 翻其餘六語也行,但檔案裡要齊)`);
  for (const id of Object.keys(doc.observances)) {
    const lacking = LOCALES.filter((code) => !doc.locales[code]?.customs[id]);
    if (lacking.length) errs.push(`observance ${id} 的 customs 缺:${lacking.join(" ")}`);
    // date_rule 七語化(2026-08-21):`- date_rule:` 那一行是 zh-TW 的說法,
    // 其餘六語各自寫在 `### date_rule <CC> <key>`。有規則才要求譯文;
    // 固定日期的 observance 本來就沒有規則可講,不逼人生一段出來。
    // 為什麼一定要譯文:這段字會出現在七個站的畫面上,而它 100% 是中文(2026-08-21 實測 83 筆),
    // 沒有本地語言版本就等於對五個非漢字站漏中文。補譯:node scripts/translate-date-rules.mjs
    if (doc.observances[id].date_rule) {
      const need = LOCALES.filter((code) => code !== "zh-TW");
      const short = need.filter((code) => !doc.locales[code]?.date_rules[id]);
      if (short.length) errs.push(`observance ${id} 有 date_rule,但缺這幾語的 ### date_rule:${short.join(" ")}`);
    }
  }
  for (const [code, l] of Object.entries(doc.locales)) {
    for (const id of Object.keys(l.date_rules || {})) {
      if (!doc.observances[id]) errs.push(`locale ${code} 有 date_rule ${id},但沒有對應的 ## observance`);
      else if (!doc.observances[id].date_rule) errs.push(`locale ${code} 有 date_rule ${id},但那個 observance 沒有 \`- date_rule:\``);
    }
  }
  if (errs.length) throw new Error(`${file}:\n  - ` + errs.join("\n  - "));
  return doc;
}

// ---------- 寫入 ----------
function importOne(db, doc, now) {
  const { meta } = doc;
  const existing = db.prepare("SELECT topic_id, status, first_seen_at, created_at FROM topics WHERE slug = ?").get(meta.slug);
  const topicId = existing ? existing.topic_id : `top_${ulid()}`;
  const isPerennial = ["true", "yes", "1"].includes(String(meta.perennial || "").toLowerCase()) ? 1 : 0;

  db.prepare(
    `INSERT INTO topics (topic_id, slug, canonical_name, commonality, category, status, is_perennial,
                         access_level, access_source, global_score, first_seen_at, last_activity_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'manual', COALESCE((SELECT global_score FROM topics WHERE topic_id = ?), 0), ?, ?, ?, ?)
     ON CONFLICT(topic_id) DO UPDATE SET
       canonical_name = excluded.canonical_name, commonality = excluded.commonality, category = excluded.category,
       is_perennial = excluded.is_perennial, updated_at = excluded.updated_at
     -- 只在內容真的不同時才寫,否則整列不動、updated_at 不推新。
     -- 少了這個 WHERE,每小時 cron 重跑都會把每個 Topic 的時間戳推新,
     -- 於是 export 的「hash 沒變不寫檔」失效 → data/ 每小時數百行純時間戳 diff
     -- → commit → CI → 七站全部重建重新部署,而整個 site/ 沒有一處讀 updated_at。
     -- IS NOT 是 SQLite 的 null-safe 比較,不能寫成 !=。
     WHERE topics.canonical_name IS NOT excluded.canonical_name
        OR topics.commonality    IS NOT excluded.commonality
        OR topics.category       IS NOT excluded.category
        OR topics.is_perennial   IS NOT excluded.is_perennial`
  ).run(topicId, meta.slug, meta.canonical, meta.commonality, meta.category,
        existing ? existing.status : "active", isPerennial, topicId,
        existing ? existing.first_seen_at : now, now, existing ? existing.created_at : now, now);

  // sources:URL upsert(source_id 由 URL 決定,穩定可重跑)
  const srcIdOf = (url) => "src_" + createHash("sha256").update(url).digest("hex").slice(0, 24).toUpperCase();
  const upSrc = db.prepare(
    `INSERT INTO sources (source_id, url, domain, source_type, next_crawl_at, crawl_freq_s, status, updated_at)
     VALUES (?, ?, ?, 'manual', ?, 86400, 'processed', ?)
     -- 不空推 updated_at(沒有任何地方讀它,2026-08-19 實查;與 topics 曾經的空推是同一個反模式)。
     -- 唯一會改的情況:這個來源之前被標 retired、現在又活了 —— 只在那時把 status 改回來。
     ON CONFLICT(url) DO UPDATE SET status = 'processed', updated_at = excluded.updated_at
       WHERE sources.status = 'retired'`
  );
  // 退役來源(`retired=YYYY-MM-DD`):仍是出處,寫進 sources 與 source_ids_json,但 status='retired',
  // export 不把它放進 source_urls(頁面不印、check-source-urls 不驗)。見 scripts/lib/topic-sources.mjs。
  const upRetired = db.prepare(
    `INSERT INTO sources (source_id, url, domain, source_type, next_crawl_at, crawl_freq_s, status, updated_at)
     VALUES (?, ?, ?, 'manual', ?, 86400, 'retired', ?)
     ON CONFLICT(url) DO UPDATE SET status = 'retired', updated_at = excluded.updated_at
       WHERE sources.status != 'retired'`
  );

  // 三張內容表整組替換(md 是權威)
  db.prepare(
    "DELETE FROM topic_observance_i18n WHERE observance_id IN (SELECT observance_id FROM topic_observances WHERE topic_id = ?)"
  ).run(topicId);
  db.prepare("DELETE FROM topic_observances WHERE topic_id = ?").run(topicId);
  db.prepare("DELETE FROM topic_i18n WHERE topic_id = ?").run(topicId);

  const observanceIds = new Map();
  for (const [id, c] of Object.entries(doc.observances)) {
    const observanceId = `obs_${topicId}_${c.country_code}_${c.observance_key}`;
    observanceIds.set(id, observanceId);
    const ids = c.sources.map((u) => {
      const id = srcIdOf(u);
      upSrc.run(id, u, new URL(u).hostname, now + 365 * 86400, now);
      return id;
    });
    for (const r of c.retired_sources || []) {
      const id = srcIdOf(r.url);
      upRetired.run(id, r.url, new URL(r.url).hostname, now + 365 * 86400, now);
      ids.push(id);
    }
    const existingObservance = db.prepare(
      'SELECT topic_id FROM topic_observances WHERE observance_id = ?'
    ).get(observanceId);
    if (existingObservance && existingObservance.topic_id !== topicId) {
      // Merged Topic 仍保留在 content/topics/ 作為 migration source。第一次匯入後，
      // observance 會被 retire-merged-topics 搬到新 Topic；下一次重跑時，舊檔案
      // 會再次讀到同一個穩定 observance_id。把它移回目前匯入的 source，讓後續
      // migration 再搬一次，同時保留已匯入的 occurrence rows。
      db.prepare('DELETE FROM topic_observance_i18n WHERE observance_id = ?').run(observanceId);
      db.prepare(
        `UPDATE topic_observances
            SET topic_id = ?, observance_key = ?, country_code = ?, local_name = ?,
                observed_date = ?, date_rule = ?, date_range_end = ?, popularity_rank = ?,
                source_ids_json = ?, updated_at = ?
          WHERE observance_id = ?`
      ).run(topicId, c.observance_key, c.country_code, c.local_name,
            c.date || null, c.date_rule || null,
            c.date_end || null, c.rank ? Number(c.rank) : null, JSON.stringify(ids), now, observanceId);
    } else {
      db.prepare(
        `INSERT INTO topic_observances (observance_id, topic_id, observance_key, country_code,
                                        local_name, observed_date, date_rule, date_range_end,
                                        popularity_rank, source_ids_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(observanceId, topicId, c.observance_key, c.country_code, c.local_name,
            c.date || null, c.date_rule || null,
            c.date_end || null, c.rank ? Number(c.rank) : null, JSON.stringify(ids), now);
    }
  }
  for (const [code, l] of Object.entries(doc.locales)) {
    const kw = l.keywords ? l.keywords.split(/[,、]/).map((s) => s.trim()).filter(Boolean) : [];
    db.prepare(
      `INSERT INTO topic_i18n (topic_id, locale, title, summary, keywords_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(topicId, code, l.title, l.summary || null, JSON.stringify(kw), now);
    for (const [id, textVal] of Object.entries(l.customs)) {
      // zh-TW 不另寫 ### date_rule —— `- date_rule:` 那一行本來就是中文原文,
      // 再抄一次只會製造兩份會漂移的同一句話。
      const ruleText = code === "zh-TW"
        ? (doc.observances[id]?.date_rule || null)
        : (l.date_rules?.[id] || null);
      db.prepare(
        `INSERT INTO topic_observance_i18n (observance_id, locale, customs_text, date_rule_text)
         VALUES (?, ?, ?, ?)`
      ).run(observanceIds.get(id), code, textVal, ruleText);
    }
  }

  // 進行中 cycle(貼文需要):沒有才開,不重複開
  const open = db.prepare("SELECT cycle_id FROM topic_cycles WHERE topic_id = ? AND ended_at IS NULL").get(topicId);
  if (!open) {
    const label = new Date(now * 1000).toISOString().slice(0, 7);
    db.prepare(
      `INSERT INTO topic_cycles (cycle_id, topic_id, label, started_at) VALUES (?, ?, ?, ?)`
    ).run(`cyc_${ulid()}`, topicId, label, now);
  }
  return { topicId, isNew: !existing };
}

// ---------- 主流程 ----------
if (!existsSync(CONTENT_DIR)) {
  console.error(`找不到 ${CONTENT_DIR}——Topic 內容 md 放這裡(見 docs/03-topic-content.md)`);
  process.exit(2);
}
const files = readdirSync(CONTENT_DIR).filter((f) => f.endsWith(".md")).sort();
if (files.length === 0) { console.log("content/topics/ 沒有 .md,無事可做。"); process.exit(0); }

// 先把全部檔解析完:`retired=` 是逐行語意,但 sources.status 一個 URL 只有一個值 ——
// 同一個 URL 在 A 檔活著、在 B 檔退役,後匯入的會把狀態翻過來(37 個 URL 跨檔共用,law.moj.gov.tw 一條在 30 檔)。
// 這種矛盾要整批擋下並點名兩個檔,不能默默讓字母序決定。
const parsed = new Map();
const parseErrors = new Map();
for (const f of files) {
  try { parsed.set(f, parseTopicMd(readFileSync(join(CONTENT_DIR, f), "utf8"), f)); }
  catch (e) { parseErrors.set(f, e.message); }
}
{
  const activeIn = new Map();
  const retiredIn = new Map();
  for (const [f, doc] of parsed) {
    for (const c of Object.values(doc.observances)) {
      for (const u of c.sources) (activeIn.get(u) ?? activeIn.set(u, new Set()).get(u)).add(f);
      for (const r of c.retired_sources || []) (retiredIn.get(r.url) ?? retiredIn.set(r.url, new Set()).get(r.url)).add(f);
    }
  }
  for (const [url, retiredFiles] of retiredIn) {
    const activeFiles = activeIn.get(url);
    if (!activeFiles) continue;
    const msg = `來源 ${url} 在 ${[...retiredFiles].join(", ")} 標 retired=,卻在 ${[...activeFiles].join(", ")} 仍是活的 —— 同一個 URL 只能有一種狀態,兩邊都要改一致`;
    for (const f of [...retiredFiles, ...activeFiles]) { parseErrors.set(f, msg); parsed.delete(f); }
  }
}

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA busy_timeout = 15000;"); // 整點 */15 與 0 * * * * 兩條 cron 會併發碰同一顆 DB;遇鎖等待而非 SQLITE_BUSY 直接炸(同 lib openDb)

// 既有主機庫的欄位自我修補(2026-08-21 新增 date_rule_text)。schema-host.sql 已經帶了這一欄,
// 但既有的 db/aeiou.sqlite 是先前建的 —— 讓匯入自己補,才不用有人記得先跑一次 migration。
{
  const cols = db.prepare("PRAGMA table_info(topic_observance_i18n)").all().map((c) => c.name);
  if (cols.length && !cols.includes("date_rule_text")) {
    db.exec("ALTER TABLE topic_observance_i18n ADD COLUMN date_rule_text TEXT");
    console.log("已補上 topic_observance_i18n.date_rule_text 欄位");
  }
}
db.exec("PRAGMA foreign_keys = ON;");
const now = Math.floor(Date.now() / 1000);
let created = 0, updated = 0, failed = 0;
for (const f of files) {
  try {
    if (parseErrors.has(f)) throw new Error(parseErrors.get(f));
    const doc = parsed.get(f);
    // BEGIN IMMEDIATE 不是 BEGIN(2026-09-17):整點 cron-15min 與本支同時寫同一顆 DB,
    // 延遲交易在第一個寫入才要鎖、拿不到就直接 SQLITE_BUSY(busy_timeout 對這種升級不生效),
    // 實測每小時都有兩個 md「database is locked」沒進 SQLite(log 裡 100 次)。
    // IMMEDIATE 一開始就排隊等寫鎖,busy_timeout 15 秒才派得上用場。
    db.exec("BEGIN IMMEDIATE");
    const r = importOne(db, doc, now);
    db.exec("COMMIT");
    r.isNew ? created++ : updated++;
    console.log(`${r.isNew ? "新增" : "更新"}  ${doc.meta.slug}  (${r.topicId})`);
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    failed++;
    console.error(`✗ ${f}:${e.message}`);
  }
}
db.close();
execFileSync(process.execPath, [join(ROOT, "scripts", "retire-merged-topics.mjs")], {
  cwd: ROOT,
  stdio: "inherit",
});
console.log(`\n完成:新增 ${created}、更新 ${updated}、失敗 ${failed}(共 ${files.length} 檔)`);
process.exit(failed ? 1 : 0);
