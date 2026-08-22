#!/usr/bin/env node
// ===========================================================================
// aeiou.now — 封面的響應式衍生檔(2026-08-22)
// ===========================================================================
//
// 用法(裸執行＝完整正確行為:掃 covers/*.png,缺的補齊,舊的不動):
//   node scripts/generate-cover-variants.mjs
//   node scripts/generate-cover-variants.mjs --force   全部重產
//   node scripts/generate-cover-variants.mjs --report  印哪些缺、各版本多大
//
// -- 為什麼要有這一支 ------------------------------------------------------
// Topic 頁的 LCP 元素就是封面(`loading="eager" fetchpriority="high"`),而封面**只有
// 一種尺寸一種格式**:1200×675 PNG。手機拿到的是一張遠大於它需要的 PNG,
// 於是 LCP 被它決定。2026-08-21 壓過一輪 PNG 體積,但壓縮解決不了「格式不對、尺寸不對」。
//
// 列表頁早就有 480×270 的 WebP(`covers/thumbs/`),但**沒有任何腳本在產它** ——
// 它是某次人工做的,所以新加的 Topic 一律沒有。這一支把兩件事一起解決:
// 補齊 thumbs,並新增 hero 用的兩個寬度。
//
// -- 產哪幾個 --------------------------------------------------------------
//   covers/<slug>.png        1200×675  原圖。**保留不動** —— og:image 與
//                                      check-topic-calendar 的驗收都指向它,而且
//                                      社群平台的爬蟲對 WebP 的支援仍然不一致。
//   covers/w800/<slug>.webp   800×450  手機 hero(Lighthouse 的 Moto G Power 是
//                                      412 CSS px × DPR 1.75 ≈ 721 實體 px)
//   covers/w1200/<slug>.webp 1200×675  桌機 hero
//   covers/thumbs/<slug>.webp 480×270  列表列
//
// -- 品質 ------------------------------------------------------------------
// WebP q=80。這些是插畫風格的平滑漸層,q=80 在這種圖上看不出差別,而 q=90 只換來
// 檔案大一倍。**逐張看過**再定的,不是抄來的預設值。
//
// ⚠ 這一支要能被 generate-topic-cover.mjs 呼叫 —— 新 Topic 出圖之後衍生檔要跟著出,
//   不能靠有人記得補一刀(同「壓縮進管線」那條:裸執行就必須是完整正確的行為)。

import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { ROOT } from "./lib/aeiou-lib.mjs";

const COVERS = join(ROOT, "site", "public", "covers");
const argv = process.argv.slice(2);
const FORCE = argv.includes("--force");
const REPORT = argv.includes("--report");

/** 目錄 → [寬, 高]。thumbs 沿用既有路徑(前端 coverThumbPath 指著它)。 */
const VARIANTS = [
  ["w800", 800, 450],
  ["w1200", 1200, 675],
  ["thumbs", 480, 270],
];
const QUALITY = 80;

const slugs = existsSync(COVERS)
  ? readdirSync(COVERS).filter((f) => f.endsWith(".png")).map((f) => f.slice(0, -4)).sort()
  : [];

if (REPORT) {
  const kb = (p) => (existsSync(p) ? `${(statSync(p).size / 1024).toFixed(0)}K` : "—");
  console.log("slug".padEnd(34) + "png".padStart(7) + VARIANTS.map(([d]) => d.padStart(8)).join(""));
  console.log("-".repeat(34 + 7 + 8 * VARIANTS.length));
  let missing = 0;
  for (const s of slugs) {
    const cells = VARIANTS.map(([d]) => {
      const p = join(COVERS, d, `${s}.webp`);
      if (!existsSync(p)) missing += 1;
      return kb(p).padStart(8);
    });
    console.log(s.padEnd(34) + kb(join(COVERS, `${s}.png`)).padStart(7) + cells.join(""));
  }
  console.log(`\n封面 ${slugs.length} 張;缺少的衍生檔 ${missing} 個`);
  console.log("補齊:node scripts/generate-cover-variants.mjs");
  process.exit(0);
}

if (slugs.length === 0) {
  console.error(`✗ ${COVERS} 底下沒有 PNG`);
  process.exit(2);
}

// PIL 走 python3。**不引入新的 node 相依** —— 這個 repo 的 site/ 沒有 sharp,
// 為了產圖裝一個原生模組會讓 CI 的安裝時間與失敗面都變大,而主機本來就有 PIL。
const PY = `
import sys, os
from PIL import Image
src, out, w, h, q = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
im = Image.open(src).convert("RGB")
im = im.resize((w, h), Image.LANCZOS)
os.makedirs(os.path.dirname(out), exist_ok=True)
im.save(out, "WEBP", quality=q, method=6)
print(os.path.getsize(out))
`;

let made = 0;
let skipped = 0;
let bytesBefore = 0;
let bytesAfter = 0;

for (const slug of slugs) {
  const png = join(COVERS, `${slug}.png`);
  for (const [dir, w, h] of VARIANTS) {
    const out = join(COVERS, dir, `${slug}.webp`);
    if (!FORCE && existsSync(out)) { skipped += 1; continue; }
    mkdirSync(join(COVERS, dir), { recursive: true });
    const r = spawnSync("python3", ["-c", PY, png, out, String(w), String(h), String(QUALITY)],
      { encoding: "utf8" });
    if (r.status !== 0) {
      // 產不出來就明說是哪一張、哪一個尺寸 —— 不要靜靜跳過,那會讓前端退回大 PNG
      // 而且沒有人知道。
      console.error(`✗ ${slug} → ${dir}: ${(r.stderr || "").trim().split("\n").pop()}`);
      process.exitCode = 1;
      continue;
    }
    made += 1;
    if (dir === "w800") {
      bytesBefore += statSync(png).size;
      bytesAfter += Number(r.stdout.trim()) || 0;
    }
  }
}

console.log(`封面 ${slugs.length} 張:新產 ${made} 個衍生檔、沿用 ${skipped} 個`);
if (bytesAfter > 0) {
  console.log(`手機 hero(w800/webp)相對原 PNG:`
    + `${(bytesBefore / 1024).toFixed(0)}K → ${(bytesAfter / 1024).toFixed(0)}K`
    + `(${(100 - (bytesAfter / bytesBefore) * 100).toFixed(0)}% 少)`);
}
console.log("看逐張明細:node scripts/generate-cover-variants.mjs --report");
