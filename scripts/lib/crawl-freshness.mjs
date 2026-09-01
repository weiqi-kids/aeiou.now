// crawl freshness 的純函式，讓 URL 篩選與 gate 計算可以被測試，
// 也避免報表把所有語系的 sitemap 強行改成主站 origin。
import { LOCALE_ORIGINS } from '../../site/src/lib/seo.mjs';

export const CRAWL_ORIGINS = Object.freeze(Object.entries(LOCALE_ORIGINS)
  .map(([locale, origin]) => ({ locale, origin })));

export function topicUrlsFromSitemap(xml, origin = null) {
  const locs = [...String(xml || '').matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  return locs.filter((url) => {
    try { return /^\/topic\/[^/]+\/$/.test(new URL(url).pathname); } catch { return false; }
  }).map((url) => {
    if (!origin) return url;
    return new URL(new URL(url).pathname, origin).href;
  });
}

export function summarizeCrawlRows(rows, since) {
  const crawled = rows.filter((row) => row.crawl);
  const fresh = crawled.filter((row) => row.crawl.slice(0, 10) >= since);
  const dates = crawled.map((row) => row.crawl.slice(0, 10)).sort();
  const errors = rows.filter((row) => row.error || String(row.state || '').startsWith('ERR')).length;
  return {
    crawled: crawled.length,
    fresh: fresh.length,
    errors,
    ratio: rows.length ? fresh.length / rows.length : 0,
    median: dates.length ? dates[Math.floor(dates.length / 2)] : '—',
    dates,
  };
}

/**
 * 從一組 URL 均勻取樣；結果固定，方便同一個 gate 的前後比較。
 * @param {Array<string>} items
 * @param {number} limit
 * @returns {Array<string>}
 */
export function sampleEvenly(items, limit) {
  const list = Array.isArray(items) ? [...items] : [];
  const size = Math.max(0, Math.floor(Number(limit) || 0));
  if (size === 0 || list.length <= size) return size === 0 ? [] : list;
  if (size === 1) return [list[Math.floor((list.length - 1) / 2)]];
  const indexes = [];
  for (let i = 0; i < size; i += 1) {
    const index = Math.round((i * (list.length - 1)) / (size - 1));
    if (indexes[indexes.length - 1] !== index) indexes.push(index);
  }
  return indexes.map((index) => list[index]);
}

/**
 * 七個網域分層取樣。每個有 Topic 的網域至少拿一頁（樣本夠大時），
 * 剩餘配額按該網域 URL 數量分配，避免本地最後一次 build 的語系代表全站。
 * @param {Array<{locale:string, origin:string, urls:Array<string>}>} groups
 * @param {number} limit 0 = 全部
 * @returns {Array<{locale:string, origin:string, url:string}>}
 */
export function stratifiedTopicSample(groups, limit = 0) {
  const normalized = (Array.isArray(groups) ? groups : [])
    .map((group) => ({
      locale: group.locale,
      origin: group.origin,
      urls: [...new Set(Array.isArray(group.urls) ? group.urls : [])],
    }))
    .filter((group) => group.urls.length > 0);
  const total = normalized.reduce((sum, group) => sum + group.urls.length, 0);
  const requested = Math.floor(Number(limit) || 0);
  if (requested <= 0 || requested >= total) {
    return normalized.flatMap((group) => group.urls.map((url) => ({ ...group, url })))
      .map(({ locale, origin, url }) => ({ locale, origin, url }));
  }

  const target = Math.min(requested, total);
  const quotas = normalized.map(() => 0);
  // 樣本大到能覆蓋全部網域時，先給每站一個名額；樣本小於站數時，
  // 仍按 URL 量取最大的站，並在輸出中明確顯示實際覆蓋範圍。
  if (target >= normalized.length) quotas.fill(1);
  let assigned = quotas.reduce((sum, quota) => sum + quota, 0);
  while (assigned < target) {
    let best = -1;
    let bestScore = -1;
    for (let i = 0; i < normalized.length; i += 1) {
      if (quotas[i] >= normalized[i].urls.length) continue;
      const score = normalized[i].urls.length / (quotas[i] + 1);
      if (score > bestScore) { best = i; bestScore = score; }
    }
    if (best < 0) break;
    quotas[best] += 1;
    assigned += 1;
  }

  return normalized.flatMap((group, index) => sampleEvenly(group.urls, quotas[index])
    .map((url) => ({ locale: group.locale, origin: group.origin, url })));
}
