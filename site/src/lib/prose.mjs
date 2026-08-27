// 版面用的斷句/分段(呈現層,不動內容本身)。
//
// 為什麼獨立一支:同一組「句末標點」規則已經有三個地方要用(清單導語 summaryLead、
// description 的 withLeadDate、長段落分段),而規則本身有坑 —— 拉丁語系的 `U.S.`、
// `Lei nº 6.791` 裡都有句點,印地文的句號是 `।`。規則只該有一份。

/**
 * 句末標點切句。CJK/天城文的句號自己就是句尾,直接切;拉丁句點要**兩個**條件:
 * 後面跟空白(避開 `U.S.`、`9.093/1995` 這種),而且**下一句要以大寫開頭**。
 *
 * 第二個條件是 2026-08-27 補的:pt-BR 的假日制度說明裡有
 * 「…mas o art. 2º da Lei nº 9.093/1995…」,`art.` 後面確實有空白,只按第一個條件
 * 就會把一句話從中間剖開,分段之後畫面上真的印出「…mas o art.」自成一段。
 * 縮寫後面接的多半是數字或小寫字(art. 2º / nº 6.791 / etc. and),
 * 真正的句子開頭則是大寫或引號,拿這個當判準才擋得住。
 */
export function splitSentences(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return [];
  return value
    .split(/(?<=[。！？!?।])|(?<=[.!?])(?=\s+["'“«(\[]*\p{Lu})/gu)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * 把一段長文重新分成幾段 —— **只改斷行,不改一個字**。
 *
 * 為什麼要有這支(2026-08-27):假日總表的「這一國的假日是誰決定的」在 zh-TW 是
 * 396 個字擠成一個 <p>,整幅寬跑滿六行,讀者第一眼看到的就是一面字牆;
 * 這正是「文字過多、又沒有適當排版」的樣子。分段不需要改寫文案(文案是用戶的),
 * 只要在句子邊界換氣。
 *
 * `maxChars` 是一段的字數上限:累積超過就在**目前這一句結束後**斷開,所以句子永遠
 * 不會被切一半。單句本身就超過上限時自成一段(不硬切)。
 */
export function paragraphs(text, { maxChars = 130 } = {}) {
  const parts = splitSentences(text);
  if (parts.length === 0) return [];
  const out = [];
  let buf = '';
  for (const part of parts) {
    // 拉丁語系句子之間要留空白,CJK 不留 —— 用「這一句是不是以 ASCII 字母/數字結尾」判斷。
    const glue = buf && /[A-Za-z0-9)\]"']$/.test(buf) ? ' ' : '';
    const next = buf ? buf + glue + part : part;
    if (buf && next.length > maxChars) {
      out.push(buf);
      buf = part;
    } else {
      buf = next;
    }
  }
  if (buf) out.push(buf);
  return out;
}
