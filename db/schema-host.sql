-- aeiou.now — 主機 SQLite 獨有的表(不進 D1)
-- 權威定義:docs/02-data-model.md §2–§4、§7–§8
-- 與 schema-d1.sql 的 topics / topic_i18n 為「不同構副本」,是明示例外,不算重複定義。

-- ============ §2 Topic 域(全欄版) ============

CREATE TABLE IF NOT EXISTS topics (
  topic_id        TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,       -- 'affection-and-reciprocity',URL 用
  canonical_name  TEXT NOT NULL,              -- 語言中立的正規名稱(英文為主)
  commonality     TEXT NOT NULL DEFAULT '',   -- 跨國共通性分類依據,不是日期名稱
  category        TEXT NOT NULL,              -- 主題分類軸(不承載來源)。正典清單見 CONTEXT.md
                                              -- civic|community|education|faith|family|festival|food|home|life-stage|relationship|remembrance|seasonal
  status          TEXT NOT NULL,              -- candidate|active|cooling|archived|merged
  merged_into     TEXT,                       -- status='merged' 時指向合併目標
  is_perennial    INTEGER NOT NULL DEFAULT 0, -- 1 = 長青(如 ask-the-world),永不 cooling

  access_level    INTEGER NOT NULL DEFAULT 0, -- 0=匿名可 1=需登入 2=需登入且滿18
  access_source   TEXT NOT NULL DEFAULT 'category', -- 來源軸的唯一正典標記(ADR-0001)
                                              -- manual|category|trend

  global_score    REAL NOT NULL DEFAULT 0,
  first_seen_at   INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status, global_score DESC);
CREATE INDEX IF NOT EXISTS idx_topics_category ON topics(category, status);

CREATE TABLE IF NOT EXISTS topic_i18n (
  topic_id      TEXT NOT NULL,
  locale        TEXT NOT NULL,
  title         TEXT NOT NULL,
  summary       TEXT,                         -- AI 摘要
  keywords_json TEXT,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (topic_id, locale)
);

-- §2.3 「全世界怎麼過」的事實層
-- 一個 Topic 在同一個國家可以有多個地方表現(observance),各自有自己的日期、名稱與來源。
-- 例如「表達愛意與互惠」可以同時掛上日本的情人節與白色情人節,不能再用
-- (topic_id, country_code) 當主鍵把它們壓成一列。
CREATE TABLE IF NOT EXISTS topic_observances (
  observance_id  TEXT PRIMARY KEY,
  topic_id       TEXT NOT NULL,
  observance_key TEXT NOT NULL,               -- 該國在 topic 內穩定的小寫識別字,如 valentine / white-day
  country_code   TEXT NOT NULL,
  local_name     TEXT NOT NULL,               -- 地方表現的原文名稱
  observed_date  TEXT,                        -- 'MM-DD' 固定日期
  date_rule      TEXT,                        -- 非固定日期的規則
  date_range_end TEXT,                        -- 跨日期間的結束
  popularity_rank INTEGER,
  source_ids_json TEXT NOT NULL,              -- 佐證來源,必填,SEO 的抗辯基礎
  updated_at     INTEGER NOT NULL,
  UNIQUE (topic_id, country_code, observance_key)
);
CREATE INDEX IF NOT EXISTS idx_topic_observances_topic
  ON topic_observances(topic_id, country_code, observed_date);
CREATE INDEX IF NOT EXISTS idx_topic_observances_date
  ON topic_observances(observed_date, date_range_end);

-- §2.3a 「全世界怎麼過」的年度實際發生日
-- date_rule 保留文化規則；occurrence 才是某一年的可排序公曆日期。
-- 同一個地方表現同一年可以有多個日期區段，不能再把它壓回 observance 一列。
CREATE TABLE IF NOT EXISTS topic_observance_occurrences (
  occurrence_id   TEXT PRIMARY KEY,
  observance_id   TEXT NOT NULL,
  occurrence_year INTEGER NOT NULL,
  starts_on       TEXT NOT NULL,              -- 'YYYY-MM-DD',地方時區的日期
  ends_on         TEXT,                       -- NULL = 單日；含首尾日
  calendar_system TEXT NOT NULL,              -- gregorian|chinese-lunisolar|hindu-lunisolar|islamic|solar-term|local
  timezone        TEXT NOT NULL,              -- IANA timezone,例如 Asia/Taipei
  date_status     TEXT NOT NULL,              -- confirmed|estimated|local-variant
  source_ids_json TEXT NOT NULL,              -- 該年度日期的佐證來源
  updated_at      INTEGER NOT NULL,
  UNIQUE (observance_id, occurrence_year, starts_on)
);
CREATE INDEX IF NOT EXISTS idx_topic_observance_occurrences_date
  ON topic_observance_occurrences(starts_on, ends_on);
CREATE INDEX IF NOT EXISTS idx_topic_observance_occurrences_observance
  ON topic_observance_occurrences(observance_id, occurrence_year, starts_on);

CREATE TABLE IF NOT EXISTS topic_observance_i18n (
  observance_id  TEXT NOT NULL,
  locale         TEXT NOT NULL,
  customs_text   TEXT NOT NULL,
  -- 「日期怎麼定」的本地語言說法(2026-08-21)。可為 NULL:固定日期的 observance
  -- 本來就沒有規則可講。**為什麼要有這一欄**:topic_observances.date_rule 是單一字串,
  -- 實際上 100% 是中文,但它會出現在七個站的畫面上——en/ja/hi/id/pt-BR 的讀者
  -- 看到的是「5 月第一個完整星期，地方學區日期可能不同」。七語系是七個獨立的站,
  -- 沒有 per-locale 版本的字串就不該渲染,所以那一欄先從畫面移除,改由這裡供應。
  date_rule_text TEXT,
  PRIMARY KEY (observance_id, locale)
);

-- §2.4 Topic Graph
CREATE TABLE IF NOT EXISTS topic_aliases (
  alias_id   TEXT PRIMARY KEY,
  topic_id   TEXT NOT NULL,
  alias      TEXT NOT NULL,
  locale     TEXT,                            -- NULL = 跨語系通用
  source     TEXT NOT NULL,                   -- llm|manual|crawl
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alias_lookup ON topic_aliases(alias);

CREATE TABLE IF NOT EXISTS topic_relations (
  from_topic_id TEXT NOT NULL,
  to_topic_id   TEXT NOT NULL,
  relation      TEXT NOT NULL,                -- related|country_branch|local_topic|parent
  country_code  TEXT,
  weight        REAL NOT NULL DEFAULT 1.0,
  created_at    INTEGER NOT NULL,
  PRIMARY KEY (from_topic_id, to_topic_id, relation)
);

-- §2.5 七時窗分數
CREATE TABLE IF NOT EXISTS topic_scores (
  topic_id    TEXT NOT NULL,
  scope       TEXT NOT NULL,                  -- 'global' | 'country:JP' | 'city:tokyo'
  window      TEXT NOT NULL,                  -- 8h|24h|72h|7d|1m|3m|1y
  score       REAL NOT NULL,
  rank        INTEGER,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (topic_id, scope, window)
);
CREATE INDEX IF NOT EXISTS idx_scores_rank ON topic_scores(scope, window, rank);

-- §2.6 「本期」的定義:一期 = 一次 active 週期
CREATE TABLE IF NOT EXISTS topic_cycles (
  cycle_id    TEXT PRIMARY KEY,
  topic_id    TEXT NOT NULL,
  label       TEXT NOT NULL,                  -- '2026-02'
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER,                        -- NULL = 進行中
  peak_score  REAL,
  peak_rank   INTEGER,
  post_count  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (topic_id, started_at)
);

-- ============ 每日世界一問域(2026-08-15 新增;規格見 docs/briefs/daily-question.md §2) ============
-- 權威來源 = content/questions.json;import-questions.mjs 整組 DELETE 重建,不放時間戳(維持 export 決定論)。

CREATE TABLE IF NOT EXISTS questions (
  question_id   TEXT PRIMARY KEY,          -- content id(非 ULID,人工可讀)
  qdate         TEXT NOT NULL,             -- YYYY-MM-DD(UTC)
  kind          TEXT NOT NULL CHECK (kind IN ('poll','guess')),
  topic_id      TEXT NOT NULL,             -- import 時由 slug 解析
  asker_locale  TEXT,
  target_locale TEXT,
  answer_option TEXT,                      -- kind=guess 才有
  status        TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS question_i18n (
  question_id TEXT NOT NULL, locale TEXT NOT NULL,
  text TEXT NOT NULL, explain TEXT,
  PRIMARY KEY (question_id, locale)
);
CREATE TABLE IF NOT EXISTS question_options (
  question_id TEXT NOT NULL, option_id TEXT NOT NULL,
  ord INTEGER NOT NULL, emoji TEXT,
  PRIMARY KEY (question_id, option_id)
);
CREATE TABLE IF NOT EXISTS question_option_i18n (
  question_id TEXT NOT NULL, option_id TEXT NOT NULL, locale TEXT NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (question_id, option_id, locale)
);

-- ============ §3 在地域 ============

CREATE TABLE IF NOT EXISTS places (
  place_id     TEXT PRIMARY KEY,
  name         TEXT NOT NULL,                 -- 語言中立:店家原文名稱
  city_code    TEXT NOT NULL,
  country_code TEXT NOT NULL,
  address      TEXT,
  map_url      TEXT,                          -- Google Maps 連結(純字串組裝)
  nav_urls_json TEXT,                         -- {"google":"...","baidu":"...","amap":"..."}
  mention_count INTEGER NOT NULL DEFAULT 0,
  discovered_via TEXT NOT NULL DEFAULT 'mention', -- mention|search
  source_urls_json TEXT,                      -- discovered_via='search' 必填
  first_seen_at INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_places_city ON places(city_code, mention_count DESC);

CREATE TABLE IF NOT EXISTS place_i18n (
  place_id    TEXT NOT NULL,
  locale      TEXT NOT NULL,
  description TEXT,
  PRIMARY KEY (place_id, locale)
);

CREATE TABLE IF NOT EXISTS place_topics (
  place_id  TEXT NOT NULL,
  topic_id  TEXT NOT NULL,
  relevance REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (place_id, topic_id)
);

CREATE TABLE IF NOT EXISTS events (
  event_id     TEXT PRIMARY KEY,
  name         TEXT NOT NULL,                 -- 語言中立原文名稱
  city_code    TEXT NOT NULL,
  country_code TEXT NOT NULL,
  venue        TEXT,
  start_at     INTEGER,
  end_at       INTEGER,
  ticket_url   TEXT,
  source_id    TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(city_code, start_at);

CREATE TABLE IF NOT EXISTS event_i18n (
  event_id    TEXT NOT NULL,
  locale      TEXT NOT NULL,
  description TEXT,
  PRIMARY KEY (event_id, locale)
);

CREATE TABLE IF NOT EXISTS event_topics (
  event_id  TEXT NOT NULL,
  topic_id  TEXT NOT NULL,
  relevance REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, topic_id)
);

-- ============ §4 來源域(只在主機) ============

CREATE TABLE IF NOT EXISTS sources (
  source_id     TEXT PRIMARY KEY,
  url           TEXT NOT NULL UNIQUE,
  domain        TEXT NOT NULL,
  source_type   TEXT NOT NULL,                -- 草案 §12 的 8 類
  language      TEXT,
  country_code  TEXT,
  city_code     TEXT,
  title         TEXT,
  published_at  INTEGER,
  crawled_at    INTEGER,
  next_crawl_at INTEGER NOT NULL,             -- 草案 §13 的分級頻率
  crawl_freq_s  INTEGER NOT NULL,             -- 900|3600|21600|86400
  content_hash  TEXT,
  quality_score REAL,
  trust_score   REAL,
  status        TEXT NOT NULL,                -- new|processed|ignored|duplicate|error
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_due ON sources(next_crawl_at) WHERE status != 'ignored';

CREATE TABLE IF NOT EXISTS source_contents (
  source_id    TEXT PRIMARY KEY,
  raw_text     TEXT,                          -- 30 天後移入 R2,此欄設 NULL
  r2_key       TEXT,
  extracted_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS source_topics (
  source_id  TEXT NOT NULL,
  topic_id   TEXT NOT NULL,
  confidence REAL NOT NULL,
  PRIMARY KEY (source_id, topic_id)
);

-- ============ §7 運行域 ============

CREATE TABLE IF NOT EXISTS jobs (
  job_id          TEXT PRIMARY KEY,
  job_name        TEXT NOT NULL,
  scope           TEXT NOT NULL,              -- 'global' 或 locale
  scheduled_at    INTEGER NOT NULL,
  started_at      INTEGER,
  finished_at     INTEGER,
  status          TEXT NOT NULL,              -- queued|running|success|partial_success|failed|skipped
  attempt         INTEGER NOT NULL DEFAULT 0,
  next_retry_at   INTEGER,                    -- 失敗 +5 分、再失敗 +10 分、第三次進 DLQ
  records_read    INTEGER NOT NULL DEFAULT 0,
  records_created INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  records_failed  INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_retry ON jobs(status, next_retry_at);

CREATE TABLE IF NOT EXISTS job_locks (
  scope        TEXT NOT NULL,
  job_name     TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  locked_by    TEXT NOT NULL,
  locked_at    INTEGER NOT NULL,
  PRIMARY KEY (scope, job_name, scheduled_at)
);

CREATE TABLE IF NOT EXISTS moderation_queue (
  item_id      TEXT PRIMARY KEY,
  target_type  TEXT NOT NULL,                 -- post|comment|user|topic
  target_id    TEXT NOT NULL,
  reason       TEXT NOT NULL,                 -- spam|harassment|illegal|malicious_link|commercial|bot|correction
  reported_by  TEXT,                          -- NULL = 系統自動偵測
  severity     TEXT NOT NULL,                 -- low|medium|high
  status       TEXT NOT NULL,                 -- pending|reviewing|resolved|dismissed
  decision     TEXT,                          -- keep|hide|delete|suspend
  decided_by   TEXT,                          -- rule|llm|human
  created_at   INTEGER NOT NULL,
  resolved_at  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_moderation_pending ON moderation_queue(status, severity, created_at);

CREATE TABLE IF NOT EXISTS quality_checks (
  check_id    TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  label       TEXT NOT NULL,                  -- verified|source-backed|needs-review|low-quality|spam
  checked_by  TEXT NOT NULL,                  -- rule|llm
  checked_at  INTEGER NOT NULL
);

-- ============ §7.5 外部搜尋趨勢自動 Topic 域 ============
-- 這組表是 machine-owned；不得用 content/topics/*.md 回寫或覆蓋。
-- run/observation/publication 分開，讓同一個時間槽重跑時可安全重播，
-- 也讓單一趨勢項目失敗時不會拖垮同一輪其他項目。
CREATE TABLE IF NOT EXISTS trend_runs (
  run_key       TEXT PRIMARY KEY,             -- provider:market:slot_start
  provider      TEXT NOT NULL,
  market        TEXT NOT NULL,
  slot_start    INTEGER NOT NULL,
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  status        TEXT NOT NULL,                -- running|success|partial_success|failed
  records_read  INTEGER NOT NULL DEFAULT 0,
  records_created INTEGER NOT NULL DEFAULT 0,
  records_failed INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_trend_runs_status ON trend_runs(provider, market, slot_start, status);

CREATE TABLE IF NOT EXISTS trend_observations (
  observation_id    TEXT PRIMARY KEY,
  run_key           TEXT NOT NULL,
  provider          TEXT NOT NULL,
  market            TEXT NOT NULL,
  provider_item_key TEXT NOT NULL,
  event_key         TEXT NOT NULL,             -- normalized cross-market event key
  title             TEXT NOT NULL,
  url               TEXT NOT NULL,
  traffic           TEXT,
  rank              INTEGER,
  published_at      INTEGER,
  observed_at       INTEGER NOT NULL,
  raw_json          TEXT NOT NULL,
  UNIQUE (run_key, provider_item_key)
);
CREATE INDEX IF NOT EXISTS idx_trend_observations_event ON trend_observations(provider, event_key, observed_at);

CREATE TABLE IF NOT EXISTS trend_topic_state (
  provider       TEXT NOT NULL,
  event_key      TEXT NOT NULL,
  topic_id       TEXT NOT NULL UNIQUE,
  state          TEXT NOT NULL,                -- active|cooling|expired|blocked
  first_seen_at  INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL,
  published_at   INTEGER,
  content_hash   TEXT,
  PRIMARY KEY (provider, event_key)
);
CREATE INDEX IF NOT EXISTS idx_trend_topic_expiry ON trend_topic_state(state, expires_at);

CREATE TABLE IF NOT EXISTS trend_publications (
  publication_key TEXT PRIMARY KEY,            -- topic_id:content_hash
  topic_id        TEXT NOT NULL,
  provider        TEXT NOT NULL,
  event_key       TEXT NOT NULL,
  content_hash    TEXT NOT NULL,
  published_at    INTEGER NOT NULL,
  status          TEXT NOT NULL,               -- published|failed|rolled_back
  error_message   TEXT
);
CREATE INDEX IF NOT EXISTS idx_trend_publications_topic ON trend_publications(topic_id, published_at);

-- ============ §8 分析域 ============

CREATE TABLE IF NOT EXISTS analytics_aggregates (
  bucket_at    INTEGER NOT NULL,              -- 15 分鐘對齊
  dimension    TEXT NOT NULL,                 -- topic|post|country|city|locale|referrer
  dimension_id TEXT NOT NULL,
  metric       TEXT NOT NULL,                 -- page_views|unique_users|comments|likes|shares|searches
  value        INTEGER NOT NULL,
  PRIMARY KEY (bucket_at, dimension, dimension_id, metric)
);

-- ============ §8.1 搜尋曝光域(2026-08-20 新增) ============
-- 立法緣由:HotScore 的「瀏覽面」原訂接 GA4,但 2026-08-20 診斷實測 GA4 有 96% 是機器流量
-- (28 天 146 sessions,其中 140 個是 direct + 0–4 秒 + 落在各站根目錄的資料中心爬蟲),
-- 而七站在 GitHub Pages 上、前面沒有 CDN,這個汙染擋不掉。GSC 則是 Google 自己去重過的
-- 搜尋面,爬蟲不會出現在裡面,且天然按 page 聚合 → 對得上 topic slug。
--
-- 這張表只是**原始每日觀測值的累積**,不是分數:
--   * GSC API 只回溯 16 個月且沒有「當時的快照」,今天不開始存,以後補不回來。
--   * 目前量還太小(28 天 110 曝光),不足以驅動排名——所以先累積,不接 topic_scores。
--     什麼時候夠?判準寫在 scripts/gsc-topic-metrics.mjs 檔頭。
CREATE TABLE IF NOT EXISTS topic_search_metrics (
  metric_date  TEXT NOT NULL,                 -- 'YYYY-MM-DD',GSC 的資料日(非抓取日)
  topic_id     TEXT NOT NULL,
  locale       TEXT NOT NULL,                 -- 由子網域反查(aeiou.now→zh-TW、jp.→ja…)
  scope        TEXT NOT NULL,                 -- 'global' | 'country:XX'(GSC country 維度)
  impressions  INTEGER NOT NULL DEFAULT 0,
  clicks       INTEGER NOT NULL DEFAULT 0,
  position_sum REAL NOT NULL DEFAULT 0,       -- 曝光加權名次的分子;平均名次 = position_sum/impressions
  fetched_at   INTEGER NOT NULL,
  PRIMARY KEY (metric_date, topic_id, locale, scope)
);
CREATE INDEX IF NOT EXISTS idx_tsm_topic_date ON topic_search_metrics(topic_id, metric_date);
CREATE INDEX IF NOT EXISTS idx_tsm_date ON topic_search_metrics(metric_date);

-- ============ §8.2 搜尋查詢域(2026-08-22 新增) =============================
-- GSC 的 page/country 聚合可以餵 HotScore，但無法回答「哪個查詢落在哪頁、
-- 為什麼前十名沒有點擊」。這張表保存主機私有的 query × page × date 聚合，
-- 不進 data/、D1 或前端；page_url 直接保存當時的 canonical URL，避免 slug
-- 改名後把歷史查詢錯接到新頁。
--
-- 查詢字串來自 Google Search Console 的聚合報表，不直接等於讀者身分，
-- 但仍可能含敏感詞；只留在主機，用於 SEO 工作清單，不在任何靜態 export 路徑上。
CREATE TABLE IF NOT EXISTS gsc_query_metrics (
  metric_date  TEXT NOT NULL,                 -- 'YYYY-MM-DD',GSC 的資料日
  locale       TEXT NOT NULL,                 -- 由頁面子網域反查
  query        TEXT NOT NULL,                 -- GSC query 維度
  page_url     TEXT NOT NULL,                 -- GSC page 維度
  impressions  INTEGER NOT NULL DEFAULT 0,
  clicks       INTEGER NOT NULL DEFAULT 0,
  position_sum REAL NOT NULL DEFAULT 0,       -- 曝光加權名次的分子
  fetched_at   INTEGER NOT NULL,
  PRIMARY KEY (metric_date, locale, query, page_url)
);
CREATE INDEX IF NOT EXISTS idx_gqm_date ON gsc_query_metrics(metric_date);
CREATE INDEX IF NOT EXISTS idx_gqm_page ON gsc_query_metrics(page_url, metric_date);
CREATE INDEX IF NOT EXISTS idx_gqm_query ON gsc_query_metrics(query, metric_date);

-- ============ §8.3 SEO 成長回饋域(2026-08-23) =============================
-- 每日把 GA4 報表、GSC 查詢工作與季節跑道凍成一筆快照，避免「跑過一次就忘了」
-- 或拿不同資料窗直接比較。query/page 本身已在 gsc_query_metrics 保存；這裡只留
-- 可回看的聚合與目前工作狀態，仍不進 data/、D1 或前端。
CREATE TABLE IF NOT EXISTS seo_growth_snapshots (
  snapshot_date       TEXT PRIMARY KEY,       -- UTC YYYY-MM-DD
  generated_at        INTEGER NOT NULL,
  window_days         INTEGER NOT NULL,
  cutoff              TEXT NOT NULL,
  data_days           INTEGER NOT NULL DEFAULT 0,
  query_page_pairs    INTEGER NOT NULL DEFAULT 0,
  impressions         INTEGER NOT NULL DEFAULT 0,
  clicks              INTEGER NOT NULL DEFAULT 0,
  weighted_position   REAL,
  ga_page_views       INTEGER NOT NULL DEFAULT 0,
  ga_page_views_human INTEGER NOT NULL DEFAULT 0,
  ga_sessions         INTEGER NOT NULL DEFAULT 0,
  p0                  INTEGER NOT NULL DEFAULT 0,
  p1                  INTEGER NOT NULL DEFAULT 0,
  p2                  INTEGER NOT NULL DEFAULT 0,
  p3                  INTEGER NOT NULL DEFAULT 0,
  intent_json         TEXT NOT NULL DEFAULT '{}',
  season_json         TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS seo_growth_actions (
  locale        TEXT NOT NULL,
  query         TEXT NOT NULL,
  page_url      TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  priority      TEXT NOT NULL,
  impressions   INTEGER NOT NULL DEFAULT 0,
  clicks        INTEGER NOT NULL DEFAULT 0,
  position      REAL,
  action        TEXT NOT NULL,
  reasons_json  TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'open',
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (locale, query, page_url)
);
CREATE INDEX IF NOT EXISTS idx_seo_growth_actions_priority
  ON seo_growth_actions(status, priority, last_seen_at);

-- ---------------------------------------------------------------------------
-- reaction 計數回流(2026-08-21)
-- ---------------------------------------------------------------------------
-- reaction 的權威在 D1(讀者按的),主機沒有。於是 /topics/events/ 與 /topics/nearby/
-- 的 emoji 排序只能在前端做:先印出靜態順序,等 JS 拿到 /v1/reactions/summary 再重排。
-- 讀者看得到那一跳,而不執行 JS 的爬蟲看到的永遠是未排序的那一版。
--
-- 這張表是**副本不是權威**:整批以 /internal/ugc/reaction-totals 的回應覆蓋,
-- 每小時一次(hourly-export.sh)。主機端不寫、不改、不據此做任何判斷,只餵給 export。
-- 刻意不存 actor_id —— 主機不需要知道誰按的,回流也不該把匿名者的行為軌跡搬出 D1。
CREATE TABLE IF NOT EXISTS reaction_totals (
  target_type TEXT NOT NULL,                  -- post|comment|place|event(契約 §4)
  target_id   TEXT NOT NULL,
  total       INTEGER NOT NULL DEFAULT 0,     -- reaction 列數(同一人按三顆 = 3)
  actors      INTEGER NOT NULL DEFAULT 0,     -- 不同 anon_id 數
  synced_at   INTEGER NOT NULL,
  PRIMARY KEY (target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_reaction_totals_type ON reaction_totals(target_type, total DESC);
