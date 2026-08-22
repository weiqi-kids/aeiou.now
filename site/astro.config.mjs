// aeiou.now 靜態站——單一碼庫,LOCALE 環境變數決定 build 哪一語系。
// 全部走環境變數(track-b.md W2.3):LOCALE / SITE_URL / BASE_PATH / PUBLIC_API_URL / PUBLIC_GA4_ID
import { defineConfig } from 'astro/config';

const LOCALES = ['zh-TW', 'en', 'ja', 'zh-CN', 'hi', 'id', 'pt-BR'];
const LOCALE = process.env.LOCALE || 'zh-TW';
if (!LOCALES.includes(LOCALE)) {
  throw new Error(`LOCALE 必須是 ${LOCALES.join(' / ')} 之一,收到:${LOCALE}`);
}
// 2026-08-15 切自訂網域:預設值=正式網域+根路徑(裸執行即正確);
// SITE_URL/BASE_PATH 環境變數只是逃生口(例如要重現舊 github.io 版面時)。
// 映射表=CLAUDE.md 介面常數(ja→jp、zh-CN→cn、pt-BR→br 不同名)。
const LOCALE_ORIGINS = {
  'zh-TW': 'https://aeiou.now',
  en: 'https://en.aeiou.now',
  ja: 'https://jp.aeiou.now',
  'zh-CN': 'https://cn.aeiou.now',
  hi: 'https://hi.aeiou.now',
  id: 'https://id.aeiou.now',
  'pt-BR': 'https://br.aeiou.now',
};
const SITE_URL = process.env.SITE_URL || LOCALE_ORIGINS[LOCALE];
const BASE_PATH = process.env.BASE_PATH || '/';

export default defineConfig({
  output: 'static',
  site: SITE_URL,
  base: BASE_PATH,
  build: {
    // 擋渲染的 CSS 內聯進 HTML(2026-08-22 用戶核准)。
    // 為什麼:元件樣式只有幾 KB,但它們是獨立請求 —— 在慢速連線上那是實打實的
    // 一次 round trip,而且擋著首次繪製。**這一項對真實的慢速讀者是真的省,
    // 不只是討好 Lighthouse 的模擬器。**
    // 代價:CSS 不再跨頁快取,每頁 HTML 各帶一份。這個站的讀者絕大多數是從搜尋
    // 進來的單頁訪客,首次載入的成本比回訪的快取命中重要,所以取 'always'。
    // 要退回原本的行為就刪掉這個 build 區塊(預設是 'auto',只內聯小於
    // vite 的 assetsInlineLimit 的那些)。
    inlineStylesheets: 'always',
  },
});
