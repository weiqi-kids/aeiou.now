import { LOCALE } from '../../../lib/config.mjs';
import { countryName } from '../../../lib/data.mjs';
import { holidayCountries, holidayCellsFor, holidaysFor } from '../../../lib/holidays.mjs';
import { holidayAssetFileName, holidayIcs } from '../../../lib/holiday-assets.mjs';

export function getStaticPaths() {
  return holidayCountries().flatMap((code) => holidayCellsFor(code).map((year) => ({
    params: { country: code.toLowerCase(), year },
    props: { code, year },
  })));
}

export function GET({ props }) {
  const { code, year } = props;
  const body = holidayIcs({
    code,
    year,
    countryLabel: countryName(code),
    locale: LOCALE,
    rows: holidaysFor(code, year),
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${holidayAssetFileName(code, year, 'ics')}"`,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
