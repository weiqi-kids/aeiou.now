// 主導覽 = 同一份 Topic 清單的四種排序(2026-08-11 用戶拍板)。
//
// 用戶原話:「全球熱門、各國熱門、今天的議題、大家正在聊、附近、活動」這算導覽列,應該在右上角
// 取代「看板」的位置……導覽列的內容應該是:全球熱門、熱門話題、附近訊息、活動資訊、情人節…
// 「這些其實都是 Topic 的排序」。
//
// 所以「附近」不是一份店家清單、「活動」也不是一份活動清單——它們是 Topic 的篩選條件:
//   · 附近訊息 = 有在地資訊(places/<city>.json 有條目)的 Topic
//   · 活動資訊 = 有活動(events/<city>.json 有條目)的 Topic
// 店家與活動本身屬於各自的 Topic 頁(草案 §44 的 📍 Near You / 🎉 Events),不上導覽層。
//
// 四個排序頁共用 TopicBoard.astro,差別只在排序/篩選與空狀態文案。
// global 這一個排序沒有自己的網址:首頁就是它(用戶:「首頁 = 全球熱門這個預設排序下的看板列表」),
// 另開 /topics/global/ 只會做出一頁跟首頁一字不差的重複內容。
import { t } from './i18n.mjs';
import { withBase } from './paths.mjs';

export const SORTS = ['global', 'today', 'nearby', 'events'];

// 導覽第一項的標籤是「首頁」(2026-08-11 用戶指示),不是「全球熱門」:那一項連的就是站根路徑,
// 對讀者而言它就是首頁。首頁那份清單的排序名稱在 2026-08-11 第二次指示後改成「近期話題」
// (i18n key home.recent_topics,只出現在首頁的 <title> 與區塊標題);「熱門」的語意整個搬到
// /topics/today/ 那一頁(nav.hot_topics = 🔥熱門話題)。連結目標未變。
const LABEL_KEY = {
  global: 'nav.home',
  today: 'nav.hot_topics',
  nearby: 'nav.nearby',
  events: 'nav.events',
};

export function sortHref(id) {
  return id === 'global' ? withBase('') : withBase(`topics/${id}/`);
}

export function sortLabel(id) {
  return t(LABEL_KEY[id]);
}

/** 導覽用的四個排序項;activeSort 決定 aria-current。 */
export function navSorts(activeSort = null) {
  return SORTS.map((id) => ({
    id,
    href: sortHref(id),
    label: sortLabel(id),
    current: id === activeSort,
  }));
}
