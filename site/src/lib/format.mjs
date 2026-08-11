// 顯示層格式化(純函式,不碰檔案)。
import { LOCALE } from './config.mjs';

// facts.json 的 observed_date 是不帶年份的 "MM-DD"。直接印 "02-14" 對讀者不友善,
// 也讓「日本 2/14、巴西 6/12」這個對比不夠明顯,所以用 Intl 轉成該 locale 的月日寫法。
// 用固定的非閏年(2001)只是為了餵 Date,年份不會被輸出;任何解析失敗一律退回原字串。
export function monthDay(mmdd) {
  if (typeof mmdd !== 'string') return '';
  const m = /^(\d{2})-(\d{2})$/.exec(mmdd.trim());
  if (!m) return mmdd;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return mmdd;
  try {
    return new Intl.DateTimeFormat(LOCALE, { month: 'long', day: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(2001, month - 1, day)));
  } catch {
    return mmdd;
  }
}

// 活動時間。兩個刻意的選擇:
// 1. 時區固定 UTC —— 不指定的話會吃 build 機器的 TZ,主機與 GitHub Actions 若不同,
//    同一筆資料會 build 出不同字串,製造沒必要的 diff(export 那層的 hash 防空寫也救不了顯示層)。
// 2. 落在整點午夜的時間戳視為「整日活動」,只印日期不印時間 —— 否則整日活動會顯示
//    「凌晨 12:00」,那是雜訊不是資訊。有真正時間的活動照常印時間。
export function dateTime(epochSec) {
  const d = new Date(epochSec * 1000);
  const allDay = d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
  try {
    return new Intl.DateTimeFormat(LOCALE, {
      dateStyle: 'medium',
      ...(allDay ? {} : { timeStyle: 'short' }),
      timeZone: 'UTC',
    }).format(d);
  } catch {
    return d.toISOString();
  }
}
