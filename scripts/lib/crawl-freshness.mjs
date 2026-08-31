// crawl freshness 的純函式，讓 URL 篩選與 gate 計算可以被測試，
// 也避免報表把所有語系的 sitemap 強行改成主站 origin。

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
