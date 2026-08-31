// occurrence 的日期選擇與輸出契約。
// `distance_days` 只供匯出時排序，不能寫進 facts.json：它會隨每天的「今天」改變，
// 卻不代表讀者看見的內容改變，會造成內容 hash、建置與 sitemap lastmod 一起漂移。

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
const parseJson = (value, fallback) => {
  if (value == null) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
};

/**
 * 從地方時區挑下一筆 occurrence。
 *
 * 排序需要距離，但輸出的 occurrence 刻意不帶距離；前端若需要排序，
 * 應在 render 時以同一個 timezone 重新計算，而不是把相對時間持久化。
 */
export function nextOccurrence(rows, sourceUrlById = new Map(), now = new Date()) {
  const candidates = [];
  for (const row of rows || []) {
    const today = isoDateParts(now, row.timezone);
    const active = row.ends_on
      ? today >= row.starts_on && today <= row.ends_on
      : today === row.starts_on;
    const future = row.starts_on > today;
    if (!active && !future) continue;

    const sourceIds = parseJson(row.source_ids_json, []);
    candidates.push({
      occurrence: {
        occurrence_id: row.occurrence_id,
        occurrence_year: row.occurrence_year,
        starts_on: row.starts_on,
        ends_on: row.ends_on,
        calendar_system: row.calendar_system,
        timezone: row.timezone,
        date_status: row.date_status,
        source_ids: sourceIds,
        source_urls: sourceIds.map((id) => sourceUrlById.get(id)).filter(Boolean),
      },
      distanceDays: active ? 0 : utcDay(row.starts_on) - utcDay(today),
    });
  }

  return candidates.sort((a, b) =>
    a.distanceDays - b.distanceDays
      || a.occurrence.starts_on.localeCompare(b.occurrence.starts_on)
      || a.occurrence.occurrence_id.localeCompare(b.occurrence.occurrence_id)
  )[0]?.occurrence || null;
}
