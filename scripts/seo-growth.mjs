#!/usr/bin/env node
// ===========================================================================
// aeiou.now — SEO growth worklist + daily feedback snapshot
// ===========================================================================
//
// 把 GA4/GSC、內容與季節資料放在同一張可執行清單裡。預設唯讀；
// --record 才會把聚合快照與工作清單寫進主機 SQLite。
//
//   node scripts/seo-growth.mjs
//   node scripts/seo-growth.mjs --days 28
//   node scripts/seo-growth.mjs --json
//   node scripts/seo-growth.mjs --record --days 28
//   node scripts/seo-growth.mjs --history
//
// 優先序不是「流量越大越值得做」的排行榜，而是可操作性：
//   P0  前十名已有曝光卻沒有點擊，先檢查 title/description 與查詢是否對題
//   P1  11–20 名，有曝光且接近首頁，先補對應段落、錨點與內鏈
//   P2  21–50 名，有證據但需要內容／來源／內鏈一起補強
//   P3  其他只列為觀察，不用拿小樣本做結構性結論
//
// query/page 表是主機私有資料，不會被 export 到靜態站或 D1。

import {
  openDb, acquireLock, beginJob, finishJob, slotStart, nowSec,
} from "./lib/aeiou-lib.mjs";

const args = process.argv.slice(2);
const DAYS = (() => {
  const i = args.indexOf("--days");
  const n = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 28;
})();
const JSON_OUTPUT = args.includes("--json");
const RECORD = args.includes("--record");
const HISTORY = args.includes("--history");
const HOST_LOCALE = {
  "aeiou.now": "zh-TW", "en.aeiou.now": "en", "jp.aeiou.now": "ja", "cn.aeiou.now": "zh-CN",
  "hi.aeiou.now": "hi", "id.aeiou.now": "id", "br.aeiou.now": "pt-BR",
};
const DATE_RE = /(\b20\d{2}\b|幾號|什麼時候|什么时候|日期|いつ|何日|kapan|tanggal|when is|quando|कब|तारीख)/i;
const INST_RE = /(哪些國家|哪些国家|各國|各国|怎麼過|怎么过|放假|為什麼|为什么|差別|差别|比較|比较|制度|國定|国定|holiday|public holiday|do they|how do|why do|libur|hari libur|feriado|छुट्टी|क्यों|कैसे)/i;

const db = openDb(!RECORD);
const cutoff = new Date(Date.now() - DAYS * 86400000).toISOString().slice(0, 10);
const tableExists = (name) => Boolean(db.prepare(
  "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?"
).get(name));

function ensureGrowthSchema() {
  db.exec(
    "CREATE TABLE IF NOT EXISTS seo_growth_snapshots (" +
    "snapshot_date TEXT PRIMARY KEY, generated_at INTEGER NOT NULL, window_days INTEGER NOT NULL, " +
    "cutoff TEXT NOT NULL, data_days INTEGER NOT NULL DEFAULT 0, query_page_pairs INTEGER NOT NULL DEFAULT 0, " +
    "impressions INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0, weighted_position REAL, " +
    "ga_page_views INTEGER NOT NULL DEFAULT 0, ga_page_views_human INTEGER NOT NULL DEFAULT 0, " +
    "ga_sessions INTEGER NOT NULL DEFAULT 0, p0 INTEGER NOT NULL DEFAULT 0, p1 INTEGER NOT NULL DEFAULT 0, " +
    "p2 INTEGER NOT NULL DEFAULT 0, p3 INTEGER NOT NULL DEFAULT 0, intent_json TEXT NOT NULL DEFAULT '{}', " +
    "season_json TEXT NOT NULL DEFAULT '[]');" +
    "CREATE TABLE IF NOT EXISTS seo_growth_actions (" +
    "locale TEXT NOT NULL, query TEXT NOT NULL, page_url TEXT NOT NULL, first_seen_at INTEGER NOT NULL, " +
    "last_seen_at INTEGER NOT NULL, priority TEXT NOT NULL, impressions INTEGER NOT NULL DEFAULT 0, " +
    "clicks INTEGER NOT NULL DEFAULT 0, position REAL, action TEXT NOT NULL, reasons_json TEXT NOT NULL DEFAULT '[]', " +
    "status TEXT NOT NULL DEFAULT 'open', updated_at INTEGER NOT NULL, " +
    "PRIMARY KEY (locale, query, page_url));" +
    "CREATE INDEX IF NOT EXISTS idx_seo_growth_actions_priority " +
    "ON seo_growth_actions(status, priority, last_seen_at);",
  );
}

if (RECORD) ensureGrowthSchema();

function pct(n, d) { return d ? `${((n / d) * 100).toFixed(1)}%` : "—"; }
function avgPos(row) { return row.impressions ? row.position_sum / row.impressions : null; }
function fmtPos(value) { return value == null ? "—" : value.toFixed(1); }
function shorten(value, max = 58) {
  const text = String(value || "");
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
function tokenize(text) {
  return String(text || "")
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}
function intentFor(query) {
  const hasDate = DATE_RE.test(query);
  const hasInstitution = INST_RE.test(query);
  if (hasDate && hasInstitution) return 'date_and_institution';
  if (hasDate) return 'date_or_name';
  if (hasInstitution) return 'cross_country_or_institution';
  return 'other';
}
function localeForUrl(pageUrl) {
  try { return HOST_LOCALE[new URL(pageUrl).host] || null; } catch { return null; }
}
function slugForUrl(pageUrl) {
  try {
    const match = new URL(pageUrl).pathname.match(/^\/topic\/([^/]+)\/?$/);
    return match ? match[1] : null;
  } catch { return null; }
}

const topicRows = tableExists("topics")
  ? db.prepare("SELECT topic_id,slug,status,access_source FROM topics").all()
  : [];
const topicBySlug = new Map(topicRows.map((row) => [row.slug, row]));
const topicTitle = new Map();
const topicSummary = new Map();
const topicText = new Map();
if (tableExists("topic_i18n")) {
  for (const row of db.prepare("SELECT topic_id,locale,title,summary,keywords_json FROM topic_i18n").all()) {
    let keywords = [];
    try { keywords = JSON.parse(row.keywords_json || "[]"); } catch { keywords = []; }
    topicTitle.set(`${row.topic_id}|${row.locale}`, row.title);
    topicSummary.set(`${row.topic_id}|${row.locale}`, row.summary || "");
    // Summary is part of the page's actual answer surface. Including it here keeps
    // the worklist useful after a content fix, instead of treating keywords as proof
    // that the page answers the query.
    topicText.set(`${row.topic_id}|${row.locale}`, [row.title, row.summary, ...keywords]
      .filter(Boolean).join(" "));
  }
}

function pageContext(pageUrl, locale) {
  const slug = slugForUrl(pageUrl);
  const topic = slug ? topicBySlug.get(slug) : null;
  const text = topic
    ? [topic.canonical_name, slug.replaceAll("-", " "), topicText.get(`${topic.topic_id}|${locale}`)]
      .filter(Boolean).join(" ")
    : "";
  return {
    slug,
    topic,
    text,
    title: topic ? topicTitle.get(`${topic.topic_id}|${locale}`) || slug : null,
    summary: topic ? topicSummary.get(`${topic.topic_id}|${locale}`) || null : null,
  };
}

function mergeRows(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.locale}\t${row.query}\t${row.page_url}`;
    const current = grouped.get(key) || {
      locale: row.locale, query: row.query, page_url: row.page_url,
      impressions: 0, clicks: 0, position_sum: 0, days: 0,
    };
    current.impressions += Number(row.impressions) || 0;
    current.clicks += Number(row.clicks) || 0;
    current.position_sum += Number(row.position_sum) || 0;
    current.days += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()].map((row) => {
    const context = pageContext(row.page_url, row.locale);
    const queryTokens = tokenize(row.query);
    const pageTokens = tokenize(context.text);
    // 這只是「可能答非所問」的提示，不是自動改稿判定；專有名詞、詞形變化與
    // 非拉丁文字都可能讓字面重疊不足，最後仍要人工看頁面。
    const overlap = queryTokens.filter((token) => pageTokens.some((pageToken) =>
      pageToken.includes(token) || token.includes(pageToken))).length;
    const possibleMismatch = Boolean(context.slug && queryTokens.length >= 2 && overlap === 0 && row.impressions >= 2);
    const position = avgPos(row);
    const reasons = [];
    let priority = "P3";
    let action = "觀察查詢與頁面走勢";
    if (possibleMismatch) {
      priority = "P0";
      action = "檢查落地頁是否直接回答查詢；必要時補段落、錨點或拆分主題";
      reasons.push("可能答非所問");
    }
    if (position != null && position <= 10 && row.clicks === 0 && row.impressions >= 3) {
      priority = "P0";
      action = "檢查 title、description、首段與 FAQ 是否讓搜尋者有點擊理由";
      reasons.push("前十名零點擊");
    } else if (position != null && position <= 10 && row.clicks > 0 && row.impressions >= 3) {
      priority = "P1";
      action = "保留有效文案，補相關主題內鏈與下一個可讀頁面";
      reasons.push("前十名已有點擊");
    } else if (position != null && position <= 20 && row.impressions >= 2) {
      priority = priority === "P0" ? priority : "P1";
      action = priority === "P0" ? action : "補查詢對應內容、來源與內鏈，爭取進前十";
      reasons.push("11–20 名可搶救");
    } else if (position != null && position <= 50 && row.impressions >= 5) {
      priority = priority === "P0" ? priority : "P2";
      action = priority === "P0" ? action : "補足查詢意圖的獨有內容，再觀察排名";
      reasons.push("21–50 名有曝光");
    }
    return {
      ...row,
      slug: context.slug,
      title: context.title,
      summary: context.summary,
      position,
      ctr: row.clicks / Math.max(row.impressions, 1),
      intent: intentFor(row.query),
      priority,
      action,
      reasons,
    };
  }).sort((a, b) => {
    const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
    return rank[a.priority] - rank[b.priority]
      || b.impressions - a.impressions
      || (a.position || 999) - (b.position || 999);
  });
}

function loadQueryRows() {
  if (!tableExists("gsc_query_metrics")) return [];
  return db.prepare(`
    SELECT metric_date,locale,query,page_url,impressions,clicks,position_sum
      FROM gsc_query_metrics
     WHERE metric_date >= ? AND impressions > 0
  `).all(cutoff);
}

function loadSeasonRunway() {
  if (!tableExists("topic_observance_occurrences")) return [];
  const rows = db.prepare(`
    SELECT t.slug, t.canonical_name, o.country_code, oc.starts_on, oc.date_status
      FROM topic_observance_occurrences oc
      JOIN topic_observances o ON o.observance_id = oc.observance_id
      JOIN topics t ON t.topic_id = o.topic_id
     WHERE t.status = 'active'
       AND t.access_source != 'trend'
       AND oc.starts_on >= date('now')
       AND oc.starts_on < date('now', '+120 day')
     ORDER BY oc.starts_on, t.slug, o.country_code
  `).all();
  const grouped = new Map();
  for (const row of rows) {
    const current = grouped.get(row.slug) || {
      slug: row.slug, canonical_name: row.canonical_name, starts_on: row.starts_on,
      countries: new Set(), estimated: false,
    };
    if (row.starts_on < current.starts_on) current.starts_on = row.starts_on;
    current.countries.add(row.country_code);
    current.estimated ||= row.date_status === "estimated";
    grouped.set(row.slug, current);
  }
  return [...grouped.values()]
    .map((row) => {
      const target = new Date(`${row.starts_on}T00:00:00Z`);
      target.setUTCDate(target.getUTCDate() - 21);
      const targetDate = target.toISOString().slice(0, 10);
      const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
      const days = Math.round((new Date(`${row.starts_on}T00:00:00Z`) - today) / 86400000);
      return {
        ...row,
        countries: [...row.countries].sort(),
        target_date: targetDate,
        days_until: days,
        phase: days <= 21 ? "P0 本輪" : days <= 42 ? "P1 下輪" : "P2 預備",
      };
    })
    .sort((a, b) => a.starts_on.localeCompare(b.starts_on) || a.slug.localeCompare(b.slug));
}

function loadMeasurement() {
  if (!tableExists("analytics_aggregates")) return null;
  const rows = db.prepare(`
    SELECT metric,SUM(value) AS total
      FROM analytics_aggregates
     WHERE bucket_at >= unixepoch(?)
       AND metric IN ('page_views','page_views_human','sessions')
     GROUP BY metric
  `).all(cutoff);
  return Object.fromEntries(rows.map((row) => [row.metric, Number(row.total) || 0]));
}

const queryRows = loadQueryRows();
const opportunities = mergeRows(queryRows);
const seasonRunway = loadSeasonRunway();
const measurement = loadMeasurement();
const dataDays = new Set(queryRows.map((row) => row.metric_date)).size;
const summary = {
  days: DAYS,
  cutoff,
  data_days: dataDays,
  query_page_rows: queryRows.length,
  query_page_pairs: opportunities.length,
  impressions: opportunities.reduce((sum, row) => sum + row.impressions, 0),
  clicks: opportunities.reduce((sum, row) => sum + row.clicks, 0),
  weighted_position: (() => {
    const imp = opportunities.reduce((sum, row) => sum + row.impressions, 0);
    const pos = opportunities.reduce((sum, row) => sum + row.position_sum, 0);
    return imp ? pos / imp : null;
  })(),
  priorities: Object.fromEntries(["P0", "P1", "P2", "P3"].map((p) => [p, opportunities.filter((row) => row.priority === p).length])),
};

const payload = {
  generated_at: new Date().toISOString(),
  summary,
  measurement,
  intent: (() => {
    const grouped = new Map();
    for (const row of opportunities) {
      const current = grouped.get(row.intent) || { impressions: 0, clicks: 0, position_sum: 0 };
      current.impressions += row.impressions;
      current.clicks += row.clicks;
      current.position_sum += row.position_sum;
      grouped.set(row.intent, current);
    }
    return Object.fromEntries([...grouped].map(([intent, row]) => [intent, {
      impressions: row.impressions,
      clicks: row.clicks,
      avg_position: row.impressions ? row.position_sum / row.impressions : null,
    }]));
  })(),
  opportunities: opportunities.slice(0, 50),
  season_runway: seasonRunway.slice(0, 50).map((row) => ({ ...row, countries: row.countries })),
};

function recordSnapshot() {
  const scheduledAt = slotStart(86400);
  const lock = acquireLock(db, { jobName: "seo-growth-record", scheduledAt });
  if (!lock.ok) return { recorded: false, reason: lock.reason };
  const job = beginJob(db, { jobName: "seo-growth-record", scheduledAt });
  const now = nowSec();
  const snapshotDate = new Date().toISOString().slice(0, 10);
  try {
    const measurementValues = measurement || {};
    db.exec("BEGIN");
    db.prepare(
      "INSERT INTO seo_growth_snapshots " +
      "(snapshot_date,generated_at,window_days,cutoff,data_days,query_page_pairs,impressions,clicks," +
      "weighted_position,ga_page_views,ga_page_views_human,ga_sessions,p0,p1,p2,p3,intent_json,season_json) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) " +
      "ON CONFLICT(snapshot_date) DO UPDATE SET generated_at=excluded.generated_at, " +
      "window_days=excluded.window_days, cutoff=excluded.cutoff, data_days=excluded.data_days, " +
      "query_page_pairs=excluded.query_page_pairs, impressions=excluded.impressions, clicks=excluded.clicks, " +
      "weighted_position=excluded.weighted_position, ga_page_views=excluded.ga_page_views, " +
      "ga_page_views_human=excluded.ga_page_views_human, ga_sessions=excluded.ga_sessions, " +
      "p0=excluded.p0, p1=excluded.p1, p2=excluded.p2, p3=excluded.p3, " +
      "intent_json=excluded.intent_json, season_json=excluded.season_json",
    ).run(
      snapshotDate, now, DAYS, cutoff, dataDays, summary.query_page_pairs, summary.impressions, summary.clicks,
      summary.weighted_position, measurementValues.page_views || 0, measurementValues.page_views_human || 0,
      measurementValues.sessions || 0, summary.priorities.P0, summary.priorities.P1,
      summary.priorities.P2, summary.priorities.P3, JSON.stringify(payload.intent), JSON.stringify(seasonRunway),
    );

    const existing = db.prepare(
      "SELECT first_seen_at,status FROM seo_growth_actions WHERE locale=? AND query=? AND page_url=?",
    );
    const action = db.prepare(
      "INSERT INTO seo_growth_actions " +
      "(locale,query,page_url,first_seen_at,last_seen_at,priority,impressions,clicks,position,action," +
      "reasons_json,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) " +
      "ON CONFLICT(locale,query,page_url) DO UPDATE SET last_seen_at=excluded.last_seen_at, " +
      "priority=excluded.priority, impressions=excluded.impressions, clicks=excluded.clicks, " +
      "position=excluded.position, action=excluded.action, reasons_json=excluded.reasons_json, " +
      "updated_at=excluded.updated_at",
    );
    for (const row of opportunities) {
      const previous = existing.get(row.locale, row.query, row.page_url);
      action.run(
        row.locale, row.query, row.page_url, previous?.first_seen_at || now, now, row.priority,
        row.impressions, row.clicks, row.position, row.action, JSON.stringify(row.reasons),
        previous?.status || "open", now,
      );
    }
    db.exec("COMMIT");
    finishJob(db, job, {
      status: "success", read: queryRows.length, created: opportunities.length, updated: 1,
    });
    return { recorded: true, snapshot_date: snapshotDate, actions: opportunities.length };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    finishJob(db, job, { status: "failed", error: error.stack || error.message || error });
    throw error;
  }
}

function printHistory() {
  if (!tableExists("seo_growth_snapshots")) {
    console.log("尚無 SEO 成長快照；先執行：node scripts/seo-growth.mjs --record");
    return;
  }
  const rows = db.prepare(
    "SELECT snapshot_date,data_days,impressions,clicks,weighted_position," +
    "ga_page_views,ga_page_views_human,p0,p1,p2,p3 " +
    "FROM seo_growth_snapshots ORDER BY snapshot_date DESC LIMIT 30",
  ).all();
  console.log("SEO 成長快照（最近 30 次）");
  console.log("日期        GSC天  曝光  點擊  平均名次  GA瀏覽  真人瀏覽  P0  P1  P2  P3");
  console.log("----------  ----  ----  ----  --------  ------  --------  --  --  --  --");
  for (const row of rows) {
    console.log(
      row.snapshot_date + "  " + String(row.data_days).padStart(4) + "  " +
      String(row.impressions).padStart(4) + "  " + String(row.clicks).padStart(4) + "  " +
      fmtPos(row.weighted_position).padStart(8) + "  " + String(row.ga_page_views).padStart(6) + "  " +
      String(row.ga_page_views_human).padStart(8) + "  " + String(row.p0).padStart(2) + "  " +
      String(row.p1).padStart(2) + "  " + String(row.p2).padStart(2) + "  " + String(row.p3).padStart(2),
    );
  }
}

let recordResult = null;
if (RECORD) recordResult = recordSnapshot();

if (HISTORY && !JSON_OUTPUT) {
  printHistory();
  if (recordResult && !recordResult.recorded) console.log("本次記錄略過：" + recordResult.reason);
  db.close();
  process.exit(0);
}

if (JSON_OUTPUT) {
  process.stdout.write(JSON.stringify({ ...payload, record: recordResult }, null, 2) + "\n");
  db.close();
} else {
  console.log(`SEO growth worklist（${RECORD ? "已記錄；" : "唯讀；"}近 ${DAYS} 天；GSC 實際資料 ${dataDays} 天）`);
  console.log("=".repeat(72));
  if (measurement) {
    const raw = measurement.page_views || 0;
    const human = measurement.page_views_human || 0;
    console.log(`GA4 本地主機聚合：page_views ${raw}；可當真人看的 ${human}（${pct(human, raw)}）`);
    console.log("注意：GA4 不能直接拿來當 HotScore；瀏覽面仍以 GSC 為準。");
  } else {
    console.log("GA4 本地主機聚合：尚無資料");
  }
  console.log(`GSC query/page：${summary.query_page_pairs} 組；曝光 ${summary.impressions}；點擊 ${summary.clicks}；平均名次 ${fmtPos(summary.weighted_position)}`);
  console.log(`優先級：P0 ${summary.priorities.P0}　P1 ${summary.priorities.P1}　P2 ${summary.priorities.P2}　P3 ${summary.priorities.P3}`);

  console.log("\n一、可直接處理的搜尋工作（最多 20 筆）");
  if (!opportunities.length) {
    console.log("尚無 gsc_query_metrics；先跑：node scripts/gsc-topic-metrics.mjs --days 28");
  } else {
    console.log("優先  名次  曝光  點擊  語系  查詢 → 頁面");
    console.log("----  ----  ----  ----  ----  ------------------------------");
    for (const row of opportunities.filter((item) => item.priority !== "P3").slice(0, 20)) {
      console.log(`${row.priority.padEnd(4)}  ${fmtPos(row.position).padStart(4)}  ${String(row.impressions).padStart(4)}  ${String(row.clicks).padStart(4)}  ${row.locale.padEnd(4)}  ${shorten(row.query, 28)} → ${shorten(row.slug || row.page_url, 34)}`);
      console.log(`      ${row.reasons.join("、")}；${row.action}`);
    }
    if (!opportunities.some((item) => item.priority !== "P3")) console.log("目前沒有超過門檻的 P0–P2 項目；保留觀測資料，不把小樣本誤判成瓶頸。");
  }

  console.log("\n二、接下來 120 天的季節跑道（每個 Topic 提前 21 天準備）");
  if (!seasonRunway.length) {
    console.log("沒有找到未來 120 天的人工 Topic occurrence。");
  } else {
    console.log("階段    發生日      應開始日    距今    市場  Topic");
    console.log("------  ----------  ----------  ------  ----  ------------------------------");
    for (const row of seasonRunway.slice(0, 20)) {
      console.log(`${row.phase.padEnd(6)}  ${row.starts_on}  ${row.target_date}  ${String(row.days_until).padStart(4)} 天  ${row.countries.join(",").padEnd(4)}  ${row.slug}`);
    }
  }

  if (recordResult) {
    console.log(recordResult.recorded
      ? "\n已寫入每日快照 " + recordResult.snapshot_date + "，更新 " + recordResult.actions + " 筆搜尋工作。"
      : "\n本次快照略過：" + recordResult.reason);
  }

  console.log("\n三、固定驗收（每次內容或模板變更後）");
  console.log("node scripts/check-content-depth.mjs");
  console.log("cd site && for L in zh-TW en ja zh-CN hi id pt-BR; do LOCALE=$L pnpm build || exit 1; done");
  console.log("gh run list -R weiqi-kids/aeiou.now --limit 5");

  db.close();
}
