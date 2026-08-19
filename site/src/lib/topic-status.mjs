// 前端的 Topic 狀態判準。與 scripts/lib/topics.mjs 是**同一套語彙的兩個實作**,
// 不是同一份程式碼 —— 兩層跑在不同 runtime、讀不同形狀的資料:
//   scripts/  讀主機 SQLite 的 topics row
//   site/     讀 export-data.mjs 產出的靜態 JSON
// 共用的是 CONTEXT.md 的定義,不是實作。改動任一邊時,兩邊都要照 CONTEXT.md 對齊。

/** 不公開的兩種 status:未達發布門檻、已併入其他 Topic。 */
const HIDDEN_STATUSES = new Set(['candidate', 'merged']);

/**
 * 【可見性軸】讀者看得到、且可以在底下發文。
 *
 * **archived 是公開可見的**,它只表示目前不熱。要表達「公開的」就用這個,
 * 不要寫 `status === 'active'` —— 那是熱度軸的一個值,會把 archived 漏掉。
 * (index.astro 曾經就是這樣寫,等排名 job 上線、開始把 Topic 推進 archived 之後,
 * 那些 Topic 會靜默地從首頁消失。2026-08-19 修正。)
 */
export const isPubliclyVisible = (topic) => !HIDDEN_STATUSES.has(topic?.status);

/** 【熱度軸】目前在即時榜上或熱度下降中 —— 排名、榜單才用這個。 */
export const isRanked = (topic) => topic?.status === 'active' || topic?.status === 'cooling';

/**
 * 趨勢 Topic(由外部搜尋趨勢管線自動產生)。
 *
 * 前端的判準是**輸出層契約** `topic_kind`,由 export-data.mjs 為趨勢 Topic 補上;
 * 不是主機那層的 access_source,也不是 category —— category 是主題分類軸,
 * 不承載來源(ADR-0001)。
 */
export const isTrendTopic = (topic) => topic?.topic_kind === 'trend';
