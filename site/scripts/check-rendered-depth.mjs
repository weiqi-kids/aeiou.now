#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// gate：渲染後的頁面撐得起排名嗎。跑在 astro build 之後，掃 dist/ 的真實 HTML。
// ═══════════════════════════════════════════════════════════════════════════
//
// 為什麼資料層的 check-content-depth.mjs 不夠：讀者與 Googlebot 看到的是**渲染結果**。
// 2026-08-19 診斷時，資料層看起來「每個 Topic 都有 summary 和國別敘述」，但渲染後
// 同一段 lede 在一頁裡印了兩次（header 一次、「快速回答」再一次）、國別敘述也印兩次
// （「各地有什麼不同？」一次、「🌎 全世界怎麼過」再一次）——字元數看起來夠，
// 唯一內容只有三分之一。那種落差只有掃 dist 才看得到。
//
// 四條規則：
//   D1 可索引頁面的 title / meta description 不得跨頁重複（alias 與 noindex 頁豁免）
//   D2 可索引頁面的渲染後唯一內容字元下限
//   D3 同一頁裡同一個「長段落」不得出現三次以上
//   D4 一頁上的空狀態區塊數上限（「目前沒有資料」「暫時關閉」）
//   D5 非 CJK 語系站的 title / meta description 不得出現 CJK 標點
//
// ⚠️ D3 的門檻刻意訂在 3 次而不是 2 次：把重複段落從 2 次降到 1 次要動版面，
//    而版面的權威來源是產品草案、範圍屬用戶（CLAUDE.md 紅線）。這支的職責是
//    **不讓它惡化**並把現況列進 --report，不是自己去改版。
//
// 用法（cwd 一律 site/，與 check-design.mjs 同）：
//   node scripts/check-rendered-depth.mjs            閘門；違規 exit 1
//   node scripts/check-rendered-depth.mjs --report   逐頁明細，exit 0
//
// ⚠️ 失敗一律 process.exit(1)（process.exitCode 會被後續程式覆寫）。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';
const REPORT = process.argv.includes('--report');

// 渲染後的唯一內容下限。對照基準：2026-08-19 實測 folk.tw 主力內容頁去重後
// 1,600–2,930 字元；本站當時最薄的可索引頁 359。門檻訂在「不再更薄」的水位，
// 目標值（1,200）由資料層的 check-content-depth.mjs --report 追蹤。
const MIN_UNIQUE_CHARS = 320;
// 工具頁不是拿來排名的（關於頁、問答清單頁），套較低下限。
// ⚠️ 這份清單只放「本來就不該用內容量衡量」的頁面，不准拿來塞真正該補厚的頁。
// 關於頁目前 225 字元——它薄是事實，但**關於頁的文案是產品文案，屬用戶的東西**
// （CLAUDE.md 2026-08-11 事故：代寫品牌定位語句並當既定前提交辦）。
// 這裡只保證它不再更薄；要寫厚必須拿用戶的文字。
const UTILITY_PAGES = new Set(['about/index.html']);
const UTILITY_MIN_UNIQUE_CHARS = 200;
// 1 = 同一段長文字在一頁只准出現一次。
// 2026-08-20 用戶核准動版面後收緊(原本是 2,只擋「印三次以上」):
// Topic 頁的「快速回答」原本把頁首 lede 與各國 customs 整段再印一次,
// 每頁約三分之一的可見文字是重複的。重複的卡片已移除,這裡把門檻鎖到 1,
// 讓它不能再長回來。
const MAX_LONG_PARAGRAPH_REPEATS = 1;   // 超過就是 ERROR
const LONG_PARAGRAPH_CHARS = 40;
const MAX_EMPTY_BLOCKS = 3;
// 「空狀態／載入中／已關閉」的字串**從 i18n 檔產生**，不手寫。
// 2026-08-20 踩過：手寫成 'currently closed'，而 en 的實際字串是
// 'The discussion room is temporarily closed' → 四個語系的 build 假紅燈，
// 而 zh-TW 因為字串短於門檻剛好沒事，看起來像「只有英文站壞掉」。
// 產生器：../scripts/gen-empty-state-strings.mjs（改 i18n 後重跑）。
// 放在 site/scripts/ 而不是 site/src/data/ —— 後者每次 build 會被 copy-data.mjs 清空重建。。
const EMPTY_MARKERS = JSON.parse(
  readFileSync(join('scripts', 'empty-state-strings.json'), 'utf8'),
);

const errors = [];
const fail = (rule, msg) => errors.push(`[${rule}] ${msg}`);

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/**
 * 移除帶 `hidden` 屬性的元素（含其內容），以及 <noscript> 區塊。
 *
 * 為什麼一定要做（2026-08-20 發現）：本檔原本把 hidden 區塊也算進「可見內容」，
 * 於是討論室的三種狀態（loading / unavailable / live）雖然同時只有一種會顯示，
 * 卻三份都被計入厚度 —— 一個**厚度**守門把頁面算得比實際厚，方向剛好相反。
 * <noscript> 同理：它是 JS 缺席時的替代路徑，不是額外內容。
 *
 * 用堆疊掃描配對結束標籤（不是貪婪 regex），才處理得了同名巢狀。
 */
function stripHidden(html) {
  const openTag = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let out = '';
  let cursor = 0;
  let m;
  while ((m = openTag.exec(html))) {
    const [whole, name, attrs] = m;
    const isNoscript = name.toLowerCase() === 'noscript';
    const isHidden = /(^|\s)hidden(\s|=|$)/i.test(attrs);
    if (!isHidden && !isNoscript) continue;
    if (whole.endsWith('/>')) { // 自閉合：只丟掉標籤本身
      out += html.slice(cursor, m.index);
      cursor = m.index + whole.length;
      continue;
    }
    // 往後找配對的結束標籤（同名開合計數）
    const tagRe = new RegExp(`<${name}\\b[^>]*>|</${name}\\s*>`, 'gi');
    tagRe.lastIndex = m.index + whole.length;
    let depth = 1;
    let t;
    let end = html.length;
    while ((t = tagRe.exec(html))) {
      if (t[0].startsWith('</')) { depth -= 1; if (depth === 0) { end = t.index + t[0].length; break; } }
      else depth += 1;
    }
    out += html.slice(cursor, m.index);
    cursor = end;
    openTag.lastIndex = end;
  }
  return out + html.slice(cursor);
}

/**
 * 「快速回答」表的資料格文字（2026-08-21）。
 *
 * D3 擋的是**同一段散文在一頁裡印很多次**（2026-08-19 診斷：某些頁面可見文字有三分之一是
 * 複印）。但比較表的資料格不是段落 —— 端午節的台灣與中國「日期怎麼定」本來就是同一條規則
 * （農曆五月初五），兩格印一樣的字正是這張表要說的事。中文原文短於 D3 的 40 字門檻所以
 * 從沒觸發，翻成英文之後長度過線就被判成重複段落，那是誤判。
 *
 * 處理方式與狀態標籤（EMPTY_MARKERS）一致：**仍然計入 total/unique 字元數**，
 * 只是不進「重複段落」那份計數。所以它擋不到的只有「表格資料格重複」這一種情況，
 * 散文複印照樣擋。
 */
function answerTableCells(html) {
  const cells = new Set();
  for (const m of html.matchAll(/<td\b[^>]*class="[^"]*\banswer-basis\b[^"]*"[^>]*>([\s\S]*?)<\/td>/gi)) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) cells.add(text);
  }
  // 每日一問卡片的社群署名(2026-08-27)。`.q-asked` 印的是「這題由哪個語言社群提出/問誰」,
  // 那是一個**標籤**不是段落 —— /questions/ 一頁列很多題,兩題來自同一個社群時本來就該印同一行,
  // 那正是這個欄位要說的事。與 answer-basis 同型:中文原文短於 40 字門檻從沒觸發,
  // 翻成英文「Asked by the 🇮🇩 Bahasa Indonesia community」過線就被判成重複段落。
  // 一樣**仍然計入 total/unique 字元數**,只是不進「重複段落」那份計數。
  for (const m of html.matchAll(/<p\b[^>]*class="[^"]*\bq-asked\b[^"]*"[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) cells.add(text);
  }
  // 假日總表 /holidays/<cc>/<年>/ 的表格欄位(2026-08-27)。同一個理由的第三次:
  //   ・狀態欄「法定假日」在一頁裡本來就會出現十幾次 —— 那一國就是有十幾天法定假日。
  //   ・「尚未公告,依規則推算」是逐列的資格說明;印尼 2027 有 11 天還沒公告,就該印 11 次。
  //   ・印尼的 cuti bersama 被拆成兩筆(20 日與 23–24 日不連續),官方名稱**本來就同一個**。
  // 這些都是資料格,不是散文。與 answer-basis 一樣仍計入 total/unique 字元數,
  // 只是不進「重複段落」那份計數 —— 所以散文複印照樣擋得到。
  for (const m of html.matchAll(/<td\b[^>]*class="[^"]*\bhol-(?:date|name|status)\b[^"]*"[^>]*>([\s\S]*?)<\/td>/gi)) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) cells.add(text);
  }
  for (const m of html.matchAll(/<span\b[^>]*class="[^"]*\bhol-flag\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) cells.add(text);
  }
  // 每日一問的選項標籤(2026-08-27)。同一個理由的第四次:選項是**按鈕上的字**不是段落。
  // /questions/<topic>/ 一頁列同一個主題的二十幾題,兩題共用一個選項
  // (「Adjusted a clock for daylight saving time」「一定會」)本來就會發生,而且合理。
  // 又是同一種語系不對稱:中文選項短於 D3 的 40 字門檻從沒觸發,翻成英文/葡文過線就被判重複
  // —— zh-TW / zh-CN / ja 全綠,en / hi / id / pt-BR 各 27–31 項。
  // 一樣**仍然計入 total/unique 字元數**,只是不進「重複段落」那份計數。
  for (const m of html.matchAll(/<span\b[^>]*class="[^"]*\bq-option-label\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) cells.add(text);
  }
  return cells;
}

/** 抽出 body 的可見文字，逐行切開（script/style/註解/hidden/noscript 都不算內容） */
function visibleLines(html) {
  let body = html.includes('<body') ? html.slice(html.indexOf('<body')) : html;
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '')
             .replace(/<style[\s\S]*?<\/style>/gi, '')
             .replace(/<!--[\s\S]*?-->/g, '');
  body = stripHidden(body);
  return body.replace(/<[^>]+>/g, '\n').split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 8);
}

const htmlFiles = walk(DIST).filter((p) => p.endsWith('.html'));
if (htmlFiles.length === 0) {
  console.error('✗ dist 沒有 HTML——先跑 astro build');
  process.exit(1);
}

const pages = [];
for (const path of htmlFiles) {
  const html = readFileSync(path, 'utf8');
  const rel = relative(DIST, path);
  const noindex = /name=["'](?:robots|googlebot)["'][^>]*content=["'][^"']*noindex/i.test(html);
  const title = (html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
  // ⚠ 結束引號必須與開頭那一個相同(反向參照),不能寫成 `["']` ——
  // Astro 在雙引號屬性裡會直接印出撇號(`content="Father's Day: …"`,合法 HTML),
  // 用字元類別會在第一個 `'` 就截斷,desc 只剩 "Father"。
  // 2026-08-26 逐國頁上線時才炸出來:兩頁各自被截成 "Father" 於是 D1 誤報重複。
  // 反過來說,在此之前**所有含撇號的英文/葡文描述都只有前幾個字在被比對**,D1 一直漏檢。
  const desc = html.match(/<meta\s+name=["']description["']\s+content=(["'])([\s\S]*?)\1/i)?.[2] || '';
  const lines = visibleLines(html);
  const total = lines.join('').length;
  const unique = [...new Set(lines)].join('').length;
  const isStatusLabel = (line) => EMPTY_MARKERS.some((m) => line.includes(m));
  const tableCells = answerTableCells(html);
  const repeats = new Map();
  const bodyRepeats = new Map();
  for (const line of lines) {
    if (line.length < LONG_PARAGRAPH_CHARS) continue;
    repeats.set(line, (repeats.get(line) || 0) + 1);
    if (!isStatusLabel(line) && !tableCells.has(line)) {
      bodyRepeats.set(line, (bodyRepeats.get(line) || 0) + 1);
    }
  }
  const worst = [...repeats.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
  const worstBody = [...bodyRepeats.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
  const empties = lines.filter(isStatusLabel).length;
  pages.push({ rel, noindex, title, desc, total, unique, worst, worstBody, empties,
    dupPairs: [...bodyRepeats.entries()].filter(([, n]) => n >= 2) });
}

const indexable = pages.filter((p) => !p.noindex);

// ── D1：可索引頁面的 title / description 不得跨頁重複 ────────────────────
for (const [field, label] of [['title', 'title'], ['desc', 'meta description']]) {
  const byValue = new Map();
  for (const p of indexable) {
    const v = p[field];
    if (!v) { fail('D1', `${p.rel}：缺 ${label}`); continue; }
    if (!byValue.has(v)) byValue.set(v, []);
    byValue.get(v).push(p.rel);
  }
  for (const [value, rels] of byValue) {
    if (rels.length > 1) {
      fail('D1', `${rels.length} 個可索引頁面共用同一個 ${label}：${rels.join(', ')}\n        「${value.slice(0, 70)}…」`);
    }
  }
}

// ── D2：渲染後唯一內容下限 ───────────────────────────────────────────────
for (const p of indexable) {
  const utility = UTILITY_PAGES.has(p.rel);
  const floor = utility ? UTILITY_MIN_UNIQUE_CHARS : MIN_UNIQUE_CHARS;
  if (p.unique < floor) {
    fail('D2', `${p.rel}：渲染後唯一內容僅 ${p.unique} 字元（下限 ${floor}${utility ? '，工具頁' : ''}；`
      + `對照 folk.tw 主力內容頁 1,600–2,930）`);
  }
}

// ── D3：同一長段落不得在一頁出現三次以上 ─────────────────────────────────
// ⚠️ 狀態標籤（「討論室暫時關閉」等）不算重複內容：清單頁每張 Topic 卡各印一次是
//    四態契約的靜態預設值（CLAUDE.md 紅線：沒有 JS 的讀者看到的就是 closed）。
//    那不是「同一段內文印了三次」，改由下面的 D4 以「清單頁 vs Topic 頁」分開衡量。
for (const p of pages) {
  const worst = p.worstBody;
  if (worst[1] > MAX_LONG_PARAGRAPH_REPEATS) {
    fail('D3', `${p.rel}：同一段文字在同一頁出現 ${worst[1]} 次（上限 ${MAX_LONG_PARAGRAPH_REPEATS}）\n`
      + `        「${worst[0].slice(0, 60)}…」`);
  }
}

// ── D4：空狀態數量 —— **只報告，不擋**（2026-08-20 降級，理由要看完） ────
// 原本想擋「Topic 頁三個主要區塊全空」，但數 HTML 裡的狀態字串量不到那件事：
//   ・討論室的三種狀態（closed / closed_hint / loading）同時存在於 DOM，
//     只有一個會顯示 —— 於是每頁固定「5 個」，與實際空不空無關。
//   ・zh-TW 之所以沒被判紅，只是因為「目前沒有資料。」短於本檔的行長度過濾器，
//     純粹是量測假象，不是它比較好。
// 門檻若建立在假象上，紅燈就不代表任何事實。真正該擋的「內容形態全空」已經由
// 資料層 scripts/check-content-depth.mjs 的 R4 直接看資料做掉了，那裡量得準。
// 這裡保留數字當觀察值：空狀態確實是 2026-08-19 診斷的實際發現
//（爬蟲在每個 Topic 頁看到一個關著的論壇），值得看見，但不該由這條規則來擋。
const emptyReport = indexable.filter((p) => p.empties >= MAX_EMPTY_BLOCKS);
if (emptyReport.length) {
  console.log(`ℹ️ 空狀態／載入中標籤較多的頁面（觀察值，不擋；真正的空內容由資料層 R4 擋）：`
    + `${emptyReport.length} 頁，最多 ${Math.max(...emptyReport.map((p) => p.empties))} 條`);
}

// ── D5：非 CJK 語系站不得印出 CJK 標點 ───────────────────────────────────
// 立法緣由（2026-08-20）：英文站的 title 與 meta description 長這樣——
//   「Labour Day 2026｜Dates, customs...」「United States · September 7, 2026、Taiwan...。」
// 分隔號、頓號、句號全是模板寫死的中文標點，七個站共用同一組字面值。
// 這是**搜尋結果上第一眼看到的東西**，讀者看到的是一個排版壞掉的頁面。
// 修法是把標點併入 SEO_COPY（listSep / itemSep / endMark / titleSep），
// 這條 gate 保證它不會再被寫死回去。
//
// 只驗 title 與 meta description —— 那兩者完全由模板組出來。
// 內文不驗：英文頁本來就會出現「端午」這類當地名稱，那是內容不是標點。
const CJK_PUNCT = /[、。；｜！？（）]/;
const CJK_LOCALES = new Set(['zh-TW', 'zh-CN', 'ja']);
const buildLocale = process.env.LOCALE || 'zh-TW';
if (!CJK_LOCALES.has(buildLocale)) {
  for (const p of indexable) {
    for (const [label, value] of [['title', p.title], ['meta description', p.desc]]) {
      const hit = value.match(CJK_PUNCT);
      if (hit) {
        fail('D5', `${p.rel}：${buildLocale} 站的 ${label} 出現 CJK 標點「${hit[0]}」\n`
          + `        「${value.slice(0, 80)}…」\n`
          + '        標點屬語系,加進 src/lib/seo.mjs 的 SEO_COPY(listSep/itemSep/endMark/titleSep),不要寫死。');
      }
    }
  }
}

if (REPORT) {
  console.log('# 渲染層厚度明細（可索引頁面；重複率＝1 − 唯一/總計）\n');
  console.log(' 總字元  唯一  重複率  最多重複  空狀態  頁面');
  for (const p of indexable.sort((a, b) => a.unique - b.unique)) {
    const dup = p.total ? 1 - p.unique / p.total : 0;
    console.log(`${String(p.total).padStart(7)} ${String(p.unique).padStart(5)} `
      + `${(dup * 100).toFixed(0).padStart(6)}% ${String(p.worst[1]).padStart(9)} `
      + `${String(p.empties).padStart(7)}  ${p.rel}`);
  }
  const dup2 = indexable.filter((p) => p.dupPairs.length);
  console.log(`\n有長段落重複兩次的頁面：${dup2.length} / ${indexable.length}`);
  console.log('（要把重複降到一次得動版面 → 版面權威來源是產品草案，屬用戶決定，本 gate 只擋惡化）');
  process.exit(0);
}

if (errors.length) {
  console.error(`✗ 渲染層厚度守門未通過（${errors.length} 項）：`);
  for (const e of errors) console.error(`  ${e}`);
  console.error('\n看逐頁明細：node scripts/check-rendered-depth.mjs --report');
  process.exit(1);
}
console.log(`✓ 渲染層厚度守門通過：${indexable.length} 個可索引頁面`
  + `（最薄 ${Math.min(...indexable.map((p) => p.unique))} 唯一字元）`);
process.exit(0);
