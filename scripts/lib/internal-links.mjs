// Rendered HTML 內部連結圖的純函式。只計算同一個來源頁對目標頁的「不同來源頁」數，
// 不把同一頁裡重複出現的 anchor 誤算成多個 inbound link。

export function normalizePageUrl(value, baseUrl = null) {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim(), baseUrl || undefined);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    if (url.pathname.endsWith('/index.html')) {
      url.pathname = url.pathname.slice(0, -'index.html'.length) || '/';
    } else if (url.pathname !== '/' && !url.pathname.endsWith('/')) {
      url.pathname += '/';
    }
    return url.href;
  } catch {
    return null;
  }
}

export function hrefsFromHtml(html) {
  return [...String(html || '').matchAll(/<a\b[^>]*\bhref\s*=\s*(['"])(.*?)\1/gi)]
    .map((match) => match[2])
    .filter(Boolean);
}

/**
 * @param {Array<string>} targetUrls sitemap 中的 URL
 * @param {Array<{url:string,html:string}>} documents rendered HTML
 * @returns {{counts:Map<string,number>, sources:Map<string,Set<string>>}}
 */
export function inboundLinkCounts(targetUrls, documents) {
  const normalizedTargets = [...new Set((targetUrls || [])
    .map((url) => normalizePageUrl(url)).filter(Boolean))];
  const targetSet = new Set(normalizedTargets);
  const counts = new Map(normalizedTargets.map((url) => [url, 0]));
  const sources = new Map(normalizedTargets.map((url) => [url, new Set()]));

  for (const document of documents || []) {
    const source = normalizePageUrl(document?.url);
    if (!source) continue;
    const seenTargets = new Set();
    for (const href of hrefsFromHtml(document.html)) {
      const target = normalizePageUrl(href, source);
      if (!targetSet.has(target) || target === source || seenTargets.has(target)) continue;
      seenTargets.add(target);
      counts.set(target, counts.get(target) + 1);
      sources.get(target).add(source);
    }
  }
  return { counts, sources };
}
