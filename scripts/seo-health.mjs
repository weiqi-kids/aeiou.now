#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// 「流量為什麼低」的標準診斷。四層分開量，直接指出瓶頸在哪一層。
// ═══════════════════════════════════════════════════════════════════════════
//
// 立法緣由（2026-08-19，用戶明確指示）：在此之前，被問到流量低時的回答一直是
// 「站還新，再等等看」。實際查下去，成因**從第一天就存在且與時間無關**——
// 索引、部署、埋碼全部正常，是頁面本身太薄。等待不但沒有幫助，還延誤了修復。
//
// 所以這支的設計原則是：**不輸出「再等等」，只輸出瓶頸在哪一層 + 下一步動作。**
// 時間因素只能出現在附註，且必須同時給出「就算等，天花板在哪」的證據。
//
// 四層（順序固定，前一層沒問題才看下一層）：
//   ① 量測層 GA4 的 session 數是不是機器流量撐出來的（direct + 極短停留 + 落在首頁）
//   ② 索引層 頁面進得去 Google 嗎（URL Inspection 抽樣 + sitemap 提交狀態）
//   ③ 排名層 進得去但排在哪（查詢排名分布；51+ 佔比；前 20 名的查詢×頁面對照）
//   ④ 內容層 頁面撐得起排名嗎（呼叫 check-content-depth.mjs 的缺口統計）
//
// 用法（裸執行＝完整診斷）：
//   node scripts/seo-health.mjs
//   node scripts/seo-health.mjs --days 28      改看更長區間（預設 28）
//   node scripts/seo-health.mjs --no-inspect   跳過 URL Inspection（那層很慢，約 3 秒/網址）
//
// 憑證：~/.config/aeiou/ga4-sa.json（GCP 專案 aeiou-seo 的 SA，只看得到 aeiou.now）。
// Google API 存取沿用 /root/seo-ops/lib/google.mjs，不重造輪子。

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SA = join(homedir(), '.config', 'aeiou', 'ga4-sa.json');
const GSC_SITE = 'sc-domain:aeiou.now';
const GA4_PROPERTY = '549586494';
const GOOGLE_LIB = '/root/seo-ops/lib/google.mjs';

const args = process.argv.slice(2);
const days = Number(args[args.indexOf('--days') + 1]) || 28;
const skipInspect = args.includes('--no-inspect');

if (!existsSync(SA)) { console.error(`✗ 缺 SA 金鑰：${SA}`); process.exit(1); }
if (!existsSync(GOOGLE_LIB)) { console.error(`✗ 缺 ${GOOGLE_LIB}`); process.exit(1); }
const { gscQuery, ga4RunReport, inspectUrl, sitemapsList } = await import(GOOGLE_LIB);

const dayStr = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(0)}%` : 'n/a');
const bottlenecks = [];
const h = (title) => console.log(`\n${'─'.repeat(70)}\n${title}\n${'─'.repeat(70)}`);

// ── ① 量測層 ──────────────────────────────────────────────────────────────
h('① 量測層：GA4 的數字有多少是真人');
let realSessions = 0;
try {
  const range = [{ startDate: dayStr(days), endDate: 'today' }];
  const ch = await ga4RunReport(SA, GA4_PROPERTY, {
    dateRanges: range,
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }, { name: 'averageSessionDuration' }],
  });
  let total = 0, suspect = 0;
  console.log('管道            sessions  互動  平均停留');
  for (const row of ch.rows || []) {
    const [group] = row.dimensionValues.map((v) => v.value);
    const [s, e, d] = row.metricValues.map((v) => Number(v.value));
    total += s;
    // 機器流量的特徵：Direct/Unassigned + 平均停留極短 + 互動率極低。
    // 三個一起看，不靠單一指標——單看 direct 會把書籤與 App 內開啟誤殺。
    const machineLike = (group === 'Direct' || group === 'Unassigned') && d < 15 && e / Math.max(s, 1) < 0.2;
    if (machineLike) suspect += s;
    else realSessions += s;
    console.log(`${group.padEnd(16)}${String(s).padStart(8)}${String(e).padStart(6)}`
      + `${d.toFixed(0).padStart(9)} 秒${machineLike ? '   ← 疑似機器流量' : ''}`);
  }
  console.log(`\n總 sessions ${total}，其中疑似機器 ${suspect}（${pct(suspect, total)}），`
    + `可當真人看的 ${realSessions}`);
  if (suspect / Math.max(total, 1) > 0.5) {
    console.log('⚠️ 過半是機器流量 —— GA4 的 session 數不能直接當「有人在看」的證據。');
  }
} catch (e) { console.log(`（GA4 讀取失敗：${e.message}）`); }

// ── ② 索引層 ──────────────────────────────────────────────────────────────
h('② 索引層：頁面進得去 Google 嗎');
try {
  const maps = await sitemapsList(SA, GSC_SITE);
  console.log(`已提交 sitemap ${maps.length} 份；最後下載日：`
    + [...new Set(maps.map((m) => (m.lastDownloaded || '-').slice(0, 10)))].join(', '));
  const bad = maps.filter((m) => Number(m.errors) > 0 || Number(m.warnings) > 0);
  console.log(bad.length ? `⚠️ ${bad.length} 份有錯誤/警告` : '全部 0 錯誤 0 警告');
  console.log('ℹ️ sitemap API 的 indexed 欄位 Google 已停用（對誰都回 0），不可當索引證據；'
    + '真實訊號是下面的 URL Inspection。');
} catch (e) { console.log(`（Sitemaps 讀取失敗：${e.message}）`); }

if (!skipInspect) {
  // 逐頁驗,不抽樣 —— 抽樣只能回答「有沒有問題」,回答不了「是哪一頁」。
  // 2026-08-20:抽樣報「1 頁不在索引」卻沒說是哪一頁;逐頁掃完才知道是 /questions/,
  // 而它之所以沒被爬到,是因為 indexnow.mjs 的清單裡從來沒有它(當天已補)。
  // 主站 sitemap 目前數十頁,配額(URL Inspection 每天 2000 次)綽綽有餘;
  // 真要省,用 --sample 只驗六頁。
  let targets = [];
  if (args.includes('--sample')) {
    targets = [
      'https://aeiou.now/', 'https://aeiou.now/topics/today/', 'https://aeiou.now/questions/',
      'https://en.aeiou.now/', 'https://jp.aeiou.now/', 'https://br.aeiou.now/',
    ];
  } else {
    try {
      const xml = await (await fetch('https://aeiou.now/sitemap.xml')).text();
      targets = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    } catch (e) {
      console.log(`（sitemap 讀取失敗,退回抽樣：${e.message}）`);
      targets = ['https://aeiou.now/', 'https://aeiou.now/questions/'];
    }
  }
  const tally = {};
  const notIndexed = [];
  let cur = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cur < targets.length) {
      const u = targets[cur++];
      let state;
      try { state = (await inspectUrl(SA, GSC_SITE, u)).coverageState || '(空)'; }
      catch (e) { state = `ERR ${e.message.slice(0, 40)}`; }
      tally[state] = (tally[state] || 0) + 1;
      if (state !== 'Submitted and indexed') notIndexed.push({ u, state });
    }
  }));
  console.log(`\nURL Inspection（${targets.length} 頁逐一驗）：`
    + Object.entries(tally).map(([k, v]) => `${v}× ${k}`).join('　'));
  if (notIndexed.length) {
    console.log('未進索引的頁面：');
    for (const n of notIndexed.sort((a, b) => a.u.localeCompare(b.u))) {
      console.log(`   ${n.state.padEnd(26)} ${n.u}`);
    }
    console.log('   修法：確認該頁有內部連結、在 sitemap 內、且被 scripts/indexnow.mjs 提交。');
    bottlenecks.push(`索引層：${notIndexed.length} 頁沒被索引（上面有清單）`);
  }
} else {
  console.log('\n（--no-inspect：略過 URL Inspection）');
}

// ── ③ 排名層 ──────────────────────────────────────────────────────────────
h('③ 排名層：進得去，但排在哪');
let queryRows = [];
try {
  const r = await gscQuery(SA, GSC_SITE, {
    startDate: dayStr(days), endDate: dayStr(0), dimensions: ['query'], rowLimit: 25000,
  });
  queryRows = r.rows || [];
  const imp = queryRows.reduce((a, x) => a + x.impressions, 0);
  const clicks = queryRows.reduce((a, x) => a + x.clicks, 0);
  const buckets = { '1–10': 0, '11–20': 0, '21–50': 0, '51+': 0 };
  for (const x of queryRows) {
    buckets[x.position <= 10 ? '1–10' : x.position <= 20 ? '11–20' : x.position <= 50 ? '21–50' : '51+']++;
  }
  console.log(`近 ${days} 天：查詢 ${queryRows.length} 個、曝光 ${imp}、點擊 ${clicks}`
    + `（CTR ${pct(clicks, imp)}）`);
  console.log('排名分布：', Object.entries(buckets).map(([k, v]) => `${k} ${v}`).join('　'));

  // 樣本量必須跟結論一起出現（2026-08-20）。「近 28 天」是**查詢區間**，不是資料量：
  // 這個 property 2026-08-20 實測只有 5 天真的有資料（08-14 起），28 天的窗裡有 23 天是空的。
  // 當天就是因為只看「近 28 天 70% 排 51+」這個佔比，把一個 5 天大的樣本當成結構性判決，
  // 推導出「那 7 個 Topic 太薄」的錯誤結論——實際上它們七國全覆蓋、厚度全達標。
  // 所以佔比照印（它是事實），但一定要把 n 印在旁邊，並且在 n 太小時明說不能下結構性結論。
  // ⚠️ 這不是「再等等看」的後門：下面不會叫任何人等，只會說這個數字還撐不起什麼結論。
  let dataDays = null;
  try {
    const dr = await gscQuery(SA, GSC_SITE, {
      startDate: dayStr(days), endDate: dayStr(0), dimensions: ['date'], rowLimit: 500,
    });
    dataDays = (dr.rows || []).filter((x) => x.impressions > 0).length;
    console.log(`樣本量：查詢區間 ${days} 天，其中真的有曝光的只有 ${dataDays} 天`);
  } catch { /* 樣本量拿不到就不印，不影響其餘判讀 */ }

  const MIN_DAYS = 14;      // 低於此天數，排名分布的佔比不足以支撐結構性結論
  const MIN_IMPRESSIONS = 500;
  const thin = (dataDays !== null && dataDays < MIN_DAYS) || imp < MIN_IMPRESSIONS;
  const deep = buckets['51+'] / Math.max(queryRows.length, 1);
  if (deep > 0.5 && !thin) {
    bottlenecks.push(`排名層：${pct(buckets['51+'], queryRows.length)} 的查詢排在 51 名以後`);
    console.log('⚠️ 過半查詢排在第五頁之後 —— 這不是「還沒到時間」，是頁面在該查詢上競爭力不足。');
  } else if (deep > 0.5) {
    console.log(`ℹ️ ${pct(buckets['51+'], queryRows.length)} 的查詢排在 51 名以後，但樣本只有 `
      + `${dataDays ?? '?'} 天／${imp} 曝光（判準：≥${MIN_DAYS} 天且 ≥${MIN_IMPRESSIONS} 曝光）。`);
    console.log('   這個佔比目前不足以判定是結構問題，也不足以判定不是 —— 不要拿它當任何一邊的證據。');
    console.log('   要縮短這段空白，靠的是 scripts/gsc-topic-metrics.mjs 每天累積，不是等。');
  }
  // ── 意圖分類:站上唯一有優勢的那一類排在哪(2026-08-21 補進工具) ────────────
  // 2026-08-21 的診斷是**手算**的:把查詢按意圖分兩類,發現日期/名稱型排 32.7 名、
  // 跨國/制度型排 67.6 名,而後者才是站上唯一有優勢的內容。改版就是照那個結論做的。
  // 但「改版有沒有效」不能靠下次有人再手算一次 —— 那等於這個判準只存在於某一次對話裡。
  // 所以固定印出來。docs/TODO.md 的「效果觀測」兩項看的就是這一段。
  //
  // ⚠ 判準是**查詢問的是什麼**,不是頁面是什麼:
  //   · 日期/名稱型 = 帶年份、帶「幾號/什麼時候/kapan/when/日期」——Google 答案框的標準品,
  //     排第一也沒人點(2026-08-21 實證:名次 4–9 累積 41 曝光仍 0 點擊)。
  //   · 跨國/制度型 = 帶「哪些國家/怎麼過/為什麼/放假嗎/差別/各國」——七國制度比較 = 唯一資產。
  //   · 其餘歸「未分類」,不進兩邊的平均,免得把雜訊算進去。
  const DATE_RE = /(\b20\d{2}\b|幾號|什麼時候|什么时候|日期|いつ|何日|kapan|tanggal|when is|quando|कब|तारीख)/i;
  const INST_RE = /(哪些國家|哪些国家|各國|各国|怎麼過|怎么过|放假|為什麼|为什么|差別|差别|比較|比较|制度|國定|国定|holiday|public holiday|do they|how do|why do|libur|hari libur|feriado|छुट्टी|क्यों|कैसे)/i;
  const intent = { date: [], inst: [] };
  for (const x of queryRows) {
    const q = String(x.keys?.[0] ?? x.query ?? '');
    // 制度型優先:同時命中兩邊時,「2027 印尼開齋節放假嗎」問的是制度不是日期。
    if (INST_RE.test(q)) intent.inst.push(x);
    else if (DATE_RE.test(q)) intent.date.push(x);
  }
  const avgPos = (rows) => {
    const imp = rows.reduce((a, x) => a + x.impressions, 0);
    if (imp === 0) return null;
    // 曝光加權平均 —— 與 GSC 自己的算法一致,不能用算術平均(那會讓一次曝光的查詢
    // 與一百次曝光的查詢等重)。
    return rows.reduce((a, x) => a + x.position * x.impressions, 0) / imp;
  };
  console.log('\n意圖分類（站上唯一有優勢的是跨國/制度型；2026-08-21 改版前是 32.7 對 67.6）：');
  for (const [label, rows] of [['日期/名稱型（沒有優勢）', intent.date], ['跨國/制度型（唯一資產）', intent.inst]]) {
    const imp = rows.reduce((a, x) => a + x.impressions, 0);
    const clk = rows.reduce((a, x) => a + x.clicks, 0);
    const pos = avgPos(rows);
    console.log(`  ${label}：查詢 ${rows.length}　曝光 ${imp}　點擊 ${clk}　平均名次 ${pos === null ? '—' : pos.toFixed(1)}`);
  }
  const unclassified = queryRows.length - intent.date.length - intent.inst.length;
  if (unclassified > 0) console.log(`  （未分類 ${unclassified} 個查詢不進兩邊的平均）`);
  console.log('  ⚠ 這兩個數字要和**改版上線後 Google 重爬過**的資料比才有意義；');
  console.log('     GSC 資料固定落後 2–3 天，查 lastCrawlTime 確認它看過新標題沒有（見 ② 層）。');

  const top = queryRows.filter((x) => x.position <= 10);
  const topImp = top.reduce((a, x) => a + x.impressions, 0);
  const topClicks = top.reduce((a, x) => a + x.clicks, 0);
  // 門檻從 20 提高到 200（2026-08-20）。理由：位置 5–10 的期望 CTR 約 5–8%，
  // 20 次曝光的期望點擊只有 1–2 次，拿到 0 次完全在雜訊範圍內，稱不上「天花板證據」。
  // 200 次曝光的期望點擊約 10–16 次，此時 0 點擊才真的說明了什麼。
  if (topImp >= 200 && topClicks === 0) {
    bottlenecks.push(`天花板證據：已排進前十的查詢累積 ${topImp} 曝光仍 0 點擊`);
    console.log(`⚠️ 已排進前十的查詢累積 ${topImp} 曝光、${topClicks} 點擊 —— `
      + '這就是「就算等下去，天花板在哪」的證據，不要用時間解釋它。');
  }
  // 排進前十卻沒人點,光看「幾個查詢、幾次曝光」看不出原因;要看**查詢問的是什麼、
  // 落在哪一頁**。2026-08-20 就是這張表讓問題現形:排名第 5 的查詢是
  // 「2027印尼齋戒月時間」,落在 /topic/ramadan-and-eid/ —— 而那個 Topic 底下五個
  // observance 全是開齋節,一筆齋戒月都沒有。標題寫著齋戒月,答案給的是開齋節日期。
  // 這類「頁面答非所問」不適合做成閘門(判準太模糊,noisy gate 只會被無視),
  // 但**列出來就看得見**,所以固定印在報告裡。
  try {
    const r2 = await gscQuery(SA, GSC_SITE, {
      startDate: dayStr(days), endDate: dayStr(0), dimensions: ['query', 'page'], rowLimit: 500,
    });
    const pairs = (r2.rows || []).filter((x) => x.position <= 20)
      .sort((a, b) => a.position - b.position).slice(0, 20);
    if (pairs.length) {
      console.log('\n排進前 20 的查詢落在哪一頁（看「問的東西」與「頁面答的東西」對不對得上）：');
      console.log('  名次  曝光  點擊  查詢 → 頁面');
      for (const x of pairs) {
        console.log(`  ${x.position.toFixed(1).padStart(4)} ${String(x.impressions).padStart(5)} `
          + `${String(x.clicks).padStart(5)}  ${x.keys[0]} → ${x.keys[1].replace(/^https?:\/\//, '')}`);
      }
    }
  } catch (e) { console.log(`（查詢×頁面讀取失敗：${e.message}）`); }
} catch (e) { console.log(`（GSC 讀取失敗：${e.message}）`); }

// ── ④ 內容層 ──────────────────────────────────────────────────────────────
h('④ 內容層：頁面撐得起排名嗎');
try {
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'check-content-depth.mjs'), '--report'],
    { cwd: ROOT, encoding: 'utf8' });
  const tail = out.trim().split('\n').slice(-3).join('\n');
  console.log(tail);
  const m = out.match(/未達目標：(\d+) \/ (\d+)/);
  if (m && Number(m[1]) > 0) bottlenecks.push(`內容層：${m[1]}/${m[2]} 個 Topic 未達厚度目標`);
  console.log('\n完整缺口清單：node scripts/check-content-depth.mjs --report');
} catch (e) { console.log(`（內容層檢查失敗：${e.message}）`); }

// ── 結論 ──────────────────────────────────────────────────────────────────
h('結論');
if (bottlenecks.length === 0) {
  console.log('四層都沒有查到瓶頸 —— 量測、索引、排名、內容都沒有可修的缺口。');
  console.log('這種情況下唯一誠實的下一步是**擴大可被搜尋的面**（更多 Topic × 更多國家），');
  console.log('不是等，也不是再調同一批頁面。若樣本量那行顯示資料天數還很少，');
  console.log('那代表這份報告本身還沒有判別力，而不是代表站台沒問題。');
} else {
  console.log('瓶頸（依序處理）：');
  bottlenecks.forEach((b, i) => console.log(`  ${i + 1}. ${b}`));
  console.log('\n⚠️ 以上每一項都與「站台上線多久」無關，等待不會改善任何一項。');
  console.log('   不准把「再等等看」當成這份報告的結論（doctrine：2026-08-19 用戶明示）。');
}
process.exit(0);
