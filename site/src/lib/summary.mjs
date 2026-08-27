// 清單頁只需要一句能讓人決定要不要點進去的導語。
// Topic 的完整摘要仍留在主題頁與 FAQ 資料裡；首頁不把編輯說明、比較方法和結論
// 全部塞進每一列，避免每張卡都讀起來像同一個生成模板。
// 斷句規則只有一份(拉丁 `U.S.`／小數點、天城文 `।` 的坑寫在那支的註解裡)。
import { splitSentences as sentences } from './prose.mjs';

const EDITORIAL_SENTENCE_MARKERS = [
  '這一頁',
  'This page',
  'This guide',
  'このページ',
  '这页',
  'यह पृष्ठ',
  'Halaman ini',
  'Esta página',
];

/** Return the shortest useful, fact-first teaser for a topic list. */
export function summaryLead(text) {
  const parts = sentences(text);
  if (parts.length === 0) return '';

  const useful = parts.filter((part) => (
    !EDITORIAL_SENTENCE_MARKERS.some((marker) => part.includes(marker))
  ));
  if (useful.length === 0) return '';
  const lead = useful[0];

  // Very short question-style summaries benefit from one follow-up fact, but never
  // from the generic “this page compares…” sentence that follows them in old content.
  if (lead.length < 42 && useful[1]) return `${lead} ${useful[1]}`.trim();
  return lead.trim();
}
