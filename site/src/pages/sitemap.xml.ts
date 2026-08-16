import { WINDOWS } from '../lib/config.mjs';
import { coverPath, getTopicBundle, listTopicIds } from '../lib/data.mjs';
import { withBase } from '../lib/paths.mjs';

export const prerender = true;

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

export function GET({ site }) {
  const origin = site || new URL(process.env.SITE_URL || 'https://weiqi-kids.github.io');
  const entries = new Map();
  const add = (path, options = {}) => {
    const loc = new URL(withBase(path), origin).toString();
    entries.set(loc, { loc, ...options });
  };

  add('', { changefreq: 'daily', priority: '1.0' });
  add('about/', { changefreq: 'monthly', priority: '0.3' });
  add('questions/', { changefreq: 'daily', priority: '0.5' });
  for (const sort of ['today', 'nearby', 'events']) add(`topics/${sort}/`, { changefreq: 'daily', priority: '0.8' });
  for (const window of WINDOWS) add(`rankings/${window}/`, { changefreq: 'daily', priority: '0.6' });

  for (const topicId of listTopicIds()) {
    const { facts } = getTopicBundle(topicId);
    if (!facts?.slug) continue;
    const cover = coverPath(facts.slug);
    add(`topic/${facts.slug}/`, {
      changefreq: facts.is_perennial ? 'monthly' : 'weekly',
      priority: '0.8',
      image: cover ? new URL(withBase(cover), origin).toString() : undefined,
      imageTitle: facts.canonical_name,
    });
  }

  const body = [...entries.values()].map((entry) => [
    '  <url>',
    `    <loc>${escapeXml(entry.loc)}</loc>`,
    entry.lastmod ? `    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : null,
    entry.changefreq ? `    <changefreq>${entry.changefreq}</changefreq>` : null,
    entry.priority ? `    <priority>${entry.priority}</priority>` : null,
    entry.image ? '    <image:image>' : null,
    entry.image ? `      <image:loc>${escapeXml(entry.image)}</image:loc>` : null,
    entry.imageTitle ? `      <image:title>${escapeXml(entry.imageTitle)}</image:title>` : null,
    entry.image ? '    </image:image>' : null,
    '  </url>',
  ].filter(Boolean).join('\n')).join('\n');

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ` +
    `xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${body}\n</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
}
