#!/usr/bin/env node
// aeiou.now — 外部搜尋趨勢 → machine-owned Topic → 七語靜態發布
//
// 這是一條可立即啟用的 bounded vertical slice：
//   Google Trends RSS → normalize/dedupe → claude 七語內容閘門
//   → host SQLite trend Topic → 既有 D1 sync / hourly export
//
// 硬邊界：
//   1. 只寫 access_source='trend' 的 Topic，不碰 content/topics/*.md 的 manual Topic。
//   2. 同一 run/event/content hash 可安全重跑；失敗的單項不污染半成品。
//   3. 七語內容不完整、來源不是 HTTPS、模型輸出不符合契約，一律不發布。
//   4. AEIOU_TREND_AUTO_PUBLISH=0 是 kill switch；--dry-run 永不寫入。
//
// 用法：
//   node scripts/trend-pipeline.mjs --dry-run
//   node scripts/trend-pipeline.mjs
//
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { hostname } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOCALES,
  CONFIG,
  acquireLock,
  beginJob,
  finishJob,
  log,
  nowSec,
  openDb,
  slotStart,
} from "./lib/aeiou-lib.mjs";
import { fetchGoogleTrendsTrendingNow, PROVIDER_NAME } from "./trends/google-trends-rss.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const JOB_NAME = "trend-auto-publish";
const PROVIDER = process.env.AEIOU_TREND_PROVIDER || PROVIDER_NAME;
// Google Trends 的 RSS 不提供 CN feed；zh-CN 仍由七語內容生成器產出。
const MARKETS = (process.env.AEIOU_TREND_MARKETS || "TW,US,JP,IN,ID,BR")
  .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const LIMIT = Math.min(10, Math.max(1, Number.parseInt(process.env.AEIOU_TREND_LIMIT || "3", 10) || 3));
const TTL_SEC = Math.max(3600, Number.parseInt(process.env.AEIOU_TREND_TTL_SEC || String(48 * 3600), 10) || 48 * 3600);
const AUTO_PUBLISH = !["0", "false", "off", "no"].includes(
  String(process.env.AEIOU_TREND_AUTO_PUBLISH ?? "1").toLowerCase()
);
const DRY_RUN = process.argv.includes("--dry-run");
const FORCE = process.argv.includes("--force") || ["1", "true", "yes"].includes(String(process.env.AEIOU_TREND_FORCE || "").toLowerCase());
const FIXTURE = process.env.AEIOU_TREND_FIXTURE || null;
const CONTENT_FIXTURE = process.env.AEIOU_TREND_CONTENT_FIXTURE || null;
const CLAUDE_BIN = process.env.AEIOU_CLAUDE_BIN || "/root/.local/bin/claude";
const CLAUDE_TIMEOUT_MS = Number.parseInt(process.env.AEIOU_TREND_CLAUDE_TIMEOUT_MS || "600000", 10);
const CLAUDE_CWD = process.env.AEIOU_TREND_CLAUDE_CWD || join(tmpdir(), "aeiou-trend-cwd");
const STATIC_WINDOWS = ["24h", "72h", "7d", "1m", "3m", "1y"];

const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");
const jsonHash = (value) => sha256(JSON.stringify(value));
const stableId = (prefix, value, length = 24) => `${prefix}${sha256(value).slice(0, length).toUpperCase()}`;

function parseJsonFile(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} 無法讀取：${path}: ${error.message}`);
  }
}

function ensureSchema(db) {
  // schema-host.sql 使用 IF NOT EXISTS；對既有主機庫執行一次即可補上 trend 表。
  db.exec(readFileSync(join(ROOT, "db", "schema-host.sql"), "utf8"));

  // 初版垂直切片曾使用 google-trends-rss 作為 provider identity；升級到
  // adapter 的正式名稱時保留既有 state/publication，避免下一輪重複建題。
  const legacyProvider = "google-trends-rss";
  if (PROVIDER !== PROVIDER_NAME) return;
  db.exec("BEGIN");
  try {
    const legacyStates = db.prepare(
      "SELECT event_key FROM trend_topic_state WHERE provider = ?"
    ).all(legacyProvider);
    const canonicalState = db.prepare(
      "SELECT 1 FROM trend_topic_state WHERE provider = ? AND event_key = ?"
    );
    const moveState = db.prepare(
      "UPDATE trend_topic_state SET provider = ? WHERE provider = ? AND event_key = ?"
    );
    for (const row of legacyStates) {
      if (!canonicalState.get(PROVIDER_NAME, row.event_key)) {
        moveState.run(PROVIDER_NAME, legacyProvider, row.event_key);
      }
    }

    const legacyPublications = db.prepare(
      "SELECT publication_key FROM trend_publications WHERE provider = ?"
    ).all(legacyProvider);
    const canonicalPublication = db.prepare(
      "SELECT 1 FROM trend_publications WHERE provider = ? AND publication_key = ?"
    );
    const movePublication = db.prepare(
      "UPDATE trend_publications SET provider = ? WHERE provider = ? AND publication_key = ?"
    );
    for (const row of legacyPublications) {
      if (!canonicalPublication.get(PROVIDER_NAME, row.publication_key)) {
        movePublication.run(PROVIDER_NAME, legacyProvider, row.publication_key);
      }
    }

    db.prepare("UPDATE trend_runs SET provider = ? WHERE provider = ?").run(PROVIDER_NAME, legacyProvider);
    db.prepare("UPDATE trend_observations SET provider = ? WHERE provider = ?").run(PROVIDER_NAME, legacyProvider);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

function localLockAlive(lockedBy) {
  const marker = String(lockedBy || "");
  const split = marker.lastIndexOf(":");
  if (split < 0 || marker.slice(0, split) !== hostname()) return true;
  const pid = Number.parseInt(marker.slice(split + 1), 10);
  if (!Number.isInteger(pid)) return true;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function acquireTrendLock(db, scheduledAt) {
  if (FORCE) {
    const rows = db.prepare(
      "SELECT scheduled_at, locked_by, locked_at FROM job_locks WHERE scope = 'global' AND job_name = ?"
    ).all(JOB_NAME);
    const terminal = new Set(["success", "partial_success", "failed", "skipped", "dlq"]);
    // --force 只回收已結束 job 留下的鎖；活行程仍然不能被第二份 pipeline 撞開。
    for (const row of rows) {
      const previousJob = db.prepare(
        "SELECT status FROM jobs WHERE job_name = ? AND scope = 'global' AND scheduled_at = ? ORDER BY rowid DESC LIMIT 1"
      ).get(JOB_NAME, row.scheduled_at);
      if (row.locked_at < nowSec() - 5 &&
          ((previousJob && terminal.has(previousJob.status)) || !localLockAlive(row.locked_by))) {
        db.prepare(
          "DELETE FROM job_locks WHERE scope = 'global' AND job_name = ? AND scheduled_at = ?"
        ).run(JOB_NAME, row.scheduled_at);
      }
    }
  }
  return acquireLock(db, { jobName: JOB_NAME, scheduledAt });
}

function normalizeEventKey(title) {
  return String(title || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[“”「」『』'"`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function makeSlug(eventKey) {
  const ascii = eventKey.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
  const base = ascii.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "topic";
  return `trend-${base}-${sha256(eventKey).slice(0, 10)}`;
}

function parseTraffic(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const match = String(value || "").replace(/,/g, "").match(/([\d.]+)\s*([KMB])?/i);
  if (!match) return 0;
  const n = Number(match[1]);
  const factor = ({ K: 1e3, M: 1e6, B: 1e9 })[String(match[2] || "").toUpperCase()] || 1;
  return Number.isFinite(n) ? n * factor : 0;
}

function normalizeItem(item, market, index) {
  const title = String(item.title || "").replace(/\s+/g, " ").trim();
  const url = String(item.url || item.source_url || `https://trends.google.com/trending?geo=${encodeURIComponent(market)}`).trim();
  if (!title || !/^https?:\/\//i.test(url)) return null;
  const eventKey = normalizeEventKey(item.event_key || title);
  if (!eventKey) return null;
  const trafficRaw = item.traffic && typeof item.traffic === "object" ? item.traffic.raw : item.traffic;
  const trafficValue = item.traffic && typeof item.traffic === "object" && Number.isFinite(item.traffic.value)
    ? item.traffic.value : parseTraffic(trafficRaw);
  const publishedAt = typeof item.published_at === "number"
    ? item.published_at
    : Number.isFinite(Date.parse(item.published_at || "")) ? Math.floor(Date.parse(item.published_at) / 1000) : null;
  return {
    provider_item_key: String(item.provider_item_key || item.id || `${market}:${eventKey}`),
    event_key: eventKey,
    title,
    url,
    traffic: trafficRaw == null ? null : String(trafficRaw),
    traffic_value: trafficValue,
    rank: Number.isInteger(item.rank) ? item.rank : index + 1,
    published_at: publishedAt,
    market,
    raw: item.raw || item,
  };
}

async function readTrendItems() {
  if (FIXTURE) {
    const fixture = parseJsonFile(resolve(FIXTURE), "trend fixture");
    const rows = Array.isArray(fixture) ? fixture : fixture.items;
    if (!Array.isArray(rows)) throw new Error("trend fixture 必須是陣列或 {items: []}");
    return {
      items: rows.map((item, i) => normalizeItem(item, String(item.market || MARKETS[0]), i)).filter(Boolean),
      errors: [],
    };
  }

  const all = [];
  const errors = [];
  for (const market of MARKETS) {
    try {
      const result = await fetchGoogleTrendsTrendingNow({ market });
      result.items.forEach((item, i) => {
        const normalized = normalizeItem(item, market, i);
        if (normalized) all.push(normalized);
      });
    } catch (error) {
      errors.push({ market, error });
      log(`[${JOB_NAME}] provider ${market} failed: ${error.stack || error.message || error}${error.cause ? ` cause=${error.cause.stack || error.cause.message || error.cause}` : ""}`);
    }
  }

  // 同一事件在多市場 feed 出現時只生成一個 Topic，保留排名/流量最強的一筆。
  const byEvent = new Map();
  for (const item of all) {
    const previous = byEvent.get(item.event_key);
    if (!previous || item.rank < previous.rank || item.traffic_value > previous.traffic_value) {
      byEvent.set(item.event_key, item);
    }
  }
  const items = [...byEvent.values()]
    .sort((a, b) => a.rank - b.rank || b.traffic_value - a.traffic_value || a.event_key.localeCompare(b.event_key))
    .slice(0, LIMIT);
  if (items.length === 0 && errors.length > 0) {
    throw new Error(`所有趨勢市場都失敗：${errors.map(({ market, error }) => `${market}=${error.message || error}`).join(" | ")}`);
  }
  return { items, errors };
}

function buildContentPrompt(items) {
  const localeNames = {
    "zh-TW": "繁體中文（台灣）", en: "English", ja: "日本語",
    "zh-CN": "简体中文（中国大陆）", hi: "हिन्दी", id: "Bahasa Indonesia", "pt-BR": "Português do Brasil",
  };
  return `你是全球議題平台的內容編輯。輸入是外部搜尋趨勢，不是完整新聞稿。
請為每個項目產生可公開發布的跨語言 Topic；不要杜撰事件細節、人物立場、數字或因果關係。
摘要只描述「人們正在搜尋這個詞／事件，因此適合跨文化互動」；若背景不足，保持保守。
若詞彙涉及明顯色情、血腥暴力、仇恨、個人私密資料、詐騙、未成年性內容或無法安全理解，publish=false。

輸出只能是一個 JSON 物件，不要 markdown、不要解釋：
{"items":[{"id":"t1","publish":true,"safe":true,"canonical_name":"...","commonality":"...","locales":{
"zh-TW":{"title":"...","summary":"...","keywords":["..."]},
"en":{"title":"...","summary":"...","keywords":["..."]},
"ja":{"title":"...","summary":"...","keywords":["..."]},
"zh-CN":{"title":"...","summary":"...","keywords":["..."]},
"hi":{"title":"...","summary":"...","keywords":["..."]},
"id":{"title":"...","summary":"...","keywords":["..."]},
"pt-BR":{"title":"...","summary":"...","keywords":["..."]}}}]}

規則：
- 每個輸入 id 必須剛好回傳一次。
- 七個 locale 都必須存在，title/summary 非空，keywords 至少一個。
- title 忠實保留搜尋詞，不把未知背景寫成事實。
- summary 以一至兩句自然語言寫成互動入口，避免 SEO 套話。
- keywords 是短詞陣列，不要放 URL 或 HTML。
- locale 必須使用指定語言：${Object.entries(localeNames).map(([k, v]) => `${k}=${v}`).join(", ")}。

輸入：
${JSON.stringify(items, null, 2)}
`;
}

function extractJson(raw) {
  let text = String(raw || "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("claude 輸出沒有 JSON object");
  return JSON.parse(text.slice(start, end + 1));
}

function runClaude(prompt) {
  mkdirSync(CLAUDE_CWD, { recursive: true });
  const result = spawnSync(CLAUDE_BIN, ["-p"], {
    input: prompt,
    encoding: "utf8",
    timeout: CLAUDE_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    cwd: CLAUDE_CWD,
    env: { ...process.env, HOME: process.env.HOME || "/root" },
  });
  if (result.error) throw new Error(`claude spawn failed: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`claude exited ${result.status}: stderr=${String(result.stderr || "").slice(0, 240)} stdout=${String(result.stdout || "").slice(0, 400)}`);
  }
  return result.stdout;
}

function validText(value, max = 1000) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[<>]/.test(value);
}

function validateContent(items, parsed) {
  if (!parsed || !Array.isArray(parsed.items)) throw new Error("claude 輸出缺 items");
  const byId = new Map(parsed.items.map((item) => [item?.id, item]));
  const out = [];
  for (const input of items) {
    const item = byId.get(input.id);
    if (!item) throw new Error(`claude 缺少 ${input.id}`);
    if (item.publish !== true || item.safe !== true) continue;
    if (!validText(item.canonical_name, 240) || !validText(item.commonality, 500))
      throw new Error(`${input.id} canonical/commonality 無效`);
    const locales = {};
    for (const locale of LOCALES) {
      const row = item.locales?.[locale];
      if (!validText(row?.title, 240) || !validText(row?.summary, 1000) ||
          !Array.isArray(row?.keywords) || row.keywords.length < 1 || row.keywords.length > 12 ||
          !row.keywords.every((word) => validText(word, 120))) {
        throw new Error(`${input.id} 缺少或不合法的 ${locale} 內容`);
      }
      locales[locale] = { title: row.title.trim(), summary: row.summary.trim(), keywords: row.keywords.map((word) => word.trim()) };
    }
    out.push({
      input,
      canonical_name: item.canonical_name.trim(),
      commonality: item.commonality.trim(),
      locales,
    });
  }
  return out;
}

function generateContent(items) {
  const input = items.map((item, index) => ({
    id: `t${index + 1}`,
    event_key: item.event_key,
    market: item.market,
    title: item.title,
    url: item.url,
    source_url: item.url,
    traffic: item.traffic,
    rank: item.rank,
  }));
  if (CONTENT_FIXTURE) return validateContent(input, parseJsonFile(resolve(CONTENT_FIXTURE), "trend content fixture"));
  const parsed = extractJson(runClaude(buildContentPrompt(input)));
  return validateContent(input, parsed);
}

function sourceIdFor(url) {
  return stableId("src_", url, 24);
}

function scoreFor(item) {
  // 24h 分數是相對分數，不把 provider 的絕對搜尋量誤稱成站內使用者量。
  const rankScore = Math.max(1, 100 - Math.max(0, (item.rank || 1) - 1) * 2);
  const trafficBoost = item.traffic_value > 0 ? Math.min(4, Math.log10(item.traffic_value + 1)) : 0;
  return Math.min(99.9, Number((rankScore + trafficBoost).toFixed(3)));
}

function expireOldTopics(db, now) {
  const rows = db.prepare(
    "SELECT topic_id FROM trend_topic_state WHERE state IN ('active','cooling') AND expires_at < ? ORDER BY topic_id"
  ).all(now);
  for (const row of rows) {
    db.prepare("UPDATE trend_topic_state SET state = 'expired' WHERE topic_id = ?").run(row.topic_id);
    db.prepare("UPDATE topics SET status = 'archived', updated_at = ? WHERE topic_id = ? AND access_source = 'trend'").run(now, row.topic_id);
  }
  return rows.length;
}

function upsertSource(db, item, now) {
  const sourceId = sourceIdFor(item.url);
  db.prepare(
    `INSERT INTO sources (source_id, url, domain, source_type, language, country_code,
                          next_crawl_at, crawl_freq_s, status, updated_at)
     VALUES (?, ?, ?, 'trend', NULL, ?, ?, 86400, 'processed', ?)
     ON CONFLICT(url) DO UPDATE SET updated_at = excluded.updated_at,
       next_crawl_at = excluded.next_crawl_at, status = 'processed'`
  ).run(sourceId, item.url, new URL(item.url).hostname, item.market, now + 86400, now);
  return sourceId;
}

function upsertScore(db, topicId, score, now) {
  const windows = [
    ["24h", score], ["72h", score * 0.9], ["7d", score * 0.75],
    ["1m", score * 0.5], ["3m", score * 0.25], ["1y", score * 0.1],
  ];
  for (const [window, value] of windows) {
    db.prepare(
      `INSERT INTO topic_scores (topic_id, scope, window, score, rank, computed_at)
       VALUES (?, 'global', ?, ?, NULL, ?)
       ON CONFLICT(topic_id, scope, window) DO UPDATE SET score = excluded.score, computed_at = excluded.computed_at`
    ).run(topicId, window, Number(value.toFixed(3)), now);
  }
}

function recalculateGlobalRanks(db) {
  for (const window of STATIC_WINDOWS) {
    const rows = db.prepare(
      `SELECT s.topic_id, s.score
         FROM topic_scores s JOIN topics t ON t.topic_id = s.topic_id
        WHERE s.scope = 'global' AND s.window = ? AND t.status IN ('active','cooling')
        ORDER BY s.score DESC, s.topic_id`
    ).all(window);
    const update = db.prepare(
      "UPDATE topic_scores SET rank = ? WHERE topic_id = ? AND scope = 'global' AND window = ?"
    );
    rows.forEach((row, index) => update.run(index + 1, row.topic_id, window));
  }
}

function publishOne(db, content, now) {
  const { input, canonical_name, commonality, locales } = content;
  const eventKey = input.event_key;
  const existingState = db.prepare(
    "SELECT topic_id, content_hash, first_seen_at FROM trend_topic_state WHERE provider = ? AND event_key = ?"
  ).get(PROVIDER, eventKey);
  const topicId = existingState?.topic_id || stableId("top_tr_", `${PROVIDER}:${eventKey}`, 24);
  const slug = makeSlug(eventKey);
  const contentHash = jsonHash({ canonical_name, commonality, locales });
  const publicationKey = `${topicId}:${contentHash}`;
  const existingTopic = db.prepare("SELECT topic_id, access_source FROM topics WHERE topic_id = ? OR slug = ?").get(topicId, slug);
  if (existingTopic && existingTopic.access_source !== "trend") {
    throw new Error(`拒絕覆蓋非 trend Topic：${existingTopic.topic_id}`);
  }

  const sourceId = upsertSource(db, input, now);
  const score = scoreFor(input);
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO topics (topic_id, slug, canonical_name, commonality, category, status, merged_into,
                           is_perennial, access_level, access_source, global_score, first_seen_at,
                           last_activity_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'trend', 'active', NULL, 0, 0, 'trend', ?, ?, ?, ?, ?)
       ON CONFLICT(topic_id) DO UPDATE SET
         canonical_name = excluded.canonical_name,
         commonality = excluded.commonality,
         status = 'active', merged_into = NULL,
         global_score = excluded.global_score,
         last_activity_at = excluded.last_activity_at,
         updated_at = excluded.updated_at`
    ).run(topicId, slug, canonical_name, commonality, score, now, now, now, now);

    for (const locale of LOCALES) {
      const row = locales[locale];
      db.prepare(
        `INSERT INTO topic_i18n (topic_id, locale, title, summary, keywords_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(topic_id, locale) DO UPDATE SET title = excluded.title,
           summary = excluded.summary, keywords_json = excluded.keywords_json, updated_at = excluded.updated_at`
      ).run(topicId, locale, row.title, row.summary, JSON.stringify(row.keywords), now);
    }
    db.prepare(
      `INSERT INTO source_topics (source_id, topic_id, confidence) VALUES (?, ?, 1.0)
       ON CONFLICT(source_id, topic_id) DO UPDATE SET confidence = excluded.confidence`
    ).run(sourceId, topicId);
    upsertScore(db, topicId, score, now);

    const openCycle = db.prepare("SELECT cycle_id FROM topic_cycles WHERE topic_id = ? AND ended_at IS NULL").get(topicId);
    if (!openCycle) {
      db.prepare(
        "INSERT INTO topic_cycles (cycle_id, topic_id, label, started_at) VALUES (?, ?, ?, ?)"
      ).run(stableId("cyc_", `${topicId}:${now}`, 24), topicId, new Date(now * 1000).toISOString().slice(0, 7), now);
    }

    db.prepare(
      `INSERT INTO trend_topic_state (provider, event_key, topic_id, state, first_seen_at,
                                      last_seen_at, expires_at, published_at, content_hash)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
       ON CONFLICT(provider, event_key) DO UPDATE SET topic_id = excluded.topic_id,
         state = 'active', last_seen_at = excluded.last_seen_at, expires_at = excluded.expires_at,
         published_at = COALESCE(trend_topic_state.published_at, excluded.published_at),
         content_hash = excluded.content_hash`
    ).run(PROVIDER, eventKey, topicId, existingState?.first_seen_at || now, now, now + TTL_SEC, now, contentHash);
    db.prepare(
      `INSERT OR IGNORE INTO trend_publications
         (publication_key, topic_id, provider, event_key, content_hash, published_at, status)
       VALUES (?, ?, ?, ?, ?, ?, 'published')`
    ).run(publicationKey, topicId, PROVIDER, eventKey, contentHash, now);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
  return { topicId, slug, score, contentHash };
}

async function main() {
  const db = openDb();
  ensureSchema(db);
  const scheduledAt = slotStart(900);
  const lock = acquireTrendLock(db, scheduledAt);
  if (!lock.ok) {
    log(`[${JOB_NAME}] skip: ${lock.reason}`);
    db.close();
    return;
  }
  const job = beginJob(db, { jobName: JOB_NAME, scheduledAt });
  const now = nowSec();
  let read = 0, created = 0, failed = 0;
  const errors = [];
  log(`[${JOB_NAME}] job_id=${job.job_id} provider=${PROVIDER} markets=${MARKETS.join(",")} limit=${LIMIT} auto=${AUTO_PUBLISH && !DRY_RUN}`);

  try {
    if (!AUTO_PUBLISH && !DRY_RUN) {
      finishJob(db, job, { status: "skipped", error: "AEIOU_TREND_AUTO_PUBLISH=0" });
      log(`[${JOB_NAME}] disabled by kill switch`);
      db.close();
      return;
    }
    const expired = expireOldTopics(db, now);
    if (expired) log(`[${JOB_NAME}] expired ${expired} trend topic(s)`);
    const fetched = await readTrendItems();
    const items = fetched.items;
    const fetchErrors = fetched.errors;
    for (const { market, error } of fetchErrors) errors.push(`${market}: ${error.message || error}`);
    read = items.length;
    log(`[${JOB_NAME}] normalized ${read} trend item(s), provider failures=${fetchErrors.length}`);
    if (read === 0) {
      const status = fetchErrors.length ? "failed" : "success";
      finishJob(db, job, { status, read: 0, failed: fetchErrors.length, error: errors.join(" | ") || null });
      db.close();
      if (status === "failed") process.exitCode = 1;
      return;
    }

    const runByMarket = new Map();
    for (const market of MARKETS) {
      const runKey = `${PROVIDER}:${market}:${scheduledAt}`;
      runByMarket.set(market, runKey);
      if (!DRY_RUN) db.prepare(
        `INSERT OR IGNORE INTO trend_runs (run_key, provider, market, slot_start, started_at, status)
         VALUES (?, ?, ?, ?, ?, 'running')`
      ).run(runKey, PROVIDER, market, scheduledAt, now);
    }

    if (!DRY_RUN) {
      for (const item of items) {
        const runKey = runByMarket.get(item.market) || `${PROVIDER}:${item.market}:${scheduledAt}`;
        db.prepare(
          `INSERT OR IGNORE INTO trend_observations
             (observation_id, run_key, provider, market, provider_item_key, event_key, title, url,
              traffic, rank, published_at, observed_at, raw_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          stableId("obs_tr_", `${runKey}:${item.provider_item_key}`, 24), runKey, PROVIDER, item.market,
          item.provider_item_key, item.event_key, item.title, item.url, item.traffic, item.rank,
          item.published_at, now, JSON.stringify(item.raw)
        );
      }
    }

    const candidates = items.filter((item) => {
      if (DRY_RUN) return true;
      const state = db.prepare(
        "SELECT state, expires_at FROM trend_topic_state WHERE provider = ? AND event_key = ?"
      ).get(PROVIDER, item.event_key);
      return !state || state.state === "expired" || state.expires_at < now;
    }).slice(0, LIMIT);

    if (candidates.length === 0) {
      for (const market of MARKETS) if (!DRY_RUN) db.prepare(
        "UPDATE trend_runs SET finished_at = ?, status = ?, records_read = ?, records_failed = ?, error_message = ? WHERE run_key = ?"
      ).run(now, fetchErrors.some((entry) => entry.market === market) ? "failed" : "success", read,
        fetchErrors.filter((entry) => entry.market === market).length,
        errors.filter((message) => message.startsWith(`${market}:`)).join(" | ") || null, runByMarket.get(market));
      const status = fetchErrors.length ? "partial_success" : "success";
      finishJob(db, job, { status, read, failed: fetchErrors.length, error: errors.join(" | ") || null });
      log(`[${JOB_NAME}] no new event candidate`);
      db.close();
      return;
    }

    const contentInputs = candidates.map((item, index) => ({ ...item, id: `t${index + 1}` }));
    const contents = generateContent(contentInputs);
    if (DRY_RUN) {
      log(`[${JOB_NAME}] dry-run publish candidates: ${contents.map((x) => `${x.input.title} (${x.input.market})`).join(" | ")}`);
      finishJob(db, job, { status: "success", read, created: contents.length });
      db.close();
      return;
    }

    for (const content of contents) {
      try {
        const result = publishOne(db, content, now);
        created++;
        log(`[${JOB_NAME}] published ${result.slug} score=${result.score}`);
      } catch (error) {
        failed++;
        errors.push(`${content.input.event_key}: ${error.message || error}`);
        log(`[${JOB_NAME}] item failed ${content.input.event_key}: ${error.stack || error.message || error}`);
      }
    }
    recalculateGlobalRanks(db);
    const totalFailed = failed + fetchErrors.length;
    for (const market of MARKETS) db.prepare(
      "UPDATE trend_runs SET finished_at = ?, status = ?, records_read = ?, records_created = ?, records_failed = ?, error_message = ? WHERE run_key = ?"
    ).run(now, fetchErrors.some((entry) => entry.market === market) ? "failed" : failed ? (created ? "partial_success" : "failed") : "success", read, created, failed,
      errors.length ? errors.join(" | ").slice(0, 4000) : null, runByMarket.get(market));
    const status = totalFailed === 0 ? "success" : created > 0 ? "partial_success" : "failed";
    finishJob(db, job, { status, read, created, failed: totalFailed, error: errors.length ? errors.join(" | ") : null });
    log(`[${JOB_NAME}] ${status}: read=${read} created=${created} failed=${totalFailed}`);
    db.close();
    if (status === "failed") process.exitCode = 1;
  } catch (error) {
    const done = finishJob(db, job, {
      status: "failed", read, created, failed,
      error: [...errors, String(error?.stack || error?.message || error)].join(" | "),
    });
    log(`[${JOB_NAME}] FAILED status=${done.status}: ${error.message || error}`);
    db.close();
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`[${JOB_NAME}] fatal: ${error.stack || error}`);
  process.exitCode = 1;
});
