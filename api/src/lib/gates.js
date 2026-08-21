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

// ---------- Turnstile(Bot 防護第三層,2026-08-21) ----------
//
// 三層防護,由外而內:① 入口限流(anon_id + IP 雙鍵) ② 價值閘門(翻譯前的 claude 判定)
// ③ Turnstile。前兩層擋的是「發太多」與「發垃圾」,擋不掉「一個腳本規規矩矩地每五分鐘
// 發三篇像樣的廢文」—— 那正是 Turnstile 的守備範圍。
//
// ── 沒設 secret 就跳過,而且是刻意的 ──────────────────────────────────────
// `TURNSTILE_SECRET` 沒設 → 不驗、照放行,也就是這一版之前的行為。
// 這**是** fail-open,所以要講清楚為什麼可以:
//   · Turnstile 的 widget 只能在 Cloudflare 儀表板(或帶 Turnstile scope 的 API token)
//     建立,主機這邊建不了 —— 碼先上線、鑰匙後到,中間那段不能讓寫入端點全部 400。
//   · 前端也不會自己冒出一個看不見的挑戰:sitekey 由 /v1/me 回,沒設就不載入
//     challenges.cloudflare.com 的那支 script(外部 script 只在真的要用時才出現)。
//   · 開關一翻(wrangler secret put + vars),兩邊同一秒生效,七個站**不必重建**。
// 要查現在是開是關:`curl -s "$API/v1/me" | grep -o '"turnstile":{[^}]*}'`。
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** 這個 Worker 現在有沒有在驗 Turnstile。sitekey 是公開值,回給前端是正常用法。 */
export function turnstileState(env) {
  const enabled = !!(env.TURNSTILE_SECRET && env.TURNSTILE_SITEKEY);
  return { required: enabled, sitekey: enabled ? env.TURNSTILE_SITEKEY : null };
}

/** 沒過就回 403 Response;沒開啟或通過則回 null(與 rateLimit 同一種呼叫慣例)。 */
export async function verifyTurnstile(request, env, token, cors) {
  if (!env.TURNSTILE_SECRET || !env.TURNSTILE_SITEKEY) return null; // 未設定 = 不驗(見上)
  if (typeof token !== "string" || token === "")
    return err(403, "challenge_required", "Turnstile token missing", cors);

  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  const ip = request.headers.get("CF-Connecting-IP");
  // remoteip 是選填但強烈建議:少了它,同一個 token 從別的網路重放就驗得過。
  if (ip) form.append("remoteip", ip);

  let ok = false;
  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body: form });
    const data = await res.json();
    ok = !!(data && data.success);
  } catch {
    // Cloudflare 自己的驗證端點打不通時**擋下**,不放行 —— 這一層存在的意義就是擋腳本,
    // 「驗不到就當作通過」等於在對方最想要的時刻自動關掉。真人重試一次即可。
    return err(503, "challenge_unavailable", "Could not verify challenge, please retry", cors);
  }
  return ok ? null : err(403, "challenge_failed", "Turnstile verification failed", cors);
}
