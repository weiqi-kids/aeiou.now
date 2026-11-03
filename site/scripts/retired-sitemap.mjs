// 把 dist 裡標 noindex 的頁列進 sitemap-retired.xml。2026-11-03 起用：移出 sitemap 後 Google 少了回爬的理由，
// 看不到 noindex 就一直留著舊判定（10/14 那批至今沒有一頁生效）。2027-01-01 起不再產出，robots.txt 同步拿掉。
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[process.argv.indexOf('--dist') + 1];
if (new Date() >= new Date('2027-01-01')) process.exit(0);

const site = process.env.SITE_URL;
const urls = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name === 'index.html' && /name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(readFileSync(p, 'utf8'))) urls.push(p.slice(dist.length).replace(/index\.html$/, '').replace(/^\/?/, '/'));
  }
}
walk(dist);
const origin = (site || readFileSync(join(dist, 'robots.txt'), 'utf8').match(/Sitemap: (https?:\/\/[^/\s]+)/)?.[1] || '').replace(/\/$/, '');
const body = urls.map((u) => `  <url><loc>${origin}${encodeURI(u)}</loc></url>`).join('\n');
writeFileSync(join(dist, 'sitemap-retired.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`);
console.log(`sitemap-retired：${urls.length} 頁`);
