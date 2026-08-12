-- aeiou.now — 主機 SQLite 獨有的表(不進 D1)
-- 權威定義:docs/02-data-model.md §2–§4、§7–§8
-- 與 schema-d1.sql 的 topics / topic_i18n 為「不同構副本」,是明示例外,不算重複定義。

-- ============ §2 Topic 域(全欄版) ============

CREATE TABLE IF NOT EXISTS topics (
  topic_id        TEXT PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,       -- 'affection-and-reciprocity',URL 用
  canonical_name  TEXT NOT NULL,              -- 語言中立的正規名稱(英文為主)
  commonality     TEXT NOT NULL DEFAULT '',   -- 跨國共通性分類依據,不是日期名稱
  category        TEXT NOT NULL,              -- 草案 §4.1 的 15 類
  status          TEXT NOT NULL,              -- candidate|active|cooling|archived|merged
  merged_into     TEXT,                       -- status='merged' 時指向合併目標
  is_perennial    INTEGER NOT NULL DEFAULT 0, -- 1 = 長青(如 ask-the-world),永不 cooling

  access_level    INTEGER NOT NULL DEFAULT 0, -- 0=匿名可 1=需登入 2=需登入且滿18
  access_source   TEXT NOT NULL DEFAULT 'category', -- category|manual|moderation

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

CREATE TABLE IF NOT EXISTS topic_observance_i18n (
  observance_id TEXT NOT NULL,
  locale        TEXT NOT NULL,
  customs_text  TEXT NOT NULL,
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

-- ============ §8 分析域 ============

CREATE TABLE IF NOT EXISTS analytics_aggregates (
  bucket_at    INTEGER NOT NULL,              -- 15 分鐘對齊
  dimension    TEXT NOT NULL,                 -- topic|post|country|city|locale|referrer
  dimension_id TEXT NOT NULL,
  metric       TEXT NOT NULL,                 -- page_views|unique_users|comments|likes|shares|searches
  value        INTEGER NOT NULL,
  PRIMARY KEY (bucket_at, dimension, dimension_id, metric)
);
