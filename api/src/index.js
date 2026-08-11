// aeiou-api — 動態互動層:討論室發文/留言/reaction + 8H 即時 feed
// 唯一契約:docs/briefs/api-contract.md(欄位名不得自行加減)
// M1 刻意不做:Turnstile / rate limit(有意識的裸奔)、OAuth、圖片、Markdown 渲染。

const REACTION_SET = ["❤️", "😂", "😮", "😢", "🤔", "🎉", "👏"]; // 不含 👍(用戶明示排除)
const LOCALES = ["zh-TW", "en", "ja", "zh-CN", "hi", "id", "pt-BR"];
const ALLOWED_ORIGINS = ["https://weiqi-kids.github.io"];
const WINDOW_HOURS = 8;
const POST_MAX_CHARS = 5000;
const COMMENT_MAX_CHARS = 2000;

// ---------- 基礎工具 ----------

// ULID(Crockford base32;26 字元)。32 整除 256,無 modulo bias。
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulid(now = Date.now()) {
  let ts = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    ts = B32[t % 32] + ts;
    t = Math.floor(t / 32);
  }
  const rnd = crypto.getRandomValues(new Uint8Array(16));
  let r = "";
  for (let i = 0; i < 16; i++) r += B32[rnd[i] % 32];
  return ts + r;
}

const ANON_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

function charLen(s) {
  // 以 code point 計字元數(契約:post ≤5000 / comment ≤2000 字元)
  return [...s].length;
}

// city_code = lowercase-slugify(request.cf.city);無 city 時 NULL
function cityCode(cf) {
  const city = cf && cf.city;
  if (!city) return null;
  const s = String(city)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || null;
}

function countryCode(cf) {
  // posts.country_code NOT NULL;request.cf 極少數情況無 country 時退 "XX"
  return (cf && cf.country) || "XX";
}

function getAnonId(request) {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0 && part.slice(0, eq).trim() === "anon_id") {
      const v = part.slice(eq + 1).trim();
      if (ANON_RE.test(v)) return v;
    }
  }
  return null;
}

function anonCookie(anonId) {
  // 跨站 cookie 三件套之一;缺一不可(_shared-context.md)
  return `anon_id=${anonId}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=None`;
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    // origin 不得用 *(因為 Allow-Credentials: true)
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin",
    };
  }
  return {};
}

function json(data, status, extra) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

function err(status, code, message, extra) {
  return json({ error: { code, message } }, status, extra);
}

async function readJson(request) {
  try {
    const body = await request.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) return undefined;
    return body;
  } catch {
    return undefined;
  }
}

// 內部端點:Bearer <SYNC_SECRET>;SHA-256 後 timingSafeEqual,避免時序側信道
async function checkSyncAuth(request, env) {
  if (!env.SYNC_SECRET) return false;
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/);
  if (!m) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(m[1])),
    crypto.subtle.digest("SHA-256", enc.encode(env.SYNC_SECRET)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

// ---------- 共用 gate ----------
// access gate 只 gate 討論室(讀+寫都經此 Worker,一律檢查);M1 不做 OAuth,1/2 一律 401
function topicGate(row, cors) {
  if ((row.access_level | 0) >= 1) {
    return err(401, "login_required", "This topic requires login (not available in M1)", cors);
  }
  if (row.topic_status === "candidate" || row.topic_status === "merged") {
    return err(403, "topic_locked", "Topic is not open for discussion", cors);
  }
  return null;
}

// ---------- 公開端點 ----------

async function handleFeed(request, env, topicId, url, cors) {
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
              p.translation_status, p.country_code, p.city_code, p.created_at,
              p.comments AS comment_count,
              (SELECT COUNT(DISTINCT r.actor_id) FROM reactions r
                WHERE r.target_type = 'post' AND r.target_id = p.post_id) AS reaction_actors,
              ((SELECT COUNT(DISTINCT r.actor_id) FROM reactions r
                 WHERE r.target_type = 'post' AND r.target_id = p.post_id) + p.comments) AS heat
       FROM posts p
       WHERE p.topic_id = ? AND p.created_at >= ? AND p.status IN ('active','cooling')
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

async function handleCreatePost(request, env, cors) {
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
  const target_country =
    typeof body.target_country === "string" && body.target_country !== ""
      ? body.target_country
      : null;

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

async function handleCreateComment(request, env, cors) {
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
  if (row.post_status !== "active" && row.post_status !== "cooling")
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

async function handleReaction(request, env, cors) {
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
    if (row.post_status !== "active" && row.post_status !== "cooling")
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

// ---------- 內部端點(主機 cron ↔ Worker;皆須 Bearer SYNC_SECRET) ----------

async function handleSyncTopics(request, env) {
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

async function handlePendingTranslation(env, url) {
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

async function handleTranslations(request, env) {
  const body = await readJson(request);
  if (!body) return err(400, "invalid_body", "Malformed JSON body");
  const translations = Array.isArray(body.translations) ? body.translations : [];
  const doneIds = Array.isArray(body.done_post_ids) ? body.done_post_ids : [];

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
  if (stmts.length > 0) await env.DB.batch(stmts);
  return json({ i18n_upserted: translations.length, posts_done: doneIds.length }, 200);
}

// GET /v1/me —— 讀者是誰、在哪裡。
// 位置以 Cloudflare 的 request.cf 為準:每一次請求都帶,不必等使用者發過文,
// 也不需要 GPS(GPS 給經緯度,換成城市要反向地理編碼,而資料模型刻意不存座標)。
// has_posted 供前端判斷「這個人有沒有在站上留下過足跡」。
async function handleMe(request, env, cors) {
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
async function handleReactionSummary(env, url, cors) {
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

// ---------- 路由 ----------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const cors = corsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    try {
      // 公開端點
      const feedMatch = path.match(/^\/v1\/topics\/([^/]+)\/feed$/);
      if (feedMatch) {
        if (request.method !== "GET")
          return err(405, "method_not_allowed", "Use GET", cors);
        return await handleFeed(request, env, decodeURIComponent(feedMatch[1]), url, cors);
      }
      if (path === "/v1/me") {
        if (request.method !== "GET")
          return err(405, "method_not_allowed", "Use GET", cors);
        return await handleMe(request, env, cors);
      }
      if (path === "/v1/reactions/summary") {
        if (request.method !== "GET")
          return err(405, "method_not_allowed", "Use GET", cors);
        return await handleReactionSummary(env, url, cors);
      }
      if (path === "/v1/posts" || path === "/v1/comments" || path === "/v1/reactions") {
        if (request.method !== "POST")
          return err(405, "method_not_allowed", "Use POST", cors);
        if (path === "/v1/posts") return await handleCreatePost(request, env, cors);
        if (path === "/v1/comments") return await handleCreateComment(request, env, cors);
        return await handleReaction(request, env, cors);
      }

      // 內部端點(主機 cron 呼叫,無 CORS 需求)
      if (path.startsWith("/internal/")) {
        if (!(await checkSyncAuth(request, env)))
          return err(401, "unauthorized", "Invalid or missing bearer token");
        if (path === "/internal/sync/topics") {
          if (request.method !== "POST")
            return err(405, "method_not_allowed", "Use POST");
          return await handleSyncTopics(request, env);
        }
        if (path === "/internal/ugc/pending-translation") {
          if (request.method !== "GET")
            return err(405, "method_not_allowed", "Use GET");
          return await handlePendingTranslation(env, url);
        }
        if (path === "/internal/translations") {
          if (request.method !== "POST")
            return err(405, "method_not_allowed", "Use POST");
          return await handleTranslations(request, env);
        }
        return err(404, "not_found", "No such internal route");
      }

      return err(404, "not_found", "No such route", cors);
    } catch (e) {
      console.log(
        JSON.stringify({
          level: "error",
          path,
          method: request.method,
          error: String((e && e.stack) || e),
        })
      );
      return err(500, "internal_error", "Internal error", cors);
    }
  },
};
