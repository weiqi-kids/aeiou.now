// Topic 正文裡的 `**強調**` 標記。
//
// 事故(2026-08-21 發現):content/topics/*.md 的 summary 與 customs 有 14 個檔用了
// `**…**`,但**前端從來沒有處理過它** —— 42 個頁面上直接印出兩顆星號,
// 其中三頁連 `<meta name="description">` 都帶著星號進了搜尋結果。
//
// 兩種消費端要的東西不一樣,所以分兩支:
//   · `plainText()` —— 給**不能有標記**的地方:meta description、JSON-LD、
//     FAQPage 的答案、行事曆項目的說明。這些地方讀者看到的是純字串,星號只會是雜訊。
//   · `emphasisParts()` —— 給畫面。回傳 `{ text, strong }` 陣列讓呼叫端自己組 `<strong>`,
//     **不回傳 HTML 字串** —— Topic 正文雖然是自己寫的,渲染路徑仍然與 UGC 共用同一條
//     紀律(見 CLAUDE.md「絕不 innerHTML」)。
//
// 只認 `**…**`。不做斜體、不做連結:md 裡沒有用到,而多認一種語法就多一種會漏的情形。

const MARK = /\*\*([^*\n]+)\*\*/g;

/** 去掉強調標記,只留文字。非字串一律回空字串(呼叫端不必先判斷)。 */
export function plainText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(MARK, '$1');
}

/**
 * 切成 `{ text, strong }` 片段。沒有標記時回單一片段,呼叫端不必為兩種情形寫兩條路。
 * @returns {{text: string, strong: boolean}[]}
 */
export function emphasisParts(value) {
  if (typeof value !== 'string' || value === '') return [];
  const parts = [];
  let last = 0;
  let m;
  MARK.lastIndex = 0;
  while ((m = MARK.exec(value)) !== null) {
    if (m.index > last) parts.push({ text: value.slice(last, m.index), strong: false });
    parts.push({ text: m[1], strong: true });
    last = m.index + m[0].length;
  }
  if (last < value.length) parts.push({ text: value.slice(last), strong: false });
  return parts;
}
