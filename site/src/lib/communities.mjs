// 每日世界一問的「社群」常數(docs/briefs/daily-question.md §0-1、§6.1)。
// 社群 = 語言 = 站台,七語站相同,不進 i18n(旗幟 emoji + 語言自稱(endonym),不翻譯)。
export const COMMUNITIES = {
  'zh-TW': { flag: '🇹🇼', name: '中文(台灣)' },
  'en':    { flag: '🇺🇸', name: 'English' },
  'ja':    { flag: '🇯🇵', name: '日本語' },
  'zh-CN': { flag: '🇨🇳', name: '中文(简体)' },
  'hi':    { flag: '🇮🇳', name: 'हिन्दी' },
  'id':    { flag: '🇮🇩', name: 'Bahasa Indonesia' },
  'pt-BR': { flag: '🇧🇷', name: 'Português' },
};

/** 「旗幟 + 語言自稱」的顯示字串。locale 查不到就退回 locale 代碼本身(不猜、不空白)。 */
export function communityLabel(locale) {
  const hit = COMMUNITIES[locale];
  return hit ? `${hit.flag} ${hit.name}` : String(locale || '');
}
