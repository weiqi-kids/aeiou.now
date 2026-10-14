// 來源連結檢查的分界(scripts/lib/source-url-status.mjs)。
// 網路層失敗只警告;404/410 與跟完 redirect 落在錯誤頁才擋部署。
import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyProbe, needsRecheck } from "../../scripts/lib/source-url-status.mjs";

const url = "https://example.gov/doc.pdf";

test("網路層失敗(status 0:逾時、連不上、DNS、TLS、重置)只警告", () => {
  for (const error of [
    "ETIMEDOUT:fetch failed",
    "UND_ERR_CONNECT_TIMEOUT:Connect Timeout Error",
    "timeout",
    "DNS 查不到這個網域",
    "ECONNRESET:read ECONNRESET",
    "TLS 憑證過期",
  ]) {
    assert.equal(classifyProbe({ url, status: 0, error }), "blocked", error);
  }
  assert.equal(needsRecheck({ url, status: 0 }), false);
});

test("對方擋機器人或伺服器錯誤只警告", () => {
  for (const status of [401, 403, 406, 412, 429, 500, 502, 503, 555]) {
    assert.equal(classifyProbe({ url, status, finalUrl: url }), "blocked", String(status));
  }
});

test("404/410 擋,且判死前要複驗", () => {
  for (const status of [404, 410]) {
    assert.equal(classifyProbe({ url, status, finalUrl: url }), "dead");
    assert.equal(needsRecheck({ url, status, finalUrl: url }), true);
  }
});

test("2xx 但跟完 redirect 落在錯誤頁或登入牆也擋", () => {
  assert.equal(classifyProbe({ url, status: 200, finalUrl: "https://example.gov/ErrorPage.html" }), "dead");
  assert.equal(classifyProbe({ url, status: 200, finalUrl: "https://example.gov/acl_users/credentials_cookie_auth/require_login" }), "dead");
  assert.equal(classifyProbe({ url, status: 200, finalUrl: "https://example.gov/new/doc.pdf" }), "ok");
  assert.equal(classifyProbe({ url, status: 301, finalUrl: url }), "ok");
});
