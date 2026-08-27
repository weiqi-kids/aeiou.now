#!/usr/bin/env node
/**
 * IndexNow 即時索引提交(七站各一次)。
 *
 * 為什麼要有:GitHub Pages 沒有伺服器端 hook,新內容上線後只能等搜尋引擎自己回來爬。
 * IndexNow 一次提交會分享給 Bing / Yandex / Seznam / Naver / Yep;Bing 的索引同時
 * 餵 ChatGPT Search 與 Copilot。**Google 不吃 IndexNow**,它走 sitemap 的 lastmod
 * (見 site/src/pages/sitemap.xml.ts)。兩條路互補,不重疊。
 *
 * 為什麼要分七次:IndexNow 的 payload 有 host 欄位,且必須與 urlList 的網域相符,
 * 金鑰檔也要能在該網域上取得。七個語系是七個獨立網域,所以是七次獨立提交,
 * 不是一次七語混送 —— 混送會被整批拒絕。
 *
 * 送什麼:只送「近期真的變過」的 Topic 頁。判準是 export-data 寫入
 * data/topics/<id>/facts.json 的 content_updated_at；它由 facts+i18n 的實際輸出 hash
 * 決定，所以改七語 summary/customs 也會觸發提交。不能用 topics.updated_at：那個欄位
 * 刻意只在 Topic metadata 改變時更新，內容改了但 canonical/commonality 沒變時不會動。
 *
 * best-effort:任何網路或 API 錯誤都只印警告並以 0 結束,絕不擋部署。
 *
 * 裸執行即正確行為(送近 48 小時內變動的頁);旗標只縮減行為:
 *   --dry-run                 只印要送什麼,不實際送出
 *   AEIOU_INDEXNOW_HOURS=N    改時間窗
 *   AEIOU_INDEXNOW_KEY=xxx    改金鑰(需同步換掉 site/public/<key>.txt)
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = join(ROOT, "data");

// 公開金鑰(IndexNow 用它驗網域擁有權,本來就是公開資訊,不是 secret)。
// 對應檔案 site/public/<KEY>.txt,build 後會出現在七個站的根路徑。
const KEY = process.env.AEIOU_INDEXNOW_KEY || "ef6066298d7fcbf541dfdfaa1fbad2ce";
const ENDPOINT = "https://api.indexnow.org/indexnow";
const WINDOW_HOURS = Number(process.env.AEIOU_INDEXNOW_HOURS || 48);
const DRY_RUN = process.argv.includes("--dry-run");

// locale → 正式網域。與 CLAUDE.md 的介面常數同一份映射(ja→jp、zh-CN→cn、pt-BR→br 不同名)。
const ORIGINS = {
  "zh-TW": "https://aeiou.now",
  en: "https://en.aeiou.now",
  ja: "https://jp.aeiou.now",
  "zh-CN": "https://cn.aeiou.now",
  hi: "https://hi.aeiou.now",
  id: "https://id.aeiou.now",
  "pt-BR": "https://br.aeiou.now",
};

/** 近期變動的 Topic slug。空陣列代表這一輪沒有東西該送。 */
function changedSlugs() {
  const topicsDir = join(DATA, "topics");
  if (!existsSync(topicsDir)) return [];
  const cutoff = Date.now() - WINDOW_HOURS * 3600 * 1000;
  const slugs = [];
  for (const name of readdirSync(topicsDir)) {
    if (!name.startsWith("top_")) continue;
    const factsPath = join(topicsDir, name, "facts.json");
    if (!existsSync(factsPath)) continue;
    let facts;
    try { facts = JSON.parse(readFileSync(factsPath, "utf8")); } catch { continue; }
    if (!facts?.slug) continue;
    const updated = Date.parse(facts.content_updated_at || facts.updated_at || "");
    if (!Number.isFinite(updated) || updated < cutoff) continue;
    slugs.push(facts.slug);
  }
  return slugs.sort();
}

async function submit(origin, urlList) {
  const host = new URL(origin).host;
  const payload = { host, key: KEY, keyLocation: `${origin}/${KEY}.txt`, urlList };
  if (DRY_RUN) {
    console.log(`[indexnow] DRY_RUN ${host}:${urlList.length} 筆`);
    return true;
  }
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
    const text = await res.text().catch(() => "");
    // IndexNow:200/202 視為成功。其他狀態印出來供排查,但不當成失敗。
    if (res.ok) {
      console.log(`[indexnow] ✓ ${host} ${urlList.length} 筆(HTTP ${res.status})`);
      return true;
    }
    console.warn(`[indexnow] ${host} 回應 HTTP ${res.status} ${text}`.trim());
  } catch (e) {
    console.warn(`[indexnow] ${host} 提交失敗(忽略):${e.message}`);
  }
  return false;
}

/**
 * 某個站**線上那一份** sitemap 的路徑清單。
 *
 * 為什麼是線上抓、不是讀本地 dist(2026-08-27 修正):這支在 CI 是獨立 job
 * (`needs: build-deploy`),只做 checkout、不 build —— `site/dist/` 根本不存在,
 * 於是逐國頁那一段從上線以來**一次都沒有真的送出過**,而且靜靜地送 0 筆。
 * 本地跑時 dist 又只有最後一個 build 的語系,拿它餵七個 origin 會送出 404。
 *
 * 線上 sitemap 剛好同時解掉這兩件事:它逐 origin 各自一份、而且就是**真的上線了的**
 * 那一份,判準仍然只有一份(site/src/lib/{country-cells,holidays}.mjs 產出的那份)。
 * 抓不到就退回本地 dist(只認 origin 相符的那一份),再抓不到就回空陣列 —— 不擋提交。
 */
async function sitemapPaths(origin) {
  let xml = null;
  try {
    const res = await fetch(`${origin}/sitemap.xml`, { headers: { "User-Agent": "aeiou.now indexnow" } });
    if (res.ok) xml = await res.text();
    else console.warn(`[indexnow] ${origin}/sitemap.xml HTTP ${res.status},改讀本地 dist`);
  } catch (e) {
    console.warn(`[indexnow] ${origin}/sitemap.xml 抓取失敗(${e.message}),改讀本地 dist`);
  }
  if (xml == null) {
    const file = ["site/dist/sitemap.xml", "dist/sitemap.xml"].map((p) => join(ROOT, p)).find((p) => existsSync(p));
    if (!file) return [];
    xml = readFileSync(file, "utf8");
  }
  const out = [];
  for (const m of xml.matchAll(/<loc>([^<]*)<\/loc>/g)) {
    // ⚠ 只認 sitemap 自己那個 origin:七站的逐國頁與假日頁集合不一樣(厚度門檻逐語系算),
    // 拿同一份清單送給七個 origin 等於主動把 404 餵給搜尋引擎。
    if (!m[1].startsWith(`${origin}/`)) continue;
    out.push(m[1].slice(origin.length));
  }
  return [...new Set(out)];
}

/** 假日總表(/holidays/<cc>/<年>/)近期變過嗎。它有自己的資料指紋,與 Topic 無關。 */
function holidaysChanged() {
  const stampPath = join(DATA, "meta", "stamps.json");
  if (!existsSync(stampPath)) return false;
  try {
    const stamps = JSON.parse(readFileSync(stampPath, "utf8"));
    const at = Date.parse(stamps?.holidays?.updated_at || "");
    return Number.isFinite(at) && at >= Date.now() - WINDOW_HOURS * 3600 * 1000;
  } catch { return false; }
}

async function main() {
  const slugs = changedSlugs();
  const holidays = holidaysChanged();
  if (slugs.length === 0 && !holidays) {
    console.log(`[indexnow] 近 ${WINDOW_HOURS}h 沒有變動的 Topic 或假日總表,略過提交。`);
    return;
  }
  if (slugs.length > 0) {
    console.log(`[indexnow] 近 ${WINDOW_HOURS}h 變動 ${slugs.length} 個 Topic:${slugs.join(", ")}`);
  }
  if (holidays) console.log(`[indexnow] 近 ${WINDOW_HOURS}h 假日總表變動,一併提交 /holidays/ 全部格子。`);

  for (const [locale, origin] of Object.entries(ORIGINS)) {
    const paths = await sitemapPaths(origin);
    const urlList = [];
    if (slugs.length > 0) {
      urlList.push(...slugs.map((slug) => `${origin}/topic/${slug}/`));
      // 有 Topic 變動時列表頁的內容也跟著變,一併請重爬。
      // /questions/ 每天換題,而且是唯一沒有其他入口的頁面 —— 2026-08-20 用 URL Inspection
      // 逐頁驗過:sitemap 上 36 頁只有它是「URL is unknown to Google」,其餘 35 頁都已索引。
      // 它一直沒被提交,是因為這份清單原本只推 Topic 頁與 today 列表。
      urlList.push(
        `${origin}/`,
        `${origin}/topics/today/`,
        `${origin}/topics/nearby/`,
        `${origin}/topics/events/`,
        `${origin}/questions/`,
        // 排行榜六個時窗(2026-08-26 補)。它們的內容跟著 Topic 分數每小時變,
        // 符合上面那條「有 Topic 變動時列表頁也跟著變」的理由,卻從來沒被提交過。
        // 起因:`seo-health.mjs` ② 層查到 `/rankings/3m/` 是全站唯一
        // 「Discovered - currently not indexed」,而且 `lastCrawlTime` 是 never。
        // 逐頁比對六個時窗:24h/72h/7d/1m/1y 都已索引、referringUrls 1–4 個,只有 3m 是 0 個。
        // 三項檢查裡它只缺這一項 —— 在 sitemap(有)、有站內連結(六頁互連,markup 與其他五頁一樣)、
        // 被 indexnow 提交(**沒有**)。
        // ⚠ Google 不吃 IndexNow(見檔頭),所以這一條直接受益的是 Bing/ChatGPT/Copilot;
        // 對 Google 那一半仍然靠 sitemap 的 lastmod。
        // /about/ 不加:它不隨 Topic 變動,不符合上面那條理由。
        ...["24h", "72h", "7d", "1m", "3m", "1y"].map((w) => `${origin}/rankings/${w}/`),
        // 逐國頁(2026-08-26)。它的內容就是母 Topic 那一格,母頁變了它就變。
        // 清單來自線上 sitemap(見 sitemapPaths),所以送的一定是真的產出了的那些格子。
        ...paths.filter((path) => slugs.some((slug) => path.startsWith(`/topic/${slug}/`)) && /^\/topic\/[^/]+\/[a-z]{2}\/$/.test(path))
          .map((path) => `${origin}${path}`),
      );
    }
    // 假日總表(2026-08-27 補)。它有自己的資料指紋,不隨 Topic 變 ——
    // 上線當天 147 個新網址一個都沒被提交過,因為這份清單原本只認 Topic 變動。
    // 它也是站上唯一沒有站內入口的頁型(見 [year].astro 的說明),對 Bing 而言
    // sitemap 與 IndexNow 是僅有的兩條發現路徑。
    if (holidays) {
      urlList.push(...paths.filter((path) => /^\/holidays\/[a-z]{2}\/\d{4}\/$/.test(path)).map((path) => `${origin}${path}`));
    }
    const unique = [...new Set(urlList)];
    if (unique.length === 0) {
      console.warn(`[indexnow] ${new URL(origin).host}:沒有可提交的網址(sitemap 讀不到?),略過。`);
      continue;
    }
    await submit(origin, unique);
  }
}

await main();
