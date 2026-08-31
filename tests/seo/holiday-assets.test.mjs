import test from 'node:test';
import assert from 'node:assert/strict';
import { holidayCsv, holidayIcs } from '../../site/src/lib/holiday-assets.mjs';

const rows = [
  {
    key: 'new-years-day',
    name: { en: 'New Year, "official" day' },
    starts_on: '2027-01-01',
    ends_on: '2027-01-02',
    status: 'statutory',
    date_status: 'confirmed',
    source_urls: ['https://example.test/notice'],
  },
  {
    key: 'note',
    name: { en: 'A commemorative note' },
    starts_on: '2027-05-01',
    ends_on: null,
    status: 'commemorative',
    date_status: 'estimated',
    source_urls: [],
  },
];

test('holiday CSV is localized, escaped, and includes undated rows', () => {
  const csv = holidayCsv({
    code: 'US',
    year: '2027',
    locale: 'en',
    rows,
    undated: [{ key: 'local', name: { en: 'Local, variant' }, status: 'discretionary', source_urls: [] }],
  });
  assert.match(csv, /^\ufeffdate,end_date,name,country_code,year,status,date_status,source_urls/);
  assert.match(csv, /"New Year, ""official"" day",US,2027,statutory,confirmed/);
  assert.match(csv, /,"Local, variant",US,2027,discretionary,local-variant,/);
});

test('holiday ICS has exclusive end dates and excludes commemorative rows', () => {
  const ics = holidayIcs({ code: 'US', year: '2027', countryLabel: 'United States', locale: 'en', rows });
  assert.match(ics, /X-WR-CALNAME:United States 2027/);
  assert.match(ics, /DTSTART;VALUE=DATE:20270101/);
  assert.match(ics, /DTEND;VALUE=DATE:20270103/);
  assert.match(ics, /SUMMARY:New Year\\, "official" day/);
  assert.doesNotMatch(ics, /A commemorative note/);
  assert.match(ics, /Date status: confirmed/);
});
