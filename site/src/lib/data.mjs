// 靜態資料層的轉出口(barrel)。
//
// 這支曾經是 591 行的 god module:讀檔、Topic 索引、季節運算、熱度排序、在地資料、
// 每日一問、首頁「現在」全塞在一起。2026-08-19 依內聚拆成六支,這裡只留 re-export,
// 讓既有的九個消費端一行都不用改。
//
// **新的程式碼請直接 import 具體模組**,不要再從這裡拿 —— 這層存在的唯一理由是
// 相容,不是設計。等消費端逐步改完,這個檔就可以刪掉。
//
//   data-source.mjs    src/data/ 的唯一讀取入口,檔案缺席一律回退
//   topics-data.mjs    Topic 索引/bundle/observance/各語系文字/cover 路徑
//   season.mjs         季節距離的純運算(無 I/O)
//   ranking.mjs        熱度、排名、首頁與熱門清單的排序
//   local-data.mjs     城市、國家名、Topic 的地點與活動
//   questions-data.mjs 每日世界一問
//   today-world.mjs    首頁「現在」區塊

export { readJson, DATA_ROOT } from './data-source.mjs';

export {
  observancesForFacts,
  getTopicsIndex,
  topicRowBySlug,
  listTopicIds,
  getTopicBundle,
  customsText,
  dateRuleText,
  regionalNotesForFacts,
  regionalNoteText,
  coverPath,
  coverThumbPath,
  coverHeroSources,
} from './topics-data.mjs';

export { inSeason, seasonDistance } from './season.mjs';

export {
  tiersFor,
  getGlobalRanking,
  globalRankRows,
  globalRankOf,
  recentTopics,
  topicsByHeat,
  hotTopics,
  relatedTopics,
} from './ranking.mjs';

export {
  cityName,
  countryName,
  topicsWithPlacesByCity,
  topicsWithEventsByCity,
  placesForTopic,
  eventsForTopic,
} from './local-data.mjs';

export {
  getQuestions,
  questionsForDate,
  pastQuestions,
  allQuestions,
  questionsByTopic,
  questionTopicCells,
  MIN_TOPIC_QUESTIONS,
} from './questions-data.mjs';

export { todayWorld } from './today-world.mjs';
