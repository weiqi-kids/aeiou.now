// render 時才計算 occurrence 距離；相對於今天的數字不應進入 data/ 的內容 hash。
//
// ⚠ 「今天」一律用 UTC 判，不用 occurrence 自己的時區（2026-09-18 修）。
// 原本 occurrenceDistance() 拿 occurrence.timezone 算今天，於是同一天、不同國家的
// observance（例如 12-25 的 IN/BR/JP/US）之間的距離會隨 UTC 時鐘一天翻轉好幾次：
// 16:00Z 時日本已是隔天、距離少一天，美國還是今天 —— 兩者順序互換，
// 而 [slug].astro 的 starts_on tie-break 只在距離**相等**時才生效，正好擋不到這一種。
// 後果是 Topic 主頁的 HTML 指紋每小時都在變，sitemap 每輪對 Google 宣告一次改版：
// 2026-09-18 實測 aeiou.now 的 544 個 URL 裡有 15 個 Topic 主頁標成當天，
// 全部是同日多國的 Topic（christmas / easter / halloween / ramadan-and-eid / womens-day…）。
// 這是 CLAUDE.md 紅線「這一頁自己的內容變了才算變」的第三個入口
// （第一個是 RENDER_AT，第二個是導覽列的 24h 排行捷徑）。
// 鎖成 UTC 之後，所有 observance 共用同一個「今天」，distance 變成 starts_on 的單調位移，
// 排序在一個 UTC 日內完全固定；只有跨 UTC 午夜、或某一筆進入／離開進行中區間時才會變。
// 同一條理由也寫在 CLAUDE.md 的「活動時間鎖 timeZone: 'UTC'」。

const isoDateParts = (date, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
};

const utcDay = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86400000;

/** 回傳 occurrence 距離今天幾天；進行中的日期回傳 0。資料不完整時回傳 null。 */
export function occurrenceDistance(occurrence, now = new Date()) {
  if (!occurrence?.starts_on || !occurrence?.timezone) return null;
  const today = isoDateParts(now, 'UTC');
  const active = occurrence.ends_on
    ? today >= occurrence.starts_on && today <= occurrence.ends_on
    : today === occurrence.starts_on;
  return active ? 0 : utcDay(occurrence.starts_on) - utcDay(today);
}
