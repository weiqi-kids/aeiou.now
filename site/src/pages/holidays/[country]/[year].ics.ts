import { LOCALE } from '../../../lib/config.mjs';
import { countryName } from '../../../lib/data.mjs';
import { t } from '../../../lib/i18n.mjs';
import { withBase } from '../../../lib/paths.mjs';
import { fillTemplate, LOCALE_ORIGINS } from '../../../lib/seo.mjs';
import { holidayCountries, holidayCellsFor, holidaysFor } from '../../../lib/holidays.mjs';
import { holidayAssetFileName, holidayIcs } from '../../../lib/holiday-assets.mjs';

export function getStaticPaths() {
  return holidayCountries().flatMap((code) => holidayCellsFor(code).map((year) => ({
    params: { country: code.toLowerCase(), year },
    props: { code, year },
  })));
}

/** 該年度頁的正式網址(Astro.site = 該站正式網域;裸執行即正確,SITE_URL 只是逃生口)。 */
export function holidayPageUrl(site, code, year) {
  const origin = site || new URL(process.env.SITE_URL || LOCALE_ORIGINS[LOCALE] || LOCALE_ORIGINS['zh-TW']);
  return new URL(withBase(`holidays/${String(code).toLowerCase()}/${year}/`), origin).href;
}

/** 與頁面導言同一句(i18n `holidays.lead`),進 X-WR-CALDESC。 */
export function holidayLead(code, year, rows) {
  const statutory = rows.filter((r) => r.status === 'statutory').length;
  return fillTemplate(t('holidays.lead'), { year, country: countryName(code), statutory: String(statutory) });
}

export function GET({ props, site }) {
  const { code, year } = props;
  const rows = holidaysFor(code, year);
  const body = holidayIcs({
    code,
    year,
    countryLabel: countryName(code),
    locale: LOCALE,
    rows,
    pageUrl: holidayPageUrl(site, code, year),
    calendarDescription: holidayLead(code, year, rows),
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${holidayAssetFileName(code, year, 'ics')}"`,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
