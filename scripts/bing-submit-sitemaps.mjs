#!/usr/bin/env node
// aeiou.now — 把七站的 sitemap 提交給 Bing Webmaster Tools(2026-09-17)
//
// 前提:七個站已經在 Bing Webmaster Tools 裡驗證過。最省事的做法是站主登入 Bing Webmaster Tools
// 按「Import from Google Search Console」(Google 那邊七站都已驗證,會一次帶進來)。
// 沒驗證的站這支會印「不在帳號裡」然後跳過,不會出錯。
//
// 為什麼要做:Google 2026-09-02 起站級降權,Bing 是短期內唯一還能帶搜尋流量的引擎,而這個站
// 從來沒登記過 Bing(2026-09-17 實測:帳號 52 個站,aeiou 零個)。IndexNow 每次部署都有送,
// 但沒登記的站 Bing 不見得收。金鑰:/root/.config/seo-ops/bing-webmaster-api-key(跨站共用;本檔不印出)。
//
// 用法:node scripts/bing-submit-sitemaps.mjs            提交(已提交過的只印狀態)
//       node scripts/bing-submit-sitemaps.mjs --report   只看每站在 Bing 的狀態,不提交
import { readFileSync } from "node:fs";

const HOSTS = ["aeiou.now", "en.aeiou.now", "jp.aeiou.now", "cn.aeiou.now", "hi.aeiou.now", "id.aeiou.now", "br.aeiou.now"];
const KEY_FILE = "/root/.config/seo-ops/bing-webmaster-api-key";
const BASE = "https://ssl.bing.com/webmaster/api.svc/json";
const REPORT = process.argv.includes("--report");

const key = readFileSync(KEY_FILE, "utf8").trim();
const get = async (method, params = {}) => {
  const q = new URLSearchParams({ apikey: key, ...params });
  const res = await fetch(`${BASE}/${method}?${q}`, { signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  if (/^﻿?<\?xml/.test(text)) throw new Error(`${method}:端點不存在`);
  const body = JSON.parse(text);
  if (body.ErrorCode) throw new Error(`${method}:${body.Message || body.ErrorCode}`);
  return body.d;
};
const post = async (method, payload) => {
  const res = await fetch(`${BASE}/${method}?apikey=${encodeURIComponent(key)}`, {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`${method}:HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.text();
};

const sites = await get("GetUserSites");
const byHost = new Map(sites.map((s) => [new URL(s.Url).host, s]));
for (const host of HOSTS) {
  const site = byHost.get(host);
  const siteUrl = `https://${host}/`;
  if (!site) { console.log(`✗ ${host}:不在 Bing 帳號裡(先在 Bing Webmaster Tools 匯入或驗證)`); continue; }
  if (!site.IsVerified) { console.log(`⚠ ${host}:已加入但尚未驗證`); continue; }
  const feeds = await get("GetFeeds", { siteUrl });
  if (feeds.length) { console.log(`  ${host}:已有 ${feeds.length} 個 sitemap(${feeds[0].Status ?? "?"},最後抓 ${feeds[0].LastCrawled ?? "-"})`); continue; }
  if (REPORT) { console.log(`⚠ ${host}:已驗證但沒提交 sitemap(裸執行會提交)`); continue; }
  await post("SubmitFeed", { siteUrl, feedUrl: `${siteUrl}sitemap.xml` });
  console.log(`✓ ${host}:已提交 ${siteUrl}sitemap.xml`);
}
