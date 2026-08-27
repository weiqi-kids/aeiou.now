// 每日世界一問的讀取層。規格見 docs/briefs/daily-question.md。
// 題庫用完不開天窗 —— 前端退回最近一題,由 latestOfKind 負責。

import { LOCALE } from './config.mjs';
import { readJson } from './data-source.mjs';

export function getQuestions() {
  const data = readJson(`questions/${LOCALE}.json`, null);
  return (data && Array.isArray(data.questions) && data.questions) || [];
}

function utcDateStr(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

/** 某 kind 的「date <= 今日」中最新一筆:今天沒有就退到最近一題,不開天窗。 */
function latestOfKind(questions, kind, today) {
  return questions
    .filter((q) => q.kind === kind && q.date <= today)
    .reduce((best, q) => {
      if (!best) return q;
      if (q.date !== best.date) return q.date > best.date ? q : best;
      return String(q.question_id) > String(best.question_id) ? q : best;
    }, null);
}

/** 首頁要的 { poll, guess }:各自獨立取「今天(含以前)最新一筆」該 kind,題庫空(或該 kind
 * 沒有任何一筆 date<=今日)則該欄位回 null,呼叫端(index.astro)據此整塊不渲染。 */
export function questionsForDate(now = new Date()) {
  const today = utcDateStr(now);
  const questions = getQuestions();
  return {
    poll: latestOfKind(questions, 'poll', today),
    guess: latestOfKind(questions, 'guess', today),
  };
}

/** /questions/ 題庫頁:全部「date <= 今日」的題目,依日期新到舊、同日依 question_id 倒序(穩定鍵序)。 */
export function pastQuestions(now = new Date()) {
  const today = utcDateStr(now);
  return getQuestions()
    .filter((q) => q.date <= today)
    .sort(
      (a, b) => String(b.date).localeCompare(String(a.date)) || String(b.question_id).localeCompare(String(a.question_id))
    );
}

// ── 逐主題題集 /questions/<topic-slug>/(2026-08-27)────────────────
// 為什麼開這一塊:486 題 × 七語系,全部只掛在 /questions/ **一個** URL 上,
// 而 379 個自動生成的逐國頁各有一個。題目是站上唯一 Google 不會用答案框吃掉的內容
// (「日本人真的每天泡澡嗎」沒有標準答案框),卻連一個可索引的位置都沒有。
//
// 🔴 **不是一題一頁**。486 × 7 = 3,402 個薄頁會重演逐國頁那次
// (全站 186 頁 Discovered - currently not indexed)。改成一個 Topic 一頁:
// 中位數 5 題、最多 50 題,每題自帶問句與三到五個選項,厚度來自題數不是灌水。
//
// 判準只有一份(getStaticPaths、sitemap、Topic 頁的入口三處都吃這一支)——
// 逐國頁那次的教訓是判準有兩份就會漂,sitemap 於是指向 404。

// 門檻:**這一頁自己的內容量**,不是題數(2026-08-27 實測)。
//
// 第一版寫成「題數 >= 4」,建出來的七頁裡四頁沒過 check-rendered-depth 的 320 唯一字元。
// 攤開來看才發現題數根本不相關:
//     moving-home        2 題 → 渲染後 334 ✅        ask-the-world  4 題 → 291 ❌
//     back-to-school     2 題 → 343 ✅              mid-autumn     2 題 → 286 ❌
// 決定厚度的是**借來的 Topic 摘要**長短,不是題目 —— 也就是說,靠題數開頁會開出一批
// 內容主要來自母頁的近似重複頁,正是逐國頁那次的坑(全站 186 頁 Discovered - not indexed)。
//
// 所以改成量「題目自己的唯一字數」,而且門檻直接取守門的 320:
// 這樣不管頁面外框借到多少字,**產出的頁一定過得了守門**,不會變成幾週後才引爆的 CI 炸彈。
//
// ⚠ 今天這個門檻會產出 **0 頁**,那是正確行為不是壞掉:
//    題庫 486 題裡只有 26 題已發布(2026-08-15 起一天兩題,排到 2027-04-14),
//    每題可見字數中位 38 —— 單一 Topic 要累積到 320 唯一字元還早。
//    這一支不必再改,題目累積到了頁面就會自己長出來。
//    查:`node -e "..."` 見 docs/briefs/new-territory.md §C 的「什麼時候會開始長」。
export const MIN_TOPIC_QUESTION_TEXT = 320;

/** 依 topic_slug 分組的題目(每組內依日期新到舊,與 /questions/ 同一種排序)。 */
export function questionsByTopic(now = new Date()) {
  const groups = new Map();
  for (const question of pastQuestions(now)) {
    if (!question.topic_slug) continue;
    if (!groups.has(question.topic_slug)) groups.set(question.topic_slug, []);
    groups.get(question.topic_slug).push(question);
  }
  return groups;
}

/** 這一組題目自己的唯一字數(問句 + 選項標籤;不含任何從母頁借來的文字)。 */
export function questionTextWeight(questions) {
  const text = (questions || [])
    .map((q) => `${q.text || ''}${(q.options || []).map((o) => o.label || '').join('')}`)
    .join('')
    .replace(/\s+/g, '');
  return new Set(text).size;
}

/** 撐得起一頁的 topic_slug 清單(排序固定,build 才可重現)。 */
export function questionTopicCells(now = new Date()) {
  return [...questionsByTopic(now).entries()]
    .filter(([, list]) => questionTextWeight(list) >= MIN_TOPIC_QUESTION_TEXT)
    .map(([slug]) => slug)
    .sort();
}

// ── 「今天的世界」────────────────────────────────────────────────
// 用既有 topics index + 各 topic facts.json 的 observances[].occurrences(starts_on/ends_on),
// 挑「進行中」或「14 天內開始」的場次,依國家分組,依距今天數排序,最多 8 國、每國最多 3 項。
// 這裡的國家是**內容**裡的國家(節日辦在哪國),與投票的語言社群判定無關,允許出現。