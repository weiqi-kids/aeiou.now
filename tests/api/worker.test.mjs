// Worker 的行為測試。優先測「錯了會靜默出事」的那幾段:
// 發文閘門、入口限流、內部端點認證、投票去重、feed 的時間窗與狀態過濾。
//
// 這些之前一行測試都沒有。2026-08-19 在未 commit 的工作區裡發現發文閘門被改成
// 「只放行 active/cooling」,那會把所有 archived Topic 鎖死不能發文。
// **它沒有上線**(git log -S 查證從未進過任何 commit,Worker 最後部署是 08-15),
// 是靠人工讀碼攔下的 —— 而那正是問題:當時沒有任何自動化會攔它。
// 本檔的第一組測試就是要讓下一次不必靠運氣。
//
// 跑法:node --test tests/api/worker.test.mjs

import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeD1, makeCtx, req, installWorkerCryptoShim } from "./helpers/d1.mjs";

const SYNC_SECRET = "test-sync-secret";
let worker;

before(async () => {
  installWorkerCryptoShim();
  worker = (await import("../../api/src/index.js")).default;
});

let DB, raw, env;

beforeEach(() => {
  ({ DB, raw } = makeD1());
  env = { DB, SYNC_SECRET };
});

/** 打一發請求,順便把 waitUntil 的副作用(限流計數)結算掉。 */
async function call(path, opts) {
  const { ctx, settle } = makeCtx();
  const res = await worker.fetch(req(path, opts), env, ctx);
  await settle();
  return res;
}

function seedTopic({ topic_id = "top_TEST", slug = "test", status = "active", access_level = 0, cycle = "cyc_1" } = {}) {
  raw.prepare(
    "INSERT INTO topics (topic_id, slug, status, access_level, is_perennial, global_score, current_cycle_id) VALUES (?,?,?,?,0,0,?)"
  ).run(topic_id, slug, status, access_level, cycle);
  return topic_id;
}

// 必須通過 Worker 的 ANON_RE(ULID/Crockford base32,不含 I L O U),否則
// getAnonId 會忽略 cookie 並每次發新 ID —— 那樣所有「同一個人」的測試都會沙盤化。
const ANON = "01JZZZZZZZZZZZZZZZZZZZZZZY";

// ---------------------------------------------------------------------------

describe("發文閘門:status 的兩個軸不可混用", () => {
  // CLAUDE.md 紅線:topics.status='archived' 仍可發文(只是不熱);
  // 只有 posts.status='archived' 才是永久鎖定。同名不同義。
  for (const status of ["active", "archived"]) {
    test(`status='${status}' 的 Topic 可以發文`, async () => {
      seedTopic({ status });
      const res = await call("/v1/posts", {
        method: "POST", anonId: ANON,
        body: { topic_id: "top_TEST", content: "hello", locale: "zh-TW" },
      });
      assert.equal(res.status, 201, await res.text());
    });
  }

  for (const status of ["candidate", "merged"]) {
    test(`status='${status}' 的 Topic 擋下發文`, async () => {
      seedTopic({ status });
      const res = await call("/v1/posts", {
        method: "POST", anonId: ANON,
        body: { topic_id: "top_TEST", content: "hello", locale: "zh-TW" },
      });
      assert.equal(res.status, 403);
      assert.equal((await res.json()).error.code, "topic_locked");
    });
  }

  test("access_level >= 1 回 401(M1 不做 OAuth)", async () => {
    seedTopic({ access_level: 1 });
    const res = await call("/v1/posts", {
      method: "POST", anonId: ANON,
      body: { topic_id: "top_TEST", content: "hello", locale: "zh-TW" },
    });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error.code, "login_required");
  });

  test("archived Topic 的 feed 讀得到(不是 403)", async () => {
    seedTopic({ status: "archived" });
    const res = await call("/v1/topics/top_TEST/feed");
    assert.equal(res.status, 200, await res.text());
  });
});

describe("feed 只收還開著的 Post", () => {
  // posts.status='archived' 是永久鎖定,與 topics.status='archived' 同名不同義。
  // 這組同時驗證 feed SQL 的 ${SQL_POST_OPEN} 樣板有正確展開 —— 沒展開的話
  // SQL 會語法錯誤或過濾失效,而那不會有任何外顯徵兆。
  const insertPost = (post_id, status) => raw.prepare(
    `INSERT INTO posts (post_id, topic_id, cycle_id, user_id, anon_id, original_locale,
       content, media_json, target_country, country_code, city_code,
       views, unique_views, comments, likes, shares, cross_country_engagements, hot_score,
       status, translation_status, created_at, last_activity_at, archived_at)
     VALUES (?,?,?,NULL,?,?,?,NULL,NULL,'TW','taipei',0,0,0,0,0,0,0,?,'done',?,?,NULL)`
  ).run(post_id, "top_TEST", "cyc_1", ANON, "zh-TW", `content-${status}`,
        status, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));

  test("active 出現、archived 與 moderation 不出現", async () => {
    seedTopic();
    insertPost("pst_OPEN", "active");
    insertPost("pst_LOCKED", "archived");
    insertPost("pst_MOD", "moderation");

    const res = await call("/v1/topics/top_TEST/feed");
    const payload = await res.json();   // body 只能讀一次
    assert.equal(res.status, 200, JSON.stringify(payload));
    const ids = (payload.posts || []).map((p) => p.post_id);
    assert.ok(ids.includes("pst_OPEN"), `active 的貼文應該在 feed,實際:${JSON.stringify(ids)}`);
    assert.ok(!ids.includes("pst_LOCKED"), "archived 的貼文不該在 feed");
    assert.ok(!ids.includes("pst_MOD"), "moderation 的貼文不該在 feed");
  });
});

describe("發文的輸入驗證", () => {
  beforeEach(() => seedTopic());

  const bad = [
    ["缺 topic_id",  { content: "x", locale: "zh-TW" },                      "invalid_body"],
    ["缺 content",   { topic_id: "top_TEST", locale: "zh-TW" },              "invalid_body"],
    ["空 content",   { topic_id: "top_TEST", content: "", locale: "zh-TW" }, "invalid_body"],
    ["locale 不合法", { topic_id: "top_TEST", content: "x", locale: "klingon" }, "invalid_body"],
  ];
  for (const [name, body, code] of bad) {
    test(name, async () => {
      const res = await call("/v1/posts", { method: "POST", anonId: ANON, body });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error.code, code);
    });
  }

  test("content 超長回 content_too_long", async () => {
    const res = await call("/v1/posts", {
      method: "POST", anonId: ANON,
      body: { topic_id: "top_TEST", content: "字".repeat(6000), locale: "zh-TW" },
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, "content_too_long");
  });

  test("不存在的 topic 回 404", async () => {
    const res = await call("/v1/posts", {
      method: "POST", anonId: ANON,
      body: { topic_id: "top_NOPE", content: "x", locale: "zh-TW" },
    });
    assert.equal(res.status, 404);
  });
});

describe("入口限流", () => {
  test("5 分鐘內第 4 篇貼文回 429", async () => {
    seedTopic();
    const post = () => call("/v1/posts", {
      method: "POST", anonId: ANON,
      body: { topic_id: "top_TEST", content: "hi", locale: "zh-TW" },
    });
    for (let i = 1; i <= 3; i++) {
      assert.equal((await post()).status, 201, `第 ${i} 篇應該成功`);
    }
    const fourth = await post();
    assert.equal(fourth.status, 429);
    assert.equal((await fourth.json()).error.code, "rate_limited");
  });

  test("限流事件有寫進 rate_events(anon 與 IP 雙鍵)", async () => {
    seedTopic();
    await call("/v1/posts", {
      method: "POST", anonId: ANON,
      body: { topic_id: "top_TEST", content: "hi", locale: "zh-TW" },
    });
    const keys = raw.prepare("SELECT DISTINCT key FROM rate_events WHERE kind='post'").all().map((r) => r.key);
    assert.ok(keys.some((k) => k.startsWith("anon:")), `應有 anon 鍵,實際:${JSON.stringify(keys)}`);
    assert.ok(keys.some((k) => !k.startsWith("anon:")), `應有 IP 鍵,實際:${JSON.stringify(keys)}`);
  });

  test("IP 鍵不得是明文 IP(必須雜湊)", async () => {
    seedTopic();
    await call("/v1/posts", {
      method: "POST", anonId: ANON, headers: { "cf-connecting-ip": "203.0.113.9" },
      body: { topic_id: "top_TEST", content: "hi", locale: "zh-TW" },
    });
    const keys = raw.prepare("SELECT key FROM rate_events").all().map((r) => r.key).join("|");
    assert.ok(!keys.includes("203.0.113.9"), "rate_events 出現明文 IP —— 這是紅線");
  });
});

describe("內部端點認證", () => {
  const internal = [
    ["GET",  "/internal/ugc/pending-translation"],
    ["POST", "/internal/sync/topics"],
    ["POST", "/internal/translations"],
    ["POST", "/internal/sync/questions"],
  ];

  for (const [method, path] of internal) {
    test(`${path} 無 token 回 401`, async () => {
      const res = await call(path, { method, body: method === "POST" ? {} : undefined });
      assert.equal(res.status, 401);
    });

    test(`${path} 錯 token 回 401`, async () => {
      const res = await call(path, {
        method, headers: { authorization: "Bearer wrong-secret" },
        body: method === "POST" ? {} : undefined,
      });
      assert.equal(res.status, 401);
    });
  }

  test("正確 token 不會被擋在 401", async () => {
    const res = await call("/internal/ugc/pending-translation", {
      headers: { authorization: `Bearer ${SYNC_SECRET}` },
    });
    assert.notEqual(res.status, 401);
  });
});

describe("每日世界一問:一人一票", () => {
  beforeEach(() => {
    seedTopic();
    raw.prepare(
      "INSERT INTO questions (question_id, qdate, kind, topic_id, options_json, status) VALUES (?,?,?,?,?,?)"
    ).run("qst_1", "2026-08-19", "poll", "top_TEST", JSON.stringify(["a", "b"]), "active");
  });

  test("同一個 anon 投兩次只留一筆(改票,不是累加)", async () => {
    const vote = (option_id) => call("/v1/votes", {
      method: "POST", anonId: ANON,
      body: { question_id: "qst_1", option_id, locale: "zh-TW" },
    });
    assert.equal((await vote("a")).status, 200, "第一票");
    assert.equal((await vote("b")).status, 200, "改投第二票");

    const rows = raw.prepare("SELECT option_id FROM question_votes WHERE question_id='qst_1'").all();
    assert.equal(rows.length, 1, "同一 anon 應只有一筆票");
    assert.equal(rows[0].option_id, "b", "應該是最後一次的選項");
  });

  test("不在 options_json 裡的選項被擋下", async () => {
    const res = await call("/v1/votes", {
      method: "POST", anonId: ANON,
      body: { question_id: "qst_1", option_id: "not-an-option", locale: "zh-TW" },
    });
    assert.equal(res.status, 400);
  });
});

describe("路由與 CORS", () => {
  test("未知路徑回 404", async () => {
    assert.equal((await call("/v1/nope")).status, 404);
  });

  test("方法不對回 405", async () => {
    assert.equal((await call("/v1/me", { method: "POST", body: {} })).status, 405);
  });

  test("OPTIONS 回 204 並帶 CORS", async () => {
    const res = await call("/v1/posts", { method: "OPTIONS" });
    assert.equal(res.status, 204);
    assert.ok(res.headers.get("access-control-allow-methods"));
  });

  test("跨站 cookie 三件套:credentials 為 true 時 origin 不得是 *", async () => {
    seedTopic();
    const res = await call("/v1/topics/top_TEST/feed");
    const allowOrigin = res.headers.get("access-control-allow-origin");
    const allowCreds = res.headers.get("access-control-allow-credentials");
    if (allowCreds === "true") {
      assert.notEqual(allowOrigin, "*", "帶 credentials 時 origin 不得為 * —— 跨站 cookie 會整組失效");
    }
  });
});
