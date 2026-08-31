#!/usr/bin/env node
// sitemap 的 lastmod 改成「這一頁**算出來的 HTML** 真的變了才推新」(2026-08-27)。
//
// ── 為什麼要有這支(實測,不是推論) ──────────────────────────────────────
// 原本每一頁都取 `freshest(內容指紋, RENDER_AT)`,而 RENDER_AT 是整包 `site/src`
// 的指紋。site/src 一天改好幾次(2026-08-21 起連續七天,08-26 一天就變七次),
// 於是 **469 個 URL 的 lastmod 全部都是今天,而且天天如此**。
// sitemap.xml.ts 自己的註解就寫著「狼來了有害」—— 那正是當時的狀態。
//
// 後果量得出來:2026-08-27 抽驗 19 個 Topic 主頁(吃掉全部曝光的那批),
// 最後抓取日中位數是 **08-19**,08-26 之後只有 2 頁;而同一天抽的 20 個逐國頁
// 中位數是 08-27。標題與摘要在 08-21 / 08-25 / 08-26 改過三次,Google 一次都沒看過,
// 「523 曝光 1 點擊」量到的是 08-19 以前的舊摘要。
//
// ── 做法 ─────────────────────────────────────────────────────────────
// 逐頁對**產出的 HTML** 取指紋,和上一次部署的指紋比:一樣就沿用舊時間戳,
// 不一樣才蓋現在。狀態存在 publish repo 的 `.page-stamps.json` —— publish repo
// 本來就是「上一次部署長什麼樣」的權威副本,不必回寫原始碼庫(CI 七個語系平行跑,
// 回寫必打架)。
//
// ⚠ 指紋前先正規化,把「與讀者無關、但每次 build 都不同」的東西洗掉:
//   · `_astro/<hash>.css|js` 的檔名 —— 任何一個 scoped style 改動都會換掉它,
//     不正規化的話「改一個元件的 CSS」又會變成 469 頁一起宣告改版(同一個坑)。
//   · `data-astro-cid-xxxx` 同理。
//   · 行內 `<style>` 的內容 —— Astro 會把小張的 scoped style 直接內嵌進 <head>,
//     實測「只改一條 CSS」就讓 4 頁的 HTML 變了。樣式裡沒有讀者看得到的**文字**,
//     所以整塊洗掉;`<script type="application/json">` 那種設定塊**不洗**(那是內容)。
//   剩下的就是**讀者與 Google 看得到的東西**:標題、摘要、內文、連結。
//   所以「改標題」會推新(rule ② 的原意),「純換皮」不會 —— 這比舊做法更貼近 rule ②,
//   不是推翻它。
//
// 裸執行(沒有上一版指紋)= 全部視為新頁、蓋上現在,與改這支之前的行為一樣。
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DIST = flag('--dist', 'dist');
const PREV = flag('--prev', join(DIST, '.page-stamps.json'));
const OUT = flag('--out', join(DIST, '.page-stamps.json'));
const NOW = flag('--now', new Date().toISOString());
const quiet = args.includes('--quiet');

/** 每次 build 都會變、但讀者看不到的東西,一律洗成固定字串再取指紋。 */
function fingerprint(html) {
  const normalised = String(html)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '<style/>')
    .replace(/_astro\/[^"'\s>]+/g, '_astro/*')
    .replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(normalised).digest('hex');
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '.git' || name === '_astro') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

/** dist/topic/foo/index.html → /topic/foo/ (sitemap 的 <loc> 就是這個路徑) */
function routeOf(file) {
  const rel = relative(DIST, file).split(sep).join('/');
  const route = rel.replace(/index\.html$/, '').replace(/\.html$/, '');
  return `/${route}`.replace(/\/+/g, '/');
}

const prev = (() => {
  if (!existsSync(PREV)) return {};
  try {
    const parsed = JSON.parse(readFileSync(PREV, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.error(`✗ 上一版 .page-stamps.json 無法讀取：${PREV} (${error.message})`);
    process.exit(2);
  }
})();
const next = {};
let changed = 0;
let carried = 0;

for (const file of walk(DIST)) {
  const route = routeOf(file);
  const hash = fingerprint(readFileSync(file, 'utf8'));
  const before = prev[route];
  if (before && before.hash === hash && before.updated_at) {
    next[route] = before;
    carried += 1;
  } else {
    next[route] = { hash, updated_at: NOW };
    changed += 1;
  }
}

// sitemap 的 <lastmod> 換成逐頁的真實時間戳。找不到對應頁面(理論上不該發生)就原樣留著,
// **不亂編一個時間** —— 少報只是不來重爬,亂報會讓 Google 整個忽略這個欄位。
const sitemapPath = join(DIST, 'sitemap.xml');
let rewritten = 0;
let missing = 0;
if (existsSync(sitemapPath)) {
  const xml = readFileSync(sitemapPath, 'utf8');
  const updated = xml.replace(
    /<loc>([^<]+)<\/loc>(\s*)<lastmod>([^<]*)<\/lastmod>/g,
    (whole, loc, gap) => {
      let route;
      try { route = new URL(loc).pathname; } catch { return whole; }
      const stamp = next[route];
      if (!stamp) { missing += 1; return whole; }
      rewritten += 1;
      return `<loc>${loc}</loc>${gap}<lastmod>${stamp.updated_at}</lastmod>`;
    },
  );
  writeFileSync(sitemapPath, updated);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(next)}\n`);

if (!quiet) {
  const previousCount = Object.keys(prev).length;
  if (previousCount > 0 && changed === walk(DIST).length && changed > 1) {
    console.warn(`⚠ sitemap lastmod：${changed} 頁全部被判定為變更；請檢查是否把 build-time 相對值寫進 HTML。`);
  }
  console.log(
    `✓ sitemap lastmod:${changed} 頁內容變了(蓋 ${NOW.slice(0, 19)}Z)、${carried} 頁沿用舊時間戳;`
    + `改寫 ${rewritten} 筆${missing ? `、${missing} 筆在 dist 找不到對應頁面(原樣保留)` : ''}`,
  );
}
