// 逐頁 HTML 指紋 —— sitemap-lastmod.mjs 拿它判斷「這一頁**讀者看得到的內容**變了沒」。
//
// 指紋前先正規化,把「每次 build 都不同、但讀者與 Google 不在乎」的東西洗掉:
//   · `_astro/<hash>.css|js` 的檔名 —— 任何一個 scoped style 改動都會換掉它,
//     不洗的話「改一個元件的 CSS」會變成幾百頁一起宣告改版。
//   · `data-astro-cid-xxxx` 同理。
//   · 行內 `<style>` 的內容 —— Astro 會把小張的 scoped style 直接內嵌進 <head>,
//     實測「只改一條 CSS」就讓 4 頁的 HTML 變了。樣式裡沒有讀者看得到的**文字**,整塊洗掉;
//     `<script type="application/json">` 那種設定塊**不洗**(那是內容)。
//   · 右上導覽尾端的兩個 Topic 捷徑(`.nav-link--topic`,BaseLayout 的 `hotTopics(2)`)——
//     它吃 24h 排行,**每小時的 hourly-export 都可能換掉它**,而它長在每一頁的 header 上。
//     2026-09-17 實測(publish repo aeiou-pages-zh-tw 逐版比對):b66771d→cc69d74 之間
//     /about/、/holidays/tw/2027/、/topic/halloween/ 正規化後**唯一**的差異就是這兩個捷徑,
//     結果整站 549 頁一起被判「內容變了」;08-26~09-01 連續七天每一份 sitemap 的 lastmod
//     全是當天 —— 這正是 CLAUDE.md 記載 08-27 修掉、又從另一個入口回來的那個坑。
//     捷徑是導覽(chrome),不是這一頁的內容;洗掉之後「改標題」照樣會推新,「排行換了」不會。
//
// 剩下的就是讀者與 Google 看得到的東西:標題、摘要、內文、連結。
// 判準只有一句:**這一頁自己的內容變了才算變**,整站共用的東西輪替不算。
import { createHash } from 'node:crypto';

/** 每次 build 都會變、但不屬於這一頁內容的東西,一律洗成固定字串。 */
export function normaliseForFingerprint(html) {
  return String(html)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '<style/>')
    .replace(/_astro\/[^"'\s>]+/g, '_astro/*')
    .replace(/data-astro-cid-[a-z0-9]+/g, 'data-astro-cid')
    // 導覽尾端的 Topic 捷徑:連續幾個 <a> 連同文字一起洗成**一個**佔位(href、文字、
    // 幾個捷徑都跟著排行走,沒有一樣是這一頁的內容)。
    .replace(/(?:<a\b[^>]*\bclass="nav-link nav-link--topic"[^>]*>[\s\S]*?<\/a>\s*)+/g, '<a class="nav-link nav-link--topic"/>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function fingerprint(html) {
  return createHash('sha256').update(normaliseForFingerprint(html)).digest('hex');
}
