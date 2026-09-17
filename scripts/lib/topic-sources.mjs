// content/topics/*.md 的 `- source:` 那一行怎麼讀(2026-09-17 加 retired 語法)。
//
//   - source: https://example.gov/page                 ← 活的來源(預設)
//   - source: https://example.gov/page retired=2026-09-17 ← 已退役:頁面不在了,但內文引用它的
//                                                         事實仍然成立,不想因為一條 404 就重寫內容
//
// 退役來源:仍寫進 sources 表(status='retired')與 observance 的 source_ids_json(它是出處,
// 出處消失是事實不是要抹掉的東西),但 **不進 data/ 的 source_urls**(頁面不印、check-source-urls
// 不驗),改進 retired_source_urls。每個 observance 仍要**至少一個活的來源** —— 匯入會擋。
//
// 緣由:2026-09-03 五個 404 讓 CI 的來源存活檢查連紅 14 天、七站凍結;其中兩個是用戶明示
// 「內文保留」的 procon.df 來源。「內文保留」與「不要印死連結」需要同時成立,這就是那個語法。
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 回 { url, retired }(retired 是 YYYY-MM-DD 或 null)。格式不對就 throw,讓匯入器逐檔報錯。 */
export function parseSourceLine(value) {
  const tokens = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  const url = tokens.shift() || "";
  if (!/^https?:\/\//.test(url)) throw new Error(`source 必須是 http(s) 網址:「${value}」`);
  let retired = null;
  for (const token of tokens) {
    const m = token.match(/^([a-z_]+)=(.*)$/);
    if (!m) throw new Error(`source 網址後面只准 key=value 旗標,看不懂「${token}」(目前只有 retired=YYYY-MM-DD)`);
    if (m[1] !== "retired") throw new Error(`source 不認識的旗標「${m[1]}」(目前只有 retired=YYYY-MM-DD)`);
    if (!DATE_RE.test(m[2]) || Number.isNaN(Date.parse(`${m[2]}T00:00:00Z`))) {
      throw new Error(`retired 要是 YYYY-MM-DD:「${m[2]}」`);
    }
    retired = m[2];
  }
  return { url, retired };
}
