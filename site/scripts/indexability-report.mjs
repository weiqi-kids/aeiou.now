#!/usr/bin/env node
// 逐國頁收錄判準的 dry-run 報表(唯讀,不改任何檔)。cwd 一律 site/(讀 src/data)。
// 用法:node scripts/indexability-report.mjs [--list <locale>]
// 印出:七站各自「產出的逐國頁 / 可收錄 / noindex」與 noindex 原因分佈。
// 調 indexability.mjs 的門檻之前先跑這支看前後數字。
import { LOCALES } from '../src/lib/config.mjs';
import { listTopicIds, getTopicBundle } from '../src/lib/data.mjs';
import {
  countryPageIndexability, cellQuality, allCellCodes,
} from '../src/lib/indexability.mjs';

const args = process.argv.slice(2);
const listLocale = args.includes('--list') ? args[args.indexOf('--list') + 1] : null;

const totals = {};
const listed = [];
for (const id of listTopicIds()) {
  const { facts, i18n } = getTopicBundle(id);
  if (!facts?.slug) continue;
  for (const code of allCellCodes(facts)) {
    for (const locale of LOCALES) {
      const r = countryPageIndexability(facts, i18n, code, locale);
      const t = (totals[locale] ||= { exists: 0, indexable: 0, noindex: 0, reasons: {} });
      if (r.reason === 'missing') continue;
      t.exists += 1;
      t.reasons[r.reason] = (t.reasons[r.reason] || 0) + 1;
      if (r.indexable) t.indexable += 1; else t.noindex += 1;
      if (listLocale === locale && !r.indexable) {
        const q = cellQuality(facts, i18n, code);
        listed.push(`${facts.slug}/${code.toLowerCase()}  chars=${q.chars} sim=${q.similarity} ${q.reasons.join(',')}`);
      }
    }
  }
}
for (const locale of LOCALES) {
  const t = totals[locale] || { exists: 0, indexable: 0, noindex: 0, reasons: {} };
  console.log(`${locale.padEnd(6)} 逐國頁 ${t.exists} → 可收錄 ${t.indexable}(noindex ${t.noindex})  ${JSON.stringify(t.reasons)}`);
}
if (listLocale) console.log(listed.join('\n'));
