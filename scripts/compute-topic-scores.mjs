#!/usr/bin/env node
// ===========================================================================
// aeiou.now — 算 HotScore,寫 topic_scores(2026-08-20 新增)
// ===========================================================================
//
// 用法(裸執行＝完整正確行為:算六個時窗 × global + 各國,冪等重寫):
//   node scripts/compute-topic-scores.mjs
//   node scripts/compute-topic-scores.mjs --dry-run     只印分佈,不寫
//   node scripts/compute-topic-scores.mjs --explain <slug>   印出某個 Topic 的分項
//   AEIOU_SCORE_NOW=<epoch> node scripts/compute-topic-scores.mjs   假裝是那個時刻(驗換日用)
//
// -- 這支補的是哪一半 ----------------------------------------------------
// `gsc-topic-metrics.mjs` 每天累積 `topic_search_metrics`,但在這支出現以前
// **沒有任何東西把它變成分數**,所以全站熱度級距恆為最低階、排行榜六窗恆 thin。
// 資料在累積、畫面卻永遠不動,從外面看很容易被誤判成資料壞了。
//
// -- 公式(docs/02-data-model.md §2.5,草案 §20 + §21 修正) ---------------
//   HotScore = ViewScore + CommentScore + EngagementScore
//            + VelocityScore + CrossCountryScore + SourceScore - AgeDecay
//
// 七項全部實作。**目前多數項會是 0,那是事實不是缺陷**——站上 UGC 還很少
// (posts/comments/reactions 的筆數自己查)。項目為 0 與項目不存在是兩件事,
// 前者會隨資料長出來,後者永遠不會,所以七項都寫進去。
//
// -- 為什麼「量還小」不是不算分數的理由(2026-08-20 用戶拍板) ------------
// 先前的想法是「等單 Topic 中位曝光 >=30 再說」。但那讓畫面停在一個**假的**狀態:
// 所有 Topic 都顯示最低階,等於對讀者宣稱「全世界沒有任何話題正在發生」。
// 而且熱度最誠實的訊號根本不是流量,是**時序鄰近度**——下週就是的節日就是熱的,
// 那一項與曝光量無關、完全不受樣本稀疏影響。所以照算,並且讓鄰近度主導。
// 稀疏的是 ViewScore 那一項,不是整個分數。
//
// -- 尺度 ----------------------------------------------------------------
// 各項一律先壓成 0..~40 的量級再相加,避免任何一項因為單位不同而吃掉其他項。
// 流量類用 log1p(注意力是長尾),鄰近度用高斯衰減。最終分數與
// `site/src/lib/heat.mjs` 的 HEAT_TIERS 對齊(1/3/10/30 幾何級距)。
//
// 失敗:寫 jobs(job_name='compute-topic-scores'),重試曲線同其他 job。

import { openDb, beginJob, finishJob, slotStart, nowSec, log } from "./lib/aeiou-lib.mjs";
import { SQL_PUBLICLY_VISIBLE } from "./lib/topics.mjs";

const JOB_NAME = "compute-topic-scores";
const argv = process.argv.slice(2);
const DRY_RUN = argv.includes("--dry-run");
const EXPLAIN = argv[argv.indexOf("--explain") + 1] && argv.includes("--explain")
  ? argv[argv.indexOf("--explain") + 1] : null;

// 時窗 → 回看天數。8h 是 Worker 即時層,不在這支的守備範圍(靜態只出六窗)。
const WINDOWS = { "24h": 1, "72h": 3, "7d": 7, "1m": 30, "3m": 90, "1y": 365 };
const day = 86400;
// AEIOU_SCORE_NOW:覆寫「現在」(epoch 秒)。用途是驗證「換日會不會讓靜態產物大規模重寫」——
// 沒有這個開關就只能等明天。順帶讓重跑可重現。不設就是真正的現在。
const now = Number(process.env.AEIOU_SCORE_NOW) || nowSec();
// 分數的時間基準一律對齊「當日 UTC 午夜」,不是此刻。
// 2026-08-20 事故:Proximity 直接吃 now(秒),於是每跑一次分數就微幅變動,
// hourly-export 每小時都判定 data/ 有變 → 每小時 commit 124 檔、822 增 822 刪,
// 每小時觸發一次七站重建,只為了一個 0.01 的分數漂移。而且真正的內容改動
// 會被埋在這種雜訊裡看不出來。「距離某天還有幾天」本來就不該每小時變。
const midnight = Math.floor(now / day) * day;
const today = new Date(now * 1000).toISOString().slice(0, 10);
const dayStr = (n) => new Date((now - n * day) * 1000).toISOString().slice(0, 10);

const db = openDb();
const job = beginJob(db, { jobName: JOB_NAME, scheduledAt: slotStart(3600) });

try {
  const topics = db.prepare(
    `SELECT topic_id, slug, status FROM topics WHERE ${SQL_PUBLICLY_VISIBLE}`,
  ).all();
  log(`[${JOB_NAME}] 可見 Topic ${topics.length} 個`);

  // ── 輸入 1:搜尋曝光(ViewScore / VelocityScore / 國別 scope 的來源) ──
  const searchRows = db.prepare(
    `SELECT topic_id, scope, metric_date, impressions, clicks
       FROM topic_search_metrics WHERE metric_date >= ?`,
  ).all(dayStr(400));

  // ── 輸入 2:UGC(CommentScore / EngagementScore / CrossCountryScore) ──
  // 這幾張表目前多半是空的;空就是 0,不特別處理。
  const postRows = db.prepare(
    `SELECT topic_id, country_code, created_at, comments, likes, shares,
            cross_country_engagements
       FROM posts WHERE status NOT IN ('archived','moderation')`,
  ).all();
  const commentRows = db.prepare(
    `SELECT p.topic_id AS topic_id, c.created_at AS created_at
       FROM comments c JOIN posts p ON p.post_id = c.post_id`,
  ).all();
  const reactionRows = db.prepare(
    `SELECT p.topic_id AS topic_id, r.created_at AS created_at
       FROM reactions r JOIN posts p ON p.post_id = r.target_id
      WHERE r.target_type = 'post'`,
  ).all();

  // ── 輸入 3:來源數(SourceScore) ──
  // ⚠️ 來源與 Topic 的關聯有**兩處**,只讀一處會讓人工 Topic 的 SourceScore 恆為 0:
  //   * source_topics —— 機器/趨勢 Topic 走這裡
  //   * topic_observances.source_ids_json —— content/topics/*.md 匯入的人工 Topic 走這裡
  // 2026-08-20 初版只讀前者,結果 33 個人工 Topic 全部拿 0 分,實測才發現。
  const sourceCounts = new Map();
  const addSource = (topicId, sourceId) => {
    if (!topicId || !sourceId) return;
    if (!sourceCounts.has(topicId)) sourceCounts.set(topicId, new Set());
    sourceCounts.get(topicId).add(sourceId);
  };
  for (const r of db.prepare("SELECT topic_id, source_id FROM source_topics").all()) {
    addSource(r.topic_id, r.source_id);
  }
  for (const r of db.prepare(
    "SELECT topic_id, source_ids_json FROM topic_observances WHERE source_ids_json IS NOT NULL",
  ).all()) {
    let ids = [];
    try { ids = JSON.parse(r.source_ids_json) || []; } catch { ids = []; }
    for (const id of ids) addSource(r.topic_id, id);
  }

  // ── 輸入 4:下一次發生的日期(AgeDecay 的反面:時序鄰近度) ──
  const nextOcc = new Map();
  for (const r of db.prepare(
    `SELECT o.topic_id AS topic_id, oc.starts_on AS starts_on
       FROM topic_observance_occurrences oc
       JOIN topic_observances o ON o.observance_id = oc.observance_id`,
  ).all()) {
    const prev = nextOcc.get(r.topic_id);
    // 取「距今絕對值最小」的那一筆:節日剛過與即將到來都算當令。
    const d = Math.abs((Date.parse(`${r.starts_on}T00:00:00Z`) / 1000 - midnight) / day);
    if (!prev || d < prev) nextOcc.set(r.topic_id, d);
  }

  const inWindow = (ts, days) => ts != null && ts >= midnight - days * day;
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  /** 各國 scope 用得到:把某個集合按國別切開 */
  const scopesFor = (topicId) => {
    const set = new Set(["global"]);
    for (const r of searchRows) {
      if (r.topic_id === topicId && r.scope.startsWith("country:")) set.add(r.scope);
    }
    for (const p of postRows) {
      if (p.topic_id === topicId && p.country_code) set.add(`country:${p.country_code}`);
    }
    return [...set];
  };

  /** 單一 (topic, scope, window) 的分項 */
  function score(topicId, scope, windowKey) {
    const days = WINDOWS[windowKey];
    const since = dayStr(days);
    const cc = scope === "global" ? null : scope;

    const mine = searchRows.filter(
      (r) => r.topic_id === topicId && r.scope === (cc || "global") && r.metric_date >= since,
    );
    const impressions = sum(mine.map((r) => r.impressions));
    const clicks = sum(mine.map((r) => r.clicks));

    // ViewScore:曝光是「被看見」,點擊是「真的來了」,後者權重高得多。
    const ViewScore = 4 * Math.log1p(impressions) + 10 * Math.log1p(clicks);

    // VelocityScore:同長度的前一段當基準,成長才是「正在發生」。
    const prevFrom = dayStr(days * 2);
    const prev = searchRows.filter(
      (r) => r.topic_id === topicId && r.scope === (cc || "global")
        && r.metric_date >= prevFrom && r.metric_date < since,
    );
    const prevImp = sum(prev.map((r) => r.impressions));
    const growth = impressions - prevImp;
    const VelocityScore = growth > 0 ? 6 * Math.log1p(growth) : 0;

    // UGC 三項
    const posts = postRows.filter(
      (p) => p.topic_id === topicId && (!cc || `country:${p.country_code}` === cc)
        && inWindow(p.created_at, days),
    );
    const comments = commentRows.filter(
      (c) => c.topic_id === topicId && inWindow(c.created_at, days),
    );
    const reactions = reactionRows.filter(
      (r) => r.topic_id === topicId && inWindow(r.created_at, days),
    );
    const CommentScore = 5 * Math.log1p(comments.length + sum(posts.map((p) => p.comments || 0)));
    const EngagementScore = 3 * Math.log1p(
      reactions.length + sum(posts.map((p) => (p.likes || 0) + (p.shares || 0))),
    );
    const CrossCountryScore = 4 * Math.log1p(
      sum(posts.map((p) => p.cross_country_engagements || 0))
      + (cc ? 0 : new Set(posts.map((p) => p.country_code).filter(Boolean)).size),
    );

    // SourceScore:有來源的 Topic 才撐得起排名(也是對 scaled content abuse 的正面抗辯)。
    // 與時窗無關,故不隨窗變動,權重刻意小,只當底噪之上的墊高。
    const SourceScore = 1.5 * Math.log1p((sourceCounts.get(topicId) || new Set()).size);

    // 時序鄰近度:距離下一次(或剛過的)發生日越近越熱。
    // 用高斯衰減,σ 隨時窗放大——24h 窗只關心這幾天,1y 窗容得下整季。
    // 這一項與流量無關,是站台資料量還小的時候唯一不受雜訊影響的訊號。
    // σ 的成長刻意**慢於**時窗(sqrt 而非線性)。2026-08-20 初版用 days*0.9,
    // 結果 1y 窗的 σ 高達三百多天,等於「一年內會發生的節日」全部拿滿分——
    // 實測 1y 榜 24 筆裡 11 筆判為 blast、11 筆 hot,級距形同沒有資訊。
    // 級距的用途是讓讀者一眼分出輕重,全部擠在頂端就是失效。
    const dist = nextOcc.get(topicId);
    const sigma = 10 * Math.sqrt(days / 7);
    const Proximity = dist == null ? 0 : 26 * Math.exp(-((dist / sigma) ** 2) / 2);

    // AgeDecay:cooling/archived 的 Topic 該退燒;active 不額外扣。
    const st = topics.find((t) => t.topic_id === topicId)?.status;
    const AgeDecay = st === "archived" ? 8 : st === "cooling" ? 4 : 0;

    const total = ViewScore + CommentScore + EngagementScore + VelocityScore
      + CrossCountryScore + SourceScore + Proximity - AgeDecay;
    return {
      total: Math.max(0, Number(total.toFixed(2))),
      parts: { ViewScore, CommentScore, EngagementScore, VelocityScore, CrossCountryScore, SourceScore, Proximity, AgeDecay },
      impressions, clicks,
    };
  }

  if (EXPLAIN) {
    const t = topics.find((x) => x.slug === EXPLAIN);
    if (!t) { console.error(`✗ 找不到 slug=${EXPLAIN}`); process.exit(2); }
    console.log(`\n${t.slug}(${t.status})的分項:\n`);
    for (const w of Object.keys(WINDOWS)) {
      const s = score(t.topic_id, "global", w);
      const p = s.parts;
      console.log(`  ${w.padEnd(4)} total=${String(s.total).padStart(7)}  `
        + Object.entries(p).filter(([, v]) => v !== 0)
          .map(([k, v]) => `${k}=${v.toFixed(1)}`).join(" "));
    }
    process.exit(0);
  }

  // ── 算全部 ──
  const rows = [];
  for (const t of topics) {
    for (const scope of scopesFor(t.topic_id)) {
      for (const w of Object.keys(WINDOWS)) {
        const s = score(t.topic_id, scope, w);
        if (s.total <= 0) continue;   // 0 分不進表:排行榜不列「完全沒有訊號」的 Topic
        rows.push({ topic_id: t.topic_id, scope, window: w, score: s.total });
      }
    }
  }
  // 名次:同 (scope, window) 內由高到低,分數相同時用 topic_id 定序(避免每次跑名次跳動)
  const byKey = new Map();
  for (const r of rows) {
    const k = `${r.scope}|${r.window}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(r);
  }
  for (const list of byKey.values()) {
    list.sort((a, b) => b.score - a.score || a.topic_id.localeCompare(b.topic_id));
    list.forEach((r, i) => { r.rank = i + 1; });
  }

  const globals = (byKey.get("global|7d") || []).map((r) => r.score).sort((a, b) => a - b);
  const pct = (q) => (globals.length ? globals[Math.floor((globals.length - 1) * q)] : 0);
  log(`[${JOB_NAME}] global/7d 分數分佈:n=${globals.length}`
    + ` min=${(globals[0] ?? 0).toFixed(1)} p25=${pct(0.25).toFixed(1)}`
    + ` 中位=${pct(0.5).toFixed(1)} p75=${pct(0.75).toFixed(1)}`
    + ` max=${(globals[globals.length - 1] ?? 0).toFixed(1)}`);

  if (DRY_RUN) {
    log(`[${JOB_NAME}] --dry-run:算出 ${rows.length} 列,不寫入`);
    finishJob(db, job, { status: "success", read: topics.length });
    process.exit(0);
  }

  // 整表重算:分數是「此刻的量測」,不是累積帳本,留著舊列只會讓過期分數混進排行。
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM topic_scores");
    const stmt = db.prepare(
      `INSERT INTO topic_scores (topic_id, scope, window, score, rank, computed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const r of rows) stmt.run(r.topic_id, r.scope, r.window, r.score, r.rank, now);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }

  finishJob(db, job, { status: "success", read: topics.length, created: rows.length });
  log(`[${JOB_NAME}] success(寫入 ${rows.length} 列 / ${byKey.size} 個 scope×window)`);
} catch (err) {
  finishJob(db, job, { status: "failed", error: String(err && err.message ? err.message : err) });
  log(`[${JOB_NAME}] failed:${err && err.stack ? err.stack : err}`);
  process.exit(1);
}
