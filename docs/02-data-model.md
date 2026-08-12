# aeiou.now — 資料結構定義

> 依據草案 `global_topic_platform_full_spec.md` 與 2026-08-11 的架構討論結論
> ⚠ `01-layering.md` 已過期(Cloudflare 角色、fallback 快照機制皆已推翻),待重寫
> 標記 **【代填】** 的欄位是我在未取得決定下的判斷,隨時可改

---

## 0. 三個儲存位置的分工

這是理解整份 schema 的前提。**資料不是只有一份,而是分住三個地方,各自是不同東西的權威來源。**

| | 主機 SQLite | Cloudflare D1 | 靜態 JSON(git) |
|---|---|---|---|
| **角色** | 生產線 | 服務即時互動 | 服務閱讀 |
| **誰寫** | cron | Worker(UGC)+ cron(同步) | cron → git push |
| **誰讀** | cron | Worker API | Astro build |
| **權威來源** | 爬搜、來源、Topic 生產全流程 | **UGC(貼文/留言/使用者)** | 無(全部是衍生品) |
| **可丟失?** | 不可(重爬成本高) | 不可(使用者資料) | 可(隨時能重生) |

**兩個權威來源、雙向同步:**

```
主機 SQLite ──① Topic/Place/Event 精簡副本──▶ D1
            ◀─② UGC 原文(供翻譯與排名)────
            ──③ 翻譯結果、精華標記、審核判定──▶

主機 SQLite ──④ 靜態資料 JSON ──▶ git push ──▶ 每小時 build ──▶ 7 個 Pages 站
```

主機用 **SQLite** 而非 Postgres,理由:與 D1 同一套 SQL 方言,`schema.sql` 可以共用一份定義,不會出現兩邊型別漂移。

---

## 1. 命名與型別慣例

- 主鍵一律 `TEXT`,格式 `<prefix>_<ulid>`(如 `top_01J...`、`pst_01J...`)。ULID 可排序、可在主機端產生,不依賴資料庫。
- 時間一律 `INTEGER`(Unix epoch 秒)。D1 沒有原生 timestamp,統一用整數避免時區問題。
- 陣列型欄位一律 `TEXT` 存 JSON 字串,欄名以 `_json` 結尾。
- `locale` 的合法值固定七個:`zh-TW` `en` `ja` `zh-CN` `hi` `id` `pt-BR`。
- `country_code` 用 ISO 3166-1 alpha-2;`city_code` 用自訂 slug(`tokyo`、`taichung`)。

---

## 2. Topic 域

### 2.1 `topics` —— 主檔

```sql
CREATE TABLE topics (
  topic_id        TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,      -- 'affection-and-reciprocity',URL 用
  canonical_name  TEXT NOT NULL,             -- 語言中立的正規名稱(英文為主)
  commonality     TEXT NOT NULL DEFAULT '',  -- 跨國共通性分類依據,不是日期名稱
  category        TEXT NOT NULL,             -- 草案 §4.1 的 15 類
  status          TEXT NOT NULL,             -- candidate|active|cooling|archived|merged
  merged_into     TEXT,                      -- status='merged' 時指向合併目標
  is_perennial    INTEGER NOT NULL DEFAULT 0,-- 1 = 長青(如 ask-the-world),永不 cooling

  access_level    INTEGER NOT NULL DEFAULT 0,-- 0=匿名可 1=需登入 2=需登入且滿18
  access_source   TEXT NOT NULL DEFAULT 'category', -- category|manual|moderation
                                             -- 誰設定的,供稽核與覆寫判斷

  global_score    REAL NOT NULL DEFAULT 0,
  first_seen_at   INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_topics_status ON topics(status, global_score DESC);
CREATE INDEX idx_topics_category ON topics(category, status);
```

**`status` 的語意(討論結論,與草案 §53 不同):**

| status | 意思 | 能發文嗎 |
|---|---|---|
| `candidate` | 尚未達到發布門檻 | ❌ 不公開,`noindex` |
| `active` | 目前熱門,在即時榜上 | ✅ |
| `cooling` | 熱度下降中 | ✅ |
| `archived` | **只表示目前不熱,不在即時榜上** | ✅ **仍可發文** |
| `merged` | 已併入其他 Topic | ❌ 301 導向 |

> **`archived` 不鎖寫入,是週期性 Topic 的關鍵。** 情人節每年二月熱度回升就自動回到 `active`,去年的貼文仍鎖在歷史精華裡,今年是新的一期。長青、週期性、一次性三種 Topic 共用同一套機制,不需要額外欄位。
>
> 對照:**`posts.status = 'archived'` 才是真的鎖定不能回覆。** 兩者名稱相同、語意不同,實作時務必分清。

**`access_level` 只管討論室,不管主題頁。** 靜態 Topic 頁一律公開可索引;動態討論室依此欄位 gate。靜態 build 完全不需要知道身分系統的存在。

### 2.2 `topic_i18n` —— 七語呈現

```sql
CREATE TABLE topic_i18n (
  topic_id      TEXT NOT NULL,
  locale        TEXT NOT NULL,
  title         TEXT NOT NULL,             -- 「情人節」/「バレンタイン」
  summary       TEXT,                      -- AI 摘要
  keywords_json TEXT,                      -- ["情人節","西洋情人節",...]
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (topic_id, locale)
);
```

### 2.3 `topic_observances` —— 「全世界怎麼過」的地方表現層

**這是草案 §44「🌎 How the World Celebrates」的核心表,也是討論中「一份事實、七語呈現」的落點。**
一個 Topic 是跨國共通性；同一國在同一 Topic 下可以有多個地方表現(observance),
每個表現各自擁有名稱、日期／日期規則、來源與七語 customs。日期不是 Topic 的主鍵,
也不能用 `(topic_id, country_code)` 把同一國的多個時間點壓成一筆。

```sql
CREATE TABLE topic_observances (
  observance_id  TEXT PRIMARY KEY,
  topic_id       TEXT NOT NULL,
  observance_key TEXT NOT NULL,            -- 該國在 Topic 內穩定 key:'valentine'/'white-day'
  country_code   TEXT NOT NULL,
  local_name     TEXT NOT NULL,            -- 地方表現的原文名稱
  observed_date  TEXT,                     -- 'MM-DD' 固定日期,如 '02-14'
  date_rule      TEXT,                     -- 非固定日期的規則,如 '農曆七月初七'
  date_range_end TEXT,                     -- 跨日期間的結束(如印度 Valentine Week)
  popularity_rank INTEGER,                 -- 該 Topic 在該國的熱度排名(草案 §47)
  source_ids_json TEXT NOT NULL,           -- 佐證來源,SEO 的抗辯基礎
  updated_at     INTEGER NOT NULL,
  UNIQUE (topic_id, country_code, observance_key)
);
CREATE INDEX idx_topic_observances_topic
  ON topic_observances(topic_id, country_code, observed_date);
CREATE INDEX idx_topic_observances_date
  ON topic_observances(observed_date, date_range_end);

CREATE TABLE topic_observance_occurrences (
  occurrence_id   TEXT PRIMARY KEY,
  observance_id   TEXT NOT NULL,
  occurrence_year INTEGER NOT NULL,
  starts_on       TEXT NOT NULL,              -- 'YYYY-MM-DD',地方時區的日期
  ends_on         TEXT,                       -- NULL = 單日；含首尾日
  calendar_system TEXT NOT NULL,              -- gregorian|chinese-lunisolar|hindu-lunisolar|islamic|solar-term|local
  timezone        TEXT NOT NULL,              -- IANA timezone
  date_status     TEXT NOT NULL,              -- confirmed|estimated|local-variant
  source_ids_json TEXT NOT NULL,              -- 該年度日期的佐證來源
  updated_at      INTEGER NOT NULL,
  UNIQUE (observance_id, occurrence_year, starts_on)
);
CREATE INDEX idx_topic_observance_occurrences_date
  ON topic_observance_occurrences(starts_on, ends_on);
CREATE INDEX idx_topic_observance_occurrences_observance
  ON topic_observance_occurrences(observance_id, occurrence_year, starts_on);

CREATE TABLE topic_observance_i18n (
  observance_id TEXT NOT NULL,
  locale       TEXT NOT NULL,
  customs_text TEXT NOT NULL,              -- 「女生送巧克力,分本命/義理」的該語系版本
  PRIMARY KEY (observance_id, locale)
);
```

> `source_ids_json` 是必填,不是選填。每一條文化事實都要能點回原始來源——這既是內容品質,也是對 Google「scaled content abuse」政策的正面抗辯:這一頁的價值來自跨國真實來源的彙整,不是生成的散文。
>
> **年度日期是獨立層:**`observed_date` / `date_rule` 是文化規則與無年份的摘要；`topic_observance_occurrences` 保存每一年的實際日期、時區、狀態與來源。頁面排序只使用匯出的 `next_occurrence`，不在 Astro build 解析自然語言。 「加入行事曆」同樣以 occurrence 產生 Google Calendar URL 與靜態 `.ics`(cn 市場不依賴 Google)。

### 2.4 `topic_aliases` / `topic_relations` —— Topic Graph(草案 §48)

```sql
CREATE TABLE topic_aliases (
  alias_id   TEXT PRIMARY KEY,
  topic_id   TEXT NOT NULL,
  alias      TEXT NOT NULL,
  locale     TEXT,                          -- NULL = 跨語系通用
  source     TEXT NOT NULL,                 -- llm|manual|crawl
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_alias_lookup ON topic_aliases(alias);

CREATE TABLE topic_relations (
  from_topic_id TEXT NOT NULL,
  to_topic_id   TEXT NOT NULL,
  relation      TEXT NOT NULL,              -- related|country_branch|local_topic|parent
  country_code  TEXT,                       -- relation='country_branch' 時
  weight        REAL NOT NULL DEFAULT 1.0,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (from_topic_id, to_topic_id, relation)
);
```

> 草案 §15 的「`Japan Valentine's Chocolate` 成為 related_topic 而非完全合併」,就是 `relation='local_topic'` 的邊,而不是 `topics.merged_into`。

### 2.5 `topic_scores` —— 七時窗分數(草案 §19 §47)

```sql
CREATE TABLE topic_scores (
  topic_id    TEXT NOT NULL,
  scope       TEXT NOT NULL,                -- 'global' | 'country:JP' | 'city:tokyo'
  window      TEXT NOT NULL,                -- 8h|24h|72h|7d|1m|3m|1y
  score       REAL NOT NULL,
  rank        INTEGER,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (topic_id, scope, window)
);
CREATE INDEX idx_scores_rank ON topic_scores(scope, window, rank);
```

**HotScore 組成(草案 §20,依討論結論修正 §21):**

```
HotScore = ViewScore + CommentScore + EngagementScore
         + VelocityScore          ← 權重高於單純 PV(§20)
         + CrossCountryScore      ← 改為「跨國貼文互動」而非「跨國留言」
         + SourceScore
         - AgeDecay
```

> **§21 的修正**:因為留言不翻譯,跨國留言鏈接不起來。CrossCountryScore 改為計算「一則貼文被多少不同國家的使用者互動/引用」。跨國價值發生在主題層與貼文層,留言是在地社群內部的對話。

### 2.6 `topic_cycles` —— 「本期」的定義

```sql
CREATE TABLE topic_cycles (
  cycle_id    TEXT PRIMARY KEY,
  topic_id    TEXT NOT NULL,
  label       TEXT NOT NULL,                -- '2026-02'【代填】格式
  started_at  INTEGER NOT NULL,             -- 進入 active 的時刻
  ended_at    INTEGER,                      -- 退出 active(NULL = 進行中)
  peak_score  REAL,
  peak_rank   INTEGER,
  post_count  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (topic_id, started_at)
);
```

> **一期 = 一次 active 週期。** 情人節每年一期。這是「本期精華」的分組依據,也是歷史封存頁的分組單位。

### 2.7 向量(Vectorize,不是 D1)

| | 內容 |
|---|---|
| index | `topics`(唯一的向量索引) |
| 向量來源 | `canonical_name` + 全部 `topic_aliases` + 各語系 `title` 串接 |
| 模型 | `@cf/baai/bge-m3`(1024 維,多語)**【代填】** |
| 筆數上限 | 免費額度 500 萬維度 ÷ 1024 = **約 4,880 個** |
| metadata | `{topic_id, category, status}` |

> 多語 embedding 的用途:日文查詢「バレンタイン」與中文查詢「情人節」落在相近向量空間,**一個 Topic 只需要一個向量,不必每語系存一份**。這是選 bge-m3 而非「先翻譯再搜」的全部理由。
>
> Place / Event / Post 都不進 Vectorize(討論結論)。Place/Event 用 D1 索引,Post 不提供搜尋。

---

## 3. 在地域

```sql
CREATE TABLE places (
  place_id     TEXT PRIMARY KEY,
  name         TEXT NOT NULL,               -- 語言中立:店家原文名稱
  city_code    TEXT NOT NULL,
  country_code TEXT NOT NULL,
  address      TEXT,                        -- 原文地址(非結構化)
  map_url      TEXT,                        -- Google Maps 連結
  nav_urls_json TEXT,                       -- {"google":"...","baidu":"...","amap":"..."}
  mention_count INTEGER NOT NULL DEFAULT 0, -- 被討論提及次數 → 熱門度
  discovered_via TEXT NOT NULL DEFAULT 'mention', -- mention|search(按需探索)
  source_urls_json TEXT,                    -- 按需探索的佐證來源連結(discovered_via='search' 必填)
  first_seen_at INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_places_city ON places(city_code, mention_count DESC);

CREATE TABLE place_i18n (
  place_id    TEXT NOT NULL,
  locale      TEXT NOT NULL,
  description TEXT,                         -- 「大家推薦的巧克力店」
  PRIMARY KEY (place_id, locale)
);

CREATE TABLE place_topics (
  place_id  TEXT NOT NULL,
  topic_id  TEXT NOT NULL,
  relevance REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (place_id, topic_id)
);
```

> **不儲存任何 Places API 回傳的資料**(評分、評論數、營業狀態),也**不呼叫 Places API**。店家兩個來源(2026-08-11 拍板):
> ① 討論中被提及的名稱(`mention_count` 累計);
> ② **按需探索**——觸發訊號 = **GA4 城市維度流量**(週工作階段達門檻,設定檔可調;2026-08-11 用戶定案,單一訊號)。觸發後 cron 用 `claude -p` 自帶 web search 抽店名+來源連結(自有爬搜資料,非 Places API 資料),導航用 Google Maps 免費連結組裝。不做全城市預掃,Job 11 從排程改為按需,依賴 GA4 每日拉取(同為 M2)。
>
> `map_url` / `nav_urls_json` 是純字串組裝(Google Maps 搜尋連結;`cn` 給百度/高德)。零 API 成本、零條款風險。

events 域三表完整定義:

```sql
CREATE TABLE event_i18n (
  event_id    TEXT NOT NULL,
  locale      TEXT NOT NULL,
  description TEXT,
  PRIMARY KEY (event_id, locale)
);

CREATE TABLE event_topics (
  event_id  TEXT NOT NULL,
  topic_id  TEXT NOT NULL,
  relevance REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, topic_id)
);

CREATE TABLE events (
  event_id     TEXT PRIMARY KEY,
  name         TEXT NOT NULL,               -- 語言中立原文名稱
  city_code    TEXT NOT NULL,
  country_code TEXT NOT NULL,
  venue        TEXT,
  start_at     INTEGER,
  end_at       INTEGER,
  ticket_url   TEXT,
  source_id    TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_events_time ON events(city_code, start_at);
```

目前的第一批在地資料樣本放在 `content/local-sample-data.json`；來源目錄
`content/local-data-sources.json` 保留七市場的搜尋候選詞、官方 URL 與頁面核對 markers。
排程與人工更新入口是 `node scripts/update-local-data.mjs`：它會先驗證目前仍有效的
官方頁面與活動日期，沒有可靠回應就整次失敗，不會用猜測資料覆蓋；日期已過的活動會移除，
再由 `scripts/import-local-sample-data.mjs` 匯入主機 SQLite，最後由
`node scripts/export-data.mjs` 產生 `data/places/<city_code>.json` 與
`data/events/<city_code>.json`。每個地點保留 `source_urls`；每個活動保留
`source_id` 與匯出後的 `source_url`。沒有可核對的官方或主辦方來源，不建立資料列。

`local-sample-data.json` 不使用全域 `topic_slug`。每一筆 `place`／`event` 都必須有自己的
`topic_slugs` 陣列；匯入器會逐筆解析 slug，寫入 `place_topics`／`event_topics` 多對多關聯。
因此同一個市場可以在 `nearby`／`events` 索引看到多個 Topic，而資料更新不會把所有地點或
活動重新掛回同一個 Topic。新增資料時，只有來源內容能直接支持的 Topic 才能放進陣列，
不能因為同一城市或同一節日日期相近就自動加標籤。

兩個集合的語意不能互換：`places` 只放有可持續到訪依據的常設地點（匯出欄位
`place_type: "permanent"`）；`events` 只放有明確日期、場地與來源的單次或期間活動。
地點還必須在人工輸入中標為 `topic_relevance: "direct"`；活動在哪裡舉辦，不代表該場地
就應複製成這個 Topic 的 `place`。只有另有常設地點來源時才建立 `places` 列。
`retired_place_ids` 僅是清掉舊錯誤資料的遷移清單，
不會被重新發布或當成目前地點來源。

手動執行：

```bash
node scripts/update-local-data.mjs --check-only   # 只驗證來源，不寫 SQLite
node scripts/update-local-data.mjs                 # 驗證、清除過期活動、匯入 SQLite
node scripts/update-local-data.mjs --offline       # 無網路時只做結構/日期重跑
```

新增或替換來源時，先在 `local-data-sources.json` 填官方 URL、`discovery_query`、
至少一個 `markers`；活動來源還必須填 `date_markers`。腳本不會直接抓搜尋引擎結果當成資料，
而是把搜尋後選出的可追溯來源固定下來並週期性重新核對。

---

## 4. 來源域(只在主機,不進 D1)

```sql
CREATE TABLE sources (
  source_id     TEXT PRIMARY KEY,
  url           TEXT NOT NULL UNIQUE,
  domain        TEXT NOT NULL,
  source_type   TEXT NOT NULL,              -- 草案 §12 的 8 類
  language      TEXT,
  country_code  TEXT,
  city_code     TEXT,
  title         TEXT,
  published_at  INTEGER,
  crawled_at    INTEGER,
  next_crawl_at INTEGER NOT NULL,           -- 草案 §13 的分級頻率
  crawl_freq_s  INTEGER NOT NULL,           -- 900|3600|21600|86400
  content_hash  TEXT,
  quality_score REAL,
  trust_score   REAL,
  status        TEXT NOT NULL,              -- new|processed|ignored|duplicate|error
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_sources_due ON sources(next_crawl_at) WHERE status != 'ignored';

CREATE TABLE source_contents (
  source_id    TEXT PRIMARY KEY,
  raw_text     TEXT,                        -- 30 天後移入 R2,此欄設 NULL
  r2_key       TEXT,                        -- 移入 R2 後的鍵
  extracted_at INTEGER NOT NULL
);

CREATE TABLE source_topics (
  source_id  TEXT NOT NULL,
  topic_id   TEXT NOT NULL,
  confidence REAL NOT NULL,
  PRIMARY KEY (source_id, topic_id)
);
```

> **來源清冊(哪些 RSS / 官方 API 要抓)是 day 0 的人工工作,尚未決定**(你說「之後再找」)。schema 已備妥,`sources` 表可直接匯入。

---

## 5. 互動域(權威來源在 D1)

### 5.1 `users`

```sql
CREATE TABLE users (
  user_id       TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,              -- google|github|line
  provider_uid  TEXT NOT NULL,
  display_name  TEXT,
  avatar_url    TEXT,
  locale        TEXT,
  country_code  TEXT,                       -- 來自 Cloudflare,可覆寫
  city_code     TEXT,
  age18_declared_at INTEGER,                -- NULL = 未宣告滿 18
  status        TEXT NOT NULL DEFAULT 'active', -- active|suspended
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  UNIQUE (provider, provider_uid)
);
```

> **滿 18 宣告記在帳號,不記 cookie。** 因為 `access_level=2` 已經蘊含 `access_level=1`(需登入),三級是繼承關係,所以宣告必然有帳號可掛。

### 5.2 `posts`

```sql
CREATE TABLE posts (
  post_id        TEXT PRIMARY KEY,
  topic_id       TEXT NOT NULL,             -- 歸屬唯一,不可跨 Topic
  cycle_id       TEXT,                      -- 發文當下該 Topic 的期別
  user_id        TEXT,                      -- NULL = 匿名(僅 access_level=0 允許)
  anon_id        TEXT,                      -- 匿名時的簽名識別,供檢舉追蹤

  original_locale TEXT NOT NULL,
  content        TEXT NOT NULL,             -- 原文。格式 = Markdown 安全子集(2026-08-11 拍板):
                                            -- 無標題欄;禁 raw HTML,渲染端一律 sanitize。
                                            -- M1 顯示為純文字轉義,Markdown 渲染 M2
  media_json     TEXT,                      -- 圖片 M2 啟用(R2 儲存 + 審核),M1 恆 NULL
  target_country TEXT,                      -- Ask the World 指定提問對象【代填,可為 NULL】

  country_code   TEXT NOT NULL,             -- 來自 Cloudflare request.cf
  city_code      TEXT,                      -- 城市級,不存座標

  views          INTEGER NOT NULL DEFAULT 0,
  unique_views   INTEGER NOT NULL DEFAULT 0,
  comments       INTEGER NOT NULL DEFAULT 0,
  likes          INTEGER NOT NULL DEFAULT 0,
  shares         INTEGER NOT NULL DEFAULT 0,
  cross_country_engagements INTEGER NOT NULL DEFAULT 0,  -- §21 修正後的指標
  hot_score      REAL NOT NULL DEFAULT 0,

  status         TEXT NOT NULL,             -- active|cooling|archived|moderation|deleted
  translation_status TEXT NOT NULL DEFAULT 'pending', -- pending|translating|done|skipped

  created_at     INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  archived_at    INTEGER
);
CREATE INDEX idx_posts_feed ON posts(topic_id, status, hot_score DESC);
CREATE INDEX idx_posts_new  ON posts(topic_id, status, created_at DESC);
CREATE INDEX idx_posts_pending_translation ON posts(translation_status, created_at)
  WHERE translation_status IN ('pending','translating');
CREATE INDEX idx_posts_geo ON posts(topic_id, country_code, city_code, status);
```

**`status` 的語意(這裡的 `archived` 才是真的鎖):**

| status | 意思 | 能回覆嗎 | 在即時 Feed? |
|---|---|---|---|
| `active` | 8H 內或有新留言續命 | ✅ | ✅ |
| `cooling` | 退出 Top 100 但仍在窗口內 | ✅ | ⚠ 降級顯示 |
| `archived` | **已封存,永久鎖定** | ❌ | ❌ |
| `moderation` | 審核中 | ❌ | ❌ |
| `deleted` | 使用者刪除(軟刪) | ❌ | ❌ |

**`translation_status`** 現在恆為全翻,但保留此欄以便將來改成分級翻譯時不需改 schema。

**geo 只到城市級。** 「附近的留言」用階層排序而非距離計算:`同城市 > 同國家 > 同語系 > 其他`。不存精確座標,七個市場的隱私法規都好交代。

### 5.3 `post_i18n` —— 貼文的七語翻譯

```sql
CREATE TABLE post_i18n (
  post_id       TEXT NOT NULL,
  locale        TEXT NOT NULL,
  content       TEXT NOT NULL,
  translated_at INTEGER NOT NULL,
  translator    TEXT NOT NULL DEFAULT 'claude', -- claude|codex|manual
  PRIMARY KEY (post_id, locale)
);
```

> 顯示時**原文與譯文並陳**:預設顯示譯文、原文摺疊可展開,並標示原始語言。譯文延遲 ≤15 分鐘,期間顯示原文並標記「翻譯中」。

### 5.4 `comments` —— 兩層結構,不翻譯

```sql
CREATE TABLE comments (
  comment_id     TEXT PRIMARY KEY,
  post_id        TEXT NOT NULL,             -- 只掛在 post,不巢狀
  topic_id       TEXT NOT NULL,             -- 反正規化,省 join
  user_id        TEXT,
  anon_id        TEXT,
  locale         TEXT NOT NULL,
  content        TEXT NOT NULL,             -- 只有原文,不翻譯
  country_code   TEXT NOT NULL,
  city_code      TEXT,
  likes          INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL,             -- active|archived|moderation|deleted
  created_at     INTEGER NOT NULL
);
CREATE INDEX idx_comments_post ON comments(post_id, created_at);
```

> 留言隨所屬 post 一起 `archived`(鎖定)。不巢狀的理由:草案 §42 的 post 結構本身沒有 `parent_comment_id`,而深層巢狀在「geo 較近優先」排序下無法呈現。

### 5.5 `reactions`

```sql
CREATE TABLE reactions (
  target_type TEXT NOT NULL,                -- post|comment|place|event
                                            -- (2026-08-11 補:店家與活動本來就規劃可按 emoji,
                                            --  當初落 schema 時漏列)
  target_id   TEXT NOT NULL,
  actor_id    TEXT NOT NULL,                -- user_id 或 anon_id
  kind        TEXT NOT NULL,                -- emoji,固定集合(2026-08-11 拍板,無獨立 like,不含 👍):
                                            -- ❤️ 😂 😮 😢 🤔 🎉 👏
                                            -- 同一 actor 可對同一目標按多個不同 emoji(PK 已允許)
  country_code TEXT NOT NULL,               -- 供 CrossCountryScore 計算
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (target_type, target_id, actor_id, kind)
);
-- EngagementScore 計算:不分 emoji 種類,計 distinct actor 數;share 不進資料庫(純前端複製連結)
```

### 5.6 `post_highlights` —— 本期精華與歷史精華

```sql
CREATE TABLE post_highlights (
  post_id         TEXT NOT NULL,
  topic_id        TEXT NOT NULL,
  kind            TEXT NOT NULL,            -- cycle|alltime
  cycle_id        TEXT,                     -- kind='cycle' 時必填
  rank            INTEGER NOT NULL,
  score_at_freeze REAL NOT NULL,
  frozen_at       INTEGER NOT NULL,
  PRIMARY KEY (post_id, kind, cycle_id)
);
CREATE INDEX idx_highlights ON post_highlights(topic_id, kind, rank);
```

> **這張表取代了「Post 的七時窗榜」。** 貼文退出即時 Feed 時比對一次:是否進入該期 Top N、是否進入該 Topic 歷來 Top N,是就寫進來並凍結分數。計算成本從「七時窗 × 每個 Topic × 每則貼文 × 每 15 分鐘」降成「退場時一次」。
>
> **`kind='alltime'` 的內容會 build 進靜態 Topic 頁**——所以 Cloudflare 掛掉時,歷史精華照樣看得到。

---

## 6. 排行域

```sql
CREATE TABLE ranking_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  scope       TEXT NOT NULL,                -- global|country:JP|city:tokyo
  window      TEXT NOT NULL,
  taken_at    INTEGER NOT NULL,
  granularity TEXT NOT NULL,                -- 15m|hourly|daily
  UNIQUE (scope, window, taken_at)
);

CREATE TABLE ranking_items (
  snapshot_id TEXT NOT NULL,
  rank        INTEGER NOT NULL,
  topic_id    TEXT NOT NULL,
  score       REAL NOT NULL,
  PRIMARY KEY (snapshot_id, rank)
);
```

**保存策略:**

| granularity | 保存 |
|---|---|
| `15m`(8H/24H 窗口) | D1 保留 30 天 |
| `daily` | 主機永久保留,支撐 7D/1M/3M/1Y 歷史趨勢(草案 §34 §56) |

> 歷史排行只需要 snapshot,**不需要貼文全文**——所以貼文移入 R2 完全不影響 1Y 排行。

---

## 7. 運行域(草案 §64 §65 §66)

```sql
CREATE TABLE jobs (
  job_id          TEXT PRIMARY KEY,
  job_name        TEXT NOT NULL,
  scope           TEXT NOT NULL,            -- 'global' 或 locale
  scheduled_at    INTEGER NOT NULL,
  started_at      INTEGER,
  finished_at     INTEGER,
  status          TEXT NOT NULL,            -- queued|running|success|partial_success|failed|skipped|dlq
                                            -- dlq（2026-08-11 補列）= 已第 3 次失敗、next_retry_at IS NULL，
                                            -- 不再自動重試，需人工處理。§66 的重試曲線（+5 分／+10 分）終點。
  attempt         INTEGER NOT NULL DEFAULT 0,
  next_retry_at   INTEGER,                  -- 失敗 +5 分、再失敗 +10 分、第三次進 DLQ
  records_read    INTEGER NOT NULL DEFAULT 0,
  records_created INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  records_failed  INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT
);
CREATE INDEX idx_jobs_retry ON jobs(status, next_retry_at);

CREATE TABLE job_locks (
  scope        TEXT NOT NULL,
  job_name     TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  locked_by    TEXT NOT NULL,
  locked_at    INTEGER NOT NULL,
  PRIMARY KEY (scope, job_name, scheduled_at)
);

CREATE TABLE moderation_queue (
  item_id      TEXT PRIMARY KEY,
  target_type  TEXT NOT NULL,               -- post|comment|user
  target_id    TEXT NOT NULL,
  reason       TEXT NOT NULL,               -- spam|harassment|illegal|malicious_link|commercial|bot
                                            -- |correction(使用者「回報錯誤/補充」主題內容,2026-08-11 拍板;
                                            --   target_type 此時為 topic,接飛輪一的回饋環,人工處理非 wiki 直編)
  reported_by  TEXT,                        -- NULL = 系統自動偵測
  severity     TEXT NOT NULL,               -- low|medium|high
  status       TEXT NOT NULL,               -- pending|reviewing|resolved|dismissed
  decision     TEXT,                        -- keep|hide|delete|suspend
  decided_by   TEXT,                        -- rule|llm|human
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER
);
CREATE INDEX idx_moderation_pending ON moderation_queue(status, severity, created_at);

CREATE TABLE quality_checks (
  check_id    TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  label       TEXT NOT NULL,                -- verified|source-backed|needs-review|low-quality|spam
  checked_by  TEXT NOT NULL,                -- rule|llm
  checked_at  INTEGER NOT NULL
);
```

> **moderation 的範圍尚未決定**(你說 Ask the World 不用審內容對不對,但 §33 的 spam / 騷擾 / 違法 / 惡意連結仍待定)。schema 已備妥全部 reason 類別,實際啟用哪幾類由你決定。**【代填】**

---

## 8. 分析域

**瀏覽統計分工(2026-08-11 拍板)**:24H 以上時窗的瀏覽面指標(page_views / unique_users)由 **GA4** 承擔——靜態頁埋 tag,主機 cron 每日經 GA4 Data API 拉取,寫入下表。不用 Cloudflare Analytics Engine。**8H 即時層不用 GA4**(其資料延遲數小時),8H 熱度由 D1 的互動事件(發文/留言/reaction)驅動。HotScore = GA4 瀏覽面 + D1 互動面合成。已知缺口:cn 市場 GA4 被牆,瀏覽數低估。紅線:aeiou 須有自己的 GCP 專案與 SA(`identity-audit --expect-only` 驗收)。

原始事件不進 D1(寫入量會撞破免費額度每日 10 萬列);D1 只承載互動寫入本身,聚合結果進下表:

```sql
CREATE TABLE analytics_aggregates (
  bucket_at    INTEGER NOT NULL,            -- 15 分鐘對齊
  dimension    TEXT NOT NULL,               -- topic|post|country|city|locale|referrer
  dimension_id TEXT NOT NULL,
  metric       TEXT NOT NULL,               -- page_views|unique_users|comments|likes|shares|searches
  value        INTEGER NOT NULL,
  PRIMARY KEY (bucket_at, dimension, dimension_id, metric)
);
```

> 草案 §35 的「不保存不必要的個資」在此落實:GA4 只收匿名聚合維度(前端直送 Google,不經 Worker);D1 只承載互動寫入本身,不存瀏覽原始事件。

---

## 9. 靜態 JSON 的目錄結構

cron 產出、git push、每小時 build 讀取。**只寫入內容 hash 有變的檔**,讓每小時的 diff 維持最小。

```
data/
├── topics/
│   ├── index/<locale>.json          Topic 清單(id, slug, title, category, 各窗分數, status)
│   └── <topic-id>/
│       ├── facts.json               語言中立:topic_observances、relations、source ids
│       ├── i18n.json                七語一檔(title/summary/keywords + 各地方表現 customs_text)
│       └── highlights.json          歷史精華(凍結貼文的原文 + 七語譯文)
├── places/<city_code>.json          語言中立事實 + 各語系描述
├── events/<city_code>.json
├── rankings/
│   ├── global/<window>.json
│   └── <country_code>/<window>.json
└── meta/
    ├── countries.json
    └── cities.json
```

**兩個判斷,標明理由:**

- **`i18n.json` 七語一檔而非七個檔**【代填】:七語總是由同一批 cron 同時產生、同時更新,拆成七檔只會讓檔案數 ×7 而 diff 完全一樣。代價是 build 單一 locale 時會讀入七倍資料,但 JSON parse 成本可忽略。
- **`highlights.json` 放在 Topic 目錄下**:歷史精華是凍結內容,更新頻率極低(只有貼文退場時),與每小時都變的 `rankings/` 分開,避免拖著大檔案進每小時的 commit。

---

## 10. 還沒定、我先代填的五件事

| # | 項目 | 代填值 | 影響 |
|---|---|---|---|
| 1 | Embedding 模型 | `@cf/baai/bge-m3`(1024 維,Workers AI) | 換模型要重建整個 Vectorize index |
| 2 | cron 寫入 Cloudflare 的方式 | Worker 內部端點 + shared secret | 換方式不影響 schema |
| 3 | Moderation 啟用哪幾類 | 全部 6 類都建表,啟用與否由設定檔控制 | 不影響 schema |
| 4 | 每日 UGC 量級 | 假設 1,000 貼文 + 1 萬留言/日 → D1 免費額度約撐 1.5 年 | 決定何時要啟用 R2 分層 |
| 5 | `posts.target_country` | 保留為 nullable | Ask the World 若不需要指定國家,此欄留空即可 |

## 11. 尚未涵蓋、需另立文件的

- **API 契約**:Worker 端點的 request/response schema、錯誤碼、CORS、快取策略
- **排程規格**:19 個 job 各自的輸入/輸出/冪等性/失敗語意
- **同步協定**:主機 ↔ D1 的雙向同步細節(衝突處理、增量標記)
- **登入流程**:OAuth 三家的 callback、session、以及中國市場 Google/GitHub/LINE 皆不通的替代方案
- **來源清冊**:七個市場的合法資料來源(你說之後再找)
