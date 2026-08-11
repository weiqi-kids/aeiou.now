-- aeiou.now — 兩邊完全同構的表(主機 SQLite 與 Cloudflare D1 都建)
-- 權威定義:docs/02-data-model.md §5–§6
-- 規則:同一個資料庫不得由兩份檔案重複定義同一張表。
--       本檔的表在 host 與 d1 兩邊結構完全相同,故獨立成 common。

-- §5.2 posts —— UGC 貼文(權威來源在 D1,主機由 translate-posts.mjs 回流一份副本)
CREATE TABLE IF NOT EXISTS posts (
  post_id        TEXT PRIMARY KEY,
  topic_id       TEXT NOT NULL,              -- 歸屬唯一,不可跨 Topic
  cycle_id       TEXT,                       -- 發文當下該 Topic 的期別
  user_id        TEXT,                       -- NULL = 匿名(僅 access_level=0 允許)
  anon_id        TEXT,                       -- 匿名時的簽名識別,供檢舉追蹤

  original_locale TEXT NOT NULL,
  content        TEXT NOT NULL,              -- 原文,Markdown 安全子集(M1 顯示為純文字轉義)
  media_json     TEXT,                       -- 圖片 M2 啟用,M1 恆 NULL
  target_country TEXT,                       -- Ask the World 指定提問對象,可為 NULL

  country_code   TEXT NOT NULL,              -- 來自 Cloudflare request.cf
  city_code      TEXT,                       -- 城市級,不存座標

  views          INTEGER NOT NULL DEFAULT 0,
  unique_views   INTEGER NOT NULL DEFAULT 0,
  comments       INTEGER NOT NULL DEFAULT 0,
  likes          INTEGER NOT NULL DEFAULT 0,
  shares         INTEGER NOT NULL DEFAULT 0,
  cross_country_engagements INTEGER NOT NULL DEFAULT 0,
  hot_score      REAL NOT NULL DEFAULT 0,    -- M1 沒有 hot_score job,恆 0 不得用

  status         TEXT NOT NULL,              -- active|cooling|archived|moderation|deleted
  translation_status TEXT NOT NULL DEFAULT 'pending', -- pending|translating|done|skipped

  created_at     INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  archived_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_posts_feed ON posts(topic_id, status, hot_score DESC);
CREATE INDEX IF NOT EXISTS idx_posts_new  ON posts(topic_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_pending_translation ON posts(translation_status, created_at)
  WHERE translation_status IN ('pending','translating');
CREATE INDEX IF NOT EXISTS idx_posts_geo ON posts(topic_id, country_code, city_code, status);

-- §5.3 post_i18n —— 貼文七語翻譯
CREATE TABLE IF NOT EXISTS post_i18n (
  post_id       TEXT NOT NULL,
  locale        TEXT NOT NULL,
  content       TEXT NOT NULL,
  translated_at INTEGER NOT NULL,
  translator    TEXT NOT NULL DEFAULT 'claude', -- claude|codex|manual
  PRIMARY KEY (post_id, locale)
);

-- §5.4 comments —— 兩層結構,不翻譯
CREATE TABLE IF NOT EXISTS comments (
  comment_id     TEXT PRIMARY KEY,
  post_id        TEXT NOT NULL,              -- 只掛在 post,不巢狀
  topic_id       TEXT NOT NULL,              -- 反正規化,省 join
  user_id        TEXT,
  anon_id        TEXT,
  locale         TEXT NOT NULL,
  content        TEXT NOT NULL,              -- 只有原文,不翻譯
  country_code   TEXT NOT NULL,
  city_code      TEXT,
  likes          INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL,              -- active|archived|moderation|deleted
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at);

-- §5.5 reactions —— 純 emoji,固定集合 ❤️ 😂 😮 😢 🤔 🎉 👏(不含 👍)
CREATE TABLE IF NOT EXISTS reactions (
  target_type TEXT NOT NULL,                 -- post|comment
  target_id   TEXT NOT NULL,
  actor_id    TEXT NOT NULL,                 -- user_id 或 anon_id
  kind        TEXT NOT NULL,                 -- emoji;同一 actor 可對同一目標按多個不同 emoji
  country_code TEXT NOT NULL,                -- 供 CrossCountryScore 計算
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (target_type, target_id, actor_id, kind)
);

-- §5.6 post_highlights —— 本期精華與歷史精華(取代 Post 的七時窗榜)
CREATE TABLE IF NOT EXISTS post_highlights (
  post_id         TEXT NOT NULL,
  topic_id        TEXT NOT NULL,
  kind            TEXT NOT NULL,             -- cycle|alltime
  cycle_id        TEXT,                      -- kind='cycle' 時必填
  rank            INTEGER NOT NULL,
  score_at_freeze REAL NOT NULL,
  frozen_at       INTEGER NOT NULL,
  PRIMARY KEY (post_id, kind, cycle_id)
);
CREATE INDEX IF NOT EXISTS idx_highlights ON post_highlights(topic_id, kind, rank);

-- §6 排行域
CREATE TABLE IF NOT EXISTS ranking_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  scope       TEXT NOT NULL,                 -- global|country:JP|city:tokyo
  window      TEXT NOT NULL,                 -- 8h|24h|72h|7d|1m|3m|1y
  taken_at    INTEGER NOT NULL,
  granularity TEXT NOT NULL,                 -- 15m|hourly|daily
  UNIQUE (scope, window, taken_at)
);

CREATE TABLE IF NOT EXISTS ranking_items (
  snapshot_id TEXT NOT NULL,
  rank        INTEGER NOT NULL,
  topic_id    TEXT NOT NULL,
  score       REAL NOT NULL,
  PRIMARY KEY (snapshot_id, rank)
);
