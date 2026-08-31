// render 時才計算 occurrence 距離；相對於今天的數字不應進入 data/ 的內容 hash。

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
  const today = isoDateParts(now, occurrence.timezone);
  const active = occurrence.ends_on
    ? today >= occurrence.starts_on && today <= occurrence.ends_on
    : today === occurrence.starts_on;
  return active ? 0 : utcDay(occurrence.starts_on) - utcDay(today);
}
