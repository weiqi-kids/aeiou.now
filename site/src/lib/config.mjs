// 單一真實來源:locale 常數與環境變數(build 時讀,cwd 一律 = site/)
export const LOCALES = ['zh-TW', 'en', 'ja', 'zh-CN', 'hi', 'id', 'pt-BR'];
export const LOCALE = process.env.LOCALE || 'zh-TW';
export const WINDOWS = ['24h', '72h', '7d', '1m', '3m', '1y']; // 靜態只有六窗;8h 屬動態,不出靜態
// REACTION_SET 跨 Track 契約常數(不含 👍,用戶明示排除)
export const REACTION_SET = ['❤️', '😂', '😮', '😢', '🤔', '🎉', '👏'];
