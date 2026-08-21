// 每日世界一問。規格 docs/briefs/daily-question.md、契約 §7。

import { LOCALES, DATE_RE } from "../constants.js";
import { json, err, readJson } from "../lib/http.js";
import { ulid, getAnonId, anonCookie } from "../lib/identity.js";
import { rateLimit } from "../lib/gates.js";

// ---------- 每日世界一問(2026-08-15;規格 docs/briefs/daily-question.md、契約 §7) ----------
// 社群 = 語言 = 站台:社群由前端送的 locale 決定,不做國家判定、不讀 request.cf.country。

// guess 的正解揭曉(2026-08-21 起由 Worker 負責,不再放在靜態 JSON)。
//
// 為什麼搬過來:答案原本跟題目一起印在 /questions/<locale>.json 裡,view-source 就看得到,
// 猜謎的猜字失去意義。揭曉的條件是「這個人已經投過票」,而那個事實只有 D1 知道。
//
// 判準只有一條:**mine 非 null 才給**。不是「投對才給」,也不是「過了某個時間才給」——
// 投完票就該看到正解與解說,那是這個玩法的回饋;沒投票的人拿到的回應裡連 key 都沒有。
// poll 沒有正解,任何情況都不回。
function revealFor(row, locale, mine) {
  if (!row || row.kind !== "guess" || row.answer_option == null || mine == null) return null;
  let explain = null;
  if (row.explain_json) {
    try {
      const map = JSON.parse(row.explain_json);
      // 讀者只看得懂自己站的語言。缺該語系的解說就不給句子(不要退回別的語言:
      // 那是 CLAUDE.md「只有一種語言看得懂的欄位不准上畫面」那條紅線)。
      if (map && typeof map === "object" && typeof map[locale] === "string") explain = map[locale];
    } catch {
      explain = null;
    }
  }
  return { answer: row.answer_option, explain };
}

// 聚合結果(GET results 與 POST votes 共用同構回應)。
// by_locale 只含有票的 locale;options 只含計數 > 0(GROUP BY 的列本就 > 0,天然滿足)。
export async function questionResults(env, questionId, anonId) {
  const rows = (
    await env.DB.prepare(
      `SELECT locale, option_id, COUNT(*) AS c FROM question_votes
       WHERE question_id = ? GROUP BY locale, option_id`
    )
      .bind(questionId)
      .all()
  ).results;

  const byLocale = {};
  let total = 0;
  for (const r of rows) {
    total += r.c;
    if (!byLocale[r.locale]) byLocale[r.locale] = { total: 0, options: {} };
    byLocale[r.locale].total += r.c;
    byLocale[r.locale].options[r.option_id] = r.c;
  }

  let mine = null;
  if (anonId) {
    const row = await env.DB.prepare(
      `SELECT option_id FROM question_votes WHERE question_id = ? AND anon_id = ?`
    )
      .bind(questionId, anonId)
      .first();
    mine = row ? row.option_id : null;
  }

  return { total, by_locale: byLocale, mine };
}

// GET /v1/questions/:id/results —— 公開,不發 cookie(讀既有 cookie 算 mine,沒有就 null)
export async function handleQuestionResults(request, env, url, questionId, cors) {
  const q = await env.DB.prepare(
    "SELECT question_id, kind, answer_option, explain_json FROM questions WHERE question_id = ?"
  )
    .bind(questionId)
    .first();
  if (!q) return err(404, "not_found", "question not found", cors);

  // 揭曉的解說要挑讀者那一語。locale 不合法就當成沒帶 —— 只會少一句解說,不影響投票。
  const locale = url.searchParams.get("locale");
  const anonId = getAnonId(request);
  const now = Math.floor(Date.now() / 1000);
  const { total, by_locale, mine } = await questionResults(env, questionId, anonId);
  const body = { question_id: questionId, server_time: now, total, by_locale, mine };
  const reveal = revealFor(q, LOCALES.includes(locale) ? locale : null, mine);
  if (reveal) Object.assign(body, reveal);
  return json(body, 200, cors);
}

// POST /v1/votes —— 一人一題一票,重投 = 改票(created_at 保留首次值)
export async function handleVote(request, env, ctx, cors) {
  const limited = await rateLimit(request, env, ctx, "vote", getAnonId(request), cors);
  if (limited) return limited;
  const body = await readJson(request);
  if (!body) return err(400, "invalid_body", "Malformed JSON body", cors);
  const { question_id, option_id, locale } = body;
  if (typeof question_id !== "string" || question_id === "")
    return err(400, "invalid_body", "question_id is required", cors);
  if (typeof option_id !== "string" || option_id === "")
    return err(400, "invalid_body", "option_id is required", cors);
  if (!LOCALES.includes(locale))
    return err(400, "invalid_body", "locale must be one of " + LOCALES.join(", "), cors);

  const q = await env.DB.prepare(
    "SELECT question_id, status, options_json, kind, answer_option, explain_json FROM questions WHERE question_id = ?"
  )
    .bind(question_id)
    .first();
  if (!q) return err(404, "not_found", "question not found", cors);
  if (q.status !== "active")
    return err(403, "topic_locked", "question is not open for voting", cors);

  let options;
  try {
    options = JSON.parse(q.options_json);
  } catch {
    options = [];
  }
  if (!Array.isArray(options) || !options.includes(option_id))
    return err(400, "invalid_body", "option_id is not valid for this question", cors);

  let anonId = getAnonId(request);
  let setCookie = null;
  if (!anonId) {
    anonId = ulid();
    setCookie = anonCookie(anonId);
  }

  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO question_votes (question_id, anon_id, option_id, locale, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (question_id, anon_id) DO UPDATE SET
       option_id = excluded.option_id, locale = excluded.locale, updated_at = excluded.updated_at`
  )
    .bind(question_id, anonId, option_id, locale, now, now)
    .run();

  const { total, by_locale, mine } = await questionResults(env, question_id, anonId);
  const headers = { ...cors };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  // 投完票就揭曉:回應與 GET results 同構,前端不必為「剛投完」寫第二套路徑。
  const payload = { question_id, server_time: now, total, by_locale, mine };
  const reveal = revealFor(q, locale, mine);
  if (reveal) Object.assign(payload, reveal);
  return json(payload, 200, headers);
}

// GET /v1/questions/participation?date=YYYY-MM-DD —— 當日各社群參與數,不發 cookie
export async function handleParticipation(env, url, cors) {
  const date = url.searchParams.get("date") || "";
  if (!DATE_RE.test(date)) return err(400, "invalid_body", "date must be YYYY-MM-DD", cors);
  const startMs = Date.parse(date + "T00:00:00Z");
  if (Number.isNaN(startMs)) return err(400, "invalid_body", "date must be YYYY-MM-DD", cors);
  const start = Math.floor(startMs / 1000);
  const end = start + 86400;

  const rows = (
    await env.DB.prepare(
      `SELECT locale, COUNT(*) AS c FROM question_votes
       WHERE created_at >= ? AND created_at < ? GROUP BY locale`
    )
      .bind(start, end)
      .all()
  ).results;

  const byLocale = {};
  let total = 0;
  for (const r of rows) {
    byLocale[r.locale] = r.c;
    total += r.c;
  }
  const now = Math.floor(Date.now() / 1000);
  return json({ date, server_time: now, total, by_locale: byLocale }, 200, cors);
}

// POST /internal/sync/questions —— 主機 → D1 題目精簡副本(Bearer;比照 handleSyncTopics)
export async function handleSyncQuestions(request, env) {
  const body = await readJson(request);
  if (!body) return err(400, "invalid_body", "Malformed JSON body");
  const questions = Array.isArray(body.questions) ? body.questions : [];

  const stmts = [];
  for (const q of questions) {
    if (
      !q ||
      typeof q.question_id !== "string" ||
      typeof q.qdate !== "string" ||
      typeof q.kind !== "string" ||
      typeof q.topic_id !== "string" ||
      !Array.isArray(q.options)
    )
      return err(
        400,
        "invalid_body",
        "each question needs question_id, qdate, kind, topic_id, options[]"
      );
    // 正解必須是這一題的選項之一,否則揭曉時會印出一個讀者從沒看過的 id。
    if (q.answer != null && !q.options.includes(q.answer))
      return err(400, "invalid_body", `answer is not one of the options: ${q.question_id}`);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO questions (question_id, qdate, kind, topic_id, options_json, status,
                                answer_option, explain_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (question_id) DO UPDATE SET
           qdate = excluded.qdate, kind = excluded.kind, topic_id = excluded.topic_id,
           options_json = excluded.options_json, status = excluded.status,
           answer_option = excluded.answer_option, explain_json = excluded.explain_json`
      ).bind(
        q.question_id,
        q.qdate,
        q.kind,
        q.topic_id,
        JSON.stringify(q.options),
        q.status ?? "active",
        q.answer ?? null,
        q.explain && typeof q.explain === "object" ? JSON.stringify(q.explain) : null
      )
    );
  }
  if (stmts.length > 0) await env.DB.batch(stmts);
  return json({ questions_upserted: questions.length }, 200);
}
