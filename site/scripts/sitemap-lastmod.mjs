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
// ⚠ 指紋前先正規化,把「與讀者無關、但每次 build 都不同」的東西洗掉
//   (實作與逐條緣由在 page-fingerprint.mjs;2026-09-17 起連導覽尾端的 Topic 捷徑也洗,
//   那是同一個坑從另一個入口回來):
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
import { fingerprint } from './page-fingerprint.mjs';
import { appendFileSync, readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
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
// 上一次部署的 HTML 所在目錄(CI 傳 publish repo 的 clone)。給了就**重算上一版的指紋**來比,
// 不信任 .page-stamps.json 裡存的 hash —— 指紋的正規化規則一改(2026-09-17 洗掉導覽捷徑),
// 舊 hash 全部對不上,會把整站再誤推一次;拿舊 HTML 重算就永遠是同一套規則比同一套規則。
// 存在檔裡的 hash 只剩「沒有上一版 HTML 可比」時(本機裸跑)才用。
const PREV_DIST = flag('--prev-dist', null);
const quiet = args.includes('--quiet');

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

let recomputed = 0;
for (const file of walk(DIST)) {
  const route = routeOf(file);
  const hash = fingerprint(readFileSync(file, 'utf8'));
  const before = prev[route];
  let beforeHash = before ? before.hash : null;
  if (PREV_DIST) {
    const prevFile = join(PREV_DIST, relative(DIST, file));
    if (existsSync(prevFile)) {
      beforeHash = fingerprint(readFileSync(prevFile, 'utf8'));
      recomputed += 1;
    }
  }
  if (before && before.updated_at && beforeHash === hash) {
    next[route] = { hash, updated_at: before.updated_at };
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
  const summary = `sitemap lastmod:${changed} 頁內容變了(蓋 ${NOW.slice(0, 19)}Z)、${carried} 頁沿用舊時間戳;`
    + `改寫 ${rewritten} 筆${missing ? `、${missing} 筆在 dist 找不到對應頁面(原樣保留)` : ''}`
    + (PREV_DIST ? `;上一版 HTML 重算 ${recomputed} 頁` : '');
  console.log(`✓ ${summary}`);
  // CI 上把比例寫進 run 的 Summary 頁,讓「這一輪推新了幾頁」不用翻 log 就看得到。
  // 只印不擋:凍結後首次部署、真的改了標題,整站變更都是誠實結果,擋門會把 CI 再次卡死。
  // 只在有上一版可比時寫:`pnpm build` 串鏈裡那次裸跑沒有 --prev,永遠是「全部變了」,
  // 寫進 Summary 只會誤導(CI 每個語系 job 都會跑兩次這支)。
  const hadPrevious = Boolean(PREV_DIST) || args.includes('--prev');
  if (process.env.GITHUB_STEP_SUMMARY && hadPrevious) {
    try {
      const total = changed + carried;
      const flag = previousCount > 0 && total > 1 && changed === total ? ' ⚠ 全部頁面被判定為變更' : '';
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${summary}${flag}\n`);
    } catch { /* Summary 寫不進去不影響部署 */ }
  }
}
