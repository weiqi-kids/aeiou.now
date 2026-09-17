import test from 'node:test';
import assert from 'node:assert/strict';
import { holidayCsv, holidayIcs, holidayIcsFeed, icsEligible } from '../../site/src/lib/holiday-assets.mjs';

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
  {
    key: 'lunar-guess',
    name: { en: 'Estimated lunar holiday' },
    starts_on: '2027-02-06',
    ends_on: null,
    status: 'statutory',
    date_status: 'estimated',
    source_urls: [],
  },
  {
    key: 'regional',
    name: { en: 'Regional variant with a date' },
    starts_on: '2027-03-03',
    ends_on: null,
    status: 'discretionary',
    date_status: 'local-variant',
    source_urls: [],
  },
];

const countLines = (ics, prefix) => ics.split('\r\n').filter((line) => line.startsWith(prefix)).length;

test('holiday CSV is localized, escaped, includes undated rows and keeps estimated rows', () => {
  const csv = holidayCsv({
    code: 'US',
    year: '2027',
    locale: 'en',
    rows,
    undated: [{ key: 'local', name: { en: 'Local, variant' }, status: 'discretionary', source_urls: [] }],
  });
  assert.match(csv, /^﻿date,end_date,name,country_code,year,status,date_status,source_urls/);
  assert.match(csv, /"New Year, ""official"" day",US,2027,statutory,confirmed/);
  assert.match(csv, /,"Local, variant",US,2027,discretionary,local-variant,/);
  // CSV 是資料引用:估算列照出,欄位裡有 date_status 讓引用者自己判斷
  assert.match(csv, /2027-02-06,,Estimated lunar holiday,US,2027,statutory,estimated,/);
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

test('holiday ICS never writes an estimated or local-variant date into somebody\'s calendar', () => {
  const ics = holidayIcs({ code: 'US', year: '2027', countryLabel: 'United States', locale: 'en', rows });
  assert.doesNotMatch(ics, /Estimated lunar holiday/);
  assert.doesNotMatch(ics, /Regional variant with a date/);
  assert.doesNotMatch(ics, /Date status: estimated/);
  assert.equal(countLines(ics, 'BEGIN:VEVENT'), 1);
  assert.equal(icsEligible(rows[0]), true);
  assert.equal(icsEligible(rows[2]), false);
  assert.equal(icsEligible(rows[3]), false);
  assert.equal(icsEligible({ key: 'undated', status: 'statutory' }), false);
});

test('holiday ICS carries the page URL on every event and subscription hints on the calendar', () => {
  const ics = holidayIcs({
    code: 'US',
    year: '2027',
    countryLabel: 'United States',
    locale: 'en',
    rows,
    pageUrl: 'https://en.aeiou.now/holidays/us/2027/',
    calendarDescription: 'United States has 1 public holidays in 2027.',
  });
  const events = countLines(ics, 'BEGIN:VEVENT');
  assert.ok(events > 0);
  assert.equal(countLines(ics, 'URL:'), events);
  assert.match(ics, /\r\nURL:https:\/\/en\.aeiou\.now\/holidays\/us\/2027\/\r\n/);
  assert.match(ics, /\r\nREFRESH-INTERVAL;VALUE=DURATION:P1W\r\n/);
  assert.match(ics, /\r\nX-PUBLISHED-TTL:P1W\r\n/);
  assert.match(ics, /\r\nX-WR-CALDESC:United States has 1 public holidays in 2027\.\r\n/);
});

test('holiday ICS DTSTAMP comes from the event date, not from the clock', () => {
  const build = () => holidayIcs({ code: 'US', year: '2027', countryLabel: 'United States', locale: 'en', rows });
  const first = build();
  const originalNow = Date.now;
  Date.now = () => originalNow() + 86_400_000 * 400;
  try {
    assert.equal(build(), first);
  } finally {
    Date.now = originalNow;
  }
  assert.match(first, /DTSTAMP:20270101T000000Z/);
  assert.doesNotMatch(first, new RegExp(`DTSTAMP:${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`));
});

test('rolling feed merges years with the same UIDs as the annual files and no duplicates', () => {
  const rows2028 = [
    { ...rows[0], key: 'new-years-day', starts_on: '2028-01-01', ends_on: null },
    { ...rows[2], starts_on: '2028-01-26' },
  ];
  const feed = holidayIcsFeed({
    code: 'US',
    countryLabel: 'United States',
    locale: 'en',
    years: [
      { year: '2027', rows, pageUrl: 'https://en.aeiou.now/holidays/us/2027/' },
      { year: '2028', rows: rows2028, pageUrl: 'https://en.aeiou.now/holidays/us/2028/' },
    ],
    calendarDescription: 'two years',
  });
  assert.match(feed, /\r\nX-WR-CALNAME:United States\r\n/);
  assert.equal(countLines(feed, 'BEGIN:VEVENT'), 2);
  assert.equal(countLines(feed, 'URL:'), 2);
  assert.doesNotMatch(feed, /Estimated lunar holiday/);
  const uids = feed.split('\r\n').filter((line) => line.startsWith('UID:'));
  assert.deepEqual(uids, [
    'UID:holiday-us-2027-new-years-day@aeiou.now',
    'UID:holiday-us-2028-new-years-day@aeiou.now',
  ]);
  assert.equal(new Set(uids).size, uids.length);
  const annual = holidayIcs({ code: 'US', year: '2028', countryLabel: 'United States', locale: 'en', rows: rows2028 });
  assert.match(annual, /UID:holiday-us-2028-new-years-day@aeiou\.now/);
  assert.match(feed, /DTSTART;VALUE=DATE:20280101\r\nDTEND;VALUE=DATE:20280102/);
});
