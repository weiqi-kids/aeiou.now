// 公開端點:8H 即時 feed、發文、留言、reaction、/v1/me、reaction 統計。
// 全部要過 CORS 與 topicGate;寫入端點另外要過入口限流。

import { REACTION_SET, LOCALES, WINDOW_HOURS, POST_MAX_CHARS, COMMENT_MAX_CHARS } from "../constants.js";
import { json, err, readJson } from "../lib/http.js";
import { ulid, charLen, cityCode, countryCode, getAnonId, anonCookie } from "../lib/identity.js";
import { rateLimit, topicGate, isPostOpen, SQL_POST_OPEN } from "../lib/gates.js";

// ---------- 公開端點 ----------

export async function handleFeed(request, env, topicId, url, cors) {
  const sortParam = url.searchParams.get("sort");
  const sort = sortParam === "new" ? "new" : "hot";
  let limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
  if (!Number.isFinite(limit)) limit = 20;
  limit = Math.min(50, Math.max(1, limit));
  let nComments = Number.parseInt(url.searchParams.get("comments") ?? "3", 10);
  if (!Number.isFinite(nComments)) nComments = 3;
  nComments = Math.min(10, Math.max(0, nComments));

  const topic = await env.DB.prepare(
    "SELECT topic_id, status AS topic_status, access_level FROM topics WHERE topic_id = ?"
  )
    .bind(topicId)
    .first();
  if (!topic) return err(404, "not_found", "topic not found", cors);
  const gate = topicGate(topic, cors);
  if (gate) return gate;

  const now = Math.floor(Date.now() / 1000);
  const since = now - WINDOW_HOURS * 3600;

  // sort=hot 的 M1 定義:COUNT(DISTINCT reactions.actor_id) + posts.comments,
  // tie-break created_at DESC。hot_score 恆 0,不得用來排序。
  const orderBy =
    sort === "hot" ? "heat DESC, p.created_at DESC" : "p.created_at DESC";
  const posts = (
    await env.DB.prepare(
      `SELECT p.post_id, p.topic_id, p.cycle_id, p.original_locale, p.content,
              p.translation_status, p.target_country, p.country_code, p.city_code, p.created_at,
              p.comments AS comment_count,
              (SELECT COUNT(DISTINCT r.actor_id) FROM reactions r
                WHERE r.target_type = 'post' AND r.target_id = p.post_id) AS reaction_actors,
              ((SELECT COUNT(DISTINCT r.actor_id) FROM reactions r
                 WHERE r.target_type = 'post' AND r.target_id = p.post_id) + p.comments) AS heat
       FROM posts p
       WHERE p.topic_id = ? AND p.created_at >= ? AND p.status IN ${SQL_POST_OPEN}
       ORDER BY ${orderBy}
       LIMIT ?`
    )
      .bind(topicId, since, limit)
      .all()
  ).results;

  const byId = new Map();
  for (const p of posts) {
    byId.set(p.post_id, {
      post_id: p.post_id,
      topic_id: p.topic_id,
      cycle_id: p.cycle_id,
      original_locale: p.original_locale,
      content: p.content,
      translations: {},
      translation_status: p.translation_status,
      // Ask the World:這則貼文是問哪一國的(null = 不指定)。欄位早就在 posts 表裡,
      // 2026-08-21 才接到 feed 與前端 —— 在那之前寫得進去、讀不出來。
      target_country: p.target_country,
      country_code: p.country_code,
      city_code: p.city_code,
      created_at: p.created_at,
      comment_count: p.comment_count, // 留言總數(≠ comments 陣列長度)
      reactions: {},
      reaction_actors: p.reaction_actors,
      comments: [],
    });
  }

  if (posts.length > 0) {
    const ids = posts.map((p) => p.post_id);
    const ph = ids.map(() => "?").join(",");
    const stmts = [
      env.DB.prepare(
        `SELECT post_id, locale, content FROM post_i18n WHERE post_id IN (${ph})`
      ).bind(...ids),
      env.DB.prepare(
        `SELECT target_id, kind, COUNT(DISTINCT actor_id) AS c FROM reactions
         WHERE target_type = 'post' AND target_id IN (${ph}) GROUP BY target_id, kind`
      ).bind(...ids),
    ];
    if (nComments > 0) {
      stmts.push(
        env.DB.prepare(
          `SELECT comment_id, post_id, locale, content, country_code, city_code, created_at
           FROM (SELECT c.*, ROW_NUMBER() OVER (
                   PARTITION BY post_id ORDER BY created_at DESC, comment_id DESC) AS rn
                 FROM comments c
                 WHERE c.status = 'active' AND c.post_id IN (${ph}))
           WHERE rn <= ?
           ORDER BY post_id, created_at DESC`
        ).bind(...ids, nComments)
      );
    }
    const res = await env.DB.batch(stmts);
    for (const row of res[0].results) {
      const p = byId.get(row.post_id);
      if (p) p.translations[row.locale] = row.content; // 只含已翻好的 locale
    }
    for (const row of res[1].results) {
      const p = byId.get(row.target_id);
      if (p && row.c > 0) p.reactions[row.kind] = row.c; // 只列計數 > 0 的 emoji
    }
    if (nComments > 0) {
      for (const row of res[2].results) {
        const p = byId.get(row.post_id);
        if (p) {
          p.comments.push({
            comment_id: row.comment_id,
            post_id: row.post_id,
            locale: row.locale,
            content: row.content,
            country_code: row.country_code,
            city_code: row.city_code,
            created_at: row.created_at,
          });
        }
      }
    }
  }

  return json(
    {
      topic_id: topicId,
      window_hours: WINDOW_HOURS,
      sort,
      server_time: now,
      posts: [...byId.values()],
    },
    200,
    cors
  );
}

export async function handleCreatePost(request, env, ctx, cors) {
  const limited = await rateLimit(request, env, ctx, "post", getAnonId(request), cors);
  if (limited) return limited;
  const body = await readJson(request);
  if (!body) return err(400, "invalid_body", "Malformed JSON body", cors);
  const { topic_id, content, locale } = body;
  if (typeof topic_id !== "string" || topic_id === "")
    return err(400, "invalid_body", "topic_id is required", cors);
  if (typeof content !== "string" || charLen(content) < 1)
    return err(400, "invalid_body", "content is required (1-5000 chars)", cors);
  if (!LOCALES.includes(locale))
    return err(400, "invalid_body", "locale must be one of " + LOCALES.join(", "), cors);
  if (charLen(content) > POST_MAX_CHARS)
    return err(400, "content_too_long", `content exceeds ${POST_MAX_CHARS} characters`, cors);
  // Ask the World 的提問對象。null / 未帶 = 不指定。
  // 2026-08-21 起限定 ISO 3166-1 alpha-2 大寫兩碼 —— 這個值會進 DB 也會回給所有讀者,
  // 不該接受自由字串。加驗之前沒有任何客戶端送過這個欄位(D1 實查全為 NULL),不影響既有行為。
  let target_country = null;
  if (body.target_country != null && body.target_country !== "") {
    if (typeof body.target_country !== "string" || !/^[A-Z]{2}$/.test(body.target_country))
      return err(400, "invalid_body", "target_country must be an ISO 3166-1 alpha-2 code", cors);
    target_country = body.target_country;
  }

  const topic = await env.DB.prepare(
    "SELECT topic_id, status AS topic_status, access_level, current_cycle_id FROM topics WHERE topic_id = ?"
  )
    .bind(topic_id)
    .first();
  if (!topic) return err(404, "not_found", "topic not found", cors);
  const gate = topicGate(topic, cors);
  if (gate) return gate;

  let anonId = getAnonId(request);
  let setCookie = null;
  if (!anonId) {
    anonId = ulid();
    setCookie = anonCookie(anonId);
  }

  const now = Math.floor(Date.now() / 1000);
  const postId = "pst_" + ulid();
  const cc = countryCode(request.cf);
  const city = cityCode(request.cf);

  await env.DB.prepare(
    `INSERT INTO posts (post_id, topic_id, cycle_id, user_id, anon_id,
       original_locale, content, media_json, target_country,
       country_code, city_code,
       views, unique_views, comments, likes, shares, cross_country_engagements, hot_score,
       status, translation_status, created_at, last_activity_at, archived_at)
     VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?,
             0, 0, 0, 0, 0, 0, 0, 'active', 'pending', ?, ?, NULL)`
  )
    .bind(
      postId,
      topic_id,
      topic.current_cycle_id, // cycle_id 直接取 topics 副本的 current_cycle_id
      anonId,
      locale,
      content,
      target_country,
      cc,
      city,
      now,
      now
    )
    .run();

  const headers = { ...cors };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  // 與 feed 中同構的單一 post 物件
  return json(
    {
      post_id: postId,
      topic_id,
      cycle_id: topic.current_cycle_id,
      original_locale: locale,
      content,
      translations: {},
      translation_status: "pending",
      target_country,
      country_code: cc,
      city_code: city,
      created_at: now,
      comment_count: 0,
      reactions: {},
      reaction_actors: 0,
      comments: [],
    },
    201,
    headers
  );
}

export async function handleCreateComment(request, env, ctx, cors) {
  const limited = await rateLimit(request, env, ctx, "comment", getAnonId(request), cors);
  if (limited) return limited;
  const body = await readJson(request);
  if (!body) return err(400, "invalid_body", "Malformed JSON body", cors);
  const { post_id, content, locale } = body;
  if (typeof post_id !== "string" || post_id === "")
    return err(400, "invalid_body", "post_id is required", cors);
  if (typeof content !== "string" || charLen(content) < 1)
    return err(400, "invalid_body", "content is required (1-2000 chars)", cors);
  if (!LOCALES.includes(locale))
    return err(400, "invalid_body", "locale must be one of " + LOCALES.join(", "), cors);
  if (charLen(content) > COMMENT_MAX_CHARS)
    return err(400, "content_too_long", `content exceeds ${COMMENT_MAX_CHARS} characters`, cors);

  const row = await env.DB.prepare(
    `SELECT p.post_id, p.topic_id, p.status AS post_status, p.comments AS comment_count,
            COALESCE(t.access_level, 0) AS access_level, t.status AS topic_status
     FROM posts p LEFT JOIN topics t ON t.topic_id = p.topic_id
     WHERE p.post_id = ?`
  )
    .bind(post_id)
    .first();
  if (!row) return err(404, "not_found", "post not found", cors);
  const gate = topicGate(row, cors);
  if (gate) return gate;
  if (!isPostOpen(row))
    return err(403, "post_locked", "post is locked", cors);

  let anonId = getAnonId(request);
  let setCookie = null;
  if (!anonId) {
    anonId = ulid();
    setCookie = anonCookie(anonId);
  }

  const now = Math.floor(Date.now() / 1000);
  const commentId = "cmt_" + ulid();
  const cc = countryCode(request.cf);
  const city = cityCode(request.cf);

  // 同一交易:寫留言 + posts.comments +1 + last_activity_at 更新
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO comments (comment_id, post_id, topic_id, user_id, anon_id,
         locale, content, country_code, city_code, likes, status, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, 'active', ?)`
    ).bind(commentId, post_id, row.topic_id, anonId, locale, content, cc, city, now),
    env.DB.prepare(
      "UPDATE posts SET comments = comments + 1, last_activity_at = ? WHERE post_id = ?"
    ).bind(now, post_id),
  ]);

  const headers = { ...cors };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  return json(
    {
      comment_id: commentId,
      post_id,
      topic_id: row.topic_id,
      locale,
      content,
      country_code: cc,
      city_code: city,
      created_at: now,
      comment_count: row.comment_count + 1,
    },
    201,
    headers
  );
}

export async function handleReaction(request, env, ctx, cors) {
  const limited = await rateLimit(request, env, ctx, "reaction", getAnonId(request), cors);
  if (limited) return limited;
  const body = await readJson(request);
  if (!body) return err(400, "invalid_body", "Malformed JSON body", cors);
  const { target_type, target_id, kind } = body;
  const op = body.op === undefined ? "add" : body.op;
  // post/comment 的權威在 D1,可以查存在性與 access gate。
  // place/event 的權威在主機 SQLite(不同步進 D1),Worker 查不到,M1 因此不做存在性驗證——
  // target_id 來自靜態站產生的 data/,不是使用者自由輸入。兩者都不受 access_level gate
  // (那只 gate 討論室)。
  const REACTABLE = ["post", "comment", "place", "event"];
  if (!REACTABLE.includes(target_type))
    return err(400, "invalid_body", `target_type must be one of ${REACTABLE.join("/")}`, cors);
  const isUgcTarget = target_type === "post" || target_type === "comment";
  if (typeof target_id !== "string" || target_id === "")
    return err(400, "invalid_body", "target_id is required", cors);
  if (!REACTION_SET.includes(kind))
    return err(400, "invalid_kind", "kind must be one of REACTION_SET", cors);
  if (op !== "add" && op !== "remove")
    return err(400, "invalid_body", "op must be 'add' or 'remove'", cors);

  const row = !isUgcTarget
    ? null
    : target_type === "post"
      ? await env.DB.prepare(
          `SELECT p.status AS post_status,
                  COALESCE(t.access_level, 0) AS access_level, t.status AS topic_status
           FROM posts p LEFT JOIN topics t ON t.topic_id = p.topic_id
           WHERE p.post_id = ?`
        )
          .bind(target_id)
          .first()
      : await env.DB.prepare(
          `SELECT p.status AS post_status,
                  COALESCE(t.access_level, 0) AS access_level, t.status AS topic_status
           FROM comments c
           JOIN posts p ON p.post_id = c.post_id
           LEFT JOIN topics t ON t.topic_id = c.topic_id
           WHERE c.comment_id = ?`
        )
          .bind(target_id)
          .first();
  if (isUgcTarget) {
    if (!row) return err(404, "not_found", `${target_type} not found`, cors);
    const gate = topicGate(row, cors);
    if (gate) return gate;
    if (!isPostOpen(row))
      return err(403, "post_locked", "post is locked", cors);
  }

  let anonId = getAnonId(request);
  let setCookie = null;
  if (!anonId) {
    anonId = ulid();
    setCookie = anonCookie(anonId);
  }

  const now = Math.floor(Date.now() / 1000);
  if (op === "add") {
    // 冪等 upsert;PK (target_type, target_id, actor_id, kind) 允許同一 actor 按多個不同 emoji
    await env.DB.prepare(
      `INSERT INTO reactions (target_type, target_id, actor_id, kind, country_code, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (target_type, target_id, actor_id, kind) DO NOTHING`
    )
      .bind(target_type, target_id, anonId, kind, countryCode(request.cf), now)
      .run();
  } else {
    await env.DB.prepare(
      `DELETE FROM reactions
       WHERE target_type = ? AND target_id = ? AND actor_id = ? AND kind = ?`
    )
      .bind(target_type, target_id, anonId, kind)
      .run();
  }

  const [counts, actors, mine] = await env.DB.batch([
    env.DB.prepare(
      `SELECT kind, COUNT(DISTINCT actor_id) AS c FROM reactions
       WHERE target_type = ? AND target_id = ? GROUP BY kind`
    ).bind(target_type, target_id),
    env.DB.prepare(
      `SELECT COUNT(DISTINCT actor_id) AS c FROM reactions
       WHERE target_type = ? AND target_id = ?`
    ).bind(target_type, target_id),
    env.DB.prepare(
      `SELECT kind FROM reactions
       WHERE target_type = ? AND target_id = ? AND actor_id = ? ORDER BY kind`
    ).bind(target_type, target_id, anonId),
  ]);

  const reactions = {};
  for (const r of counts.results) if (r.c > 0) reactions[r.kind] = r.c;

  const headers = { ...cors };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  return json(
    {
      target_type,
      target_id,
      reactions,
      reaction_actors: actors.results[0] ? actors.results[0].c : 0,
      mine: mine.results.map((r) => r.kind),
    },
    200,
    headers
  );
}

export async function handleMe(request, env, cors) {
  const anonId = getAnonId(request);
  let hasPosted = false;
  if (anonId) {
    const row = await env.DB.prepare(
      `SELECT 1 AS x FROM posts WHERE anon_id = ? LIMIT 1`
    )
      .bind(anonId)
      .first();
    hasPosted = !!row;
  }
  return json(
    {
      country_code: request.cf?.country ?? null,
      city_code: cityCode(request.cf),
      has_posted: hasPosted,
    },
    200,
    cors
  );
}

// GET /v1/reactions/summary?target_type=place|event&ids=a,b,c
// 靜態層拿不到 reaction 計數(它們只在 D1),排序需要,所以開一支唯讀彙總端點。
// 一次最多 100 個 id;不存在的 id 就不出現在回應裡。
export async function handleReactionSummary(env, url, cors) {
  const targetType = url.searchParams.get("target_type") || "";
  if (!["post", "comment", "place", "event"].includes(targetType))
    return err(400, "invalid_body", "target_type must be post/comment/place/event", cors);
  const ids = (url.searchParams.get("ids") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 100);
  if (ids.length === 0) return json({ target_type: targetType, items: {} }, 200, cors);

  // SQLite 的視窗函數不支援 COUNT(DISTINCT …) OVER (…),所以拆兩段查:
  // 一段算每個 emoji 的計數,一段算每個目標的 distinct actor 數。
  const ph = ids.map(() => "?").join(",");
  const [kinds, actors] = await env.DB.batch([
    env.DB.prepare(
      `SELECT target_id, kind, COUNT(DISTINCT actor_id) AS n FROM reactions
       WHERE target_type = ? AND target_id IN (${ph}) GROUP BY target_id, kind`
    ).bind(targetType, ...ids),
    env.DB.prepare(
      `SELECT target_id, COUNT(DISTINCT actor_id) AS actors FROM reactions
       WHERE target_type = ? AND target_id IN (${ph}) GROUP BY target_id`
    ).bind(targetType, ...ids),
  ]);

  const items = {};
  for (const r of kinds.results || []) {
    if (!items[r.target_id]) items[r.target_id] = { reactions: {}, reaction_actors: 0 };
    items[r.target_id].reactions[r.kind] = r.n;
  }
  for (const r of actors.results || []) {
    if (!items[r.target_id]) items[r.target_id] = { reactions: {}, reaction_actors: 0 };
    items[r.target_id].reaction_actors = r.actors;
  }
  return json({ target_type: targetType, items }, 200, cors);
}
