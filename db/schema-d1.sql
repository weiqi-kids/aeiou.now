-- aeiou.now — Cloudflare D1 獨有的表(不在主機)
-- 權威定義:docs/02-data-model.md §5.1
-- topics / topic_i18n 在此為「精簡副本」,與 schema-host.sql 的全欄版刻意不同構,
-- 所以不放 common。副本由主機 cron 經 POST /internal/sync/topics 覆蓋。

-- §5.1 users
CREATE TABLE IF NOT EXISTS users (
  user_id       TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,                -- google|github|line
  provider_uid  TEXT NOT NULL,
  display_name  TEXT,
  avatar_url    TEXT,
  locale        TEXT,
  country_code  TEXT,                         -- 來自 Cloudflare,可覆寫
  city_code     TEXT,
  age18_declared_at INTEGER,                  -- NULL = 未宣告滿 18
  status        TEXT NOT NULL DEFAULT 'active', -- active|suspended
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  UNIQUE (provider, provider_uid)
);

-- Topic 精簡副本:Worker 只需要「能不能發文、屬於哪一期、標題怎麼顯示」
-- current_cycle_id 為副本特有欄位(主機版 topics 沒有);
-- Worker 寫 posts.cycle_id 時直接取此欄。
CREATE TABLE IF NOT EXISTS topics (
  topic_id         TEXT PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  status           TEXT NOT NULL,             -- candidate|active|cooling|archived|merged
  access_level     INTEGER NOT NULL DEFAULT 0,-- 0=匿名可 1=需登入 2=需登入且滿18
  is_perennial     INTEGER NOT NULL DEFAULT 0,
  global_score     REAL NOT NULL DEFAULT 0,
  current_cycle_id TEXT                       -- 副本特有:發文當下的期別
);
CREATE INDEX IF NOT EXISTS idx_topics_slug ON topics(slug);

CREATE TABLE IF NOT EXISTS topic_i18n (
  topic_id TEXT NOT NULL,
  locale   TEXT NOT NULL,
  title    TEXT NOT NULL,
  PRIMARY KEY (topic_id, locale)
);

-- 入口限流事件(2026-08-15 Bot 防護第一層;D1 獨有,不回流主機)
-- key = 'anon:<anon_id>' 或 'ip:<sha256(SYNC_SECRET+ip) hex>'(不存明文 IP)
-- kind = post|comment|reaction。舊事件由 Worker 寫入時機率性清除(>25h)。
CREATE TABLE IF NOT EXISTS rate_events (
  kind TEXT NOT NULL,
  key  TEXT NOT NULL,
  ts   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_events ON rate_events(kind, key, ts);
