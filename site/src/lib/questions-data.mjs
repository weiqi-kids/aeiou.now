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

// ── 「今天的世界」────────────────────────────────────────────────
// 用既有 topics index + 各 topic facts.json 的 observances[].occurrences(starts_on/ends_on),
// 挑「進行中」或「14 天內開始」的場次,依國家分組,依距今天數排序,最多 8 國、每國最多 3 項。
// 這裡的國家是**內容**裡的國家(節日辦在哪國),與投票的語言社群判定無關,允許出現。