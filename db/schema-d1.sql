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
  -- 2026-08-22:語意搜尋的**確定性比對層**要用(別名/俗名的字面命中,見 routes/search.js)。
  -- ⚠ 逗號要在同一行的欄位定義後面 —— 把註解夾在欄位與逗號之間會讓整個 CREATE TABLE
  --   語法錯誤,而測試用的 D1 就是從這個檔建的(2026-08-22 踩過,整批測試一次全紅)。
  keywords_json TEXT,
  PRIMARY KEY (topic_id, locale)
);

-- 入口限流事件(2026-08-15 Bot 防護第一層;D1 獨有,不回流主機)
-- key = 'anon:<anon_id>' 或 'ip:<sha256(SYNC_SECRET+ip) hex>'(不存明文 IP)
-- kind = post|comment|reaction|vote。舊事件由 Worker 寫入時機率性清除(>25h)。
CREATE TABLE IF NOT EXISTS rate_events (
  kind TEXT NOT NULL,
  key  TEXT NOT NULL,
  ts   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_events ON rate_events(kind, key, ts);

-- 每日世界一問(2026-08-15;規格 docs/briefs/daily-question.md §3)
-- questions 精簡副本(主機 → /internal/sync/questions 覆蓋)。
-- 題面文案不進 D1(那是靜態層的事);但 guess 的正解與解說 2026-08-21 起**進 D1** ——
-- 它們原本在靜態 JSON 裡,view-source 就能先看到答案。揭曉條件是「這個 anon_id 投過票了」,
-- 只有 D1 知道那件事,所以答案得跟過來(契約 §7.1)。
CREATE TABLE IF NOT EXISTS questions (
  question_id  TEXT PRIMARY KEY,
  qdate        TEXT NOT NULL,
  kind         TEXT NOT NULL,
  topic_id     TEXT NOT NULL,
  options_json TEXT NOT NULL,              -- JSON 陣列:合法 option_id 清單
  status       TEXT NOT NULL DEFAULT 'active',
  answer_option TEXT,                      -- guess 的正解 option_id;poll 恆 NULL
  explain_json  TEXT                       -- JSON 物件 {locale: 解說};缺該語系就不給句子
);
-- 一人一題一票;重投 = 覆蓋 option_id(created_at 保留首次投票時間,參與統計以它計日)
CREATE TABLE IF NOT EXISTS question_votes (
  question_id TEXT NOT NULL,
  anon_id     TEXT NOT NULL,
  option_id   TEXT NOT NULL,
  locale      TEXT NOT NULL,               -- 投票者所在站的語系(=社群)
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (question_id, anon_id)
);
CREATE INDEX IF NOT EXISTS idx_question_votes_q   ON question_votes (question_id, locale, option_id);
CREATE INDEX IF NOT EXISTS idx_question_votes_day ON question_votes (created_at);

-- ---------------------------------------------------------------------------
-- 規則層 moderation 的原始紀錄(2026-08-22;草案 §33 Job 17 的寫入端那一半)
-- ---------------------------------------------------------------------------
-- 為什麼要有這張表:**留言從來沒有被任何東西看過**。貼文有 LLM 價值閘門(翻譯前判一次),
-- 但留言不翻譯(契約 §3),所以它從來不進那條路;而留言連回流主機都沒有,
-- 主機端的任何審核也看不到它。
--
-- 這張表只是「發生過什麼」的**原始紀錄**,不是工作檯 —— 人工複核用的
-- `moderation_queue` 在主機(見 docs/02-data-model.md §7)。主機端 job 每 15 分鐘
-- 把 synced_at IS NULL 的列拉回去建檔,建完回寫 synced_at。
--
-- 一個目標只留一列(ON CONFLICT DO NOTHING):同一則內容被規則層判過就是判過了,
-- 重複寫入只會讓同一件事在工作檯上出現兩次。
CREATE TABLE IF NOT EXISTS moderation_flags (
  target_type TEXT NOT NULL,                 -- post|comment
  target_id   TEXT NOT NULL,
  anon_id     TEXT,                          -- 誰送的(供「同一人反覆命中」的判斷)
  severity    TEXT NOT NULL,                 -- low|medium|high
  reason      TEXT NOT NULL,                 -- 與 moderation_queue.reason 同一組列舉
  detail      TEXT,                          -- 命中了哪一條規則(給人看的,不做判斷)
  created_at  INTEGER NOT NULL,
  synced_at   INTEGER,                       -- NULL = 主機還沒拉走
  PRIMARY KEY (target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_moderation_flags_pending ON moderation_flags(synced_at, created_at);
