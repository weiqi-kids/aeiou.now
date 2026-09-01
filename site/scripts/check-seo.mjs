#!/usr/bin/env node
// 靜態輸出 SEO / GEO / AEO 釋出守門：只檢查 render 後的 HTML，避免
// 「元件裡有寫」但實際頁面漏掉 canonical、JSON-LD、sitemap 或答案段落。
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';
const LOCALE = process.env.LOCALE || 'zh-TW';
const LOCALES = ['zh-TW', 'en', 'ja', 'zh-CN', 'hi', 'id', 'pt-BR'];
const errors = [];
const mergeConfigPath = join('src', 'data', 'topic-merges.json');
const aliasPaths = existsSync(mergeConfigPath)
  ? new Set(((JSON.parse(readFileSync(mergeConfigPath, 'utf8'))?.merges) || []).map((merge) => `topic/${merge.from}/index.html`))
  : new Set();

// 允許 noindex 的第二類：筆數不足的排行榜時窗（2026-08-19 加）。
// 排行資料由 export-data.mjs 標 thin（門檻見 scripts/lib/content-depth.mjs）；
// 那種頁面內容幾乎相同、當時實測已被 Google 判 Crawled - currently not indexed，
// 與其送空頁不如自己標 noindex。筆數回升後 thin 消失、索引自動恢復，不需要改碼。
// ⚠️ 這份清單是**資料驅動**的，不是寫死路徑——寫死就會在資料變厚之後繼續 noindex。
const rankingDir = join('src', 'data', 'rankings', 'global');
const thinRankingPaths = new Set(
  (existsSync(rankingDir) ? readdirSync(rankingDir) : [])
    .filter((name) => name.endsWith('.json'))
    .filter((name) => JSON.parse(readFileSync(join(rankingDir, name), 'utf8'))?.thin === true)
    .map((name) => `rankings/${name.replace(/\.json$/, '')}/index.html`),
);
const noindexAllowed = (rel) => aliasPaths.has(rel) || thinRankingPaths.has(rel);

function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

function attr(html, selector, name) {
  const match = html.match(new RegExp(`<${selector}\\b[^>]*\\b${name}=["']([^"']*)["']`, 'i'));
  return match?.[1] || '';
}

function count(html, pattern) {
  return (html.match(pattern) || []).length;
}

function absolute(value) {
  return /^https?:\/\//i.test(value);
}

const BASE_PATH = String(process.env.BASE_PATH || '/');
const BASE_PREFIX = BASE_PATH === '/'
  ? ''
  : `/${BASE_PATH.replace(/^\/+|\/+$/g, '')}/`;

function localAssetPath(pathname) {
  const path = BASE_PREFIX && pathname.startsWith(BASE_PREFIX)
    ? pathname.slice(BASE_PREFIX.length)
    : pathname.replace(/^\/+/, '');
  return join(DIST, path);
}

function pngDimensions(path) {
  try {
    const bytes = readFileSync(path);
    if (bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } catch {
    return null;
  }
}

const htmlFiles = files(DIST).filter((path) => path.endsWith('.html'));
if (htmlFiles.length === 0) errors.push('dist 沒有 HTML');

for (const path of htmlFiles) {
  const html = readFileSync(path, 'utf8');
  const rel = relative(DIST, path);
  const canonical = attr(html, 'link', 'href');
  if (count(html, /<title\b/gi) !== 1) errors.push(`${rel}:title 必須恰好一個`);
  if (!/<meta\b[^>]*name=["']description["']/i.test(html)) errors.push(`${rel}:缺 meta description`);
  if (!canonical || !absolute(canonical)) errors.push(`${rel}:canonical 必須是 absolute URL`);
  if (!/name=["']robots["'][^>]*content=["'][^"']*max-image-preview:large/i.test(html)) errors.push(`${rel}:robots 缺 max-image-preview:large`);
  for (const property of ['og:title', 'og:description', 'og:url', 'og:type', 'og:site_name']) {
    if (!new RegExp(`property=["']${property.replace(':', '\\:')}["']`, 'i').test(html)) errors.push(`${rel}:缺 ${property}`);
  }
  if (!/name=["']twitter:card["']/i.test(html)) errors.push(`${rel}:缺 twitter:card`);
  if (count(html, /rel=["']alternate["'][^>]*hreflang=/gi) < LOCALES.length + 1) errors.push(`${rel}:hreflang 少於七語加 x-default`);
  const noindex = /name=["'](?:robots|googlebot)["'][^>]*content=["'][^"']*noindex/i.test(html);
  const ogImage = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1] || '';
  const ogImageWidth = html.match(/<meta\b[^>]*property=["']og:image:width["'][^>]*content=["']([^"']+)["']/i)?.[1] || '';
  const ogImageHeight = html.match(/<meta\b[^>]*property=["']og:image:height["'][^>]*content=["']([^"']+)["']/i)?.[1] || '';
  if (!noindex) {
    if (!ogImage || !absolute(ogImage)) errors.push(`${rel}:indexable page 必須有 absolute og:image`);
    if (ogImageWidth !== '1200' || ogImageHeight !== '675') {
      errors.push(`${rel}:indexable page 的 og:image 必須宣告 1200×675`);
    }
    if (!/primaryImageOfPage/i.test(html)) errors.push(`${rel}:JSON-LD 缺 primaryImageOfPage`);
  }
  if (ogImage && absolute(ogImage) && canonical && absolute(canonical)) {
    try {
      const imageUrl = new URL(ogImage);
      const pageUrl = new URL(canonical);
      if (imageUrl.origin === pageUrl.origin) {
        const imageFile = localAssetPath(imageUrl.pathname);
        if (!existsSync(imageFile)) {
          errors.push(`${rel}:og:image 指向不存在的本地檔案 ${imageUrl.pathname}`);
        } else {
          const dimensions = pngDimensions(imageFile);
          if (dimensions && (dimensions.width !== 1200 || dimensions.height !== 675)) {
            errors.push(`${rel}:og:image 實際尺寸 ${dimensions.width}×${dimensions.height}，不是 1200×675`);
          }
        }
      }
    } catch {
      errors.push(`${rel}:og:image 不是合法 URL`);
    }
  }
  if (!noindex && count(html, /<h1\b/gi) !== 1) errors.push(`${rel}:indexable page 必須恰好一個 h1`);
  if (noindex && !noindexAllowed(rel)) errors.push(`${rel}:只有 merged Topic alias 與 thin 排行榜時窗可以輸出 noindex`);
  if (thinRankingPaths.has(rel) && !noindex) errors.push(`${rel}:筆數不足的排行榜時窗必須 noindex（見 export-data.mjs 的 thin 旗標）`);
  if (aliasPaths.has(rel)) {
    if (!noindex) errors.push(`${rel}:merged Topic alias 必須 noindex`);
    if (!/<meta\b[^>]*http-equiv=["']refresh["'][^>]*content=["'][^"']*url=https?:\/\//i.test(html)) {
      errors.push(`${rel}:merged Topic alias 缺 absolute meta refresh`);
    }
  }
  const jsonScripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  if (jsonScripts.length === 0) errors.push(`${rel}:缺 JSON-LD`);
  for (const match of jsonScripts) {
    try {
      const json = JSON.parse(match[1]);
      if (json['@context'] !== 'https://schema.org' || !Array.isArray(json['@graph'])) errors.push(`${rel}:JSON-LD 必須是 schema.org graph`);
      if (!json['@graph']?.some((item) => item['@type'] === 'WebPage' || item['@type'] === 'CollectionPage')) errors.push(`${rel}:JSON-LD 缺 WebPage/CollectionPage`);
    } catch (error) {
      errors.push(`${rel}:JSON-LD 不是合法 JSON (${error.message})`);
    }
  }
}

const sitemap = join(DIST, 'sitemap.xml');
const robots = join(DIST, 'robots.txt');
if (!existsSync(sitemap)) errors.push('dist 缺 sitemap.xml');
if (!existsSync(robots)) errors.push('dist 缺 robots.txt');
if (existsSync(sitemap)) {
  const xml = readFileSync(sitemap, 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  if (locs.length === 0 || locs.some((loc) => !absolute(loc))) errors.push('sitemap 的 loc 必須是 absolute URL');
  if (!xml.includes('http://www.google.com/schemas/sitemap-image/1.1')) errors.push('sitemap 缺 image namespace');
  const topicIndex = join('src', 'data', 'topics', 'index', `${LOCALE}.json`);
  if (existsSync(topicIndex)) {
    const topics = JSON.parse(readFileSync(topicIndex, 'utf8'));
    const topicLocs = locs.filter((loc) => /\/topic\/[^/]+\/$/.test(loc));
    if (topicLocs.length !== topics.length) errors.push(`sitemap Topic 數量 ${topicLocs.length} ≠ active index ${topics.length}`);
  }
}
if (existsSync(robots) && !/Sitemap:\s*https?:\/\//i.test(readFileSync(robots, 'utf8'))) errors.push('robots.txt 缺 absolute Sitemap 指向');

const topicIndexPath = join('src', 'data', 'topics', 'index', `${LOCALE}.json`);
if (existsSync(topicIndexPath)) {
  const topics = JSON.parse(readFileSync(topicIndexPath, 'utf8'));
  for (const topic of topics) {
    const page = join(DIST, 'topic', topic.slug, 'index.html');
    if (!existsSync(page)) {
      errors.push(`active Topic ${topic.slug}:缺靜態頁`);
      continue;
    }
    const html = readFileSync(page, 'utf8');
    if (!html.includes('id="answers"')) errors.push(`${topic.slug}:缺 AEO answers 區塊`);
    // FAQPage 保留與否是語意／相容性選擇，不再是 Google Search rich-result 的必要條件；
    // release gate 只守真正可見且可索引的答案區塊。Google 已停止 FAQ rich result，
    // 因此不能把缺 FAQ schema 當成整站 SEO 失敗。
    // machine-owned trend Topic 先以無 cover 的輕量頁發布；manual/文化 Topic 維持
    // Discover cover 與 LCP 首圖硬要求，避免趨勢資料反過來阻塞整站發布。
    if (topic.category !== 'trend') {
      if (!html.includes('/covers/')) errors.push(`${topic.slug}:缺 Discover cover`);
      if (!/fetchpriority=["']high["']/i.test(html)) errors.push(`${topic.slug}:首圖缺 fetchpriority=high`);
    }
  }
}

if (errors.length) {
  console.error(`SEO/GEO/AEO 輸出稽核失敗，共 ${errors.length} 項：\n${errors.map((error) => `- ${error}`).join('\n')}`);
  process.exit(1);
}
console.log(`SEO/GEO/AEO 輸出稽核通過：${htmlFiles.length} HTML、${LOCALES.length} hreflang、sitemap、robots、JSON-LD 與 Topic answers 全數存在。`);
