// 季節距離的純運算:把「今天」與 observance 日期換算成環形距離,
// 用來決定一個 Topic 現在算不算「近期」。無 I/O,可單獨測試。

export const SEASON_DAYS = 7;
export const YEAR_DAYS = 365;

export function doy(mmdd) {
  if (typeof mmdd !== 'string') return null;
  const m = /^(\d{2})-(\d{2})$/.exec(mmdd.trim());
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  return Math.round(Date.UTC(2001, month - 1, day) / 86400000) - Math.round(Date.UTC(2001, 0, 1) / 86400000);
}

export function ringDistance(a, b) {
  const raw = Math.abs(a - b) % YEAR_DAYS;
  return Math.min(raw, YEAR_DAYS - raw);
}

export function inSeason(country, today) {
  const start = doy(country.observed_date);
  if (start === null) return false;
  const end = doy(country.date_range_end);
  if (ringDistance(today, start) <= SEASON_DAYS) return true;
  if (end === null) return false;
  if (ringDistance(today, end) <= SEASON_DAYS) return true;
  const span = (end - start + YEAR_DAYS) % YEAR_DAYS;
  const offset = (today - start + YEAR_DAYS) % YEAR_DAYS;
  return offset <= span;
}

/** 一個國家的日期離今天還有幾天(往前看)。正在當令中 = 0。無法判讀日期 = null。
 * 「近期」看的是**還有多久到**,不是絕對差距——剛過去的節日已經退燒,要到的才是話題。
 * 只有還在 SEASON_DAYS 緩衝內的才算仍然當令(inSeason 已含這個判斷)。 */
export function seasonDistance(country, today) {
  const start = doy(country.observed_date);
  if (start === null) return null;
  if (inSeason(country, today)) return 0;
  const end = doy(country.date_range_end);
  const forward = (d) => (d - today + YEAR_DAYS) % YEAR_DAYS;
  return end === null ? forward(start) : Math.min(forward(start), forward(end));
}