#!/usr/bin/env node
// 重新驗證七市場在地資料來源，移除已過期活動，再交給匯入器更新 SQLite。
//
// 這支不是通用搜尋引擎爬蟲：搜尋經驗固定在 content/local-data-sources.json，
// 每筆候選來源都要有官方 URL、搜尋脈絡與頁面 marker。頁面不可核對時整次失敗，
// 不以推測內容替換現有資料；找到新來源後先更新來源目錄，再重跑本支腳本。
//
// 失敗分三類，處理方式不同：
//   內容層（4xx **且該網域的根目錄是通的**、marker 對不上、日期 marker 對不上）
//     → 來源真的變了，立即整次失敗、擋下輸出。重抓同一頁不會有不同結果。
//   傳輸層（連線失敗、逾時、5xx）
//     → 對方伺服器暫時掛了，不是我們的資料錯。記進健康檔並放行本輪；
//       同一個 URL 連續 TRANSIENT_TOLERANCE 輪都是傳輸層失敗才擋下。
//   不可信層（4xx **且這個 URL 24 小時內驗過 OK**）——2026-08-21 用戶拍板新增
//     → 我們有證據它一小時前還在。重試三次仍 4xx 也不足以判死,降為傳輸層,
//       走「連續 TRANSIENT_TOLERANCE 輪才擋」。真的被撤掉的來源會在約 3 小時後擋下。
//       為什麼要有:實測 jakarta.go.id 那個來源同一分鐘內 8 次請求得到 4 次 200、3 次 404,
//       三次重試全落空的機率仍有約 12.5%,等於每天還會停 3 次全站更新。
//       判準用「24 小時內」而不是「上一輪」:中間若有輪次被擋掉或跳過,
//       「上一輪」會誤判成「從來沒驗過」而立刻擋。
//   封鎖層（4xx **且該網域的根目錄也連不上**）——2026-08-21 用戶拍板新增
//     → 是這台主機被對方整站擋掉，不是那一頁失效。**只 WARN，永不擋輸出**，
//       也不計入傳輸層的容忍計數（等再久都不會變，擋下去只是懲罰七個站）。
//   會這樣分是因為整條 hourly-export 都掛在這支後面：任何一個來源打個嗝，
//   Topic 與題庫的匯出也會一起停擺（2026-08-19 實際被一個 HTTP 520 擋過一次）。
//
// 封鎖層的立法緣由（2026-08-21）：03:00 那輪被
// `https://www.jakarta.go.id/siaran-pers/6855-SP-HMS-07-2026` 的 HTTP 404 擋停，
// 但複驗發現**那個網域連根目錄都回 403**——不是那一頁沒了，是主機被 WAF 擋。
// 這與 2026-08-20 `bndigital.bn.gov.br`（主機回 403、GitHub Actions 回 404）是同一個模式，
// 也正是 CLAUDE.md 紅線「驗來源連結不能只看狀態碼…判死前要複驗」講的事。
// ⚠ 判準只看**根目錄通不通**，不是看狀態碼是幾號 —— 狀態碼本身會騙人。
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
// 純本機狀態（同 db/.sync-state*.json 的慣例，不進 git）。刪掉只會讓計數從零開始。
const HEALTH_PATH = join(ROOT, "db", ".local-source-health.json");
const TRANSIENT_TOLERANCE = Number(process.env.AEIOU_LOCAL_SOURCE_TOLERANCE || 3);

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

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const FETCH_ATTEMPTS = 3;

// 重試「網路層」失敗(斷線、逾時、5xx),**4xx 也重試**(2026-08-21 改)。
//
// 原本的註解寫著「4xx 代表來源真的變了,重抓同一頁不會改變結果」。那個前提被實測推翻:
// 2026-08-21 對 `https://www.jakarta.go.id/siaran-pers/6855-SP-HMS-07-2026` 用本腳本
// 同一個 UA 連打 8 次,得到 4 次 200、3 次 404、1 次連不上 —— 同一個網址、同一分鐘內,
// 狀態碼在跳。那個 404 不是「內容沒了」,是對方的來源不穩。
// 而 CLAUDE.md 的紅線本來就寫著「**判死前要複驗**」;這裡不重試 4xx 等於沒複驗就判死,
// 代價是整條 hourly-export 停擺(2026-08-20 13:00 起的 24 小時內被擋停 5 次)。
//
// 分流不變:重試完仍是 5xx → 傳輸層(丟 transient);仍是 4xx → 把 response 交回呼叫端,
// 由它打根目錄再決定是內容層還是封鎖層。**沒有放寬判準,只是判死前先複驗。**
async function fetchSource(url) {
  let lastMessage;
  let lastClientError = null;   // 最後一次 4xx 的 response,重試用盡後交回呼叫端判
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
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
      if (response.status >= 500) {
        lastMessage = `HTTP ${response.status}`;
      } else if (!response.ok) {
        lastMessage = `HTTP ${response.status}`;
        lastClientError = { response, rawBody: await response.text() };
      } else {
        return { response, rawBody: await response.text() };
      }
    } catch (error) {
      if (error.name === "AbortError") lastMessage = `逾時（${DEFAULT_TIMEOUT_MS}ms）`;
      else if (error instanceof TypeError) lastMessage = error.message;
      else throw error;
    } finally {
      clearTimeout(timer);
    }
    if (attempt < FETCH_ATTEMPTS) await sleep(2000 * attempt);
  }
  // 重試用盡仍是 4xx:交回呼叫端(它會打根目錄,再判內容層還是封鎖層)。
  if (lastClientError) return lastClientError;
  const transient = new Error(`來源讀取失敗（已重試 ${FETCH_ATTEMPTS} 次）：${url}；${lastMessage}`);
  transient.transient = true;   // 傳輸層，不是內容層 —— 由呼叫端決定要不要擋
  throw transient;
}

// 該網域現在對「這台主機」通不通。只在 4xx 之後才會被呼叫,一個 origin 一輪只探一次。
// 不重試:探測本身失敗就是「連不上」,那正是我們要判的事。
const originReachable = new Map();
async function isOriginReachable(url) {
  const origin = new URL(url).origin;
  if (originReachable.has(origin)) return originReachable.get(origin);
  let reachable = false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetch(`${origin}/`, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "aeiou.now-local-data-updater/1.0 (+https://github.com/weiqi-kids/aeiou.now)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    reachable = response.status < 400;
  } catch {
    reachable = false;   // 連線失敗/逾時 = 連不上,與 4xx 同一類
  } finally {
    clearTimeout(timer);
  }
  originReachable.set(origin, reachable);
  return reachable;
}

// lastOkAt: 這個 URL 上次驗過 OK 的日期(YYYY-MM-DD),沒有就是 null。
// 由呼叫端從健康檔取,不讓這支自己讀檔(它在 --offline 時也會被呼叫)。
const TRUST_WINDOW_DAYS = Number(process.env.AEIOU_LOCAL_SOURCE_TRUST_DAYS || 1);
const withinTrustWindow = (lastOkAt) => {
  if (!lastOkAt) return false;
  const diff = (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${lastOkAt}T00:00:00Z`)) / 86400000;
  return Number.isFinite(diff) && diff >= 0 && diff <= TRUST_WINDOW_DAYS;
};

async function verifySource(url, source, event, lastOkAt = null) {
  if (offline) return { url, skipped: true, matched: [] };
  let response, rawBody;
  try {
    ({ response, rawBody } = await fetchSource(url));
  } catch (error) {
    if (!error.transient) throw error;
    return { url, transient: true, message: error.message, matched: [] };
  }
  if (!response.ok) {
    // 判死前先問兩件事(2026-08-21 用戶拍板):
    //   ① 這個 URL 最近驗過 OK 嗎?有的話這個 4xx 不可信 —— 來源會跳,不是內容沒了。
    // ⚠ 這裡要 **return** 傳輸層的結果形狀,不能 throw ——
    //    fetchSource 的 throw 有 try/catch 接,這一段在 catch 之外,throw 會直接冒到頂層
    //    變成硬失敗(2026-08-21 寫的時候就是這樣錯了一次,測試抓到)。
    if (withinTrustWindow(lastOkAt)) {
      return {
        url,
        transient: true,   // 交給傳輸層的容忍計數,連續 3 輪才擋
        matched: [],
        message: `HTTP ${response.status}(已重試 ${FETCH_ATTEMPTS} 次),`
          + `但 ${lastOkAt} 才驗過 OK —— 不採信這次的判死`,
      };
    }
    //   ② 是這一頁沒了,還是整個網域對我們關門?
    if (await isOriginReachable(url)) {
      fail(`來源 HTTP ${response.status}：${url}`);
    }
    const origin = new URL(url).origin;
    return {
      url,
      blocked: true,
      matched: [],
      message: `HTTP ${response.status}，且 ${origin}/ 也連不上 —— 判定為對方擋下本主機,不是來源失效`,
    };
  }
  const body = normalizedBody(rawBody);
  const matched = source.markers.filter((marker) => body.includes(marker));
  if (matched.length === 0) {
    fail(`來源未找到任何 marker：${url}；搜尋詞：${source.discovery_query}`);
  }
  const matchedDates = source.date_markers?.filter((marker) => body.includes(marker)) || [];
  if (event && matchedDates.length === 0) {
    fail(`活動來源未找到日期 marker：${url}；活動日期：${event.start_at.slice(0, 10)}；搜尋詞：${source.discovery_query}`);
  }
  return { url, status: response.status, finalUrl: response.url, matched, matchedDates };
}

const lastDayOf = (event) => (event.end_at || event.start_at).slice(0, 10);

/** 仍要發布的活動:結束日還沒過。今天正在辦的當然要留著顯示。 */
function activeEventsForDate(events) {
  return events.filter((event) => lastDayOf(event) >= asOf);
}

/**
 * 仍需**重新核對**的活動:結束日在未來(嚴格大於今天)。
 *
 * 重新核對的目的是「在人跑去現場之前抓到日期或地點變更」——對今天就結束的活動,
 * 那個目的已經不存在了。而主辦單位很常在活動當天或隔天就把公告下架:
 * 2026-08-19 臺北天文館把**當日**活動的公告撤掉,404 讓 hourly-export 連續兩輪
 * 進 DLQ,而那個活動當晚就結束、隔天本來就會自動退場。
 *
 * 所以「今天結束」的活動照常發布、但不再核對 —— 這不是放寬驗證,是把驗證用在
 * 它真正有用的地方。未來的活動一律照舊嚴格核對(Revelando SP 改期就是那樣抓到的)。
 */
function verifiableEventsForDate(events) {
  return events.filter((event) => lastDayOf(event) > asOf);
}

async function main() {
  const { catalogByUrl, placeUrls, managedEventUrls } = validateShape();
  const activeEvents = activeEventsForDate(sample.events || []);
  const verifiableEvents = verifiableEventsForDate(sample.events || []);
  const verifiableEventUrls = new Set(verifiableEvents.map((event) => event.source_url));
  // 只重新核對常設地點與**尚未結束**的活動;退役來源僅用於清除舊列。
  // 今天結束的活動仍照常發布,但不再抓取(見 verifiableEventsForDate 的說明)。
  const urlsToVerify = unique([...placeUrls, ...verifiableEventUrls]);
  const notReverified = activeEvents.length - verifiableEvents.length;
  if (notReverified > 0) {
    console.log(`${notReverified} 個今天結束的活動照常發布,但不再重新核對來源。`);
  }

  console.log(`來源驗證：${urlsToVerify.length} 個目前仍使用的 URL（${offline ? "offline" : "online"}）`);
  const health = existsSync(HEALTH_PATH) ? readJson(HEALTH_PATH) : {};
  const blocking = [];
  const blockedByOrigin = [];
  const checks = [];
  for (const url of urlsToVerify) {
    const event = verifiableEvents.find((candidate) => candidate.source_url === url);
    const result = await verifySource(url, catalogByUrl.get(url), event, health[url]?.ok_at || null);
    checks.push(result);
    if (result.skipped) console.log(`  skip ${url}`);
    else if (result.blocked) {
      // 封鎖層:永不擋輸出。記進健康檔只是為了讓它看得見(維護時查得到、也不會被
      // 下一次成功悄悄抹掉之前無人知曉),不參與 TRANSIENT_TOLERANCE 的計數。
      const prev = health[url]?.blocked_since;
      health[url] = { blocked_since: prev || asOf, ok_at: health[url]?.ok_at || null, last_message: result.message };
      blockedByOrigin.push(`${url}：${result.message}`);
      console.log(`  WARN ${url} ${result.message}`);
    }
    else if (result.transient) {
      const n = (health[url]?.consecutive_failures || 0) + 1;
      health[url] = {
        consecutive_failures: n,
        first_failed_at: health[url]?.first_failed_at || asOf,
        // ok_at 要留著:不留的話第一次降級就把「最近驗過」的證據弄丟,
        // 第二輪會變成「從來沒驗過」而立刻判死 —— 那等於這一層沒做。
        ok_at: health[url]?.ok_at || null,
        last_message: result.message,
      };
      if (n >= TRANSIENT_TOLERANCE) blocking.push(`${url} 連續 ${n} 輪傳輸層失敗（容忍上限 ${TRANSIENT_TOLERANCE}）：${result.message}`);
      else console.log(`  WARN ${url} 傳輸層失敗第 ${n}/${TRANSIENT_TOLERANCE} 輪，本輪放行：${result.message}`);
    } else {
      // 一次成功就把失敗計數歸零,但**保留 ok_at** —— 下一輪的 4xx 要靠它判斷可不可信。
      health[url] = { ok_at: asOf };
      console.log(`  ok   ${url} [${result.matched.join(", ")}${result.matchedDates.length ? `; date: ${result.matchedDates.join(", ")}` : ""}]`);
    }
  }
  // 已經不在來源目錄裡的 URL 不該留在健康檔裡 —— 否則改過的、刪掉的來源會一直掛著,
  // 讓「現在有幾個來源不健康」這個數字越看越不準(2026-08-21:封鎖層的條目不會因為
  // 下一輪成功而被清,更需要這道修剪)。
  const verifying = new Set(urlsToVerify);
  for (const url of Object.keys(health)) if (!verifying.has(url)) delete health[url];
  writeFileSync(HEALTH_PATH, `${JSON.stringify(health, null, 2)}\n`);
  if (blockedByOrigin.length) {
    // 不擋輸出,但一定要吵 —— 被擋的來源等於沒被核對過,人要知道有這回事。
    console.log(`⚠ ${blockedByOrigin.length} 個來源所在網域對本主機關門(本輪未能核對,已放行):`);
    for (const line of blockedByOrigin) console.log(`   - ${line}`);
    console.log("   要確認是不是真的失效,從別的網路打一次;查全站死連結:node scripts/check-source-urls.mjs");
  }
  if (blocking.length) {
    fail(`來源持續無法連線，停止輸出：\n${blocking.map((b) => `- ${b}`).join("\n")}`);
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
