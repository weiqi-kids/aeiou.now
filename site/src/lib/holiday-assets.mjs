// 年度假日頁的機器可讀出口。
// CSV 給資料引用與試算表；ICS 給讀者直接加入行事曆。
// 這裡只接受頁面已經整理好的 rows，保持輸出純函式、可在測試中固定驗證。

const isoDate = (value) => String(value || '').replaceAll('-', '');

function addDays(value, amount) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function rowName(row, locale) {
  return row?.name?.[locale] || row?.name?.en || row?.key || '';
}

function sourceList(row) {
  return Array.isArray(row?.source_urls) ? row.source_urls.filter(Boolean).join(' ') : '';
}

/**
 * Export every listed holiday, including undated local-variant rows.
 * Status/date_status remain stable machine values; the name is localized.
 */
export function holidayCsv({ code, year, locale, rows = [], undated = [] }) {
  const header = ['date', 'end_date', 'name', 'country_code', 'year', 'status', 'date_status', 'source_urls'];
  const dated = rows.map((row) => [
    row.starts_on,
    row.ends_on || '',
    rowName(row, locale),
    String(code).toUpperCase(),
    year,
    row.status || '',
    row.date_status || 'confirmed',
    sourceList(row),
  ]);
  const noDate = undated.map((row) => [
    '',
    '',
    rowName(row, locale),
    String(code).toUpperCase(),
    year,
    row.status || '',
    'local-variant',
    sourceList(row),
  ]);
  return `\ufeff${[header, ...dated, ...noDate].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

function icsText(value) {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll(/\r?\n/g, '\\n');
}

/**
 * Export days off only. Commemorative rows stay in CSV but should not silently
 * become a day off in somebody's personal calendar.
 */
export function holidayIcs({ code, year, countryLabel, locale = 'en', rows = [] }) {
  const upperCode = String(code).toUpperCase();
  const events = rows.filter((row) => row.status !== 'commemorative');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//aeiou.now//Annual holiday calendar//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsText(`${countryLabel || upperCode} ${year}`)}`,
  ];
  for (const row of events) {
    const start = row.starts_on;
    const end = row.ends_on || start;
    const description = [
      `Status: ${row.status || 'unspecified'}`,
      `Date status: ${row.date_status || 'confirmed'}`,
      sourceList(row) ? `Sources: ${sourceList(row)}` : null,
    ].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:holiday-${upperCode.toLowerCase()}-${year}-${row.key}@aeiou.now`,
      `DTSTAMP:${isoDate(start)}T000000Z`,
      `DTSTART;VALUE=DATE:${isoDate(start)}`,
      `DTEND;VALUE=DATE:${isoDate(addDays(end, 1))}`,
      `SUMMARY:${icsText(rowName(row, locale))}`,
      `DESCRIPTION:${icsText(description)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

export function holidayAssetFileName(code, year, extension) {
  return `aeiou-${String(code).toLowerCase()}-${year}-holidays.${extension}`;
}
