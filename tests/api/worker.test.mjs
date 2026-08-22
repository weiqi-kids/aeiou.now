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

describe("Ask the World:target_country", () => {
  // 欄位 2026-08-21 才接到 feed 與前端。在那之前寫得進 posts 表、卻讀不出來,
  // 於是「問哪一國」這件事對讀者不存在。這組測試守的是那條路徑不要再斷掉。
  beforeEach(() => seedTopic());

  test("不帶 target_country 時存 null,feed 也回 null", async () => {
    const created = await call("/v1/posts", {
      method: "POST", anonId: ANON,
      body: { topic_id: "top_TEST", content: "hello", locale: "zh-TW" },
    });
    const body = await created.json();
    assert.equal(created.status, 201, JSON.stringify(body));
    assert.equal(body.target_country, null);

    const feed = await call("/v1/topics/top_TEST/feed?sort=new");
    assert.equal((await feed.json()).posts[0].target_country, null);
  });

  test("帶合法 ISO 兩碼時回寫並出現在 feed", async () => {
    const created = await call("/v1/posts", {
      method: "POST", anonId: ANON,
      body: { topic_id: "top_TEST", content: "hello", locale: "zh-TW", target_country: "JP" },
    });
    const body = await created.json();
    assert.equal(created.status, 201, JSON.stringify(body));
    assert.equal(body.target_country, "JP");

    const feed = await call("/v1/topics/top_TEST/feed?sort=new");
    assert.equal((await feed.json()).posts[0].target_country, "JP");
  });

  for (const value of ["jp", "JPN", "J", "台灣", "'; DROP TABLE posts;--"]) {
    test(`target_country=${JSON.stringify(value)} 回 400`, async () => {
      const res = await call("/v1/posts", {
        method: "POST", anonId: ANON,
        body: { topic_id: "top_TEST", content: "hello", locale: "zh-TW", target_country: value },
      });
      assert.equal(res.status, 400);
      assert.equal((await res.json()).error.code, "invalid_body");
    });
  }
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

// ---------------------------------------------------------------------------
// 2026-08-21 契約補洞:reaction 的 mine、guess 正解的揭曉時機。
// 兩者的共同點是「同一個端點對不同的人要回不同的東西」——最容易寫成對所有人都回,
// 而那正是 guess 原本的毛病(答案跟題目印在同一張紙上)。

describe("契約 §1/§4:mine —— 我按過哪些 emoji", () => {
  const OTHER = "01JZZZZZZZZZZZZZZZZZZZZZZX";

  beforeEach(async () => {
    seedTopic();
    await call("/v1/posts", {
      method: "POST", anonId: ANON,
      body: { topic_id: "top_TEST", content: "hello", locale: "zh-TW" },
    });
  });

  const onlyPostId = () => raw.prepare("SELECT post_id FROM posts").get().post_id;

  test("feed:按過的人拿得到 mine,沒按過的人拿到空陣列", async () => {
    const pid = onlyPostId();
    const react = await call("/v1/reactions", {
      method: "POST", anonId: ANON,
      body: { target_type: "post", target_id: pid, kind: "❤️", op: "add" },
    });
    assert.equal(react.status, 200);

    const mineRes = await (await call("/v1/topics/top_TEST/feed", { anonId: ANON })).json();
    assert.deepEqual(mineRes.posts[0].mine, ["❤️"], "自己按過的 emoji 要回得出來");

    const otherRes = await (await call("/v1/topics/top_TEST/feed", { anonId: OTHER })).json();
    assert.deepEqual(otherRes.posts[0].mine, [], "別人按的不算我的");
    assert.equal(otherRes.posts[0].reactions["❤️"], 1, "但計數是公開的,別人照樣看得到");
  });

  test("feed:沒有 cookie 的讀者拿到 [] 而不是缺 key", async () => {
    const res = await (await call("/v1/topics/top_TEST/feed")).json();
    assert.ok(Array.isArray(res.posts[0].mine), "一律是陣列 —— 缺席會讓前端要寫兩套判斷");
    assert.equal(res.posts[0].mine.length, 0);
  });

  test("feed:comments=0 時 mine 仍然正確(兩段查詢的索引不能互相踩)", async () => {
    const pid = onlyPostId();
    await call("/v1/reactions", {
      method: "POST", anonId: ANON,
      body: { target_type: "post", target_id: pid, kind: "🎉", op: "add" },
    });
    const res = await (await call("/v1/topics/top_TEST/feed?comments=0", { anonId: ANON })).json();
    assert.deepEqual(res.posts[0].mine, ["🎉"]);
  });

  test("reactions/summary:每個被問到的 id 都有一格,含沒人按過的", async () => {
    const pid = onlyPostId();
    await call("/v1/reactions", {
      method: "POST", anonId: ANON,
      body: { target_type: "post", target_id: pid, kind: "😂", op: "add" },
    });
    const res = await (
      await call(`/v1/reactions/summary?target_type=post&ids=${pid},pst_NOBODY`, { anonId: ANON })
    ).json();
    assert.deepEqual(res.items[pid].mine, ["😂"]);
    assert.deepEqual(res.items.pst_NOBODY.mine, [], "沒人按過的目標也要有一格");
    assert.equal(res.items.pst_NOBODY.reaction_actors, 0);
  });
});

describe("契約 §7.1:guess 的正解只在投過票之後才給", () => {
  beforeEach(() => {
    seedTopic();
    raw.prepare(
      `INSERT INTO questions (question_id, qdate, kind, topic_id, options_json, status,
                              answer_option, explain_json) VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      "qst_g", "2026-08-21", "guess", "top_TEST", JSON.stringify(["a", "b"]), "active",
      "b", JSON.stringify({ "zh-TW": "因為乙", en: "because b" })
    );
    raw.prepare(
      "INSERT INTO questions (question_id, qdate, kind, topic_id, options_json, status) VALUES (?,?,?,?,?,?)"
    ).run("qst_p", "2026-08-21", "poll", "top_TEST", JSON.stringify(["a", "b"]), "active");
  });

  test("沒投票:回應裡連 answer 這個 key 都沒有", async () => {
    const res = await (await call("/v1/questions/qst_g/results?locale=zh-TW")).json();
    assert.equal(res.mine, null);
    assert.ok(!("answer" in res), "沒投票就不該看到正解 —— 這正是原本放靜態 JSON 的毛病");
    assert.ok(!("explain" in res));
  });

  test("投完票:同一支 POST 就揭曉,解說用送出的那一語", async () => {
    const res = await (await call("/v1/votes", {
      method: "POST", anonId: ANON,
      body: { question_id: "qst_g", option_id: "a", locale: "zh-TW" },
    })).json();
    assert.equal(res.answer, "b");
    assert.equal(res.explain, "因為乙");
  });

  test("投過票之後再 GET results 也拿得到(重新整理不會把答案收回去)", async () => {
    await call("/v1/votes", {
      method: "POST", anonId: ANON,
      body: { question_id: "qst_g", option_id: "a", locale: "en" },
    });
    const res = await (await call("/v1/questions/qst_g/results?locale=en", { anonId: ANON })).json();
    assert.equal(res.answer, "b");
    assert.equal(res.explain, "because b");
  });

  test("缺該語系的解說就不給句子,不退回別的語言", async () => {
    const res = await (await call("/v1/votes", {
      method: "POST", anonId: ANON,
      body: { question_id: "qst_g", option_id: "b", locale: "ja" },
    })).json();
    assert.equal(res.answer, "b", "正解是 option_id,與語言無關,照給");
    assert.equal(res.explain, null, "只有一種語言看得懂的字串不准上畫面(CLAUDE.md 紅線)");
  });

  test("poll 沒有正解:投完票也不會多出 answer", async () => {
    const res = await (await call("/v1/votes", {
      method: "POST", anonId: ANON,
      body: { question_id: "qst_p", option_id: "a", locale: "zh-TW" },
    })).json();
    assert.ok(!("answer" in res));
  });

  test("同步端點擋下不在選項裡的正解", async () => {
    const res = await call("/internal/sync/questions", {
      method: "POST", headers: { authorization: `Bearer ${SYNC_SECRET}` },
      body: { questions: [{
        question_id: "qst_bad", qdate: "2026-08-21", kind: "guess", topic_id: "top_TEST",
        options: ["a", "b"], answer: "zzz",
      }] },
    });
    assert.equal(res.status, 400, "正解不在選項裡 = 揭曉時會印出讀者沒看過的 id");
  });
});

describe("Turnstile:未設定就不驗,設定了就非過不可", () => {
  beforeEach(() => { seedTopic(); });

  test("沒設 TURNSTILE_SECRET:照舊放行(碼先上線、鑰匙後到的那段時間)", async () => {
    const res = await call("/v1/posts", {
      method: "POST", anonId: ANON,
      body: { topic_id: "top_TEST", content: "hello", locale: "zh-TW" },
    });
    assert.equal(res.status, 201);
  });

  test("設了 secret 但沒帶 token → 403 challenge_required", async () => {
    env = { ...env, TURNSTILE_SECRET: "s", TURNSTILE_SITEKEY: "k" };
    const res = await call("/v1/posts", {
      method: "POST", anonId: ANON,
      body: { topic_id: "top_TEST", content: "hello", locale: "zh-TW" },
    });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error.code, "challenge_required");
  });

  test("siteverify 說不通過 → 403,貼文不進 DB", async () => {
    env = { ...env, TURNSTILE_SECRET: "s", TURNSTILE_SITEKEY: "k" };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ success: false }));
    try {
      const res = await call("/v1/posts", {
        method: "POST", anonId: ANON,
        body: { topic_id: "top_TEST", content: "hi", locale: "zh-TW", turnstile_token: "bad" },
      });
      assert.equal(res.status, 403);
      assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM posts").get().n, 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("siteverify 打不通 → 503,**不放行**", async () => {
    env = { ...env, TURNSTILE_SECRET: "s", TURNSTILE_SITEKEY: "k" };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("network down"); };
    try {
      const res = await call("/v1/posts", {
        method: "POST", anonId: ANON,
        body: { topic_id: "top_TEST", content: "hi", locale: "zh-TW", turnstile_token: "t" },
      });
      assert.equal(res.status, 503, "驗不到就當作通過 = 在對方最想要的時刻自動關掉這一層");
      assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM posts").get().n, 0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("通過 → 照常寫入", async () => {
    env = { ...env, TURNSTILE_SECRET: "s", TURNSTILE_SITEKEY: "k" };
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ success: true }));
    try {
      const res = await call("/v1/posts", {
        method: "POST", anonId: ANON,
        body: { topic_id: "top_TEST", content: "hi", locale: "zh-TW", turnstile_token: "good" },
      });
      assert.equal(res.status, 201);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("/v1/me 回報開關與 sitekey(前端據此決定要不要載外部 script)", async () => {
    assert.deepEqual((await (await call("/v1/me")).json()).turnstile,
      { required: false, sitekey: null }, "沒設定時 sitekey 不得外洩成非 null");
    env = { ...env, TURNSTILE_SECRET: "s", TURNSTILE_SITEKEY: "0x4AAA" };
    assert.deepEqual((await (await call("/v1/me")).json()).turnstile,
      { required: true, sitekey: "0x4AAA" });
  });
});

// ---------------------------------------------------------------------------
// 規則層 moderation(2026-08-22)。這一層決定讀者看不看得到一則內容,而且是**同步**
// 在寫入時判的 —— 判錯就是直接吃掉一則真人留言。所以誤殺的那幾種情形要一條一條釘住。

describe("規則層 moderation:留言終於有人看了", () => {
  const ANON2 = "01JZZZZZZZZZZZZZZZZZZZZZZW";

  beforeEach(async () => {
    seedTopic();
    await call("/v1/posts", {
      method: "POST", anonId: ANON,
      body: { topic_id: "top_TEST", content: "來聊聊各國怎麼過", locale: "zh-TW" },
    });
  });

  const onlyPostId = () => raw.prepare("SELECT post_id FROM posts ORDER BY rowid DESC").get().post_id;
  const comment = (content, anonId = ANON2) => call("/v1/comments", {
    method: "POST", anonId,
    body: { post_id: onlyPostId(), content, locale: "zh-TW" },
  });
  const statusOf = (id) => raw.prepare("SELECT status FROM comments WHERE comment_id = ?").get(id).status;

  test("縮網址 → 寫得進去、露不出來(status='moderation'),但回應仍是 201", async () => {
    const res = await comment("看這個 https://bit.ly/abc123");
    assert.equal(res.status, 201, "不回 4xx —— 告訴對方他被擋了等於送他一個偵測器");
    assert.equal(statusOf((await res.json()).comment_id), "moderation");
  });

  test("整則只有連結 → moderation", async () => {
    const res = await comment("https://example.com/aaa");
    assert.equal(statusOf((await res.json()).comment_id), "moderation");
  });

  test("正常留言帶一個來源連結 → 照常 active", async () => {
    const res = await comment("日本那邊我查到的是這樣,來源在 https://www.gov.tw/abc 這頁的第三段");
    assert.equal(statusOf((await res.json()).comment_id), "active", "帶來源是好行為,不能擋");
  });

  test("完全沒有連結的普通留言 → active", async () => {
    const res = await comment("我們家都是初二才回外婆家");
    assert.equal(statusOf((await res.json()).comment_id), "active");
  });

  test("emoji 不會被誤判成重複字元(代理對不能拆開算)", async () => {
    const res = await comment("太好笑了 😂😂😂 我阿嬤也這樣");
    assert.equal(statusOf((await res.json()).comment_id), "active");
  });

  test("同一字元洗三十次以上 → 記 flag(medium,不吃掉內容)", async () => {
    const res = await comment("啊".repeat(40));
    const id = (await res.json()).comment_id;
    assert.equal(statusOf(id), "active", "medium 不改變呈現");
    const flag = raw.prepare("SELECT severity, reason FROM moderation_flags WHERE target_id = ?").get(id);
    assert.equal(flag.severity, "medium");
    assert.equal(flag.reason, "bot");
  });

  test("被判定的內容會留下 flag,而且一則只留一列", async () => {
    const id = (await (await comment("https://bit.ly/x")).json()).comment_id;
    const n = raw.prepare("SELECT COUNT(*) AS n FROM moderation_flags WHERE target_id = ?").get(id).n;
    assert.equal(n, 1);
    const row = raw.prepare("SELECT * FROM moderation_flags WHERE target_id = ?").get(id);
    assert.equal(row.reason, "malicious_link");
    assert.equal(row.synced_at, null, "主機還沒拉走");
  });

  test("貼文也走同一層:滿版連結的貼文寫成 moderation", async () => {
    const res = await call("/v1/posts", {
      method: "POST", anonId: ANON2,
      body: { topic_id: "top_TEST", content: "https://bit.ly/aa", locale: "zh-TW" },
    });
    assert.equal(res.status, 201);
    const st = raw.prepare("SELECT status FROM posts WHERE post_id = ?").get((await res.json()).post_id).status;
    assert.equal(st, "moderation");
  });

  test("貼文的連結容忍度比留言高(兩千字放幾個來源是正常的)", async () => {
    const body = "各國的規定我整理在下面:" + [
      "https://law.moj.gov.tw/a", "https://laws.e-gov.go.jp/b", "https://www.gov.cn/c",
    ].join(" ");
    const res = await call("/v1/posts", {
      method: "POST", anonId: ANON2,
      body: { topic_id: "top_TEST", content: body, locale: "zh-TW" },
    });
    const st = raw.prepare("SELECT status FROM posts WHERE post_id = ?").get((await res.json()).post_id).status;
    assert.equal(st, "active");
  });

  test("被判 moderation 的留言不出現在 feed 的內嵌留言裡", async () => {
    await comment("https://bit.ly/x");
    await comment("這則是正常的");
    const feed = await (await call("/v1/topics/top_TEST/feed?comments=10")).json();
    const contents = feed.posts[0].comments.map((c) => c.content);
    assert.ok(!contents.some((c) => c.includes("bit.ly")), "露不出來才是這一層的目的");
    assert.ok(contents.some((c) => c === "這則是正常的"));
  });
});

describe("語意搜尋:沒綁 Vectorize 時要說事實", () => {
  test("沒有綁定 → 503 search_unavailable,不是空結果", async () => {
    const res = await call("/v1/search?q=%E6%83%85%E4%BA%BA%E7%AF%80");
    assert.equal(res.status, 503, "空結果會讓前端說「找不到」,而事實是「沒有在找」");
    assert.equal((await res.json()).error.code, "search_unavailable");
  });

  test("q 是必填", async () => {
    env = { ...env, VECTORIZE: {}, AI: {} };
    assert.equal((await call("/v1/search?q=")).status, 400);
  });

  test("q 過長擋下(embedding 成本與長度成正比)", async () => {
    env = { ...env, VECTORIZE: {}, AI: {} };
    assert.equal((await call(`/v1/search?q=${"a".repeat(201)}`)).status, 400);
  });

  test("字面命中排在語意結果前面,且不重複同一個 Topic", async () => {
    seedTopic({ topic_id: "top_MOON", slug: "mid-autumn" });
    raw.prepare("INSERT INTO topic_i18n (topic_id, locale, title, keywords_json) VALUES (?,?,?,?)")
      .run("top_MOON", "en", "Mid-Autumn", JSON.stringify(["mooncake"]));
    env = {
      ...env,
      AI: { run: async (_m, { text }) => ({ data: text.map(() => new Array(1024).fill(0.1)) }) },
      VECTORIZE: {
        query: async () => ({
          matches: [
            // 同一個 Topic 也出現在語意結果裡 —— 不該重複列出
            { id: "top_MOON", score: 0.9, metadata: { topic_id: "top_MOON", slug: "mid-autumn", status: "active" } },
            { id: "top_OTHER", score: 0.61, metadata: { topic_id: "top_OTHER", slug: "other", status: "active" } },
            // 低於門檻 → 不該出現
            { id: "top_LOW", score: 0.31, metadata: { topic_id: "top_LOW", slug: "low", status: "active" } },
            // 不公開 → 不該出現
            { id: "top_HID", score: 0.99, metadata: { topic_id: "top_HID", slug: "hid", status: "merged" } },
          ],
        }),
      },
    };
    const body = await (await call("/v1/search?q=mooncake")).json();
    const slugs = body.matches.map((m) => m.slug);
    assert.equal(body.matches[0].match, "literal", "確定的事排前面");
    assert.equal(body.matches[0].score, 1);
    assert.equal(slugs.filter((s) => s === "mid-autumn").length, 1, "同一個 Topic 不重複");
    assert.ok(slugs.includes("other"));
    assert.ok(!slugs.includes("low"), "低於門檻的要被切掉");
    assert.ok(!slugs.includes("hid"), "merged 是不公開的,不該出現在搜尋結果");
  });

  test("min_score 可覆寫(校準用),且夾在合理區間", async () => {
    seedTopic({ topic_id: "top_X", slug: "x" });
    env = {
      ...env,
      AI: { run: async (_m, { text }) => ({ data: text.map(() => new Array(1024).fill(0.1)) }) },
      VECTORIZE: {
        query: async () => ({
          matches: [{ id: "top_LOW", score: 0.35, metadata: { topic_id: "top_LOW", slug: "low", status: "active" } }],
        }),
      },
    };
    assert.equal((await (await call("/v1/search?q=zzz")).json()).count, 0, "預設門檻切掉它");
    const loose = await (await call("/v1/search?q=zzz&min_score=0.3")).json();
    assert.equal(loose.min_score, 0.3);
    assert.equal(loose.count, 1, "放寬之後看得到,這就是校準要的東西");
    const clamped = await (await call("/v1/search?q=zzz&min_score=0.01")).json();
    assert.equal(clamped.min_score, 0.3, "夾住下限");
  });
});

describe("圖片:上傳成功 ≠ 看得到", () => {
  // 真的 PNG 的前 8 個位元組;sniff() 只看魔術位元組,不看 Content-Type。
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
  let store;

  beforeEach(() => {
    store = new Map();
    env = {
      ...env,
      ARCHIVE: {
        put: async (k, v) => { store.set(k, v); },
        get: async (k) => (store.has(k) ? { body: "bytes" } : null),
      },
    };
  });

  const upload = (bytes) => call("/v1/uploads", { method: "POST", anonId: ANON, raw: bytes });

  test("沒綁 R2 → 503,不是靜靜失敗", async () => {
    env = { ...env, ARCHIVE: undefined };
    const res = await upload(PNG);
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.code, "media_unavailable");
  });

  test("上傳成功但狀態是 pending,而且回應要明說", async () => {
    const res = await upload(PNG);
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.status, "pending");
    assert.match(body.note, /not publicly visible/i, "不明說會讓前端以為圖片壞了");
    const row = raw.prepare("SELECT status FROM media WHERE media_id = ?").get(body.media_id);
    assert.equal(row.status, "pending");
  });

  test("pending 的圖回 404 而不是 403", async () => {
    const { media_id: id } = await (await upload(PNG)).json();
    const res = await call(`/v1/media/${id}`);
    assert.equal(res.status, 404, "403 等於告訴對方東西在這裡、只是不給他");
  });

  test("放行之後才看得到,退回之後又看不到", async () => {
    const { media_id: id } = await (await upload(PNG)).json();
    const ok = await call("/internal/moderation/media", {
      method: "POST", headers: { authorization: `Bearer ${SYNC_SECRET}` },
      body: { media_id: id, status: "approved" },
    });
    assert.equal((await ok.json()).updated, 1);
    assert.equal((await call(`/v1/media/${id}`)).status, 200);

    await call("/internal/moderation/media", {
      method: "POST", headers: { authorization: `Bearer ${SYNC_SECRET}` },
      body: { media_id: id, status: "rejected" },
    });
    assert.equal((await call(`/v1/media/${id}`)).status, 404);
  });

  test("文字檔冒充 PNG 被擋下(只看魔術位元組,不看 Content-Type)", async () => {
    const fake = new TextEncoder().encode("not an image at all, just text");
    const res = await call("/v1/uploads", {
      method: "POST", anonId: ANON, raw: fake,
      headers: { "content-type": "image/png" },
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error.code, "unsupported_media");
  });

  test("超過上限擋下", async () => {
    const big = new Uint8Array(2 * 1024 * 1024 + 1);
    big.set(PNG.slice(0, 8));
    const res = await upload(big);
    assert.equal(res.status, 413);
  });

  test("每一次上傳都進審核工作檯", async () => {
    const { media_id: id } = await (await upload(PNG)).json();
    const flag = raw.prepare(
      "SELECT reason, severity FROM moderation_flags WHERE target_type='image' AND target_id=?"
    ).get(id);
    assert.ok(flag, "沒進工作檯 = 沒有人會知道有圖在等");
    assert.equal(flag.reason, "needs_review");
  });
});
