#!/usr/bin/env node
// 收錄白名單產生器(2026-10-14 用戶拍板「縮小可收錄範圍」時一起建)。
//
// 做什麼:向 GSC 拉近 N 天(預設 90)「page」維度,**有過任何曝光或點擊**的網址
// 全部寫進 `site/src/lib/index-keep.generated.mjs`。`site/src/lib/indexability.mjs`
// 讀它:名單上的逐國頁一律保留可收錄,不管薄頁判準怎麼說。
//
// 為什麼要有白名單:薄頁判準是「這一頁看起來夠不夠撐」,白名單是「Google 已經拿它
// 回答過真實查詢」。後者是實測,前者是推估;兩者衝突時信實測。
//
// 為什麼產成 .mjs 而不是 .json:Astro(Vite)與 node --test 都能直接 import 一個 ES 模組,
// JSON 檔要嘛走 import attributes(兩邊支援度不一),要嘛靠 process.cwd() 拼路徑
// (build 在 site/、測試在 repo 根,cwd 不同)。
//
// 不進排程:名單只增不減才安全(縮掉一頁=把它丟進 noindex),所以刻意手動跑、看 diff、
// 再 commit。重跑會**合併**舊名單,不會把以前有曝光、近期沒有的頁踢出去;
// 要真的移除得手動刪那一行。
//
// 用法:node scripts/gsc-index-keep.mjs [--days 90] [--dry-run]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ROOT } from "./lib/aeiou-lib.mjs";

const SA = process.env.AEIOU_GSC_SA || join(homedir(), ".config", "aeiou", "ga4-sa.json");
const GSC_SITE = "sc-domain:aeiou.now";
const GOOGLE_LIB = "/mnt/customers/seo-ops/lib/google.mjs";
const OUT = join(ROOT, "site", "src", "lib", "index-keep.generated.mjs");

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const days = Number(argv[argv.indexOf("--days") + 1]) || 90;

const iso = (d) => d.toISOString().slice(0, 10);
const end = new Date(Date.now() - 2 * 864e5); // GSC 固定落後 2–3 天
const start = new Date(end.getTime() - (days - 1) * 864e5);

/** 只留 path 層級的身分:去掉 query/fragment。host 保留(七站各自一份)。 */
export function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return null;
  }
}

function previousUrls() {
  if (!existsSync(OUT)) return [];
  const text = readFileSync(OUT, "utf8");
  return [...text.matchAll(/^\s+"(https:\/\/[^"]+)",$/gm)].map((m) => m[1]);
}

async function main() {
  if (!existsSync(GOOGLE_LIB)) throw new Error(`缺 ${GOOGLE_LIB}`);
  const { gscQuery } = await import(GOOGLE_LIB);
  const fresh = new Set();
  for (let startRow = 0; ; startRow += 25000) {
    const res = await gscQuery(SA, GSC_SITE, {
      startDate: iso(start), endDate: iso(end), dimensions: ["page"],
      rowLimit: 25000, startRow, dataState: "all",
    });
    const rows = res.rows || [];
    for (const row of rows) {
      if ((row.impressions || 0) + (row.clicks || 0) <= 0) continue;
      const url = normalizeUrl(row.keys[0]);
      if (url) fresh.add(url);
    }
    if (rows.length < 25000) break;
  }
  const before = previousUrls();
  const merged = [...new Set([...before, ...fresh])].sort();
  const added = merged.length - before.length;
  console.log(`[gsc-index-keep] ${iso(start)}..${iso(end)}:GSC 有曝光 ${fresh.size} 個網址;名單 ${before.length} → ${merged.length}(新增 ${added})`);
  if (DRY_RUN) return;
  const body = [
    "// 由 scripts/gsc-index-keep.mjs 產生,勿手改(要移除某頁才手刪該行;理由見產生器檔頭)。",
    "// 內容:GSC 有過曝光或點擊的網址。site/src/lib/indexability.mjs 讀它,名單上的逐國頁一律保留可收錄。",
    `export const INDEX_KEEP_RANGE = ${JSON.stringify({ start: iso(start), end: iso(end), days })};`,
    "export const INDEX_KEEP_URLS = [",
    ...merged.map((u) => `  ${JSON.stringify(u)},`),
    "];",
    "",
  ].join("\n");
  writeFileSync(OUT, body);
}

main().catch((error) => {
  console.error(`[gsc-index-keep] ${error.message}`);
  process.exit(1);
});
