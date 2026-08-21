// 內部端點:主機 cron ↔ Worker,皆須 Bearer SYNC_SECRET(認證在 lib/gates.js)。
// 這裡沒有 CORS —— 呼叫端是主機腳本,不是瀏覽器。

import { json, err, readJson } from "../lib/http.js";
import { cityCode, getAnonId } from "../lib/identity.js";

// ---------- 內部端點(主機 cron ↔ Worker;皆須 Bearer SYNC_SECRET) ----------

export async function handleSyncTopics(request, env) {
  const body = await readJson(request);
  if (!body) return err(400, "invalid_body", "Malformed JSON body");
  const topics = Array.isArray(body.topics) ? body.topics : [];
  const topicI18n = Array.isArray(body.topic_i18n) ? body.topic_i18n : [];

  const stmts = [];
  for (const t of topics) {
    if (!t || typeof t.topic_id !== "string" || typeof t.slug !== "string")
      return err(400, "invalid_body", "each topic needs topic_id and slug");
    stmts.push(
      env.DB.prepare(
        `INSERT INTO topics (topic_id, slug, status, access_level, is_perennial, global_score, current_cycle_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (topic_id) DO UPDATE SET
           slug = excluded.slug, status = excluded.status,
           access_level = excluded.access_level, is_perennial = excluded.is_perennial,
           global_score = excluded.global_score, current_cycle_id = excluded.current_cycle_id`
      ).bind(
        t.topic_id,
        t.slug,
        t.status ?? "active",
        t.access_level ?? 0,
        t.is_perennial ?? 0,
        t.global_score ?? 0,
        t.current_cycle_id ?? null
      )
    );
  }
  for (const i of topicI18n) {
    if (
      !i ||
      typeof i.topic_id !== "string" ||
      typeof i.locale !== "string" ||
      typeof i.title !== "string"
    )
      return err(400, "invalid_body", "each topic_i18n needs topic_id, locale, title");
    stmts.push(
      env.DB.prepare(
        `INSERT INTO topic_i18n (topic_id, locale, title) VALUES (?, ?, ?)
         ON CONFLICT (topic_id, locale) DO UPDATE SET title = excluded.title`
      ).bind(i.topic_id, i.locale, i.title)
    );
  }
  if (stmts.length > 0) await env.DB.batch(stmts);
  return json(
    { topics_upserted: topics.length, topic_i18n_upserted: topicI18n.length },
    200
  );
}

export async function handlePendingTranslation(env, url) {
  let limit = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  if (!Number.isFinite(limit)) limit = 50;
  limit = Math.min(50, Math.max(1, limit));

  // 完整 post 列:主機 posts 表全部欄位(Track D 原樣 upsert 進主機 SQLite)
  const rows = (
    await env.DB.prepare(
      `SELECT post_id, topic_id, cycle_id, user_id, anon_id,
              original_locale, content, media_json, target_country,
              country_code, city_code,
              views, unique_views, comments, likes, shares,
              cross_country_engagements, hot_score,
              status, translation_status, created_at, last_activity_at, archived_at
       FROM posts
       WHERE translation_status IN ('pending','translating')
       ORDER BY created_at
       LIMIT ?`
    )
      .bind(limit)
      .all()
  ).results;

  if (rows.length > 0) {
    // 回傳後標記 translating,避免下一輪重複取
    const ids = rows.map((r) => r.post_id);
    const ph = ids.map(() => "?").join(",");
    await env.DB.prepare(
      `UPDATE posts SET translation_status = 'translating' WHERE post_id IN (${ph})`
    )
      .bind(...ids)
      .run();
  }
  return json({ posts: rows }, 200);
}

export async function handleTranslations(request, env) {
  const body = await readJson(request);
  if (!body) return err(400, "invalid_body", "Malformed JSON body");
  const translations = Array.isArray(body.translations) ? body.translations : [];
  const doneIds = Array.isArray(body.done_post_ids) ? body.done_post_ids : [];
  // 價值閘門(2026-08-15):判定沒價值的貼文 → status='moderation'(feed 自動排除)
  // + translation_status='skipped'(退出 pending 佇列,不再翻譯)
  const rejectedIds = Array.isArray(body.rejected_post_ids) ? body.rejected_post_ids : [];

  const stmts = [];
  for (const t of translations) {
    if (
      !t ||
      typeof t.post_id !== "string" ||
      typeof t.locale !== "string" ||
      typeof t.content !== "string"
    )
      return err(400, "invalid_body", "each translation needs post_id, locale, content");
    stmts.push(
      env.DB.prepare(
        `INSERT INTO post_i18n (post_id, locale, content, translated_at, translator)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (post_id, locale) DO UPDATE SET
           content = excluded.content, translated_at = excluded.translated_at,
           translator = excluded.translator`
      ).bind(
        t.post_id,
        t.locale,
        t.content,
        t.translated_at ?? Math.floor(Date.now() / 1000),
        t.translator ?? "claude"
      )
    );
  }
  if (doneIds.length > 0) {
    const ph = doneIds.map(() => "?").join(",");
    stmts.push(
      env.DB.prepare(
        `UPDATE posts SET translation_status = 'done' WHERE post_id IN (${ph})`
      ).bind(...doneIds)
    );
  }
  if (rejectedIds.length > 0) {
    const ph = rejectedIds.map(() => "?").join(",");
    stmts.push(
      env.DB.prepare(
        `UPDATE posts SET status = 'moderation', translation_status = 'skipped' WHERE post_id IN (${ph})`
      ).bind(...rejectedIds)
    );
  }
  if (stmts.length > 0) await env.DB.batch(stmts);
  return json(
    {
      i18n_upserted: translations.length,
      posts_done: doneIds.length,
      posts_rejected: rejectedIds.length,
    },
    200
  );
}

// GET /v1/me —— 讀者是誰、在哪裡。
// 位置以 Cloudflare 的 request.cf 為準:每一次請求都帶,不必等使用者發過文,
// 也不需要 GPS(GPS 給經緯度,換成城市要反向地理編碼,而資料模型刻意不存座標)。
// has_posted 供前端判斷「這個人有沒有在站上留下過足跡」。

// GET /internal/ugc/reaction-totals?target_type=place|event|post|comment —— reaction 計數回流主機
//
// 為什麼要有這一支(2026-08-21):reaction 的權威在 D1,靜態層沒有。/topics/events/ 與
// /topics/nearby/ 因此只能「先按靜態順序印出來,等 JS 拿到 /v1/reactions/summary 再重排」——
// 讀者看得到重排的那一跳,爬蟲看到的則永遠是未排序的那一版。把計數回流到主機、進 data/,
// 靜態就已經是對的順序,前端那一段重排退成微調。
//
// 只回聚合,不回 actor_id —— 主機不需要知道誰按的,回流也不該把匿名者的行為軌跡搬出 D1。
export async function handleReactionTotals(env, url) {
  const targetType = url.searchParams.get("target_type") || "";
  if (!["post", "comment", "place", "event"].includes(targetType))
    return err(400, "invalid_body", "target_type must be post/comment/place/event");

  const rows = (
    await env.DB.prepare(
      `SELECT target_id,
              COUNT(*) AS total,
              COUNT(DISTINCT actor_id) AS actors
         FROM reactions WHERE target_type = ?
        GROUP BY target_id
        ORDER BY target_id`
    )
      .bind(targetType)
      .all()
  ).results;

  return json({ target_type: targetType, items: rows }, 200);
}
