import { WINDOWS } from '../lib/config.mjs';
import { coverPath, getGlobalRanking, getTopicBundle, listTopicIds } from '../lib/data.mjs';
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
  // 排行頁只在「筆數夠」時才進 sitemap。thin 旗標由 export-data.mjs 依
  // scripts/lib/content-depth.mjs 的門檻標記。2026-08-19:六個時窗各只有一筆,
  // 送進 sitemap 等於主動要求 Google 索引六個內容相同的空頁(實測已被拒兩頁)。
  // 頁面本身照樣存在、照樣可點,只是不當索引候選。
  for (const window of WINDOWS) {
    const ranking = getGlobalRanking(window);
    if (!ranking || ranking.thin) continue;
    add(`rankings/${window}/`, { changefreq: 'daily', priority: '0.6' });
  }

  for (const topicId of listTopicIds()) {
    const { facts } = getTopicBundle(topicId);
    if (!facts?.slug) continue;
    const cover = coverPath(facts.slug);
    add(`topic/${facts.slug}/`, {
      // lastmod 取 content_updated_at —— 由 export-data 依「facts + i18n 實際輸出內容」
      // 的 hash 決定:內容沒變沿用舊時間戳,變了才蓋新的。
      // 為什麼不用 facts.updated_at(= 主機 topics.updated_at):那個欄位只在
      // canonical_name / commonality / category / is_perennial 變動時才推新,
      // 新增 observance、改寫七語 customs、補國別缺席說明都不會動到它。
      // 2026-08-20 實測:ramadan-and-eid 補進齋戒月後 updated_at 仍停在當日 00:27。
      // 「狼來了」有害,少報同樣有害 —— 前者讓 Google 忽略 lastmod,後者讓它不來重爬。
      // 舊值留作 fallback(舊資料尚未帶 content_updated_at 時)。
      // 排行頁刻意不給:它的內容由 topic_scores 驅動,不在這份 hash 裡,給了就是假的。
      lastmod: facts.content_updated_at || facts.updated_at || undefined,
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
