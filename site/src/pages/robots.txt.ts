export const prerender = true;

export function GET({ site }) {
  const origin = site || new URL(process.env.SITE_URL || 'https://weiqi-kids.github.io');
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  const sitemap = new URL(`${base}sitemap.xml`, origin).toString();
  const body = [
    '# aeiou.now — public pages and machine-readable sources',
    'User-agent: *',
    'Allow: /',
    'User-agent: Googlebot',
    'Allow: /',
    'User-agent: Google-Extended',
    'Allow: /',
    'User-agent: Bingbot',
    'Allow: /',
    `Sitemap: ${sitemap}`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
