#!/usr/bin/env node
// ===========================================================================
// aeiou.now — PageSpeed Insights 實測(2026-08-22 解鎖)
// ===========================================================================
//
// 用法(裸執行＝完整正確行為:量代表性的四頁 × 手機):
//   node scripts/psi-check.mjs
//   node scripts/psi-check.mjs --desktop            改量桌機
//   node scripts/psi-check.mjs --url <網址>          只量一頁
//   node scripts/psi-check.mjs --detail             連 LCP 元素與改善機會一起印
//
// -- 為什麼一直量不到,以及怎麼解開的(2026-08-22)---------------------------
// 先前記著「PSI 免金鑰配額當天用盡」,其實那個配額是 **Google 的共用匿名池**,
// 不是我們用掉的 —— 不帶 key 時所有人共用同一個 project_number,永遠是滿的。
// 而專案的 SA(`ga4-sa.json`)只有 GA4/GSC 的讀取 scope,拿它換 token 打 PSI 是
// 403 insufficient scopes。兩條路都不通,所以看起來像「外部卡點」。
//
// 真正的解法是第三條:**在自己的 GCP 專案開一把只給 PSI 用的 API key**。
// 本機的 gcloud 是用戶本人帳號(對 `aeiou-seo` 是 owner),所以做得到:
//   gcloud services enable pagespeedonline.googleapis.com --project=aeiou-seo
//   gcloud services api-keys create --project=aeiou-seo --display-name=aeiou-psi \
//     --api-target=service=pagespeedonline.googleapis.com
// key 放 `~/.config/aeiou/psi-api-key`(chmod 600,**絕不進 git**)。
//
// -- Lighthouse 會間歇性回 500 ---------------------------------------------
// 這不是我們的錯誤也不是配額,是它自己跑不出來。所以每頁最多重試三次;
// 三次都失敗就明說「量不到」,**不要印一個舊值或猜測值**。
//
// -- 判準(Google 的 Core Web Vitals 門檻)-----------------------------------
//   LCP  良好 ≤2.5s   需改善 ≤4.0s   差 >4.0s
//   CLS  良好 ≤0.1    需改善 ≤0.25   差 >0.25
//   TBT  良好 ≤200ms(實驗室指標,對應真實使用者的 INP)
// 分數本身不是目標 —— 要看的是**哪一個指標把分數拉下來**,那才指得出要改什麼。

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const KEY_FILE = process.env.AEIOU_PSI_KEY_FILE || join(homedir(), ".config", "aeiou", "psi-api-key");
const argv = process.argv.slice(2);
const STRATEGY = argv.includes("--desktop") ? "desktop" : "mobile";
const DETAIL = argv.includes("--detail");
const ONE = argv.includes("--url") ? argv[argv.indexOf("--url") + 1] : null;

/** 代表性的四頁:首頁、Topic 頁(封面是 LCP 元素)、清單頁、問答頁。
 *  不量七站 —— 七個站是同一份模板,差別只在文字長度,量一站看得到的問題就是全部的問題。 */
const PAGES = ONE ? [ONE] : [
  "https://aeiou.now/",
  "https://aeiou.now/topic/mid-autumn-and-moon-viewing/",
  "https://aeiou.now/topics/today/",
  "https://aeiou.now/questions/",
];

if (!existsSync(KEY_FILE)) {
  console.error(`✗ 找不到 ${KEY_FILE}`);
  console.error("  建一把(需要對 aeiou-seo 有 owner/editor 的 gcloud 登入):");
  console.error("    gcloud services enable pagespeedonline.googleapis.com --project=aeiou-seo");
  console.error("    gcloud services api-keys create --project=aeiou-seo --display-name=aeiou-psi \\");
  console.error("      --api-target=service=pagespeedonline.googleapis.com --format='value(response.keyString)'");
  process.exit(2);
}
const KEY = readFileSync(KEY_FILE, "utf8").trim();

const verdict = (metric, value) => {
  const T = { lcp: [2500, 4000], cls: [0.1, 0.25], tbt: [200, 600], fcp: [1800, 3000] };
  const t = T[metric];
  if (!t) return "";
  return value <= t[0] ? "良好" : value <= t[1] ? "需改善" : "✗ 差";
};

async function run(url) {
  const api = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"
    + `?url=${encodeURIComponent(url)}&strategy=${STRATEGY}&category=performance&key=${KEY}`;
  for (let i = 1; i <= 3; i += 1) {
    try {
      const res = await fetch(api, { signal: AbortSignal.timeout(180000) });
      const d = await res.json();
      if (d.error) {
        // 500 是 Lighthouse 自己跑不出來,重試有用;其餘(401/403/429)重試沒用,直接說。
        if (d.error.code !== 500) return { url, error: `${d.error.code} ${String(d.error.message).slice(0, 120)}` };
        if (i === 3) return { url, error: `500 Lighthouse 三次都跑不出來(不是配額,是它自己的問題)` };
        await new Promise((r) => setTimeout(r, 12000));
        continue;
      }
      const lh = d.lighthouseResult;
      const a = lh.audits;
      const num = (k) => a[k]?.numericValue ?? null;
      return {
        url,
        score: lh.categories.performance.score,
        lcp: num("largest-contentful-paint"),
        fcp: num("first-contentful-paint"),
        tbt: num("total-blocking-time"),
        cls: num("cumulative-layout-shift"),
        si: num("speed-index"),
        lcpEl: a["largest-contentful-paint-element"]?.details?.items?.[0]?.items?.[0]?.node?.snippet ?? null,
        // 只留真的省得下時間的建議(>100ms),其餘是雜訊。
        opps: Object.values(a)
          .filter((x) => x?.details?.type === "opportunity" && (x.numericValue ?? 0) > 100)
          .sort((x, y) => (y.numericValue ?? 0) - (x.numericValue ?? 0))
          .slice(0, 4)
          .map((x) => `${x.title} —— 可省 ${Math.round(x.numericValue)}ms`),
      };
    } catch (e) {
      if (i === 3) return { url, error: String(e.message || e).slice(0, 120) };
      await new Promise((r) => setTimeout(r, 12000));
    }
  }
  return { url, error: "unreachable" };
}

console.log(`PageSpeed Insights(${STRATEGY})　判準:LCP≤2.5s 良好 / ≤4s 需改善　CLS≤0.1 / TBT≤200ms\n`);
let worst = null;
for (const url of PAGES) {
  const r = await run(url);
  const path = url.replace("https://aeiou.now", "") || "/";
  if (r.error) {
    console.log(`${path.padEnd(42)} ✗ ${r.error}`);
    continue;
  }
  console.log(
    `${path.padEnd(42)} score ${r.score}`
    + `  LCP ${(r.lcp / 1000).toFixed(1)}s ${verdict("lcp", r.lcp)}`
    + `  FCP ${(r.fcp / 1000).toFixed(1)}s`
    + `  TBT ${Math.round(r.tbt)}ms ${verdict("tbt", r.tbt)}`
    + `  CLS ${r.cls.toFixed(2)} ${verdict("cls", r.cls)}`,
  );
  if (DETAIL) {
    if (r.lcpEl) console.log(`    LCP 元素: ${r.lcpEl.slice(0, 110)}`);
    for (const o of r.opps) console.log(`    · ${o}`);
  }
  if (!worst || r.lcp > worst.lcp) worst = { path, lcp: r.lcp };
}
if (worst) {
  console.log(`\n最慢的一頁:${worst.path}(LCP ${(worst.lcp / 1000).toFixed(1)}s)`);
  console.log("要看它慢在哪:node scripts/psi-check.mjs --detail --url <該頁網址>");
}
