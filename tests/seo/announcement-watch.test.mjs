// 官方假日公告監看的判斷核心(scripts/lib/announcement-watch.mjs)。
// 這裡不連線:每一條「該不該說話」的轉移規則都用假的上一輪/這一輪狀態跑一遍。
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classify, decide, entryFound, estimatedRows, htmlToText, isOverdue,
  overdueDecision, parseRobots, robotsAllows, validateWatchFile, expectsBinary,
} from "../../scripts/lib/announcement-watch.mjs";

// ── classify:把一次 fetch 的結果分成五種 kind ──────────────────────────────
test("classify:robots 不准抓與 401/403 都是 blocked,不看其他欄位", () => {
  assert.equal(classify({ robotsBlocked: true }), "blocked");
  assert.equal(classify({ status: 403, requestedUrl: "https://a.gov/x" }), "blocked");
  assert.equal(classify({ status: 401, requestedUrl: "https://a.gov/x" }), "blocked");
});

test("classify:404/410 是 missing,連不上與 5xx 是 error", () => {
  assert.equal(classify({ status: 404, requestedUrl: "https://a.gov/x" }), "missing");
  assert.equal(classify({ status: 410, requestedUrl: "https://a.gov/x" }), "missing");
  assert.equal(classify({ status: null, requestedUrl: "https://a.gov/x" }), "error");
  assert.equal(classify({ status: 503, requestedUrl: "https://a.gov/x" }), "error");
  assert.equal(classify({ status: 429, requestedUrl: "https://a.gov/x" }), "error");
});

test("classify:要 PDF 卻拿到 HTML 是軟 404(dfe.gov.in 2026-09-17 實例),判 missing 不判 present", () => {
  const r = classify({
    status: 200, contentType: "text/html; charset=UTF-8",
    requestedUrl: "https://dfe.gov.in/uploads/documents/list-of-gazetted-holidays-2027.pdf",
    finalUrl: "https://dfe.gov.in/uploads/documents/list-of-gazetted-holidays-2027.pdf",
  });
  assert.equal(r, "missing");
  assert.equal(classify({
    status: 200, contentType: "application/pdf",
    requestedUrl: "https://dfe.gov.in/uploads/documents/list-of-gazetted-holidays-2026.pdf",
    finalUrl: "https://dfe.gov.in/uploads/documents/list-of-gazetted-holidays-2026.pdf",
  }), "present");
});

test("classify:跟完 redirect 落到網域根目錄也是軟 404", () => {
  assert.equal(classify({
    status: 200, contentType: "text/html", requestedUrl: "https://a.gov/news/2028", finalUrl: "https://a.gov/",
  }), "missing");
  // 本來就要根目錄的不算
  assert.equal(classify({
    status: 200, contentType: "text/html", requestedUrl: "https://a.gov/", finalUrl: "https://a.gov/",
  }), "present");
});

test("classify:有 match 規則才會是 matched;沒規則一律 present", () => {
  const base = { status: 200, contentType: "text/html", requestedUrl: "https://a.gov/list", finalUrl: "https://a.gov/list" };
  assert.equal(classify({ ...base, hasMatchRule: true, matched: true }), "matched");
  assert.equal(classify({ ...base, hasMatchRule: true, matched: false }), "present");
  assert.equal(classify({ ...base, hasMatchRule: false, matched: true }), "present");
});

test("expectsBinary 只看路徑副檔名", () => {
  assert.equal(expectsBinary("https://a.gov/x.pdf"), true);
  assert.equal(expectsBinary("https://a.gov/x.csv?v=1"), true);
  assert.equal(expectsBinary("https://a.gov/x.PDF"), true);
  assert.equal(expectsBinary("https://a.gov/x.html"), false);
  assert.equal(expectsBinary("not a url"), false);
});

// ── decide:上一輪 × 這一輪 → 說不說 ──────────────────────────────────────────
const H = (hash, kind, contentType = "text/html") => ({ kind, hash, contentType });

test("decide:第一輪只有 matched 會說話;present 只建立基準", () => {
  assert.equal(decide(undefined, H("a", "matched"), { hasMatchRule: true }).speak, true);
  assert.equal(decide(undefined, H("a", "matched"), { hasMatchRule: true }).reason, "matched");
  assert.equal(decide(undefined, H("a", "present")).speak, false);
  assert.equal(decide(undefined, H(null, "missing")).speak, false);
  assert.equal(decide(undefined, H(null, "error")).speak, false);
  assert.equal(decide(undefined, H(null, "blocked")).speak, false);
});

test("decide:404 → 200 是「出現了」;404 → matched 是「對上了」", () => {
  assert.deepEqual(decide(H(null, "missing"), H("a", "present")), { speak: true, reason: "appeared", note: null });
  assert.deepEqual(decide(H(null, "missing"), H("a", "matched"), { hasMatchRule: true }), { speak: true, reason: "matched", note: null });
  assert.equal(decide(H(null, "error"), H("a", "present")).reason, "appeared");
  assert.equal(decide(H(null, "blocked"), H("a", "present")).reason, "appeared");
});

test("decide:清單頁從 present 變 matched 要說;matched 維持 matched 不重複說", () => {
  assert.equal(decide(H("a", "present"), H("b", "matched"), { hasMatchRule: true }).reason, "matched");
  assert.equal(decide(H("a", "matched"), H("b", "matched"), { hasMatchRule: true }).speak, false);
});

test("decide:沒有 match 規則的頁面,指紋變了才說(OPM 那種)", () => {
  assert.equal(decide(H("a", "present"), H("a", "present")).speak, false);
  assert.deepEqual(decide(H("a", "present"), H("b", "present")), { speak: true, reason: "changed", note: null });
});

test("decide:有 match 規則的 HTML 清單頁指紋天天變,不說;但 PDF/CSV 指紋變了要說", () => {
  assert.equal(decide(H("a", "present"), H("b", "present"), { hasMatchRule: true }).speak, false);
  assert.equal(decide(H("a", "matched"), H("b", "matched"), { hasMatchRule: true }).speak, false);
  const pdf = (h, k) => ({ kind: k, hash: h, contentType: "application/pdf" });
  assert.equal(decide(pdf("a", "present"), pdf("b", "present"), { hasMatchRule: true }).reason, "changed");
  const csv = (h, k) => ({ kind: k, hash: h, contentType: "text/csv" });
  assert.equal(decide(csv("a", "matched"), csv("b", "matched"), { hasMatchRule: true }).reason, "changed");
});

test("decide:error 永遠不拿來說話;消失只留備註", () => {
  assert.equal(decide(H("a", "present"), H(null, "error")).speak, false);
  assert.equal(decide(H(null, "missing"), H(null, "error")).speak, false);
  const gone = decide(H("a", "present"), H(null, "missing"));
  assert.equal(gone.speak, false);
  assert.equal(gone.note, "disappeared");
});

// ── 逾期:慣例月份過完還沒看到 ─────────────────────────────────────────────────
test("isOverdue:公告慣例在 year-1 年的 expected_month,那個月過完才逾期", () => {
  const e = { year: 2027, expected_month: 7 };
  assert.equal(isOverdue(e, new Date("2026-07-31T23:59:59Z")), false);
  assert.equal(isOverdue(e, new Date("2026-08-01T00:00:00Z")), true);
  assert.equal(isOverdue(e, new Date("2026-09-17T00:00:00Z")), true);
  assert.equal(isOverdue({ year: 2028, expected_month: 12 }, new Date("2027-12-15T00:00:00Z")), false);
  assert.equal(isOverdue({ year: 2028, expected_month: 12 }, new Date("2028-01-01T00:00:00Z")), true);
});

test("isOverdue:expected_month 為空(美國,法定日期)永不逾期", () => {
  assert.equal(isOverdue({ year: 2027, expected_month: null }, new Date("2030-01-01Z")), false);
  assert.equal(isOverdue({ year: 2027 }, new Date("2030-01-01Z")), false);
  assert.equal(isOverdue({ year: 2027, expected_month: 13 }, new Date("2030-01-01Z")), false);
});

test("entryFound:有規則要 matched;沒規則 present 就算", () => {
  assert.equal(entryFound({ match: "x" }, ["present", "blocked"]), false);
  assert.equal(entryFound({ match: "x" }, ["present", "matched"]), true);
  assert.equal(entryFound({ match: null }, ["missing", "present"]), true);
  assert.equal(entryFound({ match: null }, ["missing", "error"]), false);
});

test("overdueDecision:逾期只說一次;找到了就重置", () => {
  assert.deepEqual(overdueDecision(false, true, false), { speak: true, notified: true });
  assert.deepEqual(overdueDecision(true, true, false), { speak: false, notified: true });
  assert.deepEqual(overdueDecision(false, false, false), { speak: false, notified: false });
  assert.deepEqual(overdueDecision(true, true, true), { speak: false, notified: false });
});

// ── 母表裡還有幾筆估算 ────────────────────────────────────────────────────────
test("estimatedRows:只數有日期且標 estimated 的列;日期 null 的不算", () => {
  const cal = { countries: { ID: { holidays: [
    { dates: { 2027: "2027-01-01" }, date_status: { 2027: "confirmed" } },
    { dates: { 2027: "2027-03-10" }, date_status: { 2027: "estimated" } },
    { dates: { 2027: null }, date_status: {} },
    { dates: { 2027: "2027-05-01" }, date_status: {} },
  ] } } };
  assert.deepEqual(estimatedRows(cal, "ID", 2027), { estimated: 1, total: 3 });
  assert.deepEqual(estimatedRows(cal, "XX", 2027), { estimated: 0, total: 0 });
  assert.deepEqual(estimatedRows(cal, "ID", 2030), { estimated: 0, total: 0 });
});

// ── robots.txt ──────────────────────────────────────────────────────────────
test("parseRobots:dgpa.gov.tw 那種沒空格的 `User-agent:* ` / `Disallow:/` 也要讀得懂", () => {
  const rules = parseRobots("User-agent: Googlebot\nAllow:/\nUser-agent:* \nDisallow:/");
  assert.deepEqual(rules.disallow, ["/"]);
  assert.equal(robotsAllows(rules, "/informationlist"), false);
});

test("parseRobots:只讀 * 與指名本 bot 的段落;Allow 最長前綴勝;Crawl-delay 進 delayMs", () => {
  const rules = parseRobots([
    "User-agent: Yandex", "Disallow: /", "",
    "User-agent: *", "Disallow: /admin/", "Allow: /admin/public", "Crawl-delay: 5",
    "User-agent: aeiou-now-bot", "Disallow: /private/",
  ].join("\n"));
  assert.equal(robotsAllows(rules, "/zhengce/"), true);
  assert.equal(robotsAllows(rules, "/admin/x"), false);
  assert.equal(robotsAllows(rules, "/admin/public/x"), true);
  assert.equal(robotsAllows(rules, "/private/x"), false);
  assert.equal(rules.delayMs, 5000);
  assert.equal(parseRobots("").delayMs, 2000);
  assert.equal(robotsAllows(parseRobots(""), "/anything"), true);
});

test("htmlToText 去 script/style/標籤並壓空白", () => {
  assert.equal(htmlToText("<html><script>x()</script><style>a{}</style><p>Cuti&nbsp;Bersama  <b>2027</b></p></html>"), "Cuti Bersama 2027");
});

// ── 監看檔的形狀 ─────────────────────────────────────────────────────────────
test("validateWatchFile:合法檔案回空陣列;各種壞法都點名", () => {
  const ok = { watches: [
    { country: "ID", year: 2028, expected_month: 9, urls: ["https://a.go.id/x"], match: "Tahun 2028", resolved: null },
    { country: "US", year: 2027, expected_month: null, urls: ["https://opm.gov/"], match: null },
  ] };
  assert.deepEqual(validateWatchFile(ok), []);
  const bad = { watches: [
    { country: "id", year: "2028", expected_month: 13, urls: [], match: "(", resolved: "昨天" },
    { country: "ID", year: 2028, urls: ["ftp://x"] },
    { country: "ID", year: 2028, urls: ["https://x"] },
  ] };
  const p = validateWatchFile(bad);
  assert.ok(p.some((x) => /country/.test(x)));
  assert.ok(p.some((x) => /year/.test(x)));
  assert.ok(p.some((x) => /expected_month/.test(x)));
  assert.ok(p.some((x) => /urls 至少一個/.test(x)));
  assert.ok(p.some((x) => /正規式/.test(x)));
  assert.ok(p.some((x) => /resolved/.test(x)));
  assert.ok(p.some((x) => /壞網址/.test(x)));
  assert.ok(p.some((x) => /重複/.test(x)));
  assert.deepEqual(validateWatchFile({}), ["watches 必須是陣列"]);
});

test("repo 裡的 content/announcement-watch.json 本身要合法,而且七國都有", async () => {
  const { readFileSync } = await import("node:fs");
  const spec = JSON.parse(readFileSync(new URL("../../content/announcement-watch.json", import.meta.url), "utf8"));
  assert.deepEqual(validateWatchFile(spec), []);
  const countries = new Set(spec.watches.map((w) => w.country));
  for (const cc of ["TW", "JP", "CN", "US", "BR", "ID", "IN"]) assert.ok(countries.has(cc), `缺 ${cc}`);
  for (const w of spec.watches) for (const u of w.urls) assert.match(u, /^https:\/\/[^/]+\.(gov\.tw|go\.jp|gov\.cn|gov|gov\.br|go\.id|gov\.in)\//, `${u} 不是官方網域`);
});
