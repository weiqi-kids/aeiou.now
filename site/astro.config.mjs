// aeiou.now 靜態站——單一碼庫,LOCALE 環境變數決定 build 哪一語系。
// 全部走環境變數(track-b.md W2.3):LOCALE / SITE_URL / BASE_PATH / PUBLIC_API_URL / PUBLIC_GA4_ID
import { defineConfig } from 'astro/config';

const LOCALES = ['zh-TW', 'en', 'ja', 'zh-CN', 'hi', 'id', 'pt-BR'];
const LOCALE = process.env.LOCALE || 'zh-TW';
if (!LOCALES.includes(LOCALE)) {
  throw new Error(`LOCALE 必須是 ${LOCALES.join(' / ')} 之一,收到:${LOCALE}`);
}
const SITE_URL = process.env.SITE_URL || 'https://weiqi-kids.github.io';
const BASE_PATH = process.env.BASE_PATH || `/aeiou-pages-${LOCALE.toLowerCase()}`;

export default defineConfig({
  output: 'static',
  site: SITE_URL,
  base: BASE_PATH,
});
