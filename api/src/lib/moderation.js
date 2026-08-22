// 規則層 moderation(2026-08-22)。草案 §33 的 Job 17,寫入端那一半。
//
// ── 為什麼需要它:留言從來沒有被任何東西看過 ──────────────────────────────
// 貼文有 LLM 價值閘門(`scripts/translate-posts.mjs`,翻譯前判一次)。
// **留言不翻譯**(契約 §3),所以它從來不進那條路 —— 也就從來沒被檢查過。
// 2026-08-22 實查:主機 `comments` 0 筆、D1 有筆數,兩邊的差就是這個盲區:
// 留言連回流主機都沒有,任何主機端的審核都看不到它。
//
// ── 為什麼是規則層而不是 LLM ──────────────────────────────────────────────
// `claude -p` 是**全主機共用的訂閱額度**(CLAUDE.md 紅線),而留言的量天生比貼文大一個
// 量級。把留言也送進 LLM,等於用最貴的資源去擋最廉價的攻擊,而且額度一耗盡,
// **連貼文的價值閘門都會一起停擺**(2026-08-15 已經發生過一次)。
// 所以這一層是**確定性規則**:零成本、同步、擋在門口,不佔任何額度。
// LLM 只留給它真正擅長的事(貼文有沒有價值),兩層互不搶資源。
//
// ── 三種嚴重度對應三種處置 ────────────────────────────────────────────────
//   high   → 直接 `status='moderation'` 寫入。**資料仍然存下來**(要能複核、要能翻案),
//            但 feed 不收(SQL_POST_OPEN 不含 moderation),等於寫得進去、露不出來。
//   medium → 照常寫入 active,但記進 `moderation_flags`,由主機端 job 建檔待人工複核。
//   low    → 只記 flag,不影響呈現。
// **不回 4xx**:告訴對方「你被擋了」等於免費送他一個可以逐次試錯的偵測器。
// 對送出者而言,高嚴重度的內容看起來就是送出成功了 —— 它只是沒有出現在別人的 feed 裡。
//
// ── 判準刻意保守 ──────────────────────────────────────────────────────────
// 與價值閘門同一條紀律:**從寬,不確定就留**。這一層要擋的是「一望即知」的東西
// (滿版連結、縮網址、同一字元洗兩百次),不是語意判斷。誤殺一則真人留言的代價,
// 遠高於放過一則垃圾 —— 後者還有主機端 job 與人工複核兩道在後面。

/** 縮網址與轉址服務:內容看不出目的地,是垃圾連結最常見的載體。 */
const SHORTENERS = new Set([
  "bit.ly", "goo.gl", "t.co", "tinyurl.com", "ow.ly", "is.gd", "buff.ly",
  "rebrand.ly", "cutt.ly", "shorturl.at", "rb.gy", "lnkd.in", "s.id", "bit.do",
]);

const URL_RE = /https?:\/\/([^\s/?#]+)/gi;

/** 同一個字元連續重複幾次算洗版。三十次是「一望即知」的門檻,正常語言不會這樣。 */
const REPEAT_RUN = 30;

/**
 * 對一則使用者內容跑規則層。
 *
 * @param {string} content 原文
 * @param {"post"|"comment"} targetType
 * @returns {{severity:"none"|"low"|"medium"|"high", reason:string|null, detail:string|null}}
 *   `reason` 用 `moderation_queue.reason` 的列舉值(spam|malicious_link|commercial|bot|…),
 *   兩邊必須是同一組字串 —— 主機端 job 直接拿它建檔,不做第二次對照。
 */
export function screenContent(content, targetType = "comment") {
  const text = String(content || "");
  const hits = [];

  // ── 連結 ────────────────────────────────────────────────────────────────
  const domains = [];
  URL_RE.lastIndex = 0;
  let m;
  while ((m = URL_RE.exec(text)) !== null) {
    domains.push(String(m[1]).toLowerCase().replace(/^www\./, ""));
  }
  const shortened = domains.filter((d) => SHORTENERS.has(d));
  if (shortened.length > 0) {
    // 縮網址一顆就夠可疑 —— 它的唯一作用就是讓人看不出要去哪裡。
    hits.push({ severity: "high", reason: "malicious_link", detail: `shortener: ${shortened.join(",")}` });
  }
  // 留言的容忍度比貼文低:一則兩千字的貼文放三個來源連結是正常的,一句留言不是。
  const linkCap = targetType === "post" ? 5 : 2;
  if (domains.length > linkCap) {
    hits.push({ severity: "medium", reason: "spam", detail: `${domains.length} links (cap ${linkCap})` });
  }
  // 內容幾乎只有連結:去掉網址之後剩不到十個字,那不是在講話,是在貼廣告。
  const withoutUrls = text.replace(/https?:\/\/\S+/gi, "").trim();
  if (domains.length > 0 && withoutUrls.length < 10) {
    hits.push({ severity: "high", reason: "spam", detail: "link-only content" });
  }

  // ── 洗版 ────────────────────────────────────────────────────────────────
  // 用逐字掃描而不是正則的反向參照:CJK 與 emoji 都是多碼元字元,
  // /(.)\1{29,}/ 會在代理對上判錯(把一個 emoji 拆成兩半算成重複)。
  const chars = [...text];
  let run = 1;
  for (let i = 1; i <= chars.length; i += 1) {
    if (i < chars.length && chars[i] === chars[i - 1]) {
      run += 1;
      continue;
    }
    if (run >= REPEAT_RUN) {
      hits.push({ severity: "medium", reason: "bot", detail: `char repeated ${run}x` });
      break;
    }
    run = 1;
  }

  if (hits.length === 0) return { severity: "none", reason: null, detail: null };
  // 多條命中時取最嚴重的那一條 —— 一則內容只有一個處置。
  const order = { low: 1, medium: 2, high: 3 };
  hits.sort((a, b) => order[b.severity] - order[a.severity]);
  return hits[0];
}

/**
 * 把一次判定記進 D1 的 `moderation_flags`(供主機端 job 回流建檔)。
 *
 * 刻意**不**在這裡寫 `moderation_queue` —— 那張表在主機,是人工複核的工作檯;
 * D1 這張只是「發生過什麼」的原始紀錄,兩者的職責不同(見 docs/02-data-model.md §7)。
 * 寫入走 ctx.waitUntil:審核紀錄不該讓使用者的請求多等一次往返。
 */
export function recordFlag(env, ctx, { targetType, targetId, anonId, verdict }) {
  if (!verdict || verdict.severity === "none") return;
  const now = Math.floor(Date.now() / 1000);
  ctx.waitUntil(
    env.DB.prepare(
      `INSERT INTO moderation_flags
         (target_type, target_id, anon_id, severity, reason, detail, created_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT (target_type, target_id) DO NOTHING`
    )
      .bind(targetType, targetId, anonId ?? null, verdict.severity, verdict.reason,
        (verdict.detail || "").slice(0, 300), now)
      .run()
      // 記錄失敗不該讓已經寫成功的貼文/留言看起來像失敗 —— 這一層是附加的,不是主流程。
      .catch(() => {})
  );
}
