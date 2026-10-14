// 來源連結檢查的判定(從 scripts/check-source-urls.mjs 抽出,2026-10-14)。
// 抽出來是為了能測:「網路層失敗＝警告不擋、404/410 與跟完 redirect 落在錯誤頁＝擋」
// 這條分界一旦被改歪,不是 CI 因為別人的網路間歇性紅燈(2026-10-10~14 七站凍結四天的樣子),
// 就是死連結默默印在線上。判準與緣由見 check-source-urls.mjs 檔頭。

// 跟完 redirect 之後落在錯誤頁 —— 狀態碼是 200,但讀者點過去看到的是「找不到」。
// 只認路徑上的明確標記,不做語意猜測(不抓網頁內文,那會誤判正常的錯誤處理說明頁)。
const ERROR_PATH = /(^|\/)(errorpage|error|404|notfound|not-found|nopage)(\.\w+)?(\/|$)/i;
// 登入牆也算「讀者點過去看不到那份文件」(2026-08-26 抓到):
//   www.gov.br/gestao/…/confira-o-calendario-oficial-…-2026 回 200,
//   但跟完 redirect 落在 /gestao/acl_users/credentials_cookie_auth/require_login。
//   carnival 與 long-holiday-weeks 都曾引到這一類網址。與 ErrorPage 同型:狀態碼不會亮紅燈。
const LOGIN_PATH = /(^|\/)(require_login|login|signin|sign-in|credentials_cookie_auth)(\.\w+)?(\/|$)/i;
export function landsOnErrorPage(url, finalUrl) {
  if (!finalUrl || finalUrl === url) return false;
  let a, b;
  try { a = new URL(url); b = new URL(finalUrl); } catch { return false; }
  const bad = (p) => ERROR_PATH.test(p) || LOGIN_PATH.test(p);
  if (!bad(b.pathname)) return false;
  return bad(b.pathname) && !bad(a.pathname);
}

/** 這一次探測需不需要等一下再複驗(只有「看起來死了」才複驗)。 */
export function needsRecheck({ url, status, finalUrl }) {
  return status === 404 || status === 410 || (status >= 200 && status < 400 && landsOnErrorPage(url, finalUrl));
}

/**
 * 'dead'    → 擋部署:404/410,或 2xx/3xx 但跟完 redirect 落在錯誤頁/登入牆。
 * 'ok'      → 可達。
 * 'blocked' → 只警告:403/412/429、5xx、以及 status=0 的網路層失敗
 *             (逾時、連不上、DNS、TLS、連線被重置⋯⋯對方或網路的問題,不是連結死掉)。
 */
export function classifyProbe({ url, status, finalUrl }) {
  if (status === 404 || status === 410) return 'dead';
  if (status >= 200 && status < 400) return landsOnErrorPage(url, finalUrl) ? 'dead' : 'ok';
  return 'blocked';
}
