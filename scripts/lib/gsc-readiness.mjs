// GSC readiness 的純函式，讓資料採集與「是否足夠做決策」分開測試。

export const DEFAULT_READINESS_WINDOW_DAYS = 28;
export const DEFAULT_READINESS_THRESHOLD = 30;
export const DEFAULT_READINESS_DEADLINE_DAYS = 28;

const DAY_MS = 86400000;

export function positiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function addUtcDays(dateOnly, days) {
  const at = Date.parse(`${dateOnly}T00:00:00Z`);
  if (!Number.isFinite(at)) throw new Error(`無效的 UTC 日期:${dateOnly}`);
  return new Date(at + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * 回傳資料採集是否已經足以做產品決策。
 *
 * ready: 達到既有安全門檻，可以另行啟用 HotScore 的 GSC 判準。
 * collecting: 還在設定的觀測期限內，不假裝保證一定會達標。
 * decision_required: 期限已到仍未達標，必須明確決定維持門檻、改視窗或先增加流量。
 */
export function assessReadiness({
  median,
  threshold = DEFAULT_READINESS_THRESHOLD,
  windowDays = DEFAULT_READINESS_WINDOW_DAYS,
  deadlineDays = DEFAULT_READINESS_DEADLINE_DAYS,
  firstObservedDate = null,
  today,
  decision = null,
}) {
  const deadlineDate = firstObservedDate ? addUtcDays(firstObservedDate, deadlineDays) : null;
  let status = median >= threshold
    ? "ready"
    : deadlineDate && today >= deadlineDate
      ? "decision_required"
      : "collecting";
  // deferred:決策已經做了(content/gsc-readiness-decision.json),到 review_on 之前不再要求決策。
  // 決策是有日期的事實,不是把提醒永久關掉 —— review_on 一到,沒達標就再變回 decision_required。
  let reviewOn = null;
  if (status === "decision_required" && decision?.review_on && today < decision.review_on) {
    status = "deferred";
    reviewOn = decision.review_on;
  }
  return { status, deadlineDate, threshold, windowDays, reviewOn };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 決策檔的形狀檢查;壞掉就 throw(壞的決策檔比沒有更糟:它看起來像做過決定)。 */
export function validateReadinessDecision(decision) {
  if (!decision || typeof decision !== "object") throw new Error("決策檔不是物件");
  for (const key of ["decided_at", "review_on"]) {
    const value = String(decision[key] || "");
    // round-trip 檢查:2026-13-16 這種形狀對、日曆錯的,Date.parse 回 NaN 或被還原成別的日期
    let roundTrip = null;
    try { roundTrip = DATE_RE.test(value) ? addUtcDays(value, 0) : null; } catch { roundTrip = null; }
    if (roundTrip !== value) throw new Error(`決策檔 ${key} 要是有效的 YYYY-MM-DD`);
  }
  if (!["keep_threshold", "lower_threshold", "widen_window"].includes(decision.decision)) {
    throw new Error("決策檔 decision 只准 keep_threshold / lower_threshold / widen_window");
  }
  if (typeof decision.reason !== "string" || !decision.reason.trim()) throw new Error("決策檔要有 reason");
  if (decision.review_on <= decision.decided_at) throw new Error("決策檔 review_on 要晚於 decided_at");
  return decision;
}
