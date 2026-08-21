// 「加入行事曆」的兩個出口:Google 日曆的 TEMPLATE 網址,與一份 .ics 的 data: URI。
//
// 兩個都是**純字串組裝**,不打任何 API —— 與導航連結同一條紅線(CLAUDE.md:絕不呼叫
// Google Places API、導航一律純字串組裝)。也因此不需要任何金鑰,不會有配額,
// 而且靜態頁面就能出貨:不靠 JS、不靠 Worker,關掉 JS 也點得動。
//
// 全日事件的 DTEND 是**排他**的(iCalendar RFC 5545 §3.8.2.2 與 Google 的 dates= 都是),
// 所以單日事件要寫成 20260214/20260215。少加這一天的話,Google 會把它畫成「前一天結束」,
// 讀者的日曆上就少一天 —— 那是靜默的錯,畫面上完全看不出來。

/** YYYY-MM-DD → YYYYMMDD;不是那個形狀就回 null(不猜、不補) */
function compact(iso) {
  if (typeof iso !== 'string') return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}${m[2]}${m[3]}` : null;
}

/** YYYY-MM-DD + n 天 → YYYYMMDD。用 UTC 算,主機與 CI 的 TZ 差異才不會 build 出不同字串。 */
function compactPlusDays(iso, days) {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return compact(new Date(ms + days * 86400000).toISOString().slice(0, 10));
}

/** epoch 秒 → YYYYMMDDTHHMMSSZ(有時刻的活動用) */
function stamp(epochSec) {
  if (typeof epochSec !== 'number' || !Number.isFinite(epochSec)) return null;
  return new Date(epochSec * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * 一個行事曆項目。
 * @param {{title:string, details?:string, location?:string,
 *          startDate?:string, endDate?:string,      // 全日:YYYY-MM-DD
 *          startAt?:number, endAt?:number,          // 有時刻:epoch 秒
 *          uid:string, url?:string}} ev
 * @returns {{google:string, ics:string}|null} 沒有可用的時間就回 null —— 沒有日期的
 *   行事曆項目是沒有意義的,寧可不出現那個按鈕,也不要送一個讀者要自己補日期的空殼。
 */
export function calendarLinks(ev) {
  const title = String(ev.title || '').trim();
  if (!title) return null;

  let dates = null;      // Google 的 dates= 參數
  let dtStart = null;    // ICS 的 DTSTART 行(含屬性)
  let dtEnd = null;
  if (ev.startDate) {
    const s = compact(ev.startDate);
    // 全日:DTEND 排他。有結束日就是那一天的隔天,沒有就是起始日的隔天。
    const e = ev.endDate ? compactPlusDays(ev.endDate, 1) : compactPlusDays(ev.startDate, 1);
    if (!s || !e) return null;
    dates = `${s}/${e}`;
    dtStart = `DTSTART;VALUE=DATE:${s}`;
    dtEnd = `DTEND;VALUE=DATE:${e}`;
  } else if (typeof ev.startAt === 'number') {
    const s = stamp(ev.startAt);
    // 沒有結束時刻就給一小時 —— 零長度的事件在部分日曆會被吃掉。
    const e = stamp(typeof ev.endAt === 'number' ? ev.endAt : ev.startAt + 3600);
    if (!s || !e) return null;
    dates = `${s}/${e}`;
    dtStart = `DTSTART:${s}`;
    dtEnd = `DTEND:${e}`;
  } else {
    return null;
  }

  // 說明**一定要截斷**。第一版直接把逐國散文整段塞進去,一個國家的 Google 網址就 2KB,
  // 一頁七國 × 兩個連結 = 每頁多出約 30KB 的 HTML,而那些字在頁面上本來就看得到。
  // 行事曆項目要的是日期與一條回得來的連結,不是全文。
  const MAX_DETAILS = 180;
  const raw = String(ev.details || '').trim().replace(/\s+/g, ' ');
  const details = raw.length > MAX_DETAILS ? `${raw.slice(0, MAX_DETAILS - 1)}…` : raw;
  const location = String(ev.location || '').trim();

  const q = new URLSearchParams({ action: 'TEMPLATE', text: title, dates });
  if (details) q.set('details', ev.url ? `${details}\n${ev.url}` : details);
  else if (ev.url) q.set('details', ev.url);
  if (location) q.set('location', location);
  const google = `https://calendar.google.com/calendar/render?${q.toString()}`;

  // ICS 的跳脫:逗號、分號、反斜線要跳,換行寫成 \n(RFC 5545 §3.3.11)。
  const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//aeiou.now//topic//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${esc(ev.uid)}@aeiou.now`,
    // DTSTAMP 刻意用起始時間而不是「現在」:build 出來的 HTML 必須是決定論的,
    // 否則每次 build 都會產生不同的位元組,export/CI 那一整套「hash 沒變就不動」的
    // 保護會全部失效(每小時七站重建,只為了一個時間戳)。
    `DTSTAMP:${dtStart.includes('VALUE=DATE') ? `${dtStart.split(':')[1]}T000000Z` : dtStart.split(':')[1]}`,
    dtStart,
    dtEnd,
    `SUMMARY:${esc(title)}`,
  ];
  if (details) lines.push(`DESCRIPTION:${esc(ev.url ? `${details}\n${ev.url}` : details)}`);
  else if (ev.url) lines.push(`DESCRIPTION:${esc(ev.url)}`);
  if (location) lines.push(`LOCATION:${esc(location)}`);
  if (ev.url) lines.push(`URL:${esc(ev.url)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');

  // \r\n 是 RFC 要求的折行符,不是可選的風格。
  const ics = `data:text/calendar;charset=utf-8,${encodeURIComponent(lines.join('\r\n'))}`;
  return { google, ics };
}

/** 檔名:讀者存下來之後在下載夾裡要認得出是什麼。非 ASCII 一律換成 '-'。 */
export function icsFileName(slug, suffix) {
  const safe = String(slug || 'topic').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe || 'topic'}${suffix ? `-${suffix}` : ''}.ics`;
}
