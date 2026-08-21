#!/usr/bin/env node
// aeiou.now — 把 content/topics/*.md 裡缺的 `### date_rule <CC> <key>` 補齊(2026-08-21)。
//
//   node scripts/translate-date-rules.mjs              裸執行 = 補齊所有缺的
//   node scripts/translate-date-rules.mjs --dry-run    只印缺哪些,不呼叫 claude、不改檔
//   node scripts/translate-date-rules.mjs --slug diwali  只處理一個 Topic
//
// ── 為什麼要這一支 ─────────────────────────────────────────────────────────
// `## observance` 區塊裡的 `- date_rule:` 是「日期怎麼定」的說明,它會出現在
// **七個站**的畫面上,但它是單一字串、實測 100% 中文。於是 en/ja/hi/id/pt-BR
// 的讀者長期看到「5 月第一個完整星期，地方學區日期可能不同」。
// 七語系是七個獨立的站,讀者只看得到一種語言 —— 沒有本地語言版本的字串就不該渲染。
// 本支把那句話翻成其餘六語,寫回 md 的各 `## locale` 段;zh-TW 不寫
// (`- date_rule:` 本身就是中文原文,再抄一次只會製造兩份會漂移的同一句話)。
//
// 冪等:只補「缺的」。已經有 `### date_rule <CC> <key>` 的不動、不重譯。
// 因此加了新的 observance 或新語系之後重跑即可。
//
// claude 呼叫的兩條紀律沿用 translate-posts.mjs(理由見該檔檔頭,不要改):
//   ① 一律在 /tmp 的空目錄跑 —— 在 repo 跑會把各層 CLAUDE.md 讀進 context,
//      每次呼叫白花約 12,200 tokens,而且譯文行為會被手冊內容綁住。
//   ② 一律明寫 --model,不吃 CLI 預設 —— 預設會隨版本漂移到 opus 檔次,
//      而這是機械任務。本專案 pin claude-sonnet-5。
//
// 環境變數:AEIOU_CLAUDE_BIN / AEIOU_CLAUDE_MODEL / AEIOU_CLAUDE_TIMEOUT_MS /
//           AEIOU_CLAUDE_CWD / AEIOU_DATE_RULE_CHUNK(一次翻幾個 observance,預設 6)

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOPICS = join(ROOT, "content", "topics");

const CLAUDE_BIN = process.env.AEIOU_CLAUDE_BIN || "/root/.local/bin/claude";
const CLAUDE_MODEL = process.env.AEIOU_CLAUDE_MODEL || "claude-sonnet-5";
const CLAUDE_TIMEOUT_MS = Number(process.env.AEIOU_CLAUDE_TIMEOUT_MS || 600000);
const CLAUDE_CWD = process.env.AEIOU_CLAUDE_CWD || join(tmpdir(), "aeiou-translate-cwd");
const CHUNK = Number(process.env.AEIOU_DATE_RULE_CHUNK || 6);

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ONLY_SLUG = args.includes("--slug") ? args[args.indexOf("--slug") + 1] : null;

const SOURCE_LOCALE = "zh-TW";
const TARGETS = ["en", "ja", "zh-CN", "hi", "id", "pt-BR"];
const LOCALE_NAMES = {
  en: "English",
  ja: "日本語",
  "zh-CN": "简体中文(中国大陆)",
  hi: "हिन्दी (Hindi)",
  id: "Bahasa Indonesia",
  "pt-BR": "Português (Brasil)",
};

const log = (msg) => console.log(`[date-rules] ${msg}`);

// ── md 解析:只抓這一支需要的兩件事 ────────────────────────────────────────
// ① `## observance <CC> <key>` 底下的 `- date_rule:`
// ② 每個 `## locale <code>` 段裡已經有哪些 `### date_rule <CC> <key>`
function parse(text) {
  const lines = text.split("\n");
  const observances = new Map();       // "CC:key" -> zh-TW 原文
  const haveByLocale = new Map();      // locale -> Set("CC:key")
  let inObservance = null;
  let inLocale = null;
  for (const line of lines) {
    let m;
    if ((m = line.match(/^## observance\s+([A-Za-z]{2})\s+([a-z0-9-]+)\s*$/))) {
      inObservance = `${m[1].toUpperCase()}:${m[2]}`;
      inLocale = null;
      continue;
    }
    if ((m = line.match(/^## locale\s+(\S+)\s*$/))) {
      inLocale = m[1];
      haveByLocale.set(inLocale, haveByLocale.get(inLocale) || new Set());
      inObservance = null;
      continue;
    }
    if (line.startsWith("## ")) { inObservance = null; inLocale = null; continue; }
    if (inObservance && (m = line.match(/^-\s*date_rule:\s*(.+?)\s*$/))) {
      observances.set(inObservance, m[1]);
      continue;
    }
    if (inLocale && (m = line.match(/^### date_rule\s+([A-Za-z]{2})\s+([a-z0-9-]+)\s*$/))) {
      haveByLocale.get(inLocale).add(`${m[1].toUpperCase()}:${m[2]}`);
    }
  }
  return { observances, haveByLocale };
}

// 把 `### date_rule CC key` + 譯文插在同一個 locale 段裡**該 observance 的 `### customs` 之後**,
// 讓同一個 observance 的兩段文字排在一起(檔案是人在讀的)。找不到就補在該 locale 段的最後。
function insert(text, locale, key, value) {
  const [cc, obsKey] = key.split(":");
  const lines = text.split("\n");
  const localeStart = lines.findIndex((l) => l.trim() === `## locale ${locale}`);
  if (localeStart < 0) throw new Error(`找不到 ## locale ${locale}`);
  let localeEnd = lines.length;
  for (let i = localeStart + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith("## ")) { localeEnd = i; break; }
  }
  const customsHead = `### customs ${cc} ${obsKey}`;
  let at = -1;
  for (let i = localeStart + 1; i < localeEnd; i += 1) {
    if (lines[i].trim() === customsHead) {
      at = i + 1;
      while (at < localeEnd && !lines[at].startsWith("### ")) at += 1;   // 跳過 customs 的內文
      break;
    }
  }
  if (at < 0) {
    at = localeEnd;
    while (at > localeStart + 1 && lines[at - 1].trim() === "") at -= 1; // 別插在段落間的空行後面
  }
  lines.splice(at, 0, `### date_rule ${cc} ${obsKey}`, value);
  return lines.join("\n");
}

// ── claude ────────────────────────────────────────────────────────────────
function runClaude(prompt) {
  mkdirSync(CLAUDE_CWD, { recursive: true });
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL], {
    input: prompt,
    encoding: "utf8",
    timeout: CLAUDE_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
    cwd: CLAUDE_CWD,   // 見檔頭:不要改成 repo 目錄
    env: { ...process.env, HOME: process.env.HOME || "/root" },
  });
  if (r.error) throw new Error(`claude spawn failed: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(`claude exited ${r.status}: stderr=${String(r.stderr || "").slice(0, 200)} `
      + `stdout=${String(r.stdout || "").slice(0, 300)}`);
  }
  return r.stdout;
}

function extractJson(raw) {
  let s = String(raw).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("claude 輸出裡沒有 JSON 物件");
  return JSON.parse(s.slice(start, end + 1));
}

function buildPrompt(items) {
  return `你是節慶與公共假日資料的專業翻譯者。以下每一則是某個國家某個節慶的
「日期怎麼決定」說明,原文是${SOURCE_LOCALE}(繁體中文)。把每一則翻成它指定的每一個目標語言。

這些句子的用途:顯示在一張跨國比較表的「日期怎麼定」欄位,讀者用它判斷這個節日的日期
是固定的、依曆法推算的、還是每年由政府公告的。

翻譯規則(逐條遵守):
- 逐句忠實翻譯,不改寫、不摘要、不增補、不刪減、不加註解或前言。
- **保留原文的資訊密度**:法規名稱、機關名稱、曆法名稱、月份名稱、數字一個都不能掉。
- 曆法與宗教節期名稱用目標語言的慣用寫法(例:伊斯蘭曆 Shawwal 月 → 英文 the month of Shawwal
  in the Islamic calendar;日文 イスラム暦シャウワール月),沒有慣用寫法就保留原文拼寫。
- 機關名稱用目標語言的通行譯名;沒有通行譯名就用原文並在必要時補一個最短的說明詞。
- 標點用目標語言自己的標點(英文/印尼文/葡萄牙文/印地文用半形,日文與简体中文用全形)。
- 目標語言就是輸出語言,不要夾雜其他語言的說明。
- 長度與原文相當,不要為了「講清楚」而膨脹成兩三句。

輸出規則(違反即整批作廢):
- **只輸出一個 JSON 物件**,不要 markdown code fence,不要任何 JSON 以外的字元。
- 格式:{"translations":[{"id":"<原樣抄回輸入的 id>","locale":"<目標語言代碼>","text":"<譯文>"}]}
- 必須為每一個 id 的**每一個目標語言**各輸出一筆,一筆都不能少、不能多。

輸入(JSON):
${JSON.stringify(items, null, 1)}
`;
}

function translateChunk(entries) {
  const items = entries.map((e, i) => ({
    id: `r${i + 1}`,
    targets: TARGETS.map((l) => `${l} = ${LOCALE_NAMES[l]}`),
    target_codes: TARGETS,
    country: e.key.split(":")[0],
    text: e.source,
  }));
  const data = extractJson(runClaude(buildPrompt(items)));
  const out = new Map();  // id -> Map(locale -> text)
  for (const row of data.translations || []) {
    if (!out.has(row.id)) out.set(row.id, new Map());
    if (typeof row.text === "string" && row.text.trim()) out.get(row.id).set(row.locale, row.text.trim());
  }
  const result = [];
  for (const [i, entry] of entries.entries()) {
    const got = out.get(`r${i + 1}`) || new Map();
    const missing = TARGETS.filter((l) => !got.has(l));
    if (missing.length) throw new Error(`${entry.slug} ${entry.key} 缺譯文:${missing.join(" ")}`);
    result.push({ ...entry, translations: got });
  }
  return result;
}

// ── 主流程 ────────────────────────────────────────────────────────────────
const files = readdirSync(TOPICS)
  .filter((f) => f.endsWith(".md"))
  .filter((f) => !ONLY_SLUG || f === `${ONLY_SLUG}.md`)
  .sort();
if (files.length === 0) { console.error(`✗ 找不到 md${ONLY_SLUG ? `(--slug ${ONLY_SLUG})` : ""}`); process.exit(1); }

const work = [];   // {slug, file, key, source}
for (const f of files) {
  const path = join(TOPICS, f);
  const { observances, haveByLocale } = parse(readFileSync(path, "utf8"));
  for (const [key, source] of observances) {
    const missing = TARGETS.filter((l) => !(haveByLocale.get(l) || new Set()).has(key));
    if (missing.length) work.push({ slug: f.replace(/\.md$/, ""), file: path, key, source, missing });
  }
}

if (work.length === 0) { log("六語都齊了,沒有要補的"); process.exit(0); }
log(`要補 ${work.length} 個 observance × ${TARGETS.length} 語 = ${work.length * TARGETS.length} 段`);
if (DRY_RUN) {
  for (const w of work) log(`DRY_RUN ${w.slug} ${w.key} 缺 ${w.missing.join(" ")}:${w.source.slice(0, 44)}…`);
  process.exit(0);
}

let filled = 0;
for (let i = 0; i < work.length; i += CHUNK) {
  const batch = work.slice(i, i + CHUNK);
  log(`批次 ${Math.floor(i / CHUNK) + 1}/${Math.ceil(work.length / CHUNK)}:${batch.length} 個 observance`);
  const done = translateChunk(batch);
  // 一批翻完就落檔:中途失敗時已完成的部分不會白做(重跑只補剩下的)
  for (const entry of done) {
    let text = readFileSync(entry.file, "utf8");
    for (const locale of entry.missing) {
      text = insert(text, locale, entry.key, entry.translations.get(locale));
      filled += 1;
    }
    writeFileSync(entry.file, text, "utf8");
  }
}
log(`補上 ${filled} 段。接著跑:node scripts/import-topics.mjs && node scripts/export-data.mjs`);
