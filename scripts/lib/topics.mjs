// aeiou.now — Topic 的領域判準(單一來源)
//
// 這支存在的理由:CONTEXT.md 釘死了兩組本專案反覆出錯的語彙,把它們變成有名字的
// 函式,呼叫端就不必再自己列舉 status 值、也不會再各寫一份「這是不是趨勢 Topic」。
//
// 語彙見 /CONTEXT.md;來源標記的決策見 docs/adr/0001-*。
//
// 注意:本檔判斷的是**主機 SQLite 的 topics row**。前端(site/src/lib/data.mjs)看到的是
// export-data.mjs 產出的靜態 JSON,那層的契約是輸出端補上的 topic_kind/owner 欄位,
// 不是這裡的 access_source —— 兩者是不同層的契約,不要互相套用。

/** 來源標記的唯一正典值(ADR-0001)。 */
export const TREND_ACCESS_SOURCE = "trend";

/**
 * 是不是趨勢 Topic(由外部搜尋趨勢管線自動產生)。
 *
 * 唯一判準是 access_source。曾經有一版嗅探 topic_kind/topic_type/kind/owner/
 * ownership/topic_owner/origin/provenance/access_source/category 共 10 個欄位名,
 * 其中 8 個在 topics 表根本不存在 —— 那是「沒有共同語彙」的病徵,不是防禦性設計。
 */
export const isTrendTopic = (row) => row?.access_source === TREND_ACCESS_SOURCE;

/** 由人工在 content/topics/ 寫出來的 Topic。 */
export const isManualTopic = (row) => !isTrendTopic(row);

// ---------------------------------------------------------------------------
// status 承載了兩個彼此獨立的軸。要哪個軸就叫哪個名字,不要列舉值。
// ---------------------------------------------------------------------------

/** 不公開的兩種 status:未達發布門檻、已併入其他 Topic。 */
const HIDDEN_STATUSES = new Set(["candidate", "merged"]);

/**
 * 【可見性軸】讀者看得到、且可以在底下發文。
 *
 * **archived 是公開可見且可發文的** —— 它只表示目前不熱。要表達「公開的」就用這個,
 * 不要寫 `IN ('active','cooling')`:那是熱度軸,會把 archived 漏掉。
 * (2026-08-19 已因這個混淆改壞過發文閘門與兩支守門腳本。)
 */
export const isPubliclyVisible = (row) => !HIDDEN_STATUSES.has(row?.status);

/** 【熱度軸】目前在即時榜上或熱度下降中 —— 排名、榜單才用這個。 */
export const isRanked = (row) => row?.status === "active" || row?.status === "cooling";

/** SQL 片段:可見性軸。給 db.prepare 拼字串用,語意與 isPubliclyVisible 等價。 */
export const SQL_PUBLICLY_VISIBLE = "status NOT IN ('candidate','merged')";

/** SQL 片段:熱度軸。語意與 isRanked 等價。 */
export const SQL_RANKED = "status IN ('active','cooling')";

// ---------------------------------------------------------------------------
// 主題分類軸
// ---------------------------------------------------------------------------

/**
 * category 的正典取值(契約,不是現況)。
 *
 * 2026-08-19 用戶拍板:以實作長出來的這組為正典。schema 註解一度寫「草案 §4.1 的 15 類」,
 * 但草案那組(holiday/culture/travel/shopping/technology/weather/business/…)與實作只有
 * festival/food/education 三個重疊 —— 實作這組是跟著「全世界怎麼過」長出來的,更貼產品。
 *
 * 新增分類的完整動作:①加進本清單 ②七個 site/src/i18n/*.json 補 `category.<slug>` 標籤。
 * 少了②,前端 tOr() 會退回顯示英文原始 slug(2026-08-19 線上實際發生過)。
 */
export const CANONICAL_CATEGORIES = Object.freeze([
  "civic",
  "community",
  "education",
  "faith",
  "family",
  "festival",
  "food",
  "home",
  "life-stage",
  "relationship",
  "remembrance",
  "seasonal",
]);

const CANONICAL_CATEGORY_SET = new Set(CANONICAL_CATEGORIES);

/** category 是不是正典取值。 */
export const isCanonicalCategory = (value) => CANONICAL_CATEGORY_SET.has(value);
