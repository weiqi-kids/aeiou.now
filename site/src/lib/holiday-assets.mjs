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

// ── ICS(2026-08-21 用戶核准的三條限制,這裡守第二條)────────────────────────────
// 「日期是估算或地方變體時不出」:把「大概是那天」寫進別人的日曆是替他做我們沒把握的決定。
// CSV **不受此限** —— 它是資料引用,欄位裡就有 date_status 讓引用者自己判斷。
// 紀念日(status=commemorative)也不出:那不是放假日,不該悄悄變成某人日曆上的休假。
export function icsEligible(row) {
  if (!row?.starts_on) return false;                          // 沒有日期的地方變體列
  if (row.status === 'commemorative') return false;
  // discretionary 是混合語意:印尼 cuti bersama / 巴西 ponto facultativo 是全民放,
  // 但印度的 Restricted Holidays(每人每年自選兩天)、台灣警察節、中國婦女節只有特定人放。
  // 後者寫進訂閱者的日曆就是 34 個假的休假日(in.ics 2026 實測)。資料層用 scope='group' 標。
  if (row.scope === 'group') return false;
  const dateStatus = row.date_status || 'confirmed';
  return dateStatus !== 'estimated' && dateStatus !== 'local-variant';
}

// RFC 5545 §3.1:一行不得超過 75 octets,超過就 CRLF + 一個空白續行;按 UTF-8 位元組切,
// 不切在多位元組字元中間(中文 3 bytes、emoji 4 bytes)。X-WR-CALDESC 與帶 Sources 的 DESCRIPTION
// 動輒 140–440 bytes,Apple Calendar 有拒收未折行檔的案例,滾動訂閱檔整國失效的代價太大。
export function foldIcsLine(line) {
  const bytes = Buffer.from(String(line), 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let start = 0;
  let limit = 75;                 // 第一行 75,續行前面多一個空白所以 74
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // 退到 UTF-8 字元邊界(續位元組是 10xxxxxx)
    while (end < bytes.length && (bytes[end] & 0xC0) === 0x80) end -= 1;
    out.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74;
  }
  return out.join('\r\n ');
}

export function holidayEventUid(code, year, key) {
  return `holiday-${String(code).toLowerCase()}-${year}-${key}@aeiou.now`;
}

// 共同的 VCALENDAR 外殼。年度檔與滾動檔只差「幾個年份、日曆叫什麼」,事件本體與 UID
// 都一樣 —— 同一個假日在兩份檔裡是同一個 UID,訂閱者同時裝兩份也不會重複。
//
// ⚠ DTSTAMP 一律用事件起始日,**不是「現在」**:每次 build 位元組要一模一樣,
//    否則「hash 沒變就不動」那整套保護(sitemap-lastmod / publish 的 .page-stamps)會失效。
function buildIcs({ code, calendarName, calendarDescription, locale, sections }) {
  const upperCode = String(code).toUpperCase();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//aeiou.now//Annual holiday calendar//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsText(calendarName)}`,
  ];
  if (calendarDescription) lines.push(`X-WR-CALDESC:${icsText(calendarDescription)}`);
  // 給會讀的訂閱端(Apple Calendar 讀 X-PUBLISHED-TTL,RFC 7986 讀 REFRESH-INTERVAL)一週重抓一次;
  // 資料本來就是每小時 export、逐週才可能有新公告,再密只是白打。
  lines.push('REFRESH-INTERVAL;VALUE=DURATION:P1W', 'X-PUBLISHED-TTL:P1W');
  for (const { year, rows = [], pageUrl } of sections) {
    for (const row of rows.filter(icsEligible)) {
      const start = row.starts_on;
      const end = row.ends_on || start;
      const description = [
        `Status: ${row.status || 'unspecified'}`,
        `Date status: ${row.date_status || 'confirmed'}`,
        // 半天假(巴西聖灰星期三 until-1400、聖誕夜 from-1300):全日事件說不出半天,至少在說明裡講。
        row.partial_day ? `Partial day: ${row.partial_day}` : null,
        sourceList(row) ? `Sources: ${sourceList(row)}` : null,
      ].filter(Boolean).join('\n');
      lines.push(
        'BEGIN:VEVENT',
        `UID:${holidayEventUid(upperCode, year, row.key)}`,
        `DTSTAMP:${isoDate(start)}T000000Z`,
        `DTSTART;VALUE=DATE:${isoDate(start)}`,
        `DTEND;VALUE=DATE:${isoDate(addDays(end, 1))}`,
        `SUMMARY:${icsText(rowName(row, locale))}`,
        `DESCRIPTION:${icsText(description)}`,
      );
      if (pageUrl) lines.push(`URL:${pageUrl}`);   // URI 型別不做 TEXT 逃逸(`,` `;` 前不加反斜線)
      lines.push('END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

/**
 * 年度檔 `/holidays/<cc>/<year>.ics`:一國一年的放假日。
 * `pageUrl` 是那一頁的正式網址(每個 VEVENT 掛 URL:),`calendarDescription` 由呼叫端
 * 用該頁 i18n 的 `holidays.lead` 填好傳進來 —— 這支保持純函式,不讀 i18n。
 */
export function holidayIcs({ code, year, countryLabel, locale = 'en', rows = [], pageUrl = null, calendarDescription = null }) {
  const upperCode = String(code).toUpperCase();
  return buildIcs({
    code,
    locale,
    calendarName: `${countryLabel || upperCode} ${year}`,
    calendarDescription,
    sections: [{ year, rows, pageUrl }],
  });
}

/**
 * 滾動檔 `/holidays/<cc>.ics`:同一國**全部產出年份**合成一份,給 webcal:// 訂閱用
 * (年度檔是下載一次就凍住的;訂閱要的是「新年份公告出來就自動長出來」)。
 * `years` = [{ year, rows, pageUrl }],排除規則與 UID 都與年度檔相同。
 */
export function holidayIcsFeed({ code, countryLabel, locale = 'en', years = [], calendarDescription = null }) {
  const upperCode = String(code).toUpperCase();
  return buildIcs({
    code,
    locale,
    calendarName: countryLabel || upperCode,
    calendarDescription,
    sections: years,
  });
}

export function holidayFeedFileName(code) {
  return `aeiou-${String(code).toLowerCase()}-holidays.ics`;
}

export function holidayAssetFileName(code, year, extension) {
  return `aeiou-${String(code).toLowerCase()}-${year}-holidays.${extension}`;
}
