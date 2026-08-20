#!/usr/bin/env node
// aeiou.now — 靜態 JSON 匯出(Track A / W1.2)
//   node scripts/export-data.mjs
//
// 主機 SQLite → 根層 data/,目錄結構照 docs/02-data-model.md §9。
// 硬規定:
//   1. 內容 hash 沒變就不寫檔(每小時 commit diff 最小化的關鍵),輸出可見 write/skip 統計。
//   2. rankings 以 topic_scores 為源,靜態只出六窗(24h/72h/7d/1m/3m/1y);8h 是 Worker 即時層,不出靜態。
//   3. meta/countries.json 國名用 Intl.DisplayNames 按七 locale 生成;meta/cities.json 城市用 slug title-case。
//   4. M1 highlights.json 允許空陣列,note 欄如實註明。
//   5. JSON 一律 JSON.stringify(x, null, 2) + 結尾換行。
//   6. 只用 node 內建模組(node:sqlite),零 npm 依賴。
// 決定論:所有查詢帶 ORDER BY、locale/window 以固定順序迭代、輸出不含產生時刻
//         → DB 不變時輸出 byte 級相同,hash 比對才有意義。
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { isTrendTopic } from "./lib/topics.mjs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "db", "aeiou.sqlite"); // 介面常數,不得改
const OUT_DIR = join(ROOT, "data");

const LOCALES = ["zh-TW", "en", "ja", "zh-CN", "hi", "id", "pt-BR"];
const STATIC_WINDOWS = ["24h", "72h", "7d", "1m", "3m", "1y"]; // 8h 不出靜態

const db = new DatabaseSync(DB_PATH, { readOnly: true });
db.exec("PRAGMA busy_timeout = 15000;"); // 整點 */15 與 0 * * * * 兩條 cron 會併發碰同一顆 DB;遇鎖等待而非 SQLITE_BUSY 直接炸(同 lib openDb)
const sourceUrlById = new Map(
  db.prepare("SELECT source_id, url FROM sources ORDER BY source_id").all().map((r) => [r.source_id, r.url])
);
const sourceIdsByTopic = new Map();
for (const row of db.prepare("SELECT topic_id, source_id FROM source_topics ORDER BY topic_id, source_id").all()) {
  if (!sourceIdsByTopic.has(row.topic_id)) sourceIdsByTopic.set(row.topic_id, []);
  sourceIdsByTopic.get(row.topic_id).push(row.source_id);
}
const regionalNotesPath = join(ROOT, "content", "topic-regional-notes.json");
const regionalNotesDoc = existsSync(regionalNotesPath)
  ? JSON.parse(readFileSync(regionalNotesPath, "utf8"))
  : { topics: {} };
const regionalNotesBySlug = new Map(Object.entries(regionalNotesDoc.topics || {}));

let written = 0;
let skipped = 0;

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

function emit(relPath, obj) {
  const abs = join(OUT_DIR, relPath);
  const content = JSON.stringify(obj, null, 2) + "\n";
  if (existsSync(abs) && sha256(readFileSync(abs)) === sha256(Buffer.from(content, "utf8"))) {
    skipped++;
    console.log(`skip  data/${relPath}`);
    return;
  }
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
  written++;
  console.log(`write data/${relPath}`);
}

const parseJson = (s, fallback) => {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};

// 趨勢 Topic 的判準見 scripts/lib/topics.mjs(唯一來源,判準=access_source)。
// 這裡只保留「輸出端契約」:靜態 JSON 額外補 topic_kind/owner 兩個欄位,供前端辨識。
// 那是輸出層的契約,與主機 row 的 access_source 是不同層,不要互相套用。
const isMachineTrendTopic = isTrendTopic;

function trendOutputMetadata(row) {
  return isMachineTrendTopic(row)
    ? { topic_kind: 'trend', owner: 'machine' }
    : {};
}

const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;

function trendLocaleErrors(topic, i18nByTopic) {
  if (!isMachineTrendTopic(topic)) return [];
  const byLocale = i18nByTopic.get(topic.topic_id);
  return LOCALES.flatMap((locale) => {
    const row = byLocale?.get(locale);
    const keywords = parseJson(row?.keywords_json, null);
    const missing = [];
    if (!row) missing.push('row');
    if (!nonEmpty(row?.title)) missing.push('title');
    if (!nonEmpty(row?.summary)) missing.push('summary');
    if (!Array.isArray(keywords) || keywords.length === 0) missing.push('keywords');
    return missing.length
      ? [`${topic.slug}(${topic.topic_id}) ${locale} 缺 ${missing.join('/')}`]
      : [];
  });
}

const isoDateParts = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
const utcDay = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86400000;

// occurrence 是地方時區的日期；排序先在該 occurrence 的 timezone 取「今天」，
// 再算到開始日的距離。這裡不讀 date_rule，也不從文化文字猜日期。
function nextOccurrence(rows, now = new Date()) {
  const candidates = [];
  for (const row of rows) {
    const today = isoDateParts(now, row.timezone);
    const active = row.ends_on
      ? today >= row.starts_on && today <= row.ends_on
      : today === row.starts_on;
    const future = row.starts_on > today;
    if (!active && !future) continue;
    candidates.push({
      occurrence_id: row.occurrence_id,
      occurrence_year: row.occurrence_year,
      starts_on: row.starts_on,
      ends_on: row.ends_on,
      calendar_system: row.calendar_system,
      timezone: row.timezone,
      date_status: row.date_status,
      source_ids: parseJson(row.source_ids_json, []),
      source_urls: parseJson(row.source_ids_json, []).map((id) => sourceUrlById.get(id)).filter(Boolean),
      distance_days: active ? 0 : utcDay(row.starts_on) - utcDay(today),
    });
  }
  return candidates.sort((a, b) =>
    a.distance_days - b.distance_days || a.starts_on.localeCompare(b.starts_on) || a.occurrence_id.localeCompare(b.occurrence_id)
  )[0] || null;
}

// ---------- 讀庫(一次讀齊,全部 ORDER BY 保序) ----------

// candidate(未達發布門檻,noindex)與 merged(301)不進靜態層
const allTopics = db.prepare(
  "SELECT * FROM topics WHERE status NOT IN ('candidate','merged') ORDER BY topic_id"
).all();

// machine-owned trend Topic 預設不進靜態層(2026-08-19 用戶拍板:趨勢管線繼續產,
// 但先不上線,免得機器 Topic 在首頁「近期話題」淹掉人工策展的 Topic)。
// 資料仍留在主機 SQLite,不刪不改;要放行就跑 AEIOU_TREND_EXPORT=1 node scripts/export-data.mjs。
// 裸執行=不匯出 trend,cron 不必帶參數即為正確行為。
const exportTrend = process.env.AEIOU_TREND_EXPORT === "1";
const topics = exportTrend ? allTopics : allTopics.filter((t) => !isMachineTrendTopic(t));
if (!exportTrend) {
  const held = allTopics.length - topics.length;
  if (held) console.log(`hold  ${held} 個 machine-owned trend Topic 未匯出(AEIOU_TREND_EXPORT=1 可放行)`);
}

const i18nByTopic = new Map(); // topic_id -> Map(locale -> row)
for (const r of db.prepare("SELECT * FROM topic_i18n ORDER BY topic_id, locale").all()) {
  if (!i18nByTopic.has(r.topic_id)) i18nByTopic.set(r.topic_id, new Map());
  i18nByTopic.get(r.topic_id).set(r.locale, r);
}

// 在所有輸出前做 machine-owned trend 的完整性 preflight。
// 失敗時不先寫 calendar/index/bundle，避免產生半套靜態資料。
const trendLocaleErrorsFound = topics.flatMap((topic) => trendLocaleErrors(topic, i18nByTopic));
if (trendLocaleErrorsFound.length) {
  throw new Error(
    `machine-owned trend Topic 靜態匯出拒絕，共 ${trendLocaleErrorsFound.length} 項：\n` +
    trendLocaleErrorsFound.map((error) => `- ${error}`).join('\n')
  );
}

const scoreRows = db.prepare("SELECT * FROM topic_scores ORDER BY topic_id, scope, window").all();
// topic_id -> Map(scope -> Map(window -> row))。巢狀,與同檔的 i18nByTopic 同一種寫法。
// 曾經是把 `${topic_id}\0${scope}` 串成單一鍵的扁平 Map —— 那三個 NUL 位元組讓 git 與 grep
// 都把整支檔案當二進位:diff 看不見、搜尋靜默回空不報錯(2026-08-19 診斷時實際被騙過)。
// 複合鍵不要用分隔符串字串,巢狀 Map 從結構上就不可能撞鍵。
const scoresByTopic = new Map();
for (const r of scoreRows) {
  let byScope = scoresByTopic.get(r.topic_id);
  if (!byScope) { byScope = new Map(); scoresByTopic.set(r.topic_id, byScope); }
  let byWindow = byScope.get(r.scope);
  if (!byWindow) { byWindow = new Map(); byScope.set(r.scope, byWindow); }
  byWindow.set(r.window, r);
}

const observancesByTopic = new Map();
for (const r of db.prepare(
  "SELECT * FROM topic_observances ORDER BY topic_id, country_code, observed_date, observance_key"
).all()) {
  if (!observancesByTopic.has(r.topic_id)) observancesByTopic.set(r.topic_id, []);
  observancesByTopic.get(r.topic_id).push(r);
}

const occurrencesByObservance = new Map();
for (const r of db.prepare(
  "SELECT * FROM topic_observance_occurrences ORDER BY observance_id, starts_on, occurrence_id"
).all()) {
  if (!occurrencesByObservance.has(r.observance_id)) occurrencesByObservance.set(r.observance_id, []);
  occurrencesByObservance.get(r.observance_id).push(r);
}

const customsByObservance = new Map(); // observance_id -> Map(locale -> text)
for (const r of db.prepare(
  "SELECT o.topic_id, i.observance_id, i.locale, i.customs_text " +
  "FROM topic_observance_i18n i JOIN topic_observances o ON o.observance_id = i.observance_id " +
  "ORDER BY o.topic_id, i.observance_id, i.locale"
).all()) {
  if (!customsByObservance.has(r.observance_id)) customsByObservance.set(r.observance_id, new Map());
  customsByObservance.get(r.observance_id).set(r.locale, r.customs_text);
}

const relationsByTopic = new Map();
for (const r of db.prepare("SELECT * FROM topic_relations ORDER BY from_topic_id, to_topic_id, relation").all()) {
  if (!relationsByTopic.has(r.from_topic_id)) relationsByTopic.set(r.from_topic_id, []);
  relationsByTopic.get(r.from_topic_id).push(r);
}

const slugByTopic = new Map(topics.map((t) => [t.topic_id, t.slug]));

// merged/candidate Topic 不進靜態層；清掉同一個生成目錄中上一輪留下的舊副本，
// 避免 Astro 由 stale facts 重新產生已下架的 URL。只處理 data/topics/top_* 生成目錄。
const topicOutDir = join(OUT_DIR, "topics");
if (existsSync(topicOutDir)) {
  for (const name of readdirSync(topicOutDir)) {
    if (name === "index" || !name.startsWith("top_") || slugByTopic.has(name)) continue;
    rmSync(join(topicOutDir, name), { recursive: true, force: true });
    console.log(`remove stale data/topics/${name}`);
  }
}

// 編輯入口的年度排程以 slug 表達；匯出時補上 topic_id，供看板直接使用。
const calendarPath = join(ROOT, "content", "topic-calendar.json");
if (existsSync(calendarPath)) {
  const calendar = JSON.parse(readFileSync(calendarPath, "utf8"));
  emit("topic-calendar.json", {
    cycle: calendar.cycle || "annual",
    weeks: (calendar.weeks || []).map((row) => ({
      week: row.week,
      topics: (row.topics || [])
        .map((slug) => ({ slug, topic_id: topics.find((t) => t.slug === slug)?.topic_id || null }))
        .filter((topic) => topic.topic_id),
    })),
  });
}

const mergePath = join(ROOT, "content", "topic-merges.json");
if (existsSync(mergePath)) emit("topic-merges.json", JSON.parse(readFileSync(mergePath, "utf8")));

// ---------- topics/index/<locale>.json ----------

for (const locale of LOCALES) {
  const list = topics.map((t) => {
    const i18n = i18nByTopic.get(t.topic_id)?.get(locale);
    const global = scoresByTopic.get(t.topic_id)?.get('global');
    const scores = {};
    for (const w of STATIC_WINDOWS) scores[w] = global?.get(w)?.score ?? null;
    return {
      topic_id: t.topic_id, // 前端打 API 用 topic_id(路徑參數不是 slug)
      ...trendOutputMetadata(t),
      slug: t.slug,
      title: i18n?.title ?? t.canonical_name,
      commonality: t.commonality,
      category: t.category,
      status: t.status,
      is_perennial: t.is_perennial,
      updated_at: t.updated_at,
      scores,
    };
  });
  emit(join("topics", "index", `${locale}.json`), list);
}

// ---------- topics/<topic-id>/{facts,i18n,highlights}.json ----------

const highlightStmt = db.prepare(
  "SELECT h.post_id, h.rank, h.score_at_freeze, h.frozen_at, p.original_locale, p.content, p.country_code " +
  "FROM post_highlights h LEFT JOIN posts p ON p.post_id = h.post_id " +
  "WHERE h.topic_id = ? AND h.kind = 'alltime' ORDER BY h.rank"
);
const highlightI18nStmt = db.prepare(
  "SELECT locale, content FROM post_i18n WHERE post_id = ? ORDER BY locale"
);

for (const t of topics) {
  const observances = observancesByTopic.get(t.topic_id) ?? [];
  const regional = regionalNotesBySlug.get(t.slug) || null;
  const regionalRows = Object.values(regional?.notes || {})
    .filter((row) => row && row.country_code && row.text)
    .sort((a, b) => String(a.country_code).localeCompare(String(b.country_code)));
  const regionalSourceUrls = [...new Set([
    ...(regional?.source_urls || []),
    ...regionalRows.flatMap((row) => row.source_urls || []),
  ])].filter((url) => /^https?:\/\//.test(url));

  // facts.json — 語言中立:observances、各國索引、relations、source ids
  const allSourceIds = new Set();
  // machine-owned trend 的來源掛在 source_topics；manual Topic 維持原本只
  // 從 observances/regional notes 收集來源的行為，避免既有輸出漂移。
  if (isMachineTrendTopic(t)) {
    for (const id of sourceIdsByTopic.get(t.topic_id) ?? []) allSourceIds.add(id);
  }
  const factObservances = observances.map((o) => {
    const ids = parseJson(o.source_ids_json, []);
    for (const id of ids) allSourceIds.add(id);
    const occurrenceRows = occurrencesByObservance.get(o.observance_id) ?? [];
    const occurrences = occurrenceRows.map((row) => ({
      occurrence_id: row.occurrence_id,
      occurrence_year: row.occurrence_year,
      starts_on: row.starts_on,
      ends_on: row.ends_on,
      calendar_system: row.calendar_system,
      timezone: row.timezone,
      date_status: row.date_status,
      source_ids: parseJson(row.source_ids_json, []),
      source_urls: parseJson(row.source_ids_json, []).map((id) => sourceUrlById.get(id)).filter(Boolean),
    }));
    for (const occurrence of occurrences) for (const id of occurrence.source_ids) allSourceIds.add(id);
    return {
      observance_id: o.observance_id,
      observance_key: o.observance_key,
      country_code: o.country_code,
      local_name: o.local_name,
      observed_date: o.observed_date,
      date_rule: o.date_rule,
      date_range_end: o.date_range_end,
      popularity_rank: o.popularity_rank,
      source_ids: ids,
      source_urls: ids.map((id) => sourceUrlById.get(id)).filter(Boolean),
      occurrences,
      next_occurrence: nextOccurrence(occurrenceRows),
    };
  });
  const countryObservances = new Map();
  for (const o of factObservances) {
    if (!countryObservances.has(o.country_code)) countryObservances.set(o.country_code, []);
    countryObservances.get(o.country_code).push(o.observance_id);
  }
  emit(join("topics", t.topic_id, "facts.json"), {
    topic_id: t.topic_id, // index 與 facts 兩處都要有 topic_id
    ...trendOutputMetadata(t),
    slug: t.slug,
    canonical_name: t.canonical_name,
    commonality: t.commonality,
    category: t.category,
    status: t.status,
    is_perennial: t.is_perennial,
    updated_at: new Date(t.updated_at * 1000).toISOString(),
    access_level: t.access_level,
    observances: factObservances,
    // 長青 Topic 沒有固定日期，改用明確標記的 regional_notes；這些資料不進日期排序。
    regional_notes: regionalRows.map((row) => ({
      country_code: row.country_code,
      // 'absence' = 這個國家沒有這個節日(節日 Topic 的逐國補洞);
      // 未標示者是長青 Topic 的國別敘述。前端據此決定標籤,不可混用。
      kind: row.kind === 'absence' ? 'absence' : 'perennial',
      source_urls: [...new Set(row.source_urls || [])].filter((url) => /^https?:\/\//.test(url)),
    })),
    // countries 只保留去重後的索引,不再承載名稱或日期;日期一律在 observances。
    countries: [...countryObservances.entries()].map(([country_code, observance_ids]) => ({
      country_code,
      observance_ids,
    })),
    relations: (relationsByTopic.get(t.topic_id) ?? []).map((r) => ({
      to_topic_id: r.to_topic_id,
      relation: r.relation,
      country_code: r.country_code,
      weight: r.weight,
    })),
    source_ids: [...allSourceIds].sort(),
    source_urls: [...new Set([
      ...([...allSourceIds].sort().map((id) => sourceUrlById.get(id)).filter(Boolean)),
      ...regionalSourceUrls,
    ])],
  });

  // i18n.json — 七語一檔(title/summary/keywords + 各地方表現 customs_text)
  const locales = {};
  for (const locale of LOCALES) {
    const r = i18nByTopic.get(t.topic_id)?.get(locale);
    if (!r) continue;
    locales[locale] = {
      title: r.title,
      summary: r.summary,
      keywords: parseJson(r.keywords_json, []),
    };
  }
  const customsOut = {};
  for (const o of observances) {
    const byLocale = customsByObservance.get(o.observance_id);
    if (!byLocale) continue;
    const entry = {};
    for (const locale of LOCALES) {
      if (byLocale.has(locale)) entry[locale] = byLocale.get(locale);
    }
    customsOut[o.observance_id] = entry;
  }
  const regionalOut = {};
  for (const row of regionalRows) {
    regionalOut[row.country_code] = {};
    for (const locale of LOCALES) {
      if (row.text?.[locale]) regionalOut[row.country_code][locale] = row.text[locale];
    }
  }
  emit(join("topics", t.topic_id, "i18n.json"), {
    topic_id: t.topic_id,
    ...trendOutputMetadata(t),
    locales,
    observances: customsOut,
    regional_notes: regionalOut,
  });

  // highlights.json — 歷史精華。M1 骨架期尚無貼文退場流程,items 為空陣列是如實狀態。
  const items = highlightStmt.all(t.topic_id).map((h) => {
    const translations = {};
    for (const tr of highlightI18nStmt.all(h.post_id)) translations[tr.locale] = tr.content;
    return {
      post_id: h.post_id,
      rank: h.rank,
      score_at_freeze: h.score_at_freeze,
      frozen_at: h.frozen_at,
      original_locale: h.original_locale,
      content: h.content,
      country_code: h.country_code,
      translations,
    };
  });
  emit(join("topics", t.topic_id, "highlights.json"), {
    topic_id: t.topic_id,
    ...trendOutputMetadata(t),
    note: items.length === 0
      ? "M1 骨架期:尚無貼文退場流程(post_highlights kind='alltime' 為空),空陣列為如實狀態,非佔位。"
      : "kind='alltime' 凍結精華,依 rank 排序。",
    items,
  });
}

// ---------- questions/<locale>.json(每日世界一問;規格 docs/briefs/daily-question.md §5) ----------

const questionRows = db.prepare(
  "SELECT * FROM questions ORDER BY qdate ASC, CASE kind WHEN 'poll' THEN 0 WHEN 'guess' THEN 1 ELSE 2 END, question_id ASC"
).all();

const questionI18nByQ = new Map(); // question_id -> Map(locale -> {text, explain})
for (const r of db.prepare("SELECT * FROM question_i18n ORDER BY question_id, locale").all()) {
  if (!questionI18nByQ.has(r.question_id)) questionI18nByQ.set(r.question_id, new Map());
  questionI18nByQ.get(r.question_id).set(r.locale, r);
}

const questionOptionsByQ = new Map(); // question_id -> [{option_id, ord, emoji}]
for (const r of db.prepare("SELECT * FROM question_options ORDER BY question_id, ord").all()) {
  if (!questionOptionsByQ.has(r.question_id)) questionOptionsByQ.set(r.question_id, []);
  questionOptionsByQ.get(r.question_id).push(r);
}

const questionOptionI18n = new Map(); // `${question_id}:${option_id}` -> Map(locale -> label)
for (const r of db.prepare(
  "SELECT * FROM question_option_i18n ORDER BY question_id, option_id, locale"
).all()) {
  const key = `${r.question_id}:${r.option_id}`;
  if (!questionOptionI18n.has(key)) questionOptionI18n.set(key, new Map());
  questionOptionI18n.get(key).set(r.locale, r.label);
}

for (const locale of LOCALES) {
  const list = questionRows.map((q) => {
    const i18n = questionI18nByQ.get(q.question_id)?.get(locale) ?? null;
    const opts = questionOptionsByQ.get(q.question_id) ?? [];
    return {
      question_id: q.question_id,
      date: q.qdate,
      kind: q.kind,
      topic_id: q.topic_id,
      topic_slug: slugByTopic.get(q.topic_id) ?? null,
      asker_locale: q.asker_locale,
      target_locale: q.target_locale,
      text: i18n?.text ?? null,
      options: opts.map((o) => ({
        id: o.option_id,
        emoji: o.emoji,
        label: questionOptionI18n.get(`${q.question_id}:${o.option_id}`)?.get(locale) ?? null,
      })),
      answer: q.kind === "guess" ? q.answer_option : null,
      explain: q.kind === "guess" ? (i18n?.explain ?? null) : null,
    };
  });
  emit(join("questions", `${locale}.json`), { questions: list });
}

// ---------- places/<city_code>.json ----------

const placeRows = db.prepare("SELECT * FROM places ORDER BY city_code, mention_count DESC, place_id").all();
const placeI18n = new Map();
for (const r of db.prepare("SELECT * FROM place_i18n ORDER BY place_id, locale").all()) {
  if (!placeI18n.has(r.place_id)) placeI18n.set(r.place_id, new Map());
  placeI18n.get(r.place_id).set(r.locale, r.description);
}
const placeTopics = new Map();
for (const r of db.prepare("SELECT * FROM place_topics ORDER BY place_id, relevance DESC, topic_id").all()) {
  if (!placeTopics.has(r.place_id)) placeTopics.set(r.place_id, []);
  placeTopics.get(r.place_id).push({ topic_id: r.topic_id, relevance: r.relevance });
}

const placesByCity = new Map();
for (const p of placeRows) {
  if (!placesByCity.has(p.city_code)) placesByCity.set(p.city_code, []);
  placesByCity.get(p.city_code).push(p);
}
function removeStaleCityFiles(dir, validCities) {
  const absDir = join(OUT_DIR, dir);
  if (!existsSync(absDir)) return;
  for (const name of readdirSync(absDir)) {
    if (!name.endsWith('.json')) continue;
    const city = name.slice(0, -'.json'.length);
    if (validCities.has(city)) continue;
    rmSync(join(absDir, name), { force: true });
    console.log(`remove stale data/${dir}/${name}`);
  }
}
removeStaleCityFiles('places', new Set(placesByCity.keys()));
for (const [city, rows] of [...placesByCity.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  emit(join("places", `${city}.json`), {
    city_code: city,
    places: rows.map((p) => {
      const descriptions = {};
      const byLocale = placeI18n.get(p.place_id);
      for (const locale of LOCALES) {
        if (byLocale?.has(locale)) descriptions[locale] = byLocale.get(locale);
      }
      return {
        place_id: p.place_id,
        name: p.name,
        place_type: "permanent",
        topic_relevance: "direct",
        country_code: p.country_code,
        address: p.address,
        map_url: p.map_url,
        nav_urls: parseJson(p.nav_urls_json, {}),
        source_urls: parseJson(p.source_urls_json, []),
        mention_count: p.mention_count,
        descriptions,
        topics: placeTopics.get(p.place_id) ?? [],
      };
    }),
  });
}

// ---------- events/<city_code>.json ----------

const eventRows = db.prepare("SELECT * FROM events ORDER BY city_code, start_at, event_id").all();
const eventI18n = new Map();
for (const r of db.prepare("SELECT * FROM event_i18n ORDER BY event_id, locale").all()) {
  if (!eventI18n.has(r.event_id)) eventI18n.set(r.event_id, new Map());
  eventI18n.get(r.event_id).set(r.locale, r.description);
}
const eventTopics = new Map();
for (const r of db.prepare("SELECT * FROM event_topics ORDER BY event_id, relevance DESC, topic_id").all()) {
  if (!eventTopics.has(r.event_id)) eventTopics.set(r.event_id, []);
  eventTopics.get(r.event_id).push({ topic_id: r.topic_id, relevance: r.relevance });
}
const eventsByCity = new Map();
for (const e of eventRows) {
  if (!eventsByCity.has(e.city_code)) eventsByCity.set(e.city_code, []);
  eventsByCity.get(e.city_code).push(e);
}
removeStaleCityFiles('events', new Set(eventsByCity.keys()));
for (const [city, rows] of [...eventsByCity.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  emit(join("events", `${city}.json`), {
    city_code: city,
    events: rows.map((e) => {
      const descriptions = {};
      const byLocale = eventI18n.get(e.event_id);
      for (const locale of LOCALES) {
        if (byLocale?.has(locale)) descriptions[locale] = byLocale.get(locale);
      }
      return {
        event_id: e.event_id,
        name: e.name,
        country_code: e.country_code,
        venue: e.venue,
        start_at: e.start_at,
        end_at: e.end_at,
        ticket_url: e.ticket_url,
        source_id: e.source_id,
        source_url: sourceUrlById.get(e.source_id) || null,
        descriptions,
        topics: eventTopics.get(e.event_id) ?? [],
      };
    }),
  });
}

// ---------- rankings/(以 topic_scores 為源;只出六窗,8h 不出) ----------
// 厚度門檻與 gate 共用同一個常數,避免兩邊各自定義「太少」。
const { THRESHOLDS: DEPTH_THRESHOLDS } = await import("./lib/content-depth.mjs");
const RANKING_ITEMS_MIN = DEPTH_THRESHOLDS.rankingItemsMin;

const scopes = db.prepare(
  "SELECT DISTINCT scope FROM topic_scores WHERE scope = 'global' OR scope LIKE 'country:%' ORDER BY scope"
).all().map((r) => r.scope);

for (const scope of scopes) {
  const dir = scope === "global" ? "global" : scope.slice("country:".length);
  for (const window of STATIC_WINDOWS) {
    const items = db.prepare(
      "SELECT topic_id, score, rank FROM topic_scores WHERE scope = ? AND window = ? AND rank IS NOT NULL ORDER BY rank, topic_id"
    ).all(scope, window)
      .filter((r) => slugByTopic.has(r.topic_id)) // candidate/merged 不進靜態
      // 名次必須在**過濾之後**重編為 1..n。
      // 2026-08-19 事故:topic_scores 含大量未發佈的 trend Topic,過濾後只剩一筆,
      // 但沿用了全域 rank,於是六個排行榜頁面在畫面上印出「319」——對讀者無意義,
      // 對 Google 則是六個內容幾乎相同的空頁(當時實測已被判 Crawled - currently not indexed)。
      // 機械層防線=scripts/check-content-depth.mjs 的 R5。
      .map((r, i) => ({ rank: i + 1, topic_id: r.topic_id, slug: slugByTopic.get(r.topic_id), score: r.score }));
    if (items.length === 0) continue; // 沒資料的窗不產檔
    // thin=true 的視窗仍然產檔(頁面照樣可看),但 sitemap 與 robots 會排除它,
    // 不把「只有一兩筆」的清單頁送去給 Google 當索引候選。門檻見 lib/content-depth.mjs。
    emit(join("rankings", dir, `${window}.json`), {
      scope, window, thin: items.length < RANKING_ITEMS_MIN, items,
    });
  }
}

// ---------- meta/countries.json、meta/cities.json ----------

// 國家碼:topic_observances 與 places 的 distinct code
const countryCodes = [...new Set([
  ...db.prepare("SELECT DISTINCT country_code FROM topic_observances").all().map((r) => r.country_code),
  ...db.prepare("SELECT DISTINCT country_code FROM places").all().map((r) => r.country_code),
])].sort();

const displayNames = new Map(
  LOCALES.map((l) => [l, new Intl.DisplayNames([l], { type: "region" })])
);
const countriesOut = {};
for (const code of countryCodes) {
  const names = {};
  for (const locale of LOCALES) names[locale] = displayNames.get(locale).of(code);
  countriesOut[code] = names;
}
emit(join("meta", "countries.json"), countriesOut);

// 城市:places 的 distinct city_code,顯示名 = slug title-case(tokyo → Tokyo)
const titleCase = (slug) =>
  slug.split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
const cityCodes = db.prepare("SELECT DISTINCT city_code FROM places ORDER BY city_code").all().map((r) => r.city_code);
const citiesOut = {};
for (const code of cityCodes) citiesOut[code] = titleCase(code);
emit(join("meta", "cities.json"), citiesOut);

db.close();

console.log(`\n完成:寫入 ${written} 檔,略過 ${skipped} 檔(內容 hash 未變)。`);
