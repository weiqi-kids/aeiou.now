// URL Inspection 週掃的純函式(2026-09-17)。
//
// 為什麼要有這份:2026-09-02 之後用戶拍板「逐國頁縮不縮,用 Google 的判決
// (持續 N 天 Discovered - currently not indexed)」,但 crawl-freshness.mjs 與
// seo-health.mjs 都只印不存 —— 沒有任何一張表存得到逐頁 coverageState 的時間序列,
// 「持續 N 天」根本無從判起。這裡是那條時間序列的判斷邏輯;寫庫與打 API 在
// scripts/url-inspection-sweep.mjs。
//
// 這裡只有純函式(不碰 DB、不碰網路),讓排序、page_type、退場判準都能被測試。

export const PAGE_TYPES = Object.freeze([
  'topic', 'country', 'holiday', 'question', 'ranking', 'home', 'other',
]);

/** Google 的 coverageState 原文;退場判準只認這一句,不做模糊比對。 */
export const DISCOVERED_NOT_INDEXED = 'Discovered - currently not indexed';

/**
 * 從 URL 的路徑形狀判 page_type。七種形狀對應七站共用的路由:
 *   /                          home
 *   /topic/<slug>/             topic
 *   /topic/<slug>/<cc>/        country(逐國頁,cc 兩碼小寫)
 *   /holidays/<cc>/<yyyy>/     holiday
 *   /questions/ 與 /questions/<x>/  question
 *   /rankings/<window>/        ranking
 *   其餘(/topics/today/、/about/ …)  other
 * 判不出來也回 'other',不丟錯 —— 這是分類欄位不是閘門。
 */
export function pageTypeOf(url) {
  let path;
  try { path = new URL(String(url)).pathname; } catch { return 'other'; }
  if (path === '/') return 'home';
  if (/^\/topic\/[^/]+\/[a-z]{2}\/$/.test(path)) return 'country';
  if (/^\/topic\/[^/]+\/$/.test(path)) return 'topic';
  if (/^\/holidays\/[a-z]{2}\/\d{4}\/$/.test(path)) return 'holiday';
  if (/^\/questions\/(?:[^/]+\/)?$/.test(path)) return 'question';
  if (/^\/rankings\/[^/]+\/$/.test(path)) return 'ranking';
  return 'other';
}

export function hostOf(url) {
  try { return new URL(String(url)).host; } catch { return ''; }
}

/**
 * sitemap 全部 <loc>(不像 crawl-freshness 只取 Topic 主頁 —— 週掃要看的正是
 * 逐國頁與假日頁這些「疑似薄頁」)。帶 origin 時把路徑改掛到該站網域,
 * 避免某站 sitemap 誤填別站網域時把 URL 算到錯的 host。
 */
export function urlsFromSitemap(xml, origin = null) {
  const locs = [...String(xml || '').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  const out = [];
  const seen = new Set();
  for (const loc of locs) {
    let url;
    try {
      url = origin ? new URL(new URL(loc).pathname, origin).href : new URL(loc).href;
    } catch { continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/**
 * 排這一次要掃哪些 URL。
 * @param {object} p
 * @param {string[]} p.urls            線上 sitemap 的 URL(順序 = sitemap 順序,當作穩定 tie-break)
 * @param {Map<string,{lastInspectedAt:number,lastSweepId:string}>} p.history 每個 URL 最近一次
 * @param {string} p.sweepId           今天的 sweep_id(YYYY-MM-DD)
 * @param {number} p.limit             這一次最多幾筆(配額);<=0 就一筆都不排
 * @returns {{planned:string[], skippedInSweep:number, neverInspected:number, candidates:number}}
 *
 * 規則:① 同一個 sweep_id 已掃過的不再掃(重跑安全、不多燒配額);
 *       ② 從沒掃過的優先(它們連一筆判決都沒有);
 *       ③ 其餘依上次 inspected_at 最舊在前;
 *       ④ 截到 limit。
 */
export function planSweep({ urls, history, sweepId, limit }) {
  const list = [...new Set(Array.isArray(urls) ? urls : [])];
  const hist = history instanceof Map ? history : new Map(Object.entries(history || {}));
  const never = [];
  const seen = [];
  let skippedInSweep = 0;
  for (let i = 0; i < list.length; i += 1) {
    const url = list[i];
    const h = hist.get(url);
    if (!h) { never.push(url); continue; }
    if (h.lastSweepId === sweepId) { skippedInSweep += 1; continue; }
    seen.push({ url, at: Number(h.lastInspectedAt) || 0, i });
  }
  seen.sort((a, b) => (a.at - b.at) || (a.i - b.i));
  const ordered = [...never, ...seen.map((s) => s.url)];
  const cap = Math.max(0, Math.floor(Number(limit) || 0));
  return {
    planned: ordered.slice(0, cap),
    skippedInSweep,
    neverInspected: never.length,
    candidates: ordered.length,
  };
}

/** indexStatusResult → 要存進 url_inspections 的欄位。缺的欄位存 null,不補猜。 */
export function inspectionRow(result) {
  const r = result && typeof result === 'object' ? result : {};
  const referring = Array.isArray(r.referringUrls) ? r.referringUrls.length : null;
  return {
    verdict: r.verdict ?? null,
    coverage_state: r.coverageState ?? null,
    indexing_state: r.indexingState ?? null,
    robots_state: r.robotsTxtState ?? null,
    last_crawl_time: r.lastCrawlTime ?? null,
    google_canonical: r.googleCanonical ?? null,
    referring_count: referring,
  };
}

/** 配額用盡的錯誤:再打也只是燒時間,呼叫端據此提早收工。 */
export function isQuotaError(error) {
  const msg = String(error?.message || error || '');
  return /quota|RESOURCE_EXHAUSTED|rateLimitExceeded|\b429\b/i.test(msg);
}

/**
 * 每個 URL 最新一次的觀測(= 「最近一輪」)。一輪要跨兩三天才掃得完全站,
 * 所以「最近一輪」不是單一 sweep_id,而是每個 URL 各自最新的那一筆;
 * sinceSweepId 用來把早已不在 sitemap、只剩舊紀錄的 URL 排除掉。
 * @param {Array<{url:string,sweep_id:string}>} rows
 * @param {string|null} sinceSweepId  只看 sweep_id >= 這個(含);null = 全部
 */
export function latestPerUrl(rows, sinceSweepId = null) {
  const latest = new Map();
  for (const row of rows || []) {
    if (sinceSweepId && row.sweep_id < sinceSweepId) continue;
    const cur = latest.get(row.url);
    if (!cur || row.sweep_id > cur.sweep_id) latest.set(row.url, row);
  }
  return [...latest.values()];
}

/** page_type × coverage_state 的計數矩陣(給報表印)。 */
export function coverageMatrix(latestRows) {
  const counts = {};
  const states = new Set();
  for (const row of latestRows || []) {
    const type = PAGE_TYPES.includes(row.page_type) ? row.page_type : 'other';
    const state = row.coverage_state || '(空)';
    states.add(state);
    counts[type] ??= {};
    counts[type][state] = (counts[type][state] || 0) + 1;
  }
  const types = PAGE_TYPES.filter((t) => counts[t]);
  const total = (state) => Object.values(counts).reduce((s, c) => s + (c[state] || 0), 0);
  const stateList = [...states].sort((a, b) => total(b) - total(a) || a.localeCompare(b));
  return { types, states: stateList, counts };
}

export function daysBetween(fromDate, toDate) {
  const a = Date.parse(`${fromDate}T00:00:00Z`);
  const b = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/**
 * 退場判準的輸入:「連續 >= minRounds 輪都是 Discovered - currently not indexed,
 * 且這串狀態首見 >= minDays 天前」的 URL。
 * 「連續」以該 URL 自己的觀測序列算(從最新一筆往回數),不是以日曆天算 ——
 * 一輪跨兩三天,同一個 URL 每輪只有一筆。
 * 「首見」= 這一串連續狀態最早的那一筆的 sweep_id(中間曾變成別的狀態就重算)。
 * @param {Array<{url:string,sweep_id:string,coverage_state:string,page_type?:string,host?:string}>} rows
 * @returns {Array<{url:string,page_type:string,host:string,rounds:number,firstSeen:string,lastSeen:string,ageDays:number}>}
 */
export function persistentlyUnindexed(rows, { minRounds = 3, minDays = 21, today, state = DISCOVERED_NOT_INDEXED } = {}) {
  const byUrl = new Map();
  for (const row of rows || []) {
    if (!byUrl.has(row.url)) byUrl.set(row.url, []);
    byUrl.get(row.url).push(row);
  }
  const out = [];
  for (const [url, list] of byUrl) {
    list.sort((a, b) => (a.sweep_id < b.sweep_id ? 1 : a.sweep_id > b.sweep_id ? -1 : 0));
    let rounds = 0;
    let firstSeen = null;
    for (const row of list) {
      if (row.coverage_state !== state) break;
      rounds += 1;
      firstSeen = row.sweep_id;
    }
    if (rounds < minRounds) continue;
    const ageDays = today ? daysBetween(firstSeen, today) : 0;
    if (today && ageDays < minDays) continue;
    out.push({
      url,
      page_type: list[0].page_type || pageTypeOf(url),
      host: list[0].host || hostOf(url),
      rounds,
      firstSeen,
      lastSeen: list[0].sweep_id,
      ageDays,
    });
  }
  return out.sort((a, b) => (b.rounds - a.rounds) || (b.ageDays - a.ageDays) || a.url.localeCompare(b.url));
}
