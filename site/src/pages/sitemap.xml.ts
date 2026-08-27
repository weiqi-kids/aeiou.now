import { WINDOWS } from '../lib/config.mjs';
import { coverPath, getGlobalRanking, getTopicBundle, listTopicIds, readJson } from '../lib/data.mjs';
import { countryCellsFor } from '../lib/country-cells.mjs';
import { holidayCountries, holidayCellsFor } from '../lib/holidays.mjs';
import { withBase } from '../lib/paths.mjs';

export const prerender = true;

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

// lastmod 的兩條規則（2026-08-21 用戶拍板）：
//
// ① **每一個可索引頁都要有 lastmod。** 在此之前只有 Topic 頁有，首頁、三個清單頁、
//    問答頁、關於頁、六個排行榜頁共 12 個 URL 完全沒有 —— 對 Google 少了一個回來重爬的
//    訊號。當天實測四個 Topic 頁的最後抓取是 08-15/16，而改版是 08-21 上線。
//
// ② **模板改動也要算進 lastmod。** 原本只取 content_updated_at（資料的指紋），
//    所以改標題、改版面對 Google 是隱形的。
//
//    ⚠ 2026-08-27 改了**做法**（規則②本身沒有被推翻，是實作方式錯了）：
//    原本每一頁都取 max(自己的內容時間戳, RENDER_AT)，而 RENDER_AT 是整包 site/src
//    的指紋。site/src 一天改好幾次（08-26 一天七次），於是 469 個 URL 的 lastmod
//    全部都是今天、而且天天如此 —— 正是下面那句「狼來了」。
//    當天實測後果：19 個 Topic 主頁的最後抓取日中位數停在 08-19，而 08-21/25/26
//    改過三次標題與摘要，Google 一次都沒看過。
//
//    現在由 `site/scripts/sitemap-lastmod.mjs` 在 build 之後逐頁比對**算出來的 HTML**
//    指紋，真的變了才蓋新時間戳。改標題 → 只推那幾頁（實測 46 頁）；純換 CSS → 0 頁。
//    這一支產生的值只是**第一次部署的起點**，之後一律由那支說了算。
//
// 時間戳全部由 export-data.mjs 寫進 data/meta/stamps.json，規則同 content_updated_at：
// hash 沒變就沿用舊時間戳。**「狼來了」有害，少報同樣有害** —— 這裡兩邊都要守：
// 不因為資料每小時重算就宣告頁面變了，也不因為只改了模板就裝作沒變。
const stamps = readJson('meta/stamps.json', {});
const stampAt = (key) => stamps?.[key]?.updated_at || undefined;
// RENDER_AT 只剩下 about/ 在用 —— 那一頁沒有任何資料來源,只會因為文案/模板改動而變,
// 沒有別的時間戳可取。其餘頁面一律只用自己的內容指紋(見上面的 ⚠)。
const RENDER_AT = stampAt('render');

export function GET({ site }) {
  const origin = site || new URL(process.env.SITE_URL || 'https://weiqi-kids.github.io');
  const entries = new Map();
  const add = (path, options = {}) => {
    const loc = new URL(withBase(path), origin).toString();
    entries.set(loc, { loc, ...options });
  };

  // 首頁與三個清單頁列的都是 Topic，所以內容時間戳 = 所有 Topic 裡最新的那一個。
  const topicsAt = stampAt('topics_latest');
  add('', { lastmod: topicsAt, changefreq: 'daily', priority: '1.0' });
  // 關於頁沒有資料來源，只會因為模板或文案改動而變。
  add('about/', { lastmod: RENDER_AT, changefreq: 'monthly', priority: '0.3' });
  add('questions/', { lastmod: stampAt('questions'), changefreq: 'daily', priority: '0.5' });
  for (const sort of ['today', 'nearby', 'events']) {
    add(`topics/${sort}/`, { lastmod: topicsAt, changefreq: 'daily', priority: '0.8' });
  }
  // 假日總表 /holidays/<cc>/<年>/(2026-08-27)。判準與 getStaticPaths **共用同一支**
  // holidayCellsFor() —— 這是刻意的:逐國頁那次的教訓是,薄頁判準只要有兩份就會漂,
  // sitemap 於是指向不存在的網址。時間戳走 holidays 這份資料自己的指紋。
  const holidaysAt = stampAt('holidays');
  for (const code of holidayCountries()) {
    for (const year of holidayCellsFor(code)) {
      add(`holidays/${code.toLowerCase()}/${year}/`, {
        lastmod: holidaysAt, changefreq: 'monthly', priority: '0.6',
      });
    }
  }

  // 排行頁只在「筆數夠」時才進 sitemap。thin 旗標由 export-data.mjs 依
  // scripts/lib/content-depth.mjs 的門檻標記。2026-08-19:六個時窗各只有一筆,
  // 送進 sitemap 等於主動要求 Google 索引六個內容相同的空頁(實測已被拒兩頁)。
  // 頁面本身照樣存在、照樣可點,只是不當索引候選。
  for (const window of WINDOWS) {
    const ranking = getGlobalRanking(window);
    if (!ranking || ranking.thin) continue;
    // 排行頁的時間戳是**它自己那一份 ranking JSON** 的指紋，不是借用 Topic 的
    // （舊註解說「它的內容由 topic_scores 驅動，不在那份 hash 裡，給了就是假的」——
    //  那是對的，所以 export-data 給了它自己的 stamp，見 stampFor('ranking:<window>')）。
    add(`rankings/${window}/`, {
      lastmod: stampAt(`ranking:${window}`),
      changefreq: 'daily',
      priority: '0.6',
    });
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
      // 排行頁不借用這份 hash(它的內容由 topic_scores 驅動,不在這裡面);它有自己的 stamp。
      lastmod: facts.content_updated_at || facts.updated_at,
      changefreq: facts.is_perennial ? 'monthly' : 'weekly',
      priority: '0.8',
      image: cover ? new URL(withBase(cover), origin).toString() : undefined,
      imageTitle: facts.canonical_name,
    });
    // 逐國頁(2026-08-26)。lastmod 與母頁同一份指紋 —— 它的內容就是母頁那一格,
    // 沒有自己的資料來源;priority 低一階,母頁仍然是這個 Topic 的主入口。
    // 只列**真的有產出的**格子(countryCellsFor 與 getStaticPaths 同一支判準),
    // 否則 sitemap 會指向 404。
    for (const code of countryCellsFor(facts, getTopicBundle(topicId).i18n)) {
      add(`topic/${facts.slug}/${code.toLowerCase()}/`, {
        lastmod: facts.content_updated_at || facts.updated_at,
        changefreq: facts.is_perennial ? 'monthly' : 'weekly',
        priority: '0.6',
      });
    }
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
