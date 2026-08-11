// 設計規範守門 v2（團隊共用；v1 源自 dreamer868，v2 加 css 白名單＋掃 .svelte）：
// 掃 src/ 下所有 .css/.astro/.svelte，違規即 exit 1（pnpm build 前自動跑）。
// 規則（見 src/styles/variables.css 檔頭）：
// 1. font-size 禁用 px（一律 var(--text-*) 階梯）
// 2. 顏色（hex / rgb() / hsl()）只准出現在 src/styles/variables.css
// 3. 禁 !important
// 4. 禁外部 CDN（fonts.googleapis / cdnjs / unpkg / jsdelivr）
// 5. 統一 css 檔案：src/ 下的 .css 只准 src/styles/ 白名單那幾檔，新增即 fail
//    （元件樣式寫 Astro/Svelte scoped <style> 或進 global.css）
// 6. --text-* 階梯下限：token 值一律 ≥18px（1.125rem）；clamp() 以最小值計
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative, basename } from "node:path";

const ROOT = "src";
const TOKEN_FILE = join("src", "styles", "variables.css");
// 舊站遷移期可暫加既有檔（凍結用，禁再擴充）；新站一律只有這兩檔。
const STYLE_WHITELIST = new Set(["variables.css", "global.css"]);
const exts = new Set([".css", ".astro", ".svelte"]);
const violations = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (exts.has(extname(p))) scan(p);
  }
}

function scan(file) {
  const rel = relative(".", file);
  if (extname(file) === ".css") {
    const inStyles = rel.startsWith(join("src", "styles") + "/");
    if (!inStyles || !STYLE_WHITELIST.has(basename(file)))
      violations.push(
        `${rel} css 檔不在白名單（統一 css：src/styles/{${[...STYLE_WHITELIST].join(",")}}；元件樣式用 scoped <style>）`
      );
  }
  const isTokenFile = rel === TOKEN_FILE;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const loc = `${rel}:${i + 1}`;
    if (/font-size\s*:\s*[0-9.]+px/i.test(line))
      violations.push(`${loc} px 字級（改用 var(--text-*)）: ${line.trim()}`);
    if (!isTokenFile && /(#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\()/.test(line) && !/url\(/.test(line))
      violations.push(`${loc} token 外硬編顏色（改用 var(--color-*)）: ${line.trim()}`);
    if (/!important/.test(line))
      violations.push(`${loc} 禁用 !important: ${line.trim()}`);
    if (/(fonts\.googleapis|fonts\.gstatic|cdnjs\.cloudflare|unpkg\.com|cdn\.jsdelivr)/.test(line))
      violations.push(`${loc} 外部 CDN（字型/資源一律自託管或系統堆疊）: ${line.trim()}`);
  });
}

function checkLadder() {
  let css;
  try { css = readFileSync(TOKEN_FILE, "utf8"); }
  catch { violations.push(`${TOKEN_FILE} 不存在（token 檔必備）`); return; }
  const re = /--text-[\w-]+\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(css))) {
    const raw = m[1].trim();
    const first = raw.startsWith("clamp(") ? raw.slice(6).split(",")[0].trim() : raw;
    const num = parseFloat(first);
    const px = /px\s*$/.test(first) ? num : /rem\s*$/.test(first) ? num * 16 : NaN;
    if (!Number.isNaN(px) && px < 18)
      violations.push(`${TOKEN_FILE} 字級階梯低於 18px：${m[0].split(":")[0].trim()} = ${raw}（最小 1.125rem）`);
  }
}

walk(ROOT);
checkLadder();
if (violations.length) {
  console.error(`設計規範違規 ${violations.length} 處：\n` + violations.join("\n"));
  process.exit(1);
}
console.log("設計規範檢查通過：css 白名單、無 px 字級、階梯 ≥18px、無 token 外顏色、無 !important、無外部 CDN。");
