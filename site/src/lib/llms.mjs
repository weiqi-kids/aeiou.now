// /llms.txt 與 /llms-full.txt 的內容(2026-10-10)。
// 頁面清單跟 sitemap.xml.ts 吃同一批判準(listTopicIds / countryCellsFor / holidayCellsFor /
// questionTopicCells),所以這裡列出的網址都真的有產出,不會指向 404。
// 文字一律取本站語系的既有資料(Topic 的 i18n、i18n/<LOCALE>.json、SITE_DESCRIPTIONS),
// 這支不自己寫文案。
import { LOCALE, WINDOWS } from './config.mjs';
import { t } from './i18n.mjs';
import { SITE_NAME, SITE_DESCRIPTIONS, SEO_COPY } from './seo.mjs';
import { getGlobalRanking, getTopicBundle, listTopicIds, countryName } from './data.mjs';
import { countryCellsFor } from './country-cells.mjs';
import { questionTopicCells } from './questions-data.mjs';
import { holidayCountries, holidayCellsFor } from './holidays.mjs';
import { summaryLead } from './summary.mjs';
import { plainText } from './emphasis.mjs';
import { withBase } from './paths.mjs';

const oneLine = (value) => plainText(value || '').replace(/\s+/g, ' ').trim();

function topics() {
  return listTopicIds()
    .map((topicId) => {
      const { facts, i18n } = getTopicBundle(topicId);
      if (!facts?.slug) return null;
      const loc = i18n?.locales?.[LOCALE] || {};
      return {
        facts,
        i18n,
        slug: facts.slug,
        title: oneLine(loc.title || facts.canonical_name || topicId),
        summary: oneLine(loc.summary || facts.commonality || ''),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export function buildLlms(site, { full = false } = {}) {
  const origin = site || new URL(process.env.SITE_URL || 'https://weiqi-kids.github.io');
  const url = (path) => new URL(withBase(path), origin).toString();
  const copy = SEO_COPY[LOCALE] || SEO_COPY.en;
  const out = [];

  out.push(`# ${SITE_NAME}`, '', `> ${SITE_DESCRIPTIONS[LOCALE] || SITE_DESCRIPTIONS.en}`, '');
  out.push(oneLine(t('about.one_liner')), '');

  out.push(`## ${t('nav.label')}`, '');
  out.push(`- [${t('nav.home')}](${url('')})`);
  out.push(`- [${t('nav.hot_topics')}](${url('topics/today/')})`);
  out.push(`- [${t('nav.nearby')}](${url('topics/nearby/')})`);
  out.push(`- [${t('nav.events')}](${url('topics/events/')})`);
  for (const window of WINDOWS) {
    const ranking = getGlobalRanking(window);
    if (!ranking || ranking.thin) continue;
    out.push(`- [${t('rankings.title')} ${t(`rankings.window.${window}`)}](${url(`rankings/${window}/`)})`);
  }
  out.push(`- [${t('q.archive_title')}](${url('questions/')})`);
  out.push(`- [${t('nav.about')}](${url('about/')})`);
  out.push(`- [sitemap.xml](${url('sitemap.xml')})`);
  out.push('');

  const list = topics();
  out.push(`## ${copy.topic.charAt(0).toUpperCase()}${copy.topic.slice(1)}`, '');
  for (const topic of list) {
    const lead = summaryLead(topic.summary);
    out.push(`- [${topic.title}](${url(`topic/${topic.slug}/`)})${lead ? `: ${lead}` : ''}`);
  }
  out.push('');

  const holidayLinks = [];
  for (const code of holidayCountries()) {
    for (const year of holidayCellsFor(code)) {
      holidayLinks.push(`- [${t('holidays.heading').replace('{year}', year).replace('{country}', countryName(code))}](${url(`holidays/${code.toLowerCase()}/${year}/`)})`);
    }
  }
  if (holidayLinks.length) out.push(`## ${t('holidays.title')}`, '', ...holidayLinks, '');

  const questionSlugs = questionTopicCells();
  if (questionSlugs.length) {
    const titles = new Map(list.map((topic) => [topic.slug, topic.title]));
    out.push(`## ${t('q.archive_title')}`, '');
    for (const slug of questionSlugs) {
      out.push(`- [${titles.get(slug) || slug}](${url(`questions/${slug}/`)})`);
    }
    out.push('');
  }

  if (full) {
    out.push('---', '');
    for (const topic of list) {
      out.push(`## ${topic.title}`, '', url(`topic/${topic.slug}/`), '');
      if (topic.summary) out.push(topic.summary, '');
      const cells = countryCellsFor(topic.facts, topic.i18n);
      if (cells.length) {
        out.push(...cells.map((code) => `- [${countryName(code)}](${url(`topic/${topic.slug}/${code.toLowerCase()}/`)})`), '');
      }
    }
  } else {
    out.push(`## Optional`, '', `- [llms-full.txt](${url('llms-full.txt')})`, '');
  }

  return new Response(out.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
