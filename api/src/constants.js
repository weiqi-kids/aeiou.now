// aeiou-api 的介面常數。**這些是契約,不是現況** —— 值的變更等同 API 契約變更,
// 動它之前先讀 docs/briefs/api-contract.md 並問用戶(CLAUDE.md 介面常數段)。

// aeiou-api — 動態互動層:討論室發文/留言/reaction + 8H 即時 feed
// 唯一契約:docs/briefs/api-contract.md(欄位名不得自行加減)
// M1 刻意不做:Turnstile(被實際攻擊再補)、OAuth、圖片、Markdown 渲染。
// 入口限流(2026-08-15):寫入端點依 anon_id 與 IP 雙鍵計數,超限回 429 rate_limited。

export const REACTION_SET = ["❤️", "😂", "😮", "😢", "🤔", "🎉", "👏"]; // 不含 👍(用戶明示排除)
export const LOCALES = ["zh-TW", "en", "ja", "zh-CN", "hi", "id", "pt-BR"];
// 2026-08-15 起七站掛自訂網域;github.io 保留供轉址過渡與手動重現
export const ALLOWED_ORIGINS = [
  "https://aeiou.now",
  "https://en.aeiou.now",
  "https://jp.aeiou.now",
  "https://cn.aeiou.now",
  "https://hi.aeiou.now",
  "https://id.aeiou.now",
  "https://br.aeiou.now",
  "https://weiqi-kids.github.io",
];
export const WINDOW_HOURS = 8;
export const POST_MAX_CHARS = 5000;
export const COMMENT_MAX_CHARS = 2000;

// 限流上限(對真人寬鬆、對腳本致命;anon_id 與 IP 分開計,任一超限即擋)
export const RATE_LIMITS = {
  post: [
    { window: 300, max: 3 }, // 5 分鐘 3 篇
    { window: 86400, max: 20 }, // 24 小時 20 篇
  ],
  comment: [
    { window: 300, max: 10 },
    { window: 86400, max: 200 },
  ],
  reaction: [{ window: 300, max: 60 }],
  vote: [
    { window: 300, max: 30 },
    { window: 86400, max: 300 },
  ],
};

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD(UTC 當日),每日世界一問 participation 查詢用
