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
    if (h3.key === "customs") {
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
        doc.locales[h2.arg] ??= { customs: {} };
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
      } else if ((m = head.match(/^customs\s+([A-Za-z]{2})$/))) {
        // 舊格式相容讀法。
        h3 = { key: "customs", arg: `${m[1].toUpperCase()}:legacy-${m[1].toLowerCase()}` };
      } else throw new Error(`${file}: 不認識的小節「### ${head}」(只准 title/summary/keywords/customs XX key)`);
      continue;
    }
    // 清單項(meta 與 observance 用)
    const mLi = line.match(/^-\s+([a-z_]+)\s*:\s*(.*)$/);
    if (mLi && h2 && h2.kind !== "locale") {
      const [, k, v] = mLi;
      if (h2.kind === "meta") doc.meta[k] = v.trim();
      else if (h2.kind === "observance") {
        const c = doc.observances[h2.id];
        if (k === "source") c.sources.push(v.trim());
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
  if (!/^[a-z0-9-]+$/.test(doc.meta.slug || "")) errs.push(`slug 只准小寫英數與連字號:「${doc.meta.slug}」`);
  for (const [id, c] of Object.entries(doc.observances)) {
    if (!c.local_name) errs.push(`observance ${id} 缺 local_name`);
    if (!c.sources.length) errs.push(`observance ${id} 至少要一個 source(source_ids_json 是必填,這是 SEO 的抗辯基礎)`);
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
       is_perennial = excluded.is_perennial, updated_at = excluded.updated_at`
  ).run(topicId, meta.slug, meta.canonical, meta.commonality, meta.category,
        existing ? existing.status : "active", isPerennial, topicId,
        existing ? existing.first_seen_at : now, now, existing ? existing.created_at : now, now);

  // sources:URL upsert(source_id 由 URL 決定,穩定可重跑)
  const srcIdOf = (url) => "src_" + createHash("sha256").update(url).digest("hex").slice(0, 24).toUpperCase();
  const upSrc = db.prepare(
    `INSERT INTO sources (source_id, url, domain, source_type, next_crawl_at, crawl_freq_s, status, updated_at)
     VALUES (?, ?, ?, 'manual', ?, 86400, 'processed', ?)
     ON CONFLICT(url) DO UPDATE SET updated_at = excluded.updated_at`
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
    db.prepare(
      `INSERT INTO topic_observances (observance_id, topic_id, observance_key, country_code,
                                      local_name, observed_date, date_rule, date_range_end,
                                      popularity_rank, source_ids_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(observanceId, topicId, c.observance_key, c.country_code, c.local_name,
          c.date || null, c.date_rule || null,
          c.date_end || null, c.rank ? Number(c.rank) : null, JSON.stringify(ids), now);
  }
  for (const [code, l] of Object.entries(doc.locales)) {
    const kw = l.keywords ? l.keywords.split(/[,、]/).map((s) => s.trim()).filter(Boolean) : [];
    db.prepare(
      `INSERT INTO topic_i18n (topic_id, locale, title, summary, keywords_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(topicId, code, l.title, l.summary || null, JSON.stringify(kw), now);
    for (const [id, textVal] of Object.entries(l.customs)) {
      db.prepare(
        `INSERT INTO topic_observance_i18n (observance_id, locale, customs_text) VALUES (?, ?, ?)`
      ).run(observanceIds.get(id), code, textVal);
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

// 讓直接執行 import-topics 也不會繞過舊資料遷移。
execFileSync(process.execPath, [join(ROOT, "scripts", "migrate-topic-observances.mjs")], {
  cwd: ROOT,
  stdio: "inherit",
});

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");
const now = Math.floor(Date.now() / 1000);
let created = 0, updated = 0, failed = 0;
for (const f of files) {
  try {
    const doc = parseTopicMd(readFileSync(join(CONTENT_DIR, f), "utf8"), f);
    db.exec("BEGIN");
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
