#!/usr/bin/env node
// 「Google 到底有沒有回來看新版」的驗收指令(2026-08-27)。
//
// ── 為什麼需要它 ──────────────────────────────────────────────────────
// 2026-08-27 查出來的事:標題與摘要在 08-21 / 08-25 / 08-26 改過三次,而抽驗 19 個
// Topic 主頁,**最後抓取日中位數停在 08-19** —— Google 一次都沒看過新版。
// 於是「523 曝光 1 點擊」量到的是舊摘要,拿它當文案的成績單是錯的。
// 原因是 sitemap 的 lastmod 對 469 個 URL 天天都報今天(見 site/scripts/sitemap-lastmod.mjs)。
//
// 所以在 Google 重爬之前,**任何摘要/標題改版的成效都還沒開始量**。
// 這一支就是那道閘門:先跑它,看重爬進度,再決定要不要調文案。
//
// 判準(--gate 會據此決定 exit code):
//   Topic 主頁裡 lastCrawlTime >= 基準日 的比例 >= --min-ratio(預設 0.7)才算「量得準」。
//   基準日預設 = 最近一次動到 site/src/lib/seo.mjs 或 topic/[slug].astro 的 commit 日期。
//
// 用法:
//   node scripts/crawl-freshness.mjs                    # 報告
//   node scripts/crawl-freshness.mjs --since 2026-08-27 # 指定基準日
//   node scripts/crawl-freshness.mjs --gate             # 沒過就 exit 1(給 CI/cron 用)
//   node scripts/crawl-freshness.mjs --sample 20        # 只抽驗 N 頁(URL Inspection 有配額)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { summarizeCrawlRows, topicUrlsFromSitemap } from './lib/crawl-freshness.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SA = join(homedir(), '.config', 'aeiou', 'ga4-sa.json');
const GOOGLE_LIB = '/mnt/customers/seo-ops/lib/google.mjs';
const SITE = 'sc-domain:aeiou.now';
const origin = flag('--origin', null);
const gate = args.includes('--gate');
const minRatio = Number(flag('--min-ratio', '0.7'));
const sampleSize = Number(flag('--sample', '0'));

if (!existsSync(SA)) { console.error(`✗ 缺 SA 金鑰:${SA}`); process.exit(1); }
if (!existsSync(GOOGLE_LIB)) { console.error(`✗ 缺 ${GOOGLE_LIB}`); process.exit(1); }
const { inspectUrl } = await import(GOOGLE_LIB);

/** 基準日:最近一次動到「決定 title/description 的那幾支」的 commit 日期。 */
function defaultSince() {
  try {
    const out = execFileSync('git', [
      'log', '-1', '--format=%cs', '--',
      'site/src/lib/seo.mjs', 'site/src/pages/topic/[slug].astro',
    ], { cwd: '/mnt/customers/aeiou.now', encoding: 'utf8' }).trim();
    return out || null;
  } catch { return null; }
}
const since = flag('--since', defaultSince());
if (!since) { console.error('✗ 推不出基準日,請用 --since YYYY-MM-DD'); process.exit(1); }

// Topic 主頁 = 吃掉全部曝光的那批,只驗它們(逐國頁與假日頁不是這道閘門在管的)。
const sitemapPath = '/mnt/customers/aeiou.now/site/dist/sitemap.xml';
if (!existsSync(sitemapPath)) {
  console.error('✗ 找不到 site/dist/sitemap.xml —— 先 `cd site && LOCALE=zh-TW pnpm build`');
  process.exit(1);
}
let pages = topicUrlsFromSitemap(readFileSync(sitemapPath, 'utf8'), origin);
if (sampleSize > 0 && pages.length > sampleSize) {
  const step = Math.ceil(pages.length / sampleSize);
  pages = pages.filter((_, i) => i % step === 0).slice(0, sampleSize);
}

const rows = [];
for (const url of pages) {
  try {
    const r = await inspectUrl(SA, SITE, url);
    rows.push({ url, crawl: r.lastCrawlTime || null, state: r.coverageState || '?' });
  } catch (e) {
    rows.push({ url, crawl: null, state: `ERR ${String(e.message).slice(0, 40)}` });
  }
}

const summary = summarizeCrawlRows(rows, since);

console.log(`基準日 ${since}（Google 看過新版了嗎）`);
console.log(`Topic 主頁 ${rows.length} 頁：有抓取紀錄 ${summary.crawled}、基準日之後重爬 ${summary.fresh}（${(summary.ratio * 100).toFixed(0)}%）`);
console.log(`最後抓取日：最舊 ${summary.dates[0] || '—'}　中位 ${summary.median}　最新 ${summary.dates[summary.dates.length - 1] || '—'}`);
if (summary.errors) console.log(`URL Inspection 錯誤 ${summary.errors} 筆；gate 會 fail-closed，避免把錯誤誤算成未重爬。`);

const stale = rows.filter((r) => !r.crawl || r.crawl.slice(0, 10) < since);
if (stale.length) {
  console.log(`\n還沒重爬的 ${stale.length} 頁（Google 現在看到的仍是舊標題／舊摘要）：`);
  for (const r of stale.slice(0, 15)) {
    console.log(`  ${(r.crawl ? r.crawl.slice(0, 10) : '從未抓取').padEnd(10)} ${r.url}`);
  }
  if (stale.length > 15) console.log(`  …另外 ${stale.length - 15} 頁`);
}

const gateReasons = [
  summary.ratio < minRatio ? `重爬比例 ${(summary.ratio * 100).toFixed(0)}% < ${(minRatio * 100).toFixed(0)}%` : null,
  summary.errors > 0 ? `${summary.errors} 筆 Inspection 錯誤` : null,
].filter(Boolean).join('；');
console.log(
  summary.ratio >= minRatio && summary.errors === 0
    ? `\n✅ 重爬比例 ${(summary.ratio * 100).toFixed(0)}% >= ${(minRatio * 100).toFixed(0)}%：現在量到的 CTR 才是新摘要的成績。`
    : `\n⛔ ${gateReasons}：**現在不要調文案**。`
      + `\n   GSC 的曝光／點擊仍混著舊摘要,拿它當成績單會得到錯的結論(2026-08-19/21/25/26 已經據此改過三次)。`,
);
if (gate && (summary.ratio < minRatio || summary.errors > 0)) process.exit(1);
