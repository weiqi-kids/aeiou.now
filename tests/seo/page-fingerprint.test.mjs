// sitemap lastmod 的指紋:守住「整站共用的東西輪替,不算這一頁變了」。
// 每一條都對應一次真的發生過的整站 lastmod 誤推(緣由見 site/scripts/page-fingerprint.mjs 檔頭)。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fingerprint, normaliseForFingerprint } from '../../site/scripts/page-fingerprint.mjs';

const page = ({ nav, title = '萬聖節 2026', body = '正文', cid = 'abc123', asset = 'index.Q1w2E3.css', style = '.a{color:red}' }) => `
<!doctype html>
<html lang="zh-TW">
  <head>
    <title>${title}</title>
    <link rel="stylesheet" href="/_astro/${asset}">
    <style>${style}</style>
    <script type="application/json" data-cfg>{"reactions":["❤️"]}</script>
  </head>
  <body>
    <header class="masthead" data-astro-cid-${cid}>
      <nav class="site-nav">
        <a class="nav-link" href="/">首頁</a>
        <span class="nav-divider" aria-hidden="true"></span>
        ${nav}
      </nav>
    </header>
    <main><p data-astro-cid-${cid}>${body}</p></main>
  </body>
</html>`;

const navA = `<a class="nav-link nav-link--topic" data-topic-slug="carnival" href="/topic/carnival/" data-astro-cid-abc123>
狂歡節</a>
<a class="nav-link nav-link--topic" data-topic-slug="war-dead-and-veterans" href="/topic/war-dead-and-veterans/" data-astro-cid-abc123>
戰歿者與退伍軍人</a>`;
const navB = `<a class="nav-link nav-link--topic" data-topic-slug="caregiving-across-generations" href="/topic/caregiving-across-generations/" data-astro-cid-abc123>
家庭照護與代間</a>
<a class="nav-link nav-link--topic" data-topic-slug="official-languages" href="/topic/official-languages/" data-astro-cid-abc123>
官方語言:寫在憲法裡、寫在法律裡,還是根本沒寫</a>`;

test('導覽尾端的 Topic 捷徑換了,不算這一頁變了(2026-09-17 整站 549 頁誤推的原因)', () => {
  assert.equal(fingerprint(page({ nav: navA })), fingerprint(page({ nav: navB })));
});

test('捷徑數量不同(一個 vs 兩個)也一樣不算變', () => {
  const one = navA.split('\n').slice(0, 2).join('\n');
  assert.equal(fingerprint(page({ nav: navA })), fingerprint(page({ nav: one })));
});

test('_astro 檔名、data-astro-cid、行內 style 換了,不算變(2026-08-27 的坑)', () => {
  const a = page({ nav: navA });
  const b = page({ nav: navA, cid: 'zzz999', asset: 'index.X9y8Z7.css', style: '.a{color:blue}' });
  assert.equal(fingerprint(a), fingerprint(b));
});

test('標題或內文變了,一定算變', () => {
  const base = page({ nav: navA });
  assert.notEqual(fingerprint(base), fingerprint(page({ nav: navA, title: '萬聖節 2027' })));
  assert.notEqual(fingerprint(base), fingerprint(page({ nav: navA, body: '正文改了' })));
});

test('一般連結(不是 nav-link--topic)換了,算變 —— 洗的只有導覽捷徑', () => {
  const a = page({ nav: navA, body: '<a class="nav-link" href="/topic/a/">A</a>' });
  const b = page({ nav: navA, body: '<a class="nav-link" href="/topic/b/">B</a>' });
  assert.notEqual(fingerprint(a), fingerprint(b));
});

test('JSON 設定塊不會被當成 style 洗掉', () => {
  assert.match(normaliseForFingerprint(page({ nav: navA })), /application\/json/);
  assert.doesNotMatch(normaliseForFingerprint(page({ nav: navA })), /color:red/);
});
