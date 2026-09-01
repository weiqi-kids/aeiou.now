#!/usr/bin/env node
// Render 後 sitemap URL 的 inbound crawlable-link 稽核。
//
// sitemap 是 discovery hint，重要頁仍應有其他頁面的 <a href> 入口；這支只讀本地
// rendered HTML，不碰 GSC、DB 或部署狀態。用 --gate 才會在零 inbound URL 時 exit 1。
// 建議由 site/package.json 的 build 在每個 LOCALE build 後呼叫：
//   node ../scripts/check-internal-links.mjs --dist dist --gate

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { LOCALE_ORIGINS } from '../site/src/lib/seo.mjs';
import { inboundLinkCounts, normalizePageUrl } from './lib/internal-links.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DIST = resolve(process.cwd(), flag('--dist', 'dist'));
const locale = process.env.LOCALE || 'zh-TW';
const origin = String(process.env.SITE_URL || LOCALE_ORIGINS[locale] || LOCALE_ORIGINS['zh-TW']).replace(/\/$/, '');
const gate = args.includes('--gate');

function files(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

function pageUrlForFile(path) {
  const rel = relative(DIST, path).replaceAll('\\', '/');
  const pagePath = rel === 'index.html'
    ? '/'
    : rel.endsWith('/index.html')
    ? `/${rel.slice(0, -'index.html'.length)}`
    : `/${rel}`;
  return normalizePageUrl(new URL(pagePath, `${origin}/`).href);
}

const sitemapPath = join(DIST, 'sitemap.xml');
if (!existsSync(sitemapPath)) {
  console.error(`✗ 找不到 ${sitemapPath}`);
  process.exit(1);
}
const sitemapXml = readFileSync(sitemapPath, 'utf8');
const sitemapUrls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)]
  .map((match) => match[1].trim())
  .map((url) => normalizePageUrl(url))
  .filter(Boolean);
const htmlDocuments = files(DIST)
  .filter((path) => path.endsWith('.html'))
  .map((path) => ({ url: pageUrlForFile(path), html: readFileSync(path, 'utf8') }));
const { counts, sources } = inboundLinkCounts(sitemapUrls, htmlDocuments);
const rows = [...counts.entries()]
  .map(([url, count]) => ({ url, count, sources: sources.get(url)?.size || 0 }))
  .sort((a, b) => a.count - b.count || a.url.localeCompare(b.url));
const zero = rows.filter((row) => row.count === 0);
const one = rows.filter((row) => row.count === 1);
const minimum = rows.length ? rows[0].count : 0;

console.log(`內部連結圖：${rows.length} 個 sitemap URL、${htmlDocuments.length} 個 rendered HTML、locale=${locale}`);
console.log(`inbound crawlable links：零入口 ${zero.length}、單一入口 ${one.length}、最少 ${minimum}`);
if (zero.length) {
  console.log('\n零入口 URL：');
  for (const row of zero.slice(0, 20)) console.log(`  ${row.url}`);
  if (zero.length > 20) console.log(`  …另外 ${zero.length - 20} 頁`);
}
if (gate && zero.length > 0) process.exit(1);
