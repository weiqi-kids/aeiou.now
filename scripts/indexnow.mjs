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

async function main() {
  const slugs = changedSlugs();
  if (slugs.length === 0) {
    console.log(`[indexnow] 近 ${WINDOW_HOURS}h 沒有變動的 Topic,略過提交。`);
    return;
  }
  console.log(`[indexnow] 近 ${WINDOW_HOURS}h 變動 ${slugs.length} 個 Topic:${slugs.join(", ")}`);

  for (const [locale, origin] of Object.entries(ORIGINS)) {
    const urlList = slugs.map((slug) => `${origin}/topic/${slug}/`);
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
    );
    await submit(origin, urlList);
  }
}

await main();
