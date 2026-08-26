#!/usr/bin/env node
// check-source-urls.mjs — 驗 Topic 來源連結是不是還活著、而且還在講那件事
//
// 為什麼存在(2026-08-26):docs/03-topic-content.md 與 CLAUDE.md 兩處都叫人跑這一支,
// 但檔案一直不存在(文件漂移)。而它守的是一條真紅線:
//
//   **驗來源不能只看狀態碼** —— 要看跟完 redirect 之後落在哪裡,而且判死前要複驗。
//   兩個踩過的坑(2026-08-20):
//     www.tad.gov.tw       整批 302 到 ErrorPage.html 卻回 200
//     bndigital.bn.gov.br  從主機回 403、從 GitHub Actions 回 404
//   再加一個(2026-08-26):
//     www.gov.br/defesa 的新聞頁回 200,但跟完 redirect 落在 acl_users/.../require_login
//
// 所以本支的判準**不是狀態碼**,而是三層:
//   ① 落點      跟完 redirect 後的最終網址是不是還在原網域、有沒有掉進登入頁/錯誤頁
//   ② 內容      抓得到的正文長度(HTML 去標籤 / PDF 用 pdftotext)是不是還像一篇東西
//   ③ 複驗      4xx/5xx/連不上時,**再打該網域的根目錄**:
//                 根目錄通 → 判「這一頁真的沒了」(DEAD)
//                 根目錄也不通 → 判「本主機被擋」(BLOCKED,不是來源的錯,exit code 不算它)
//
// 401/403 一律當「不准抓」:不換 UA、不重試、不繞路(草案 §12 爬蟲守則)。
//
// 用法:
//   node scripts/check-source-urls.mjs                 全部(來自 db 的 sources 表)
//   node scripts/check-source-urls.mjs --topic <slug>  只驗某個 Topic 的來源
//   node scripts/check-source-urls.mjs --url <url>     驗單一網址
//   node scripts/check-source-urls.mjs --json <path>   另外輸出 JSON 報告
//   選項:--concurrency <n>(預設 6)  --timeout <秒>(預設 25)
//
// exit 1 = 有 DEAD(內容真的沒了);BLOCKED 與 THIN 只警告不擋,因為那不是來源的錯。
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, 'db', 'aeiou.sqlite');
const UA = 'Mozilla/5.0 (compatible; aeiou-now/1.0; +https://aeiou.now)';
const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const TIMEOUT = Number(arg('timeout', 25));
const CONC = Number(arg('concurrency', 6));
// 落在這些路徑片段 = 掉進登入頁/錯誤頁,即使回 200 也不算活著
const TRAP = [/require_login/i, /\/login/i, /errorpage/i, /\/error\b/i, /accessdenied/i, /session[_-]?expired/i];
const MIN_TEXT = 400;   // 正文少於這個字元數 = 疑似殼頁

// os.tmpdir() 不一定存在(某些沙箱沒有 /tmp),失敗就退到 repo 內的暫存目錄。
// 這不是小事:寫檔失敗時 curl 會非零離開,整批會被誤判成「連不上」(2026-08-26 踩過)。
const mkWork = () => {
  for (const base of [process.env.TMPDIR, tmpdir(), join(ROOT, '.tmp')]) {
    if (!base) continue;
    try { mkdirSync(base, { recursive: true }); return mkdtempSync(join(base, 'aeiou-srcchk-')); }
    catch { /* 換下一個 */ }
  }
  throw new Error('找不到可寫的暫存目錄');
};
const work = mkWork();
const curl = (url, out) => {
  try {
    const r = execFileSync('curl', ['-sL', '--max-time', String(TIMEOUT), '-A', UA,
      '-o', out, '-w', '%{http_code}\t%{url_effective}\t%{content_type}', url], { encoding: 'utf8' });
    const [code, eff, ctype] = r.split('\t');
    return { code: Number(code), eff, ctype: ctype || '' };
  } catch (e) {
    // curl 非零離開:連不上、逾時、或**寫檔失敗**。後者是環境問題不是來源問題,要看得出來。
    return { code: 0, eff: url, ctype: '', err: String(e.stderr || e.message || e).trim().slice(0, 200) };
  }
};
const bodyText = (file, ctype) => {
  try {
    if (/pdf/i.test(ctype) || file.endsWith('.pdf')) {
      try { return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 32e6 }); }
      catch { return ''; }
    }
    const raw = execFileSync('cat', [file], { encoding: 'utf8', maxBuffer: 32e6 });
    return raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  } catch { return ''; }
};

async function check(url, i) {
  const out = join(work, `p${i}${/\.pdf(\?|$)/i.test(url) ? '.pdf' : ''}`);
  const { code, eff, ctype } = curl(url, out);
  const trapped = TRAP.some((re) => re.test(eff));
  if (code >= 200 && code < 300 && !trapped) {
    const text = bodyText(out, ctype);
    return text.length < MIN_TEXT
      ? { url, verdict: 'THIN', code, eff, chars: text.length }
      : { url, verdict: 'OK', code, eff, chars: text.length };
  }
  // ── 複驗:打網域根目錄,分辨「這一頁沒了」與「本主機被擋」 ──
  let root = '';
  try { root = new URL(eff || url).origin; } catch { root = ''; }
  const rootRes = root ? curl(root, join(work, `r${i}`)) : { code: 0 };
  const rootAlive = rootRes.code >= 200 && rootRes.code < 400;
  const why = trapped ? `落在陷阱頁 ${eff}` : `HTTP ${code || '連不上'}`;
  return rootAlive
    ? { url, verdict: 'DEAD', code, eff, why: `${why}(根目錄 ${rootRes.code} 通 → 內容真的沒了)` }
    : { url, verdict: 'BLOCKED', code, eff, why: `${why}(根目錄也不通 → 本主機被擋,不是來源失效)` };
}

// ── 取要驗的網址 ──────────────────────────────────────────────────────────
let urls = [];
const one = arg('url');
const topic = arg('topic');
if (one) urls = [one];
else {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  urls = topic
    ? db.prepare(`SELECT DISTINCT s.url FROM sources s
         JOIN topic_observances o ON instr(o.source_ids_json, s.source_id) > 0
         JOIN topics t ON t.topic_id = o.topic_id
         WHERE t.slug = ? ORDER BY s.url`).all(topic).map((r) => r.url)
    : db.prepare("SELECT url FROM sources WHERE status != 'ignored' ORDER BY url").all().map((r) => r.url);
  db.close();
}
if (!urls.length) { console.error(topic ? `找不到 ${topic} 的來源` : '沒有要驗的網址'); process.exit(2); }
console.log(`驗 ${urls.length} 個來源(並行 ${CONC}、逾時 ${TIMEOUT}s)……\n`);

const results = [];
for (let i = 0; i < urls.length; i += CONC) {
  results.push(...await Promise.all(urls.slice(i, i + CONC).map((u, j) => check(u, i + j))));
  process.stderr.write(`\r  ${Math.min(i + CONC, urls.length)}/${urls.length}`);
}
process.stderr.write('\r');
rmSync(work, { recursive: true, force: true });

const by = (v) => results.filter((r) => r.verdict === v);
for (const v of ['DEAD', 'BLOCKED', 'THIN']) {
  const rows = by(v);
  if (!rows.length) continue;
  const label = { DEAD: '❌ 內容真的沒了(要換來源)', BLOCKED: '⚠️ 本主機被擋(該從別的網路複驗,不是來源的錯)', THIN: '⚠️ 正文太短(疑似殼頁,人工看一眼)' }[v];
  console.log(`${label} —— ${rows.length} 筆`);
  for (const r of rows) console.log(`  ${r.url}\n     ${r.why || `正文 ${r.chars} 字元`}`);
  console.log('');
}
console.log(`✓ OK ${by('OK').length}／DEAD ${by('DEAD').length}／BLOCKED ${by('BLOCKED').length}／THIN ${by('THIN').length}(共 ${results.length})`);
const jsonOut = arg('json');
if (jsonOut) { writeFileSync(jsonOut, `${JSON.stringify(results, null, 1)}\n`); console.log(`報告:${jsonOut}`); }
process.exit(by('DEAD').length ? 1 : 0);
