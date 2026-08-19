// 三道閘:入口限流、內部端點認證、Topic/Post 的 status 判準。
// 放一起是因為呼叫端幾乎都是「先過閘再做事」,分散只會讓人忘記過閘。

import { RATE_LIMITS } from "../constants.js";
import { err } from "./http.js";

// ---------- 入口限流 ----------
// 事件寫進 rate_events(D1 獨有表);IP 只存 sha256(SYNC_SECRET+ip),不存明文。
// anonId 可能是這一刻新發的(計數必為 0),所以 IP 鍵才是主要防線。

export async function ipKey(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode((env.SYNC_SECRET || "") + ip)
  );
  return "ip:" + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 超限回 429 Response;未超限記錄事件並回 null。 */
export async function rateLimit(request, env, ctx, kind, anonId, cors) {
  const limits = RATE_LIMITS[kind];
  const now = Math.floor(Date.now() / 1000);
  const keys = [await ipKey(request, env)];
  if (anonId) keys.push("anon:" + anonId);

  const maxWindow = Math.max(...limits.map((l) => l.window));
  const counts = await env.DB.batch(
    keys.map((k) =>
      env.DB.prepare(
        "SELECT ts FROM rate_events WHERE kind = ? AND key = ? AND ts > ?"
      ).bind(kind, k, now - maxWindow)
    )
  );
  for (let i = 0; i < keys.length; i++) {
    const tss = counts[i].results.map((r) => r.ts);
    for (const l of limits) {
      if (tss.filter((t) => t > now - l.window).length >= l.max)
        return err(429, "rate_limited", "Too many requests, slow down", cors);
    }
  }

  const stmts = keys.map((k) =>
    env.DB.prepare("INSERT INTO rate_events (kind, key, ts) VALUES (?, ?, ?)").bind(kind, k, now)
  );
  // 機率性清舊事件(>25h),不佔請求延遲
  if (Math.random() < 0.02)
    stmts.push(env.DB.prepare("DELETE FROM rate_events WHERE ts < ?").bind(now - 90000));
  ctx.waitUntil(env.DB.batch(stmts));
  return null;
}

// 內部端點:Bearer <SYNC_SECRET>;SHA-256 後 timingSafeEqual,避免時序側信道
export async function checkSyncAuth(request, env) {
  if (!env.SYNC_SECRET) return false;
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/);
  if (!m) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(m[1])),
    crypto.subtle.digest("SHA-256", enc.encode(env.SYNC_SECRET)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

// ---------- 共用 gate ----------
// status 承載兩個彼此獨立的軸,而且 Topic 與 Post 同名不同義(見 /CONTEXT.md):
//   topics.status = 'archived' → 只是不熱,**仍公開、仍可發文**
//   posts.status  = 'archived' → **永久鎖定,不能再回覆**
// 要哪個意思就叫哪個名字,不要在呼叫點散裝列舉字串值 —— 2026-08-19 就是這樣改壞過
// 一次:topicGate 被改成「只放行 active/cooling」,而 cooling 這個 topic status
// 從未存在於資料中,效果等於把所有 archived Topic 鎖死不能發文。
// (那一版沒有上線,是在 commit 前被讀出來的;現在由 tests/api 自動擋。)

/** Topic 不公開的兩種狀態。 */
export const TOPIC_HIDDEN = new Set(["candidate", "merged"]);
/** Post 還能不能被回覆/互動。archived 與 moderation/deleted 都不行。 */
export const POST_OPEN = new Set(["active", "cooling"]);
/** SQL 片段:feed 只收還開著的 Post。語意與 isPostOpen 等價,改一邊要改兩邊。 */
export const SQL_POST_OPEN = "('active','cooling')";

export const isPostOpen = (row) => POST_OPEN.has(row?.post_status);

// access gate 只 gate 討論室(讀+寫都經此 Worker,一律檢查);M1 不做 OAuth,1/2 一律 401
export function topicGate(row, cors) {
  if ((row.access_level | 0) >= 1) {
    return err(401, "login_required", "This topic requires login (not available in M1)", cors);
  }
  // 擋名單,不是放行名單:**topics.status='archived' 仍可發文**(只是不熱),
  // 只有 posts.status='archived' 才是永久鎖定 —— 同名不同義,見 CLAUDE.md 紅線。
  // 曾一度改成「只放行 active/cooling」,但 cooling 這個 status 從未存在於資料中,
  // 效果等於把 archived Topic 全部鎖死;2026-08-19 改回。
  if (TOPIC_HIDDEN.has(row.topic_status)) {
    return err(403, "topic_locked", "Topic is not open for discussion", cors);
  }
  return null;
}
