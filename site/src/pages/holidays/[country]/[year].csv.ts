import { LOCALE } from '../../../lib/config.mjs';
import { holidayCountries, holidayCellsFor, holidaysFor, undatedFor } from '../../../lib/holidays.mjs';
import { holidayAssetFileName, holidayCsv } from '../../../lib/holiday-assets.mjs';

export function getStaticPaths() {
  return holidayCountries().flatMap((code) => holidayCellsFor(code).map((year) => ({
    params: { country: code.toLowerCase(), year },
    props: { code, year },
  })));
}

export function GET({ props }) {
  const { code, year } = props;
  const body = holidayCsv({
    code,
    year,
    locale: LOCALE,
    rows: holidaysFor(code, year),
    undated: undatedFor(code, year),
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${holidayAssetFileName(code, year, 'csv')}"`,
      'Cache-Control': 'public, max-age=86400',
    },
  });
}
