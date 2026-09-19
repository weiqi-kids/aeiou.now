#!/usr/bin/env node
// ===========================================================================
// aeiou.now — 凍結出場檢查(2026-09-19 新增)
// ===========================================================================
//
// 用法(裸執行＝正確且完整的行為:印三條判準與各自的判定,唯讀、不打 API):
//   node scripts/freeze-exit-check.mjs
//   node scripts/freeze-exit-check.mjs --days 21   改變「現在」的觀察窗(預設 14 天)
//
// -- 為什麼要有它 ------------------------------------------------------------
// 2026-09-17 訂的復原判準是一句散文:「舊 Topic 主頁每日曝光回到約 150–200」。
// 它有三個問題,照著執行 2026-12-16 必然讀出「沒回來」、凍結會自動延長吃掉整個 Q4:
//   1. 掛在 site_search_daily 上,而那張表是 ['date','page','country'] 尺度、
//      被 Google 的匿名化遮罩系統性少報約一半(2026-09-18 實測:曝光留 48.5%、點擊留 15.9%)。
//   2. 150–200 從來不是穩態。真值尺度下,08-26 逐國頁上線前的實測基線是**每日 144**
//      (08-16~08-25,10 天 1,441 曝光);150–200 只在 08-27~09-01 那個爆量窗出現過。
//   3. 沒有「若沒回到怎麼辦」的分支 —— 一個只有「達標才解凍」的條件不是判準,是無限等待。
//
// -- 三條判準並列,一起讀 ------------------------------------------------------
//   ① 站級曝光:gsc_daily_raw dim='date' 的 7 日移動平均 vs 擴張前基線。
//   ② 固定 cohort:08-26 逐國頁上線**前就存在**的路徑(Topic 主頁、首頁、清單頁),
//      用 dim='page' 算。不含逐國頁與假日總表 —— 那兩種當時還不存在,放進來會比錯基準。
//   ③ 固定 query×page cohort 的曝光加權名次:斷崖前曝光 >= MIN_Q_IMP 的那批,現在排第幾。
//      ①② 量的是「有沒有被端出來」,③ 量的是「端出來時排第幾」—— 兩者會分岔,必須一起看。
//
// -- 分支(這是整支存在的理由)-------------------------------------------------
//   ①② 回到基線               → 降權結束,解凍。
//   ①② 沒回、但 ③ 名次仍在原位 → **曝光資格/覆蓋面問題,不是排名降權**:再等下去讀不出
//                                新東西,直接解凍,把資源轉向第一手內容與外部引用。
//   ①② 沒回、③ 名次也退了     → 降權仍在。此時才是唯一該延長凍結的情況,而且要重訂到期日。
//
// -- 季節性校正 ----------------------------------------------------------------
// Q4 的節日(halloween 10-31、diwali 11-08、christmas 12-25、new-year、shopping-festivals)
// 需求本來就會在 12-16 前後自然回升。主判準用**非 Q4 cohort**,Q4 另列一欄對照 ——
// 否則季節性反彈會被讀成「降權解除」。
//
// 唯讀:只 SELECT,不寫任何表、不打任何 API、不記 jobs。
// ===========================================================================

import { openDb } from "./lib/aeiou-lib.mjs";

const argv = process.argv.slice(2);
const num = (flag, dflt) => {
  const i = argv.indexOf(flag);
  const v = i >= 0 ? Number(argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : dflt;
};

// 窗與門檻。基線窗的兩端是資料決定的,不是挑的:08-15 是七站自訂網域上線日(第一天有 GSC 資料),
// 08-26 是逐國頁上線日。中間這段就是「這個站在擴張前的樣子」,只有 10 天,樣本小要記得。
const BASE_FROM = process.env.AEIOU_FREEZE_BASE_FROM || "2026-08-16";
const BASE_TO = process.env.AEIOU_FREEZE_BASE_TO || "2026-08-25";
const CLIFF = process.env.AEIOU_CLIFF_DATE || "2026-09-02";
const NOW_DAYS = num("--days", 14);
const MIN_Q_IMP = num("--min-query-impressions", 20);
// 回到基線的認定門檻:七日移動平均達到基線的這個比例。不是 100% —— 樣本只有 10 天,
// 而且逐國頁上線本來就會改變組成;要求完全復刻是另一種「永遠達不到」。
const RECOVER_RATIO = Number(process.env.AEIOU_FREEZE_RECOVER_RATIO || 0.7);
// 名次「仍在原位」的認定:斷崖後的曝光加權平均名次比斷崖前退步不超過這麼多名。
const POS_TOLERANCE = Number(process.env.AEIOU_FREEZE_POS_TOLERANCE || 10);
// ③ 可判定的前提:斷崖前有量的查詢裡,至少這個比例斷崖後仍有曝光。
// 低於它,③ 只看得到存活者,「名次沒變」是選擇效應不是事實(說明見 ③ 的程式碼註解)。
const SURVIVAL_MIN = Number(process.env.AEIOU_FREEZE_SURVIVAL_MIN || 0.5);

// Q4 需求本來就會回升的 Topic,主判準要把它們扣掉(理由見檔頭)。
const Q4_SLUGS = (process.env.AEIOU_FREEZE_Q4_SLUGS
  || "halloween,diwali,christmas,new-year,shopping-festivals,winter-solstice").split(",").map((s) => s.trim()).filter(Boolean);

const db = openDb();
const has = (t) => db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
if (!has("gsc_daily_raw")) {
  console.log("尚無資料:gsc_daily_raw 還沒建。先跑 node scripts/gsc-topic-metrics.mjs(它會建表並回補)。");
  db.close();
  process.exit(0);
}

const dayStr = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const NOW_FROM = dayStr(NOW_DAYS);
const pct = (a, b) => (b ? `${(a / b * 100).toFixed(1)}%` : "-");
const isQ4 = (url) => Q4_SLUGS.some((s) => url.includes(`/topic/${s}/`));

console.log(`凍結出場檢查　基線 ${BASE_FROM}~${BASE_TO}　斷崖 ${CLIFF}　現在窗 ${NOW_FROM}~${dayStr(0)}(${NOW_DAYS} 天)`);
console.log(`唯讀;所有數字都出自 gsc_daily_raw(GSC 原始維度,未被匿名化遮罩)。\n`);

// ── ① 站級曝光 ──────────────────────────────────────────────────────────────
const daily = db.prepare(
  "SELECT metric_date, impressions, clicks FROM gsc_daily_raw WHERE dim='date' ORDER BY metric_date",
).all();
const inWin = (d, a, b) => d >= a && d <= b;
const base = daily.filter((r) => inWin(r.metric_date, BASE_FROM, BASE_TO));
const now = daily.filter((r) => r.metric_date >= NOW_FROM);
const baseAvg = base.length ? base.reduce((a, r) => a + r.impressions, 0) / base.length : 0;
const nowAvg = now.length ? now.reduce((a, r) => a + r.impressions, 0) / now.length : 0;
// 七日移動平均取最近一個完整的(GSC 落後 2-3 天,最後兩天一定偏低,直接比會低估)。
const settled = daily.filter((r) => r.metric_date <= dayStr(3));
const last7 = settled.slice(-7);
const ma7 = last7.length ? last7.reduce((a, r) => a + r.impressions, 0) / last7.length : 0;
const target = baseAvg * RECOVER_RATIO;
const pass1 = ma7 >= target;
console.log(`① 站級曝光(dim='date')`);
console.log(`   擴張前基線　${baseAvg.toFixed(1)} 曝光/日(${base.length} 天、共 ${base.reduce((a, r) => a + r.impressions, 0)} 曝光、${base.reduce((a, r) => a + r.clicks, 0)} 點擊)`);
console.log(`   現在　　　　${nowAvg.toFixed(1)} 曝光/日(${pct(nowAvg, baseAvg)} of 基線);7 日移動平均 ${ma7.toFixed(1)}(截至 ${last7.at(-1)?.metric_date ?? "-"})`);
console.log(`   門檻　　　　>= ${target.toFixed(1)}(基線的 ${(RECOVER_RATIO * 100).toFixed(0)}%)　→　${pass1 ? "✅ 達標" : "❌ 未達標"}\n`);

// ── ② 固定 cohort(08-26 前既有路徑)───────────────────────────────────────
const pages = db.prepare(
  "SELECT metric_date, key AS url, impressions FROM gsc_daily_raw WHERE dim='page'",
).all();
// cohort 的定義只有一句:斷崖前就有觀測、而且不是逐國頁／假日總表。
const isCountryPage = (u) => /\/topic\/[^/]+\/[a-z]{2}\/?$/.test(u);
const isHoliday = (u) => u.includes("/holidays/");
const cohortUrls = new Set(
  pages.filter((r) => inWin(r.metric_date, BASE_FROM, BASE_TO) && !isCountryPage(r.url) && !isHoliday(r.url))
    .map((r) => r.url),
);
const cohortSum = (rows, filter) => rows
  .filter((r) => cohortUrls.has(r.url) && filter(r.url))
  .reduce((a, r) => a + r.impressions, 0);
for (const [label, filter] of [["非 Q4(主判準)", (u) => !isQ4(u)], ["Q4 節日(季節性對照)", isQ4]]) {
  const b = cohortSum(pages.filter((r) => inWin(r.metric_date, BASE_FROM, BASE_TO)), filter) / (base.length || 1);
  const n = cohortSum(pages.filter((r) => r.metric_date >= NOW_FROM), filter) / (now.length || 1);
  const ok = b > 0 && n >= b * RECOVER_RATIO;
  if (label.startsWith("非 Q4")) {
    console.log(`② 固定 cohort:${cohortUrls.size} 個 ${BASE_TO} 前就有觀測的路徑(不含逐國頁與假日總表)`);
  }
  console.log(`   ${label.padEnd(18)} 基線 ${b.toFixed(1)} 曝光/日 → 現在 ${n.toFixed(1)}(${pct(n, b)})`
    + (label.startsWith("非 Q4") ? `　→　${ok ? "✅ 達標" : "❌ 未達標"}` : "　(不進判定,只防止季節性反彈被讀成解除)"));
}
const nonQ4Base = cohortSum(pages.filter((r) => inWin(r.metric_date, BASE_FROM, BASE_TO)), (u) => !isQ4(u)) / (base.length || 1);
const nonQ4Now = cohortSum(pages.filter((r) => r.metric_date >= NOW_FROM), (u) => !isQ4(u)) / (now.length || 1);
const pass2 = nonQ4Base > 0 && nonQ4Now >= nonQ4Base * RECOVER_RATIO;
console.log();

// ── ③ 固定 query×page cohort 的名次 ─────────────────────────────────────────
let pass3 = null;
let posBefore = 0;
let posAfter = 0;
if (!has("gsc_query_metrics")) {
  console.log("③ 名次:gsc_query_metrics 不存在,跳過。");
} else {
  const rows = db.prepare(
    `SELECT query, page_url,
            SUM(CASE WHEN metric_date < ? THEN impressions ELSE 0 END) b_imp,
            SUM(CASE WHEN metric_date < ? THEN position_sum ELSE 0 END) b_ps,
            SUM(CASE WHEN metric_date >= ? THEN impressions ELSE 0 END) a_imp,
            SUM(CASE WHEN metric_date >= ? THEN position_sum ELSE 0 END) a_ps
       FROM gsc_query_metrics GROUP BY query, page_url HAVING b_imp >= ?`,
  ).all(CLIFF, CLIFF, CLIFF, CLIFF, MIN_Q_IMP);
  const withAfter = rows.filter((r) => r.a_imp > 0);
  const sum = (rs, k) => rs.reduce((a, r) => a + r[k], 0);
  posBefore = sum(withAfter, "b_ps") / (sum(withAfter, "b_imp") || 1);
  posAfter = sum(withAfter, "a_ps") / (sum(withAfter, "a_imp") || 1);
  const survivalRate = rows.length ? withAfter.length / rows.length : 0;
  const posHeld = withAfter.length > 0 && (posAfter - posBefore) <= POS_TOLERANCE;
  // 🔴 存活者偏誤:名次只在「有曝光」時才被記錄。一組查詢掉到第 90 名就不再有曝光,
  // 於是它**退出樣本**而不是把平均拉高 —— 這一條天生只看得到活下來的那些。
  // 所以「名次仍在原位」只有在存活率夠高時才代表整體;存活率低時它什麼都不能代表。
  // 判定必須同時通過兩關,否則 pass3 一律是 null(不可判定),不能拿來當解凍理由。
  pass3 = survivalRate >= SURVIVAL_MIN && withAfter.length >= 5 ? posHeld : null;
  console.log(`③ 固定 query×page cohort 的曝光加權名次(斷崖前曝光 >= ${MIN_Q_IMP} 的 ${rows.length} 組)`);
  console.log(`   存活率　　${withAfter.length}/${rows.length} = ${(survivalRate * 100).toFixed(1)}% 的組別斷崖後仍有曝光(門檻 ${(SURVIVAL_MIN * 100).toFixed(0)}%)`);
  console.log(`   這 ${withAfter.length} 組的名次　斷崖前 ${posBefore.toFixed(1)} → 現在 ${posAfter.toFixed(1)}(${(posAfter - posBefore) >= 0 ? "退" : "進"} ${Math.abs(posAfter - posBefore).toFixed(1)} 名;容忍 ${POS_TOLERANCE})`);
  if (pass3 === null) {
    console.log(`   →　⚠ **不可判定**:存活率 ${(survivalRate * 100).toFixed(1)}% 太低。`);
    console.log(`      名次只在有曝光時才被記錄 —— 掉到第 90 名的查詢是「退出樣本」,不是「把平均拉高」。`);
    console.log(`      存活率這麼低的時候,「活下來的那些名次沒變」完全不能代表整體。`);
  } else {
    console.log(`   →　${pass3 ? "✅ 名次仍在原位" : "❌ 名次退了"}`);
  }
  console.log();
  // 這一條刻意讀 gsc_query_metrics(被遮罩的表):query 維度本來就只有這一張,
  // 而**名次**是曝光加權平均,遮罩影響的是被留下哪些列、不是同一列的名次值本身。
  // 拿它比曝光量會錯,比名次可以 —— 前提是前後都用同一張表。
}

// ── 判定 ────────────────────────────────────────────────────────────────────
console.log("判定");
if (pass1 && pass2) {
  console.log("  ✅ ①② 都回到基線 → 降權結束。解凍,並把本檔的基線窗往後推一段重訂常態。");
} else if (pass3 === true) {
  console.log("  🟡 ①② 沒回、但 ③ 名次在夠大的存活樣本上仍在原位 → **曝光資格/覆蓋面問題,不是排名降權**。");
  console.log("     再等下去讀不出新東西:解凍,資源轉向第一手內容(holiday_announcements)與外部引用。");
} else if (pass3 === false) {
  console.log("  ❌ ①② 沒回、③ 名次也退了 → 降權仍在。這是唯一該延長凍結的情況,而且要重訂到期日與下次檢查日。");
} else {
  console.log("  ⚠ ①② 沒回、③ 不可判定(存活率太低,只看得到活下來的那些)。");
  console.log("     這個組合說的是:**站台在大多數查詢上根本沒被端出來,而沒被端出來就量不到名次**。");
  console.log("     它既不能證明降權還在,也不能證明只是曝光資格問題 —— Google 這邊問不出更多了。");
  console.log("     所以不要用「再等一個月看看」回應它;要換一個 Google 以外的判官(Bing/BWT)來問");
  console.log("     『這些內容到底有沒有需求』,那才是能分辨的下一步。");
}
console.log(`\n  ⚠ 基線只有 ${base.length} 天,而且那段期間站台本身只有 ${cohortUrls.size} 個頁面有觀測。`);
console.log("  ⚠ 這支只給判定的輸入。解凍與否是人的決定,做了之後要更新 docs/seo-current-state.md。");
db.close();
