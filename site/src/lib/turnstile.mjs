// Turnstile(Bot 防護第三層)的前端側。2026-08-21。
//
// ── 為什麼開關在 Worker,不在 build 時 ──────────────────────────────────────
// 七語系是七個獨立的站,各自 build、各自部署。要是 sitekey 走環境變數,
// 「打開 Bot 防護」就等於「重建七個站並等 CI 跑完」,而真的被打的時候沒有那個時間。
// 改成問 `GET /v1/me` 的 `turnstile: {required, sitekey}`:Worker 那邊 secret 一設,
// 下一次載入就生效,靜態站一個位元組都不用動。
//
// ── 外部 script 的取捨(要講清楚)─────────────────────────────────────────
// 守門七條第 4 條禁外部 CDN,唯一例外是 GA4。Turnstile 沒有自託管的做法 ——
// 它的挑戰必須由 challenges.cloudflare.com 那支 script 執行。所以這是**第二個例外**,
// 而且刻意收窄:
//   · 只在 Worker 回報 required=true 時才插入那個 <script>。沒開啟 = 頁面上完全沒有它。
//   · 只在討論室這一個元件用到,不進 BaseLayout,其他頁面不受影響。
//   · 只插一次(多個討論室共用同一支 script)。
// 這一條記在 CLAUDE.md 的守門七條旁邊,不要靠讀這裡才知道。
//
// ── 沒過怎麼辦 ────────────────────────────────────────────────────────────
// 拿不到 token 就**不送出**,並顯示可再試的錯誤。不做「拿不到就照送」——
// 那等於在對方最想要的時刻自動關掉這一層(Worker 那側同理,見 api/src/lib/gates.js)。

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise = null;

/** 問 Worker 現在開著沒。失敗一律當成「沒開」—— /v1/me 掛掉不該讓整個發文框不能用。 */
export async function turnstileConfig(api) {
  if (!api) return { required: false, sitekey: null };
  try {
    const res = await fetch(api + '/v1/me', { credentials: 'include' });
    if (!res.ok) return { required: false, sitekey: null };
    const data = await res.json();
    const ts = data && data.turnstile;
    if (!ts || !ts.required || typeof ts.sitekey !== 'string' || !ts.sitekey) {
      return { required: false, sitekey: null };
    }
    return { required: true, sitekey: ts.sitekey };
  } catch {
    return { required: false, sitekey: null };
  }
}

function loadScript() {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.turnstile) { resolve(window.turnstile); return; }
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.addEventListener('load', () => resolve(window.turnstile));
    s.addEventListener('error', () => reject(new Error('turnstile script failed')));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * 在 container 裡掛一個 Turnstile widget,回一個「拿一次性 token」的函式。
 *
 * @returns {Promise<() => Promise<string>>} 呼叫回傳的函式會給一個 token;
 *   token 是一次性的,所以每次送出都要重新拿(內部會 reset)。
 */
export async function mountTurnstile(container, sitekey, theme) {
  const api = await loadScript();
  if (!api || typeof api.render !== 'function') throw new Error('turnstile unavailable');
  const widgetId = api.render(container, {
    sitekey: sitekey,
    // 一律隱形挑戰:真人多數情況下什麼都不用做,只有可疑流量才會看到互動式挑戰。
    appearance: 'interaction-only',
    theme: theme || 'auto',
  });
  let pending = null;
  return function getToken() {
    // execute 之後 token 從 callback 回來 —— Turnstile 沒有 promise 介面,自己包一層。
    if (pending) return pending;
    pending = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending = null; reject(new Error('turnstile timeout')); }, 20000);
      const done = (token) => { clearTimeout(timer); pending = null; resolve(token); };
      const fail = () => { clearTimeout(timer); pending = null; reject(new Error('turnstile failed')); };
      try {
        api.reset(widgetId);
        api.execute(widgetId, { callback: done, 'error-callback': fail, 'expired-callback': fail });
      } catch (e) {
        clearTimeout(timer);
        pending = null;
        reject(e);
      }
    });
    return pending;
  };
}
