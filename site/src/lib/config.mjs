// 單一真實來源:locale 常數與環境變數(build 時讀,cwd 一律 = site/)
export const LOCALES = ['zh-TW', 'en', 'ja', 'zh-CN', 'hi', 'id', 'pt-BR'];
export const LOCALE = process.env.LOCALE || 'zh-TW';
export const WINDOWS = ['24h', '72h', '7d', '1m', '3m', '1y']; // 靜態只有六窗;8h 屬動態,不出靜態
// REACTION_SET 跨 Track 契約常數(不含 👍,用戶明示排除)
export const REACTION_SET = ['❤️', '😂', '😮', '😢', '🤔', '🎉', '👏'];

// 各語系的自稱(endonym)。頁尾用來把「七種語言」這件事講清楚。
// 這是語言的本名、不是 UI 文案,所以不進 i18n 七檔(七檔裡寫的會是同一組字)。
// M1 還沒有正式子網域,所以只列名不做連結——等網域上線再補 hreflang 與切換器。
export const LOCALE_NAMES = {
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
  'zh-CN': '简体中文',
  hi: 'हिन्दी',
  id: 'Bahasa Indonesia',
  'pt-BR': 'Português (BR)',
};
