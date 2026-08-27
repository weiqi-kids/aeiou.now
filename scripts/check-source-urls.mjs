#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// gate：頁面上印出來的來源連結還活著嗎。
// ═══════════════════════════════════════════════════════════════════════════
//
// 立法緣由（2026-08-19）：內容厚度診斷順手驗了一次 data/ 裡的全部來源網址，
// 當場抓到兩個 404 —— 而它們已經在線上頁面的「來源與日期」區塊印了好幾天：
//   ・comunicacao.pr.gov.br/noticias/aen/185ca999…（christmas / new-year 等多個 Topic 的 BR 來源）
//   ・prefeitura.sp.gov.br/…dia-das-criancas…（childrens-day 的 BR 來源）
// 本站的內容承諾是「每條文化事實都能點回原始來源」。指向 404 的來源比沒有來源更糟：
// 它讓讀者與 Google 都以為有佐證。
//
// ── 狀態碼怎麼判（這段是重點，別簡化成「非 200 就紅」）──────────────────
//   404 / 410           → ERROR。頁面真的不在了。**判死前一定複驗一次**:同一個網址
//                         從不同網路可能拿到不同狀態碼(2026-08-20 實測 bndigital.bn.gov.br
//                         本機 403、GitHub Actions 404),單次判死會讓 CI 間歇性紅燈。
//   403 / 412 / 429     → WARN。是**對方擋機器人**，不是連結死掉。
//                         實測會落在這裡的：britannica.com、oecd.org、timeanddate.com、
//                         defense.gov、justica.pr.gov.br、nhc.gov.cn。
//                         把這些判成錯誤，等於因為別人的 WAF 而擋自己的部署。
//   5xx / 連線失敗       → WARN。對方暫時掛掉或網路抖動，不該變成我們的紅燈。
//   2xx / 3xx           → OK……除非**跟完 redirect 落在錯誤頁**（見下）。
//   2xx 但最終網址是錯誤頁 → ERROR。2026-08-20 抓到:www.tad.gov.tw（觀光局舊網域）
//                         的十個來源全部 302 到 eng.taiwan.net.tw/ErrorPage.html，
//                         HTTP 狀態是 200。只看狀態碼會判成「活著」,實際上讀者點過去
//                         看到的是錯誤頁 —— 比 404 更難發現,因為它連紅燈都不亮。
//
// ── 為什麼不掛進 hourly-export ─────────────────────────────────────────────
// 🔴 刻意不進每小時管線：那會把「別人的網站有沒有掛」綁進本站的發佈路徑，
//    一次網路抖動就停掉資料匯出（folk.tw check-source-refs ④ 的同一條教訓）。
//    這支跑在 CI 與人工檢查，紅了就修來源，不影響當下的內容上線。
//
// 用法：
//   node scripts/check-source-urls.mjs              全部驗；只有 404/410 會 exit 1
//   node scripts/check-source-urls.mjs --warn-only   永遠 exit 0（只看報表）
//   node scripts/check-source-urls.mjs --timeout 30  逐一請求的秒數上限（預設 25）

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const warnOnly = args.includes('--warn-only');
const timeoutMs = (Number(args[args.indexOf('--timeout') + 1]) || 25) * 1000;
const CONCURRENCY = 8;
const UA = 'Mozilla/5.0 (compatible; aeiou-source-check; +https://aeiou.now/about/)';

// ── 收集所有會印在頁面上的來源網址 ───────────────────────────────────────
const topicsDir = join(ROOT, 'data', 'topics');
if (!existsSync(topicsDir)) { console.error('✗ 缺 data/topics/——先跑 export-data.mjs'); process.exit(1); }

const usedBy = new Map();  // url → Set<'slug/位置'>
const note = (url, where) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return;
  if (!usedBy.has(url)) usedBy.set(url, new Set());
  usedBy.get(url).add(where);
};

for (const entry of readdirSync(topicsDir)) {
  if (!entry.startsWith('top_')) continue;
  const factsPath = join(topicsDir, entry, 'facts.json');
  if (!existsSync(factsPath)) continue;
  const f = JSON.parse(readFileSync(factsPath, 'utf8'));
  if (f.status !== 'active' || String(f.slug || '').startsWith('trend-')) continue;
  for (const u of f.source_urls || []) note(u, `${f.slug}（Topic 層）`);
  for (const o of f.observances || []) for (const u of o.source_urls || []) note(u, `${f.slug}/${o.country_code}`);
  for (const n of f.regional_notes || []) for (const u of n.source_urls || []) note(u, `${f.slug}/${n.country_code}`);
}

// ── 在地資料來源（2026-08-21 加）──────────────────────────────────────────
// 為什麼要一起收：hourly-export 的 update-local-data.mjs 會驗這批，但它跑在**主機**上，
// 而主機會被某些網站的 WAF 擋（2026-08-21 實測 www.jakarta.go.id 從主機連根目錄都 403/000，
// 從別的網路卻正常）。那支已經改成「被擋就只 WARN 不擋輸出」——代價是那一輪等於沒驗。
// 這支跑在 GitHub Actions，是現成的**第二個網路出口**：主機驗不到的，由這裡補驗。
// 兩邊判準不同也是刻意的：主機那邊要決定「要不要擋住本站發佈」，這邊只要回答
// 「這個連結到底還活著嗎」。
const localSourcesPath = join(ROOT, 'content', 'local-data-sources.json');
if (existsSync(localSourcesPath)) {
  const local = JSON.parse(readFileSync(localSourcesPath, 'utf8'));
  for (const source of local.sources || []) {
    note(source.url, `在地/${source.market || '?'}/${source.kind || '?'}`);
  }
}

const urls = [...usedBy.keys()].sort();
if (urls.length === 0) { console.error('✗ 一個來源都沒收到——收集邏輯可能壞了'); process.exit(1); }

// ── robots.txt：不准抓的就不抓（2026-08-27 補）──────────────────────────
// 🔴 專案紅線「爬蟲守則不是選項」（草案 §12）本來就要求遵守 robots.txt，而
//    source-refresh.mjs 早就照做（Disallow 的來源直接標 ignored）。但**這一支沒有**，
//    於是 CI 每次 build 都去抓 `law.moj.gov.tw`——它的 robots 是 `User-agent: * / Disallow: /`，
//    而站上引用它 39 次。守自己紅線的腳本自己在違規，這裡補上。
//    (實測澄清：`www.dgpa.gov.tw` 只擋 `BLP_bbot`，對我們是允許的。)
//
// 判準與 source-refresh.mjs 的 robotsFor() 一致（那支是參考實作）：只讀套用到我們的段落
// （`User-agent: *` 與明確指名 aeiou-now-bot 的那一段），最長前綴相符者勝，Allow 平手時優先。
// robots.txt 取不到（404／逾時／網路錯）一律視為**允許**——沒有規則就沒有禁止。
//
// 被 robots 擋下的不算錯誤：它不是死連結，只是我們不該去敲。計為 SKIP 並列在報告裡，
// 讓人知道這幾個網址的存活狀態**沒有被驗過**，而不是假裝驗過了。
const robotsCache = new Map();
async function robotsFor(host) {
  if (robotsCache.has(host)) return robotsCache.get(host);
  const rules = { disallow: [], allow: [] };
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(`https://${host}/robots.txt`, { headers: { 'User-Agent': UA }, signal: ac.signal, redirect: 'follow' });
    clearTimeout(timer);
    if (res.ok) {
      let applies = false;
      for (const raw of (await res.text()).split(/\r?\n/)) {
        const line = raw.replace(/#.*$/, '').trim();
        const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
        if (!m) continue;
        const key = m[1].toLowerCase();
        const val = m[2].trim();
        if (key === 'user-agent') applies = val === '*' || val.toLowerCase().includes('aeiou-now-bot');
        else if (applies && (key === 'disallow' || key === 'allow') && val) rules[key].push(val);
      }
    }
  } catch { /* 取不到 robots = 沒有規則 = 允許 */ }
  const match = (list, path) => list.filter((p) => path.startsWith(p)).sort((a, b) => b.length - a.length)[0] || '';
  const allow = (path) => {
    const d = match(rules.disallow, path);
    const a = match(rules.allow, path);
    return !d || a.length >= d.length;
  };
  robotsCache.set(host, { allow });
  return { allow };
}

// ── 逐一請求（先 HEAD，被拒再 GET；很多政府站不支援 HEAD） ──────────────
async function probe(url) {
  for (const method of ['HEAD', 'GET']) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method, redirect: 'follow', signal: ac.signal, headers: { 'User-Agent': UA } });
      clearTimeout(timer);
      // HEAD 回 404/410 也要用 GET 複核 —— 不少站(實測:tangerangkota.go.id、
      // referensi.data.kemendikdasmen.go.id)對 HEAD 回 404、對 GET 回 200。
      // 只信 HEAD 會把活著的頁面判死。405/501 是明講「不支援 HEAD」,同樣往下走。
      // 401/403 也要往下走(2026-08-27 補)。實測 www.gov.br 的新聞頁對 **HEAD 回 403、
      // 對 GET 回 200 並跟完 redirect 落在 acl_users/.../require_login** —— HEAD 的 403
      // 把登入牆整個遮住了,那一筆於是被歸進「對方擋機器人」的 WARN,永遠不會被判死。
      // ⚠ 這**不是**繞過 401/403(草案 §12「不准抓就不抓」):
      //    ・沒有換 UA、沒有重試同一個方法、沒有換網路;
      //    ・只是把不支援 HEAD 的站升級成 GET,而 GET 回 200 正好證明對方沒有拒絕我們;
      //    ・GET 若同樣回 401/403,就到此為止,照舊歸為 blocked。
      if (method === 'HEAD' && [401, 403, 404, 405, 410, 501].includes(res.status)) continue;
      return { status: res.status, finalUrl: res.url || url };
    } catch (e) {
      clearTimeout(timer);
      if (method === 'GET') return { status: 0, error: e.name === 'AbortError' ? 'timeout' : e.message };
    }
  }
  return { status: 0, error: 'unreachable' };
}

// 跟完 redirect 之後落在錯誤頁 —— 狀態碼是 200,但讀者點過去看到的是「找不到」。
// 只認路徑上的明確標記,不做語意猜測(不抓網頁內文,那會誤判正常的錯誤處理說明頁)。
const ERROR_PATH = /(^|\/)(errorpage|error|404|notfound|not-found|nopage)(\.\w+)?(\/|$)/i;
// 登入牆也算「讀者點過去看不到那份文件」(2026-08-26 抓到):
//   www.gov.br/gestao/…/confira-o-calendario-oficial-…-2026 回 200,
//   但跟完 redirect 落在 /gestao/acl_users/credentials_cookie_auth/require_login。
//   carnival 與 long-holiday-weeks 都曾引到這一類網址。與 ErrorPage 同型:狀態碼不會亮紅燈。
const LOGIN_PATH = /(^|\/)(require_login|login|signin|sign-in|credentials_cookie_auth)(\.\w+)?(\/|$)/i;
function landsOnErrorPage(url, finalUrl) {
  if (!finalUrl || finalUrl === url) return false;
  let a, b;
  try { a = new URL(url); b = new URL(finalUrl); } catch { return false; }
  const bad = (p) => ERROR_PATH.test(p) || LOGIN_PATH.test(p);
  if (!bad(b.pathname)) return false;
  return bad(b.pathname) && !bad(a.pathname);
}

const dead = [];
const blocked = [];
const ok = [];
const robotsSkipped = [];
let cursor = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (cursor < urls.length) {
    const url = urls[cursor++];
    const where = [...usedBy.get(url)].join(', ');
    // robots 說不准抓的就不抓(見上方說明)。不是死連結,所以不進 dead;
    // 但也**不能算驗過**,所以單獨列出來。
    let parsed = null;
    try { parsed = new URL(url); } catch { /* 壞網址,交給下面照常處理 */ }
    if (parsed) {
      const { allow } = await robotsFor(parsed.host);
      if (!allow(parsed.pathname)) { robotsSkipped.push({ url, where }); continue; }
    }
    let { status, error, finalUrl } = await probe(url);
    // 判死之前一定複驗一次 —— 2026-08-20:bndigital.bn.gov.br 從本主機回 403(WAF),
    // 從 GitHub Actions 的網路回 404,同一個網址依來源網路給不同狀態碼。
    // 只驗一次會讓 CI 因為對方 WAF 的地域差異而間歇性紅燈。
    if (status === 404 || status === 410 || (status >= 200 && status < 400 && landsOnErrorPage(url, finalUrl))) {
      await new Promise((r) => setTimeout(r, 1500));
      ({ status, error, finalUrl } = await probe(url));
    }
    if (status === 404 || status === 410) dead.push({ url, status, where });
    else if (status >= 200 && status < 400 && landsOnErrorPage(url, finalUrl)) {
      dead.push({ url, status: `${status}→錯誤頁`, where, finalUrl });
    }
    else if (status >= 200 && status < 400) ok.push(url);
    else blocked.push({ url, status: status || error, where });
  }
}));

console.log(`來源網址 ${urls.length} 個：可達 ${ok.length}、被擋/暫時失敗 ${blocked.length}、robots 不准抓 ${robotsSkipped.length}、失效 ${dead.length}`);
if (robotsSkipped.length) {
  console.log('\n🤖 robots.txt 不准抓（**沒有驗過**，不是驗過沒事）——要確認這些連結是否還活著，只能人工開一次：');
  for (const r of robotsSkipped) console.log(`   ${r.url}\n             用於 ${r.where}`);
}
if (blocked.length) {
  console.log('\n⚠️ 被擋或暫時失敗（不擋部署——這是對方的 WAF 或短暫故障，不是連結死掉）：');
  for (const b of blocked.sort((a, c) => String(a.status).localeCompare(String(c.status)))) {
    console.log(`   ${String(b.status).padEnd(9)} ${b.url}\n             用於 ${b.where}`);
  }
}
if (dead.length) {
  console.error('\n✗ 失效來源（404/410 或跟完 redirect 落在錯誤頁）——這些網址正印在線上頁面的「來源與日期」區塊：');
  for (const d of dead) {
    console.error(`   ${d.status} ${d.url}`);
    if (d.finalUrl) console.error(`       → ${d.finalUrl}`);
    console.error(`       用於 ${d.where}`);
  }
  console.error('\n修法：改 content/topics/<slug>.md 或 scripts/generate-regional-notes.mjs 的 source，'
    + '再跑 import-topics.mjs + export-data.mjs。');
  if (!warnOnly) process.exit(1);
}
process.exit(0);
