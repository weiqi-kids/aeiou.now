import { after, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalFetch = globalThis.fetch;
const originalTimeout = process.env.SEO_OPS_GOOGLE_TIMEOUT_MS;
const tempDir = mkdtempSync(join(tmpdir(), "aeiou-ga-gsc-test-"));
const keyPath = join(tempDir, "service-account.json");
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
writeFileSync(keyPath, JSON.stringify({
  client_email: "test@example.com",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
}));

process.env.SEO_OPS_GOOGLE_TIMEOUT_MS = "35";
const googlePath = "/mnt/customers/seo-ops/lib/google.mjs";
// 能力偵測不是檔案偵測:timeout 支援住在另一個 repo(seo-ops)的 google.mjs 裡,舊版檔案存在但不傳 signal,
// 用「檔案在不在」決定跑不跑會讓主機上的測試在 seo-ops 退版時直接紅。沒有 timeout 支援就 skip 並說明。
const google = existsSync(googlePath) && /SEO_OPS_GOOGLE_TIMEOUT_MS/.test(readFileSync(googlePath, "utf8"))
  ? await import(`${googlePath}?aeiou-timeout-test`)
  : null;
if (!google) console.log(`# skip Google timeout tests:${googlePath} 不存在或沒有 SEO_OPS_GOOGLE_TIMEOUT_MS 支援`);
const { assessReadiness } = await import("../../scripts/lib/gsc-readiness.mjs");

after(() => {
  globalThis.fetch = originalFetch;
  if (originalTimeout === undefined) delete process.env.SEO_OPS_GOOGLE_TIMEOUT_MS;
  else process.env.SEO_OPS_GOOGLE_TIMEOUT_MS = originalTimeout;
  rmSync(tempDir, { recursive: true, force: true });
});

function neverRespond(signal) {
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason || new Error("aborted")), { once: true });
  });
}

const googleTest = google ? test : test.skip;

googleTest("Google OAuth 永不回應時會在 timeout 內中止", async () => {
  globalThis.fetch = async (_url, { signal }) => neverRespond(signal);
  await assert.rejects(
    google.getAccessToken(keyPath, "scope:test"),
    /Google OAuth timeout after 35ms/,
  );
});

googleTest("GA4 API 永不回應時會在取得 token 後中止", async () => {
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    if (calls === 1) return { ok: true, json: async () => ({ access_token: "test-token" }) };
    return neverRespond(options.signal);
  };
  await assert.rejects(
    google.ga4RunReport(keyPath, "123", { dateRanges: [] }),
    /GA4 Data API timeout after 35ms/,
  );
  assert.equal(calls, 2);
});

test("GSC readiness 在觀測期限到期仍未達標時要求決策", () => {
  assert.deepEqual(
    assessReadiness({
      median: 6,
      threshold: 30,
      windowDays: 28,
      deadlineDays: 28,
      firstObservedDate: "2026-08-15",
      today: "2026-09-12",
    }),
    {
      status: "decision_required",
      deadlineDate: "2026-09-12",
      threshold: 30,
      windowDays: 28,
      reviewOn: null,
    },
  );
});

test("GSC readiness 有決策紀錄時,到 review_on 之前是 deferred,之後又變回 decision_required", () => {
  const decision = { decided_at: "2026-09-17", decision: "keep_threshold", review_on: "2026-12-16", reason: "x" };
  const base = { median: 6, threshold: 30, windowDays: 28, deadlineDays: 28, firstObservedDate: "2026-08-15", decision };
  assert.deepEqual(
    assessReadiness({ ...base, today: "2026-10-01" }),
    { status: "deferred", deadlineDate: "2026-09-12", threshold: 30, windowDays: 28, reviewOn: "2026-12-16" },
  );
  assert.equal(assessReadiness({ ...base, today: "2026-12-16" }).status, "decision_required");
  // 達標仍然是 ready,決策不會蓋掉它
  assert.equal(assessReadiness({ ...base, median: 30, today: "2026-10-01" }).status, "ready");
});

test("決策檔形狀壞了要擋", async () => {
  const { validateReadinessDecision } = await import("../../scripts/lib/gsc-readiness.mjs");
  const good = { decided_at: "2026-09-17", decision: "keep_threshold", review_on: "2026-12-16", reason: "x" };
  assert.equal(validateReadinessDecision(good), good);
  assert.throws(() => validateReadinessDecision({ ...good, review_on: "2026-09-17" }), /晚於/);
  assert.throws(() => validateReadinessDecision({ ...good, decision: "ignore" }), /只准/);
  assert.throws(() => validateReadinessDecision({ ...good, reason: "" }), /reason/);
  assert.throws(() => validateReadinessDecision({ ...good, decided_at: "昨天" }), /YYYY-MM-DD/);
  assert.throws(() => validateReadinessDecision({ ...good, review_on: "2026-13-16" }), /YYYY-MM-DD/);
});

test("GSC readiness 達標時不會被 deadline 蓋掉", () => {
  assert.equal(
    assessReadiness({
      median: 30,
      threshold: 30,
      windowDays: 28,
      deadlineDays: 28,
      firstObservedDate: "2026-08-15",
      today: "2026-09-12",
    }).status,
    "ready",
  );
});
