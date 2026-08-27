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

/** 依日期新到舊、同日依 question_id 倒序(穩定鍵序)。 */
function newestFirst(list) {
  return list.slice().sort(
    (a, b) => String(b.date).localeCompare(String(a.date)) || String(b.question_id).localeCompare(String(a.question_id))
  );
}

/** 「date <= 今日」的題目 —— 已經輪到過的那些。/questions/ 的近期清單用它。 */
export function pastQuestions(now = new Date()) {
  const today = utcDateStr(now);
  return newestFirst(getQuestions().filter((q) => q.date <= today));
}

/**
 * **整份題庫**,不看日期(2026-08-27 用戶拍板「提前把存量放出來」)。
 *
 * 為什麼可以這樣放:`date` 是**每日一問的排程**,不是內容的發布狀態。
 * 首頁那一題仍然由 questionsForDate() 依日期挑,儀式沒有被動到;
 * 改變的只有「題集看得到多少」。
 * 投票也不會壞 —— sync-questions-to-d1.mjs 本來就把整份題庫推進 D1(沒有日期過濾),
 * Worker 驗得到每一題。
 *
 * ⚠ 逐主題題集(questionsByTopic)吃這一支,`/questions/` 的近期清單仍吃 pastQuestions ——
 *    486 題排成一頁會是十二萬像素高的怪物,題目要靠逐主題頁分流。
 */
export function allQuestions() {
  return newestFirst(getQuestions());
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

// 門檻:**題數**(2026-08-27,第三版;前兩版都量錯了,兩次的錯法記在這裡)。
//
// 第一版「題數 >= 4」:當時題庫只有 26 題已發布,建出七頁、四頁沒過守門的 320 唯一字元。
//   攤開看題數不相關 —— moving-home 2 題 → 334 過、ask-the-world 4 題 → 291 沒過。
//   原因是那時每頁只有兩三題,厚度幾乎全靠**借來的 Topic 摘要**。
//
// 第二版「題目自己的唯一字數 >= 320」:想避開「借母頁摘要」的問題,結果踩到
//   **唯一字數是跟著書寫系統走的**。拉丁字母就那二十幾個,再多題目也堆不出 320 個
//   不同字元:實測 zh-TW / zh-CN / ja 各開 27–28 頁,而 en / hi / id / pt-BR **各只開 1 頁**。
//   ⚠ 這與 country-cells.mjs 檔頭那條「同一個字元門檻對 CJK 天生比較嚴」是同一個坑,
//     只是方向相反。**字元數(不管唯一與否)都不是跨語系可比的量。**
//
// 第三版回到題數,但這次它成立了 —— 因為 2026-08-27「提前把存量放出來」之後,
// 每頁是 4–50 題而不是 2–4 題,厚度由題目主導,母頁摘要不再是主要成分。
// 實測(zh-TW,字元密度最高 = 最壞情況)恰好 4 題的六個頁面:374 / 403 / 429 / 500 / 538 / 551,
// 5 題:402;取 5 是為了在守門的 320 之上留約 80 字餘裕。拉丁語系同題數只會更厚。
//
// 這個門檻不會變成 CI 炸彈:題庫只增不減(generate-questions.mjs 是往檔尾加),
// 所以頁面只會愈來愈厚,不會有哪天突然掉到守門以下。
export const MIN_TOPIC_QUESTIONS = 5;

/** 依 topic_slug 分組的題目(每組內依日期新到舊,與 /questions/ 同一種排序)。 */
export function questionsByTopic() {
  const groups = new Map();
  const seen = new Map(); // topic_slug → Set(正規化後的問句)
  for (const question of allQuestions()) {
    if (!question.topic_slug) continue;
    // 同一個 Topic 底下把重複的問句去掉(2026-08-27)。
    // 題庫是七語各一份,兩題在中文明明不同,翻成英文可能收斂成同一句 —— 實測 en 有 31 頁
    // 撞到守門的 D3「同一段文字在同一頁出現 2 次」,而 zh-TW 完全沒事。
    // 對讀者來說同一頁印兩次一樣的問題本來就是錯的,所以在讀取層去重,不是去改題庫。
    const key = String(question.text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!seen.has(question.topic_slug)) seen.set(question.topic_slug, new Set());
    const bucket = seen.get(question.topic_slug);
    if (key && bucket.has(key)) continue;
    if (key) bucket.add(key);
    if (!groups.has(question.topic_slug)) groups.set(question.topic_slug, []);
    groups.get(question.topic_slug).push(question);
  }
  return groups;
}


/** 撐得起一頁的 topic_slug 清單(排序固定,build 才可重現)。 */
export function questionTopicCells() {
  return [...questionsByTopic().entries()]
    .filter(([, list]) => list.length >= MIN_TOPIC_QUESTIONS)
    .map(([slug]) => slug)
    .sort();
}

// ── 「今天的世界」────────────────────────────────────────────────
// 用既有 topics index + 各 topic facts.json 的 observances[].occurrences(starts_on/ends_on),
// 挑「進行中」或「14 天內開始」的場次,依國家分組,依距今天數排序,最多 8 國、每國最多 3 項。
// 這裡的國家是**內容**裡的國家(節日辦在哪國),與投票的語言社群判定無關,允許出現。