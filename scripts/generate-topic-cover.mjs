#!/usr/bin/env node
// ===========================================================================
// aeiou.now — 產生 Topic 封面圖(2026-08-20 新增)
// ===========================================================================
//
// 用法:
//   node scripts/generate-topic-cover.mjs --slug womens-day --prompt "……場景描述……"
//   node scripts/generate-topic-cover.mjs --slug womens-day --prompt-file /tmp/p.txt
//   node scripts/generate-topic-cover.mjs --slug womens-day --prompt "…" --force   覆蓋既有圖
//
// 為什麼需要這支:新增一個 Topic 要四樣東西(見 docs/03-topic-content.md),其中
// 封面圖是唯一沒有自動化的一項。而缺圖不是「這個 Topic 不上線」——
// `check-topic-calendar.mjs` 是 `hourly-export.sh` 的第 4 步且 fail-closed,
// 缺一張圖會讓**整條每小時匯出停擺**,線上所有資料跟著停更。
//
// 出圖用 `codex exec` 的內建 image_gen 工具(OpenAI 訂閱 CLI,/root/.local/bin/codex),
// **不是 Anthropic API,也不借用其他站的 OPENAI_API_KEY**——2026-08-20 查過:
// /root/folk.tw-api 有一把可出圖的 key,但那是 folk.tw 的帳,跨站借用屬紅線
// (見 /root/CLAUDE.md「共用服務帳號的爆炸半徑」)。aeiou 走 codex 自己的訂閱。
//
// codex 子行程一律在 /tmp 的空目錄跑,理由同 translate-posts.mjs:
// 在 repo 目錄跑會把 AGENTS.md / CLAUDE.md 讀進 context,既浪費也會讓產出被手冊內容綁住。
// 需要寫檔,所以帶 -s workspace-write(唯讀沙箱會讓 image_gen 無法落檔)。
//
// 環境變數:
//   AEIOU_CODEX_BIN         codex CLI 路徑(預設 /root/.local/bin/codex)
//   AEIOU_CODEX_TIMEOUT_MS  單次出圖逾時(預設 600000)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, copyFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const COVER_DIR = join(ROOT, "site", "public", "covers");
const CODEX_BIN = process.env.AEIOU_CODEX_BIN || "/root/.local/bin/codex";
const TIMEOUT_MS = Number(process.env.AEIOU_CODEX_TIMEOUT_MS || 600000);
const WIDTH = 1200;
const HEIGHT = 675; // check-topic-calendar.mjs 寫死驗這個尺寸,不要改

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
};
const slug = arg("slug");
const force = argv.includes("--force");
const promptFile = arg("prompt-file");
const promptArg = arg("prompt");

if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
  console.error("usage: generate-topic-cover.mjs --slug <a-z0-9-> --prompt \"…\" [--force]");
  process.exit(2);
}
const scene = promptFile ? readFileSync(promptFile, "utf8").trim() : (promptArg || "").trim();
if (!scene) {
  console.error("✗ 缺 --prompt 或 --prompt-file;場景描述是人寫的,本支不代寫。");
  process.exit(2);
}

const target = join(COVER_DIR, `${slug}.png`);
if (existsSync(target) && !force) {
  console.error(`✗ ${target} 已存在。要覆蓋請帶 --force(封面換掉會改變線上版面,不預設覆蓋)。`);
  process.exit(2);
}
if (!existsSync(CODEX_BIN)) { console.error(`✗ 找不到 codex CLI:${CODEX_BIN}`); process.exit(1); }

// 風格約束是整站一致的部分,寫在這裡;場景由呼叫端給。
// 「不要有任何文字」很重要:AI 生成的文字(尤其非拉丁字母)一律是亂碼,
// 印在封面上比沒有更糟;而宗教類主題的亂碼經文會直接冒犯讀者。
const STYLE = [
  "溫暖、低彩度的編輯式插畫風格,接近水彩與厚塗之間,不要塑膠感的 3D 算圖。",
  "構圖留白充足,主體不要滿版;光線柔和,像清晨或黃昏的自然光。",
  "**畫面裡不可以出現任何文字、字母、數字或看起來像文字的筆畫**——",
  "生成的文字必然是亂碼,印在封面上比留白更糟。",
  "不要浮水印、不要邊框、不要拼貼分割畫面。",
].join("");

const prompt = `用你的 image_gen 工具產生一張圖,並存成當前目錄下的 cover.png。

尺寸:${WIDTH}x${HEIGHT} 像素(16:9)。若工具產出的尺寸不同,用 ffmpeg 或其他工具縮放/裁切到剛好 ${WIDTH}x${HEIGHT}。

場景:
${scene}

風格:
${STYLE}

完成後確認 cover.png 存在且為 ${WIDTH}x${HEIGHT} 的 PNG,然後只回覆 DONE。`;

const workdir = mkdtempSync(join(tmpdir(), "aeiou-cover-"));
console.log(`[cover] slug=${slug} workdir=${workdir}`);
console.log(`[cover] 呼叫 codex(逾時 ${Math.round(TIMEOUT_MS / 1000)}s)……`);

const r = spawnSync(CODEX_BIN, ["exec", "--skip-git-repo-check", "-s", "workspace-write", prompt], {
  cwd: workdir,           // 空目錄:不讓 codex 撿到 repo 的 AGENTS.md / CLAUDE.md
  encoding: "utf8",
  timeout: TIMEOUT_MS,
  maxBuffer: 64 * 1024 * 1024,
  env: { ...process.env, HOME: process.env.HOME || "/root" },
});
if (r.error) { console.error(`✗ codex spawn 失敗:${r.error.message}`); process.exit(1); }

const produced = join(workdir, "cover.png");
if (!existsSync(produced)) {
  // codex 的錯誤常印在 stdout 而不是 stderr,兩邊都要留(同 translate-posts.mjs 的教訓)
  console.error(`✗ codex 沒有產出 cover.png(exit ${r.status})`);
  console.error(`stdout 尾段:${String(r.stdout || "").slice(-800)}`);
  console.error(`stderr 尾段:${String(r.stderr || "").slice(-400)}`);
  process.exit(1);
}

// 直接讀 PNG 檔頭驗尺寸,不依賴 codex 的自我回報(它說 DONE 不代表尺寸真的對)。
const bytes = readFileSync(produced);
const isPng = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
const w = isPng ? bytes.readUInt32BE(16) : null;
const h = isPng ? bytes.readUInt32BE(20) : null;
if (!isPng || w !== WIDTH || h !== HEIGHT) {
  console.error(`✗ 產出不合規:isPng=${isPng} 尺寸=${w}x${h},需要 ${WIDTH}x${HEIGHT} PNG`);
  console.error(`  檔案留在 ${produced},可自行檢查`);
  process.exit(1);
}

mkdirSync(COVER_DIR, { recursive: true });

// ── 壓縮(2026-08-21 新增) ──────────────────────────────────────────────────
// codex 的輸出是未壓縮的 RGB PNG,約 1.7–2.0 MB;而封面在 Topic 頁是
// `loading="eager" fetchpriority="high"` 的大圖 —— 它就是那一頁的 LCP 圖。
// 2026-08-21 盤點:33 張封面裡有 3 張是 1.7–1.8 MB(exam-season、
// islamic-calendar-days、womens-day),其餘 270–460 KB —— 差 5 倍,因為那 30 幾張
// 是某個時點手工壓過的,而出圖管線沒有這一步。「裸執行就必須是正確且完整的行為」:
// 產出來就該跟兄弟一致,不該靠有人記得補一刀。
// 實測 womens-day:1712 KB → 422 KB(縮 76%),顯示尺寸下看不出差別。
// pngquant 不在就跳過(只是檔案大,不是錯誤),但會印出來讓人知道。
const compressed = join(workdir, "cover-min.png");
const q = spawnSync("pngquant", ["--quality", "65-90", "--speed", "1", "--force",
  "--output", compressed, produced], { encoding: "utf8" });
let source = produced;
if (q.status === 0 && existsSync(compressed)) {
  const before = statSync(produced).size;
  const after = statSync(compressed).size;
  // 壓不小就用原檔(pngquant 對某些圖會變大)
  if (after < before) {
    source = compressed;
    console.log(`[cover] pngquant ${Math.round(before / 1024)} KB → ${Math.round(after / 1024)} KB`);
  }
} else {
  console.log(`[cover] ⚠ 未壓縮(pngquant 不可用或失敗:${(q.stderr || q.error?.message || "").toString().slice(0, 80)})`);
}

copyFileSync(source, target);
console.log(`✓ ${target}(${w}x${h}, ${Math.round(statSync(target).size / 1024)} KB)`);
console.log("  下一步:把 content/topics-pending/<slug>.md 搬進 content/topics/,");
console.log("  併回 occurrences,並把 slug 加進 check-final-topic-taxonomy.mjs 的 FINAL_SLUGS。");
