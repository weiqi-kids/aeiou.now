// 單一真實來源:locale 常數與環境變數(build 時讀,cwd 一律 = site/)
export const LOCALES = ['zh-TW', 'en', 'ja', 'zh-CN', 'hi', 'id', 'pt-BR'];
export const LOCALE = process.env.LOCALE || 'zh-TW';

// 靜態層有分數的六窗(rankings/global/<win>.json 與 topics index 的 scores 都是這六個)。
export const WINDOWS = ['24h', '72h', '7d', '1m', '3m', '1y'];

// 草案 §44 的 Topic 頁 Trending 是七個時窗:8H 屬動態層(Worker 的 8H feed),
// 24H 以上屬靜態層。順序照草案逐字:[8H][24H][72H][7D][1M][3M][1Y]。
export const TREND_WINDOWS = ['8h', ...WINDOWS];

// 語系 → 該語系的市場國家(ISO 3166-1 alpha-2)。
// 七語系是七個獨立的站,每個站服務一個市場,所以「附近訊息 / 活動資訊」在還不知道讀者位置時
// 一律先以本語系市場的城市為主(用戶 2026-08-11:「都已經語系了,就是以當語系為主」)。
// en 沒有單一市場,故為 null:沒有市場可偏袒時就退到下一層排序鍵。
export const MARKET_COUNTRY = {
  'zh-TW': 'TW',
  en: null,
  ja: 'JP',
  'zh-CN': 'CN',
  hi: 'IN',
  id: 'ID',
  'pt-BR': 'BR',
};

// REACTION_SET 跨 Track 契約常數(不含 👍,用戶明示排除)
export const REACTION_SET = ['❤️', '😂', '😮', '😢', '🤔', '🎉', '👏'];
