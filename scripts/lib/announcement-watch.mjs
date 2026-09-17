// aeiou.now — 官方假日公告監看的純函式(scripts/announcement-watch.mjs 的判斷核心)
//
// 這一檔不碰網路、不碰檔案、不碰 SQLite,所有「該不該說話」的判斷都在這裡,
// 讓 tests/seo/announcement-watch.test.mjs 可以不連線就把每一條轉移規則跑過一遍。
//
// ── 為什麼需要它(2026-09-17)────────────────────────────────────────────────
// content/national-holiday-calendars.json 有不少格子是 date_status='estimated'(依規則推算),
// 各國官方公告出爐之後**沒有任何機制會發現**。實測:印尼 2027 的 SKB 3 Menteri 已於
// 2026-09-15 發布,母表 ID 2027 仍有 11 筆估算。這一支只負責「公告出來了,去抄」的訊號,
// **絕不自動改日期** —— 抄公告是人的事,一份抄錯的假日表比沒有更糟。
//
// ── 每個候選網址的觀察結果(kind)────────────────────────────────────────────
//   matched   2xx、而且內文對得上這一筆的 `match` 正規式 → 公告就在這裡
//   present   2xx(沒有 match 規則;或有規則但還對不上 —— 例如清單頁上還沒出現那一年)
//   missing   404/410,或**軟 404**:要 PDF/CSV/ICS 卻回 HTML、或跟完 redirect 落到網域根目錄
//             (dfe.gov.in 的 …-2027.pdf 就是這樣:回 200,內容是首頁)
//   blocked   robots.txt 不准抓、或 401/403 —— 一律當「不准抓」,不換 UA、不重試、不繞路
//   error     連不上、逾時、5xx、其他非 2xx —— 暫時性,永遠不拿它說話
//
// ── 什麼時候「說話」(進 jobs 表 partial_success)──────────────────────────
//   出現   上一輪 missing/error/blocked/沒看過 → 這一輪 matched/present
//   對上   上一輪 present → 這一輪 matched(清單頁上終於列出那一年)
//   變了   兩輪都 present/matched、內容指紋不同 —— 但只限「沒有 match 規則」或「不是 HTML」的網址:
//          有 match 規則的 HTML 清單頁天天在變(其他新聞),那不是公告;PDF/CSV 變了才是改版
//   逾期   慣例月份過完了、還沒有任何候選網址 matched(或 present 且無規則)→ 說一次,
//          之後不再重複 —— 候選網址多半猜錯了,要人去找新入口
//   第一輪(沒有上一輪狀態)只有 matched 會說話:那代表公告已經在了、而我們從來沒記過;
//   present 在第一輪只建立基準,不說 —— OPM 那種常年在的頁面第一次看到不是新聞。
//   消失(present → missing)只進 log,不算「要人去抄公告」。

/** 一筆監看項在狀態檔與訊息裡的鍵。 */
export const entryKey = (entry) => `${entry.country} ${entry.year}`;
export const urlKey = (entry, url) => `${entryKey(entry)} ${url}`;

/** 看副檔名判斷「我們期待的是二進位/資料檔,不是 HTML 頁」。 */
export function expectsBinary(url) {
  let path = "";
  try { path = new URL(url).pathname.toLowerCase(); } catch { return false; }
  return /\.(pdf|csv|ics|xlsx?|docx?|zip)$/.test(path);
}

/**
 * 把一次 fetch 的結果分類成 kind。
 * @param {object} r
 * @param {number|null} r.status         HTTP 狀態;連不上/逾時給 null
 * @param {string}      r.contentType    回應的 Content-Type(可空)
 * @param {string}      r.requestedUrl   我們要的網址
 * @param {string}      r.finalUrl       跟完 redirect 之後的網址
 * @param {boolean}     r.robotsBlocked  robots.txt 不准抓(此時其他欄位可空)
 * @param {boolean}     r.matched        內文對上 match 規則(沒有規則給 false)
 * @param {boolean}     r.hasMatchRule   這一筆有沒有 match 規則
 */
export function classify(r) {
  if (r.robotsBlocked) return "blocked";
  const status = r.status;
  if (status == null) return "error";
  if (status === 401 || status === 403) return "blocked";
  if (status === 404 || status === 410) return "missing";
  if (status < 200 || status >= 300) return "error";
  const ct = String(r.contentType || "").toLowerCase();
  // 軟 404 ①:要的是 PDF/CSV/ICS,拿到的卻是 HTML —— 那是「找不到」頁,不是公告。
  if (expectsBinary(r.requestedUrl) && /text\/html/.test(ct)) return "missing";
  // 軟 404 ②:跟完 redirect 落到網域根目錄,而我們要的不是根目錄。
  try {
    const want = new URL(r.requestedUrl);
    const got = new URL(r.finalUrl || r.requestedUrl);
    if (want.pathname !== "/" && got.pathname === "/" && !got.search) return "missing";
  } catch { /* 網址壞掉就不做這一層判斷 */ }
  if (r.hasMatchRule && r.matched) return "matched";
  return "present";
}

const FOUND = new Set(["matched", "present"]);

/**
 * 一個候選網址這一輪該不該說話。
 * @param {object|undefined} prev  上一輪狀態 {kind, hash, contentType};第一輪給 undefined
 * @param {object} cur             這一輪 {kind, hash, contentType}
 * @param {object} opts            {hasMatchRule}
 * @returns {{speak: boolean, reason: string|null, note: string|null}}
 *   reason 只在 speak=true 時有值(appeared / matched / changed);note 是只進 log 的備註。
 */
export function decide(prev, cur, { hasMatchRule = false } = {}) {
  // 上一輪是 error(逾時/連線錯)= 沒有觀察,不能拿來當「以前沒有」的證據 —— 否則常年 200 的清單頁
  // 第一輪剛好逾時、第二輪恢復,就會誤報「出現了」。視同第一輪。
  if (prev && prev.kind === "error") prev = undefined;
  const wasFound = prev ? FOUND.has(prev.kind) : false;
  const isFound = FOUND.has(cur.kind);

  if (!prev) {
    if (cur.kind === "matched") return { speak: true, reason: "matched", note: null };
    return { speak: false, reason: null, note: "first-seen" };
  }
  if (!wasFound && isFound) {
    return { speak: true, reason: cur.kind === "matched" ? "matched" : "appeared", note: null };
  }
  if (wasFound && cur.kind === "matched" && prev.kind !== "matched") {
    return { speak: true, reason: "matched", note: null };
  }
  if (wasFound && isFound) {
    const isHtml = /text\/html/i.test(String(cur.contentType || ""));
    const hashChanged = prev.hash && cur.hash && prev.hash !== cur.hash;
    if (hashChanged && (!hasMatchRule || !isHtml)) return { speak: true, reason: "changed", note: null };
    return { speak: false, reason: null, note: null };
  }
  if (wasFound && cur.kind === "missing") return { speak: false, reason: null, note: "disappeared" };
  return { speak: false, reason: null, note: null };
}

/**
 * 慣例月份過完了沒。公告慣例在 `year - 1` 年的 `expected_month`;那個月的最後一天過去之後才算逾期。
 * expected_month 為空(例如美國:法定日期不靠年度公告)永遠不逾期。
 * @param {object} entry   {year, expected_month}
 * @param {Date}   today
 */
export function isOverdue(entry, today) {
  const m = Number(entry.expected_month);
  if (!Number.isInteger(m) || m < 1 || m > 12) return false;
  const y = Number(entry.year) - 1;
  // 慣例月份結束的下一個月 1 日(UTC);今天 >= 它就逾期。
  const deadline = Date.UTC(y, m, 1); // month 是 0-based,所以 m 就是「下一個月」
  return today.getTime() >= deadline;
}

/** 這一筆監看項算不算「找到了」:任一網址 matched,或(沒有 match 規則時)任一網址 present。 */
export function entryFound(entry, kinds) {
  const hasRule = Boolean(entry.match);
  return kinds.some((k) => k === "matched" || (!hasRule && k === "present"));
}

/**
 * 逾期訊號只說一次。
 * @param {boolean} alreadyNotified  狀態檔裡的 overdue_notified
 * @param {boolean} overdue          isOverdue(...)
 * @param {boolean} found            entryFound(...)
 * @returns {{speak: boolean, notified: boolean}}  notified 是要寫回狀態檔的新值
 */
export function overdueDecision(alreadyNotified, overdue, found) {
  if (found) return { speak: false, notified: false };       // 找到了就重置,萬一以後又不見再說
  if (!overdue) return { speak: false, notified: false };
  if (alreadyNotified) return { speak: false, notified: true };
  return { speak: true, notified: true };
}

/**
 * 母表裡某國某年還有幾筆是估算的(有日期、且 date_status 標 estimated)。
 * 日期是 null 的列不算 —— 那是「還沒有這一年」,不是「估的」。
 */
export function estimatedRows(calendar, country, year) {
  const c = calendar?.countries?.[country];
  if (!c || !Array.isArray(c.holidays)) return { estimated: 0, total: 0 };
  const y = String(year);
  let estimated = 0;
  let total = 0;
  for (const h of c.holidays) {
    if (h?.dates?.[y] == null) continue;
    total += 1;
    if (h?.date_status?.[y] === "estimated") estimated += 1;
  }
  return { estimated, total };
}

// ── robots.txt(與 source-refresh.mjs 的 robotsFor 同一套判準,抽成純函式) ────
/**
 * 只讀套用到我們的段落:`User-agent: *` 與明確指名 aeiou-now-bot 的那一段。
 * 容忍 dgpa.gov.tw 那種 `User-agent:* ` / `Disallow:/`(冒號後沒空格、行尾有空白)。
 * @returns {{disallow: string[], allow: string[], delayMs: number}}
 */
export function parseRobots(text, { botName = "aeiou-now-bot", defaultDelayMs = 2000 } = {}) {
  const rules = { disallow: [], allow: [], delayMs: defaultDelayMs, unreachable: false };
  // RFC 9309 §2.2.1:連續多行 User-agent 是同一個群組;遇到第一條規則才定案「這組套不套用到我們」。
  let groupAgents = [];
  let applies = false;
  let inRules = false;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (inRules) { groupAgents = []; inRules = false; }   // 規則之後再遇到 UA = 新群組
      groupAgents.push(val.toLowerCase());
      applies = groupAgents.some((a) => a === "*" || a.includes(botName));
      continue;
    }
    inRules = true;
    if (!applies) continue;
    if (key === "disallow" && val) rules.disallow.push(val);
    else if (key === "allow" && val) rules.allow.push(val);
    else if (key === "crawl-delay") {
      const d = Number(val);
      if (Number.isFinite(d) && d > 0) rules.delayMs = Math.min(60000, d * 1000);
    }
  }
  return rules;
}

/** robots.txt 回 5xx 或連不上:RFC 9309 §2.3.1.4 = unreachable,必須當成全站 Disallow。 */
export function unreachableRobots({ defaultDelayMs = 2000 } = {}) {
  return { disallow: ["/"], allow: [], delayMs: defaultDelayMs, unreachable: true };
}

// 規則字串 → 正規式:`*` 是任意字串、結尾 `$` 是錨定,其餘逐字(前綴比對)。gov.br 的
// `/*sendto_form$`、opm.gov 的 `/*/print/`、Drupal 的 `Allow: /core/*.css$` 都是這種寫法。
function robotsRuleToRegExp(rule) {
  const anchored = rule.endsWith("$");
  const body = anchored ? rule.slice(0, -1) : rule;
  const source = body.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`);
}

/** 最長規則優先(以規則字串長度計,與 Google 一致);同長時 Allow 勝。path 要含 query。 */
export function robotsAllows(rules, path) {
  let best = null;
  for (const p of rules.disallow) if (robotsRuleToRegExp(p).test(path) && (!best || p.length > best.len)) best = { len: p.length, ok: false };
  for (const p of rules.allow) if (robotsRuleToRegExp(p).test(path) && (!best || p.length >= best.len)) best = { len: p.length, ok: true };
  return best ? best.ok : true;
}

/** HTML → 可讀文字(去 script/style/標籤、壓空白),拿來算指紋與跑 match。 */
export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 驗 content/announcement-watch.json 的形狀;回傳問題清單(空陣列 = 合法)。 */
export function validateWatchFile(spec) {
  const problems = [];
  const list = Array.isArray(spec?.watches) ? spec.watches : null;
  if (!list) return ["watches 必須是陣列"];
  const seen = new Set();
  list.forEach((e, i) => {
    const where = `第 ${i + 1} 筆`;
    if (!/^[A-Z]{2}$/.test(String(e?.country || ""))) problems.push(`${where}:country 必須是 ISO 3166-1 alpha-2 大寫兩碼`);
    if (!Number.isInteger(e?.year) || e.year < 2000 || e.year > 2100) problems.push(`${where}:year 必須是整數年份`);
    if (e?.expected_month != null && (!Number.isInteger(e.expected_month) || e.expected_month < 1 || e.expected_month > 12)) {
      problems.push(`${where}:expected_month 必須是 1–12 或 null`);
    }
    if (!Array.isArray(e?.urls) || e.urls.length === 0) problems.push(`${where}:urls 至少一個`);
    else for (const u of e.urls) if (typeof u !== "string" || !/^https?:\/\//.test(u)) problems.push(`${where}:壞網址 ${u}`);
    if (e?.match != null) {
      if (typeof e.match !== "string") problems.push(`${where}:match 必須是正規式字串`);
      else try { new RegExp(e.match, "u"); } catch (err) { problems.push(`${where}:match 不是合法正規式(${err.message})`); }
    }
    if (e?.resolved != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(e.resolved))) problems.push(`${where}:resolved 必須是 YYYY-MM-DD 或 null`);
    const k = e?.country && e?.year ? `${e.country} ${e.year}` : null;
    if (k && seen.has(k)) problems.push(`${where}:${k} 重複`);
    if (k) seen.add(k);
  });
  return problems;
}
