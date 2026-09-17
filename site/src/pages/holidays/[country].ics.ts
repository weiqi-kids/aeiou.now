// 滾動檔 `/holidays/<cc>.ics`:一國全部產出年份合成一份,給 webcal:// 訂閱。
// 年度檔下載一次就凍住;訂閱檔每週被行事曆軟體重抓,新年份公告出來就自動長出來。
// 排除規則、UID 與年度檔完全相同(同一個假日在兩份檔裡是同一個 UID)。
import { LOCALE } from '../../lib/config.mjs';
import { countryName } from '../../lib/data.mjs';
import { holidayCountries, holidayCellsFor, holidaysFor } from '../../lib/holidays.mjs';
import { holidayFeedFileName, holidayIcsFeed } from '../../lib/holiday-assets.mjs';
import { holidayLead, holidayPageUrl } from './[country]/[year].ics.ts';

export function getStaticPaths() {
  // 一個年份都撐不起來的國家連滾動檔也不產:空日曆對訂閱者是噪音,對我們是另一種死連結。
  return holidayCountries()
    .filter((code) => holidayCellsFor(code).length > 0)
    .map((code) => ({ params: { country: code.toLowerCase() }, props: { code } }));
}

export function GET({ props, site }) {
  const { code } = props;
  const years = holidayCellsFor(code).map((year) => {
    const rows = holidaysFor(code, year);
    return { year, rows, pageUrl: holidayPageUrl(site, code, year), lead: holidayLead(code, year, rows) };
  });
  const body = holidayIcsFeed({
    code,
    countryLabel: countryName(code),
    locale: LOCALE,
    years,
    calendarDescription: years.map((y) => y.lead).join(' '),
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${holidayFeedFileName(code)}"`,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
