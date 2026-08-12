#!/usr/bin/env node
// 重新驗證七市場在地資料來源，移除已過期活動，再交給匯入器更新 SQLite。
//
// 這支不是通用搜尋引擎爬蟲：搜尋經驗固定在 content/local-data-sources.json，
// 每筆候選來源都要有官方 URL、搜尋脈絡與頁面 marker。頁面不可核對時整次失敗，
// 不以推測內容替換現有資料；找到新來源後先更新來源目錄，再重跑本支腳本。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INPUT_PATH = join(ROOT, "content", "local-sample-data.json");
const SOURCES_PATH = join(ROOT, "content", "local-data-sources.json");
const IMPORTER_PATH = join(ROOT, "scripts", "import-local-sample-data.mjs");
const LOCALES = ["zh-TW", "en", "ja", "zh-CN", "hi", "id", "pt-BR"];
const DEFAULT_TIMEOUT_MS = 20_000;

const argv = process.argv.slice(2);
const checkOnly = argv.includes("--check-only");
const offline = argv.includes("--offline");
const option = (name, fallback) => {
  const prefix = `${name}=`;
  const found = argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
};
const asOf = option("--as-of", new Date().toISOString().slice(0, 10));

const fail = (message) => { throw new Error(message); };
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const dateOnly = (value, label) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`${label} 必須是 YYYY-MM-DD：${value}`);
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    fail(`${label} 不是有效日期：${value}`);
  }
  return value;
};
const normalizedBody = (body) => body
  .replace(/&nbsp;/gi, " ")
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)));
const unique = (values) => [...new Set(values)];

if (!existsSync(INPUT_PATH) || !existsSync(SOURCES_PATH)) {
  fail("找不到 content/local-sample-data.json 或 content/local-data-sources.json");
}
dateOnly(asOf, "--as-of");
const sample = readJson(INPUT_PATH);
const sourceCatalog = readJson(SOURCES_PATH);

function validateShape() {
  if (!Array.isArray(sample.markets) || sample.markets.length !== LOCALES.length) {
    fail(`markets 必須正好有 ${LOCALES.length} 個市場`);
  }
  const marketLocales = new Set(sample.markets.map((market) => market.locale));
  for (const locale of LOCALES) if (!marketLocales.has(locale)) fail(`缺少市場：${locale}`);
  if (!Array.isArray(sourceCatalog.sources) || sourceCatalog.sources.length === 0) {
    fail("local-data-sources.json 必須有 sources");
  }
  const catalogByUrl = new Map();
  for (const source of sourceCatalog.sources) {
    if (typeof source.url !== "string" || !/^https?:\/\//.test(source.url)) fail(`來源 URL 無效：${source.url}`);
    if (catalogByUrl.has(source.url)) fail(`來源 URL 重複：${source.url}`);
    if (!LOCALES.includes(source.market)) fail(`來源市場語系無效：${source.market}`);
    if (typeof source.discovery_query !== "string" || !source.discovery_query.trim()) {
      fail(`來源缺 discovery_query：${source.url}`);
    }
    if (!Array.isArray(source.markers) || source.markers.length === 0) {
      fail(`來源缺 markers：${source.url}`);
    }
    if (!['place', 'event'].includes(source.kind)) {
      fail(`來源 kind 必須是 place 或 event：${source.url}`);
    }
    catalogByUrl.set(source.url, source);
  }

  const placeUrls = (sample.places || []).flatMap((place) => place.source_urls || []);
  const eventUrls = (sample.events || []).map((event) => event.source_url);
  const managedEventUrls = sample.managed_event_source_urls || eventUrls;
  const managedPlaceUrls = sample.managed_place_source_urls || placeUrls;
  const retiredPlaceIds = sample.retired_place_ids || [];
  const requiredUrls = unique([...placeUrls, ...eventUrls, ...managedEventUrls, ...managedPlaceUrls]);
  for (const url of requiredUrls) {
    if (!catalogByUrl.has(url)) fail(`資料 URL 沒有來源目錄設定：${url}`);
  }
  for (const url of managedEventUrls) {
    if (!/^https?:\/\//.test(url)) fail(`managed_event_source_urls 含無效 URL：${url}`);
    if (catalogByUrl.get(url)?.kind !== "event") fail(`managed_event_source_urls 只能包含 event 來源：${url}`);
  }
  for (const url of managedPlaceUrls) {
    if (!/^https?:\/\//.test(url)) fail(`managed_place_source_urls 含無效 URL：${url}`);
    if (catalogByUrl.get(url)?.kind !== "place") fail(`managed_place_source_urls 只能包含 place 來源：${url}`);
  }
  for (const id of retiredPlaceIds) {
    if (!/^plc_[A-Z0-9]{24,26}$/.test(id)) fail(`retired_place_ids 含無效 place_id：${id}`);
  }
  for (const event of sample.events || []) {
    if (!Array.isArray(event.topic_slugs) || event.topic_slugs.length === 0) {
      fail(`活動必須明確列出 topic_slugs：${event.name}`);
    }
    if (new Set(event.topic_slugs).size !== event.topic_slugs.length || event.topic_slugs.some((slug) => typeof slug !== 'string' || !slug.trim())) {
      fail(`活動 topic_slugs 無效或重複：${event.name}`);
    }
    if (!event.start_at) fail(`活動缺 start_at：${event.name}`);
    if (event.end_at && event.end_at < event.start_at) fail(`活動日期逆序：${event.name}`);
    const source = catalogByUrl.get(event.source_url);
    if (source?.kind !== "event") {
      fail(`活動來源 kind 必須是 event：${event.source_url}`);
    }
    if (!Array.isArray(source?.date_markers) || source.date_markers.length === 0) {
      fail(`活動來源缺 date_markers：${event.source_url}`);
    }
  }
  for (const place of sample.places || []) {
    if (!Array.isArray(place.topic_slugs) || place.topic_slugs.length === 0) {
      fail(`地點必須明確列出 topic_slugs：${place.name}`);
    }
    if (new Set(place.topic_slugs).size !== place.topic_slugs.length || place.topic_slugs.some((slug) => typeof slug !== 'string' || !slug.trim())) {
      fail(`地點 topic_slugs 無效或重複：${place.name}`);
    }
    if (place.place_type !== "permanent") fail(`地點必須是 permanent：${place.name}`);
    if (place.topic_relevance !== "direct") fail(`地點與 Topic 的關聯必須是 direct：${place.name}`);
    for (const url of place.source_urls || []) {
      const source = catalogByUrl.get(url);
      if (source?.kind !== "place") {
        fail(`地點來源 kind 必須是 place：${url}`);
      }
    }
  }
  return { catalogByUrl, requiredUrls, managedEventUrls, placeUrls, retiredPlaceIds };
}

async function verifySource(url, source, event) {
  if (offline) return { url, skipped: true, matched: [] };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "aeiou.now-local-data-updater/1.0 (+https://github.com/weiqi-kids/aeiou.now)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if (!response.ok) fail(`來源 HTTP ${response.status}：${url}`);
    const body = normalizedBody(await response.text());
    const matched = source.markers.filter((marker) => body.includes(marker));
    if (matched.length === 0) {
      fail(`來源未找到任何 marker：${url}；搜尋詞：${source.discovery_query}`);
    }
    const matchedDates = source.date_markers?.filter((marker) => body.includes(marker)) || [];
    if (event && matchedDates.length === 0) {
      fail(`活動來源未找到日期 marker：${url}；活動日期：${event.start_at.slice(0, 10)}；搜尋詞：${source.discovery_query}`);
    }
    return { url, status: response.status, finalUrl: response.url, matched, matchedDates };
  } catch (error) {
    if (error.name === "AbortError") fail(`來源逾時（${DEFAULT_TIMEOUT_MS}ms）：${url}`);
    if (error instanceof TypeError) fail(`來源讀取失敗：${url}；${error.message}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function activeEventsForDate(events) {
  return events.filter((event) => {
    const lastDay = (event.end_at || event.start_at).slice(0, 10);
    return lastDay >= asOf;
  });
}

async function main() {
  const { catalogByUrl, placeUrls, managedEventUrls } = validateShape();
  const activeEvents = activeEventsForDate(sample.events || []);
  const activeEventUrls = new Set(activeEvents.map((event) => event.source_url));
  // 只重新核對目前仍要發布的常設地點與活動；退役來源僅用於清除舊列，
  // 不會被當成目前地點或活動再次抓取。
  const urlsToVerify = unique([...placeUrls, ...activeEventUrls]);

  console.log(`來源驗證：${urlsToVerify.length} 個目前仍使用的 URL（${offline ? "offline" : "online"}）`);
  const checks = [];
  for (const url of urlsToVerify) {
    const event = activeEvents.find((candidate) => candidate.source_url === url);
    const result = await verifySource(url, catalogByUrl.get(url), event);
    checks.push(result);
    if (result.skipped) console.log(`  skip ${url}`);
    else console.log(`  ok   ${url} [${result.matched.join(", ")}${result.matchedDates.length ? `; date: ${result.matchedDates.join(", ")}` : ""}]`);
  }

  const removedEvents = (sample.events || []).filter((event) => !activeEvents.includes(event));
  if (removedEvents.length) {
    console.log(`將移除 ${removedEvents.length} 個已過期活動：${removedEvents.map((event) => event.name).join("、")}`);
  }
  if (checkOnly) {
    console.log(`檢查完成：${activeEvents.length} 個有效活動、${managedEventUrls.length} 個受管理活動來源`);
    return;
  }

  const changed = JSON.stringify(sample.events || []) !== JSON.stringify(activeEvents);
  if (changed) {
    sample.events = activeEvents;
    writeFileSync(INPUT_PATH, `${JSON.stringify(sample, null, 2)}\n`);
    console.log(`已更新 ${INPUT_PATH}`);
  } else {
    console.log("活動資料未變更；保留原始文案與日期快照");
  }

  execFileSync(process.execPath, [IMPORTER_PATH], { cwd: ROOT, stdio: "inherit" });
  console.log(`更新完成：${checks.length} 個來源已核對、${activeEvents.length} 個活動已匯入`);
}

main().catch((error) => {
  console.error(`在地資料更新失敗：${error.message}`);
  process.exitCode = 1;
});
