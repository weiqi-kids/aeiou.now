// 語意搜尋(草案 §57–§59;docs/02-data-model.md §2.7;2026-08-22)。
//
// ── 為什麼是一個索引、一個向量 ────────────────────────────────────────────
// 模型是 `@cf/baai/bge-m3` —— 多語。日文查「バレンタイン」與中文查「情人節」
// 落在相近的向量空間,所以**一個 Topic 只需要一個向量,不必每語系存一份**。
// 這是選它而不是「先翻譯查詢再搜」的全部理由:後者要先猜使用者在講哪一語,
// 猜錯就整條查不到,而且七語系要維護七份索引。
//
// 向量的來源(§2.7):`canonical_name` + 全部 alias + 七語 title 串接。
// **刻意不含 summary 與逐國散文** —— 那些字太長,會把「這個 Topic 是什麼」稀釋成
// 「這個 Topic 提到過什麼」,搜「情人節」會被一篇提到情人節的中秋內容拉走。
// 索引的是**名字**,不是內容。
//
// ── 為什麼搜尋在 Worker 而不是靜態層 ──────────────────────────────────────
// 靜態站可以自己做關鍵字比對(七語 title 都在 data/ 裡),但那只能做**字面**比對:
// 查「バレンタイン」找不到「Dia dos Namorados」。跨語言正是這個站唯一的資產,
// 所以搜尋必須是語意的,而語意需要模型 —— 那只能在 Worker 端。
//
// ── 沒綁 Vectorize 時 ──────────────────────────────────────────────────────
// 一律回 503 而不是空結果。空結果會讓前端顯示「找不到」,而事實是「沒有在找」——
// 與討論室四態同一條紀律:狀態名稱要說事實(CLAUDE.md 紅線)。

import { json, err, readJson } from "../lib/http.js";

const MODEL = "@cf/baai/bge-m3";
/** 相似度下限的預設值。
 *  ⚠ 這個數字是**量出來的**,而量出來的結論是:**單靠門檻分不開**。
 *  2026-08-22 掃過 12 個應該命中的查詢與 5 個應該落空的:
 *    真陽性 0.452(THR lebaran)– 0.637(年終獎金)
 *    雜訊   最高 0.485(「隨便打幾個字」→ exam-season)
 *  兩個區間**重疊**,沒有任何一個門檻能同時要到全部真陽性又擋掉全部雜訊。
 *  所以真正的修法不是調門檻,是上面那一層字面比對:精確名稱交給確定性判斷,
 *  向量只留給「用不同的字講同一件事」。有了那一層之後,門檻可以訂在雜訊之上
 *  (0.485)的 0.5 —— 被它切掉的低分真陽性,現在都由字面命中接住了。
 *  查詢端可用 `min_score` 覆寫;要重新校準時用 `min_score=0.3` 掃一輪就看得到分佈。 */
const DEFAULT_MIN_SCORE = 0.5;

function requireIndex(env, cors) {
  if (!env.VECTORIZE || !env.AI)
    return err(503, "search_unavailable", "Vectorize/AI bindings are not configured", cors);
  return null;
}

async function embed(env, texts) {
  const out = await env.AI.run(MODEL, { text: texts });
  // Workers AI 的回傳形狀在不同模型間不一致,兩種都接住;拿不到就明確失敗,
  // 不要回一個長度不對的陣列讓 upsert 靜靜寫進壞向量。
  const vectors = out?.data || out?.result?.data;
  if (!Array.isArray(vectors) || vectors.length !== texts.length)
    throw new Error(`unexpected embedding shape from ${MODEL}`);
  return vectors;
}

// GET /v1/search?q=...&limit=10 —— 公開,CORS,不發 cookie
export async function handleSearch(request, env, url, cors) {
  const gate = requireIndex(env, cors);
  if (gate) return gate;

  const q = (url.searchParams.get("q") || "").trim();
  if (q === "") return err(400, "invalid_body", "q is required", cors);
  // 上限刻意小:查詢字串是使用者輸入,而 embedding 的成本與長度成正比。
  if (q.length > 200) return err(400, "invalid_body", "q must be 200 characters or fewer", cors);
  let limit = Number.parseInt(url.searchParams.get("limit") ?? "10", 10);
  if (!Number.isFinite(limit)) limit = 10;
  limit = Math.min(25, Math.max(1, limit));
  // 門檻可覆寫,夾在合理區間內。用途是**校準**:要重訂預設值時,
  // 用 min_score=0.3 掃一輪真實查詢,看真陽性與雜訊各落在哪,再決定。
  let minScore = Number.parseFloat(url.searchParams.get("min_score") ?? "");
  if (!Number.isFinite(minScore)) minScore = DEFAULT_MIN_SCORE;
  minScore = Math.min(0.95, Math.max(0.3, minScore));

  // ── 第一層:字面命中(確定的事就不要交給機率)──────────────────────────
  // 2026-08-22 量出來的問題:一個 Topic 只有一個向量,而那個向量是三十幾個名稱
  // 跨七語的重心 —— **精確名稱因此被稀釋**。實測「Dia dos Namorados」查它自己的
  // Topic 只有 0.494、「THR lebaran」只有 0.452,而純亂碼的雜訊可以到 0.485。
  // 兩者重疊,**沒有任何門檻分得開**。
  //
  // 分不開是因為問錯了問題:「這個字串是不是這個 Topic 的名字」是可以確定回答的,
  // 不該交給相似度。所以先用 D1 的 title/slug/keywords 做一次字面比對,
  // 命中的直接給 1.0 排最前面;向量只負責它真正擅長的那件事 ——
  // 「用不同的字講同一件事」(查「respect for the aged」找到 elders-day)。
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const literal = (
    await env.DB.prepare(
      `SELECT DISTINCT t.topic_id, t.slug, t.status
         FROM topics t LEFT JOIN topic_i18n i ON i.topic_id = t.topic_id
        WHERE t.status NOT IN ('candidate','merged')
          AND (t.slug LIKE ?1 ESCAPE '\\'
               OR i.title LIKE ?1 ESCAPE '\\'
               OR i.keywords_json LIKE ?1 ESCAPE '\\')
        LIMIT ?2`
    )
      .bind(like, limit)
      .all()
  ).results;
  const literalIds = new Set(literal.map((r) => r.topic_id));
  // ⚠ 已知限制:字面比對要的是**整個查詢字串**是子字串。多詞查詢裡只有一部分對得上時
  //   接不住 —— 實測「THR lebaran」就是這樣(keywords 有「THR」但沒有「THR lebaran」),
  //   而它的語意分數 0.452 又低於門檻。**刻意不做逐詞回退**:那會讓「day」「節」
  //   這種到處都是的詞命中一整排 Topic,把剛清乾淨的誤報又放回來。
  //   要接住這一類,正確的做法是把常見說法補進該 Topic 的 keywords(內容工作),
  //   不是放寬比對(判準工作)。

  const [vector] = await embed(env, [q]);
  const res = await env.VECTORIZE.query(vector, {
    topK: limit,
    returnMetadata: "all",
  });

  const semantic = (res?.matches || [])
    .filter((m) => (m.score ?? 0) >= minScore)
    // status 不是 active 的 Topic 仍在索引裡(它們沒有消失,只是不熱),
    // 但 candidate/merged 是**不公開**的兩種,不該出現在搜尋結果。
    .filter((m) => !["candidate", "merged"].includes(m.metadata?.status))
    .filter((m) => !literalIds.has(m.metadata?.topic_id || m.id))
    .map((m) => ({
      topic_id: m.metadata?.topic_id || m.id,
      slug: m.metadata?.slug || null,
      category: m.metadata?.category || null,
      status: m.metadata?.status || null,
      score: Number((m.score ?? 0).toFixed(4)),
      match: "semantic",
    }));

  const matches = [
    ...literal.map((r) => ({
      topic_id: r.topic_id, slug: r.slug, category: null, status: r.status,
      score: 1, match: "literal",
    })),
    ...semantic,
  ].slice(0, limit);

  return json({ q, min_score: minScore, count: matches.length, matches }, 200, cors);
}

// POST /internal/search/index —— 主機把 Topic 的名字推進索引(Bearer)
// body: { topics: [{topic_id, slug, category, status, text}] }
//   text = canonical_name + alias + 七語 title 串接(**主機那邊組好**,
//   Worker 不去猜要串哪些欄位 —— 那份資料的權威在主機)
export async function handleSearchIndex(request, env) {
  const gate = requireIndex(env, undefined);
  if (gate) return gate;
  const body = await readJson(request);
  if (!body) return err(400, "invalid_body", "Malformed JSON body");
  const topics = Array.isArray(body.topics) ? body.topics : [];
  if (topics.length === 0) return json({ upserted: 0 }, 200);
  if (topics.length > 50)
    return err(400, "invalid_body", "at most 50 topics per request");

  for (const t of topics) {
    if (!t || typeof t.topic_id !== "string" || typeof t.text !== "string" || t.text.trim() === "")
      return err(400, "invalid_body", "each topic needs topic_id and non-empty text");
  }

  const vectors = await embed(env, topics.map((t) => t.text.slice(0, 2000)));
  const payload = topics.map((t, i) => ({
    id: t.topic_id,
    values: vectors[i],
    metadata: {
      topic_id: t.topic_id,
      slug: t.slug ?? null,
      category: t.category ?? null,
      status: t.status ?? null,
    },
  }));
  const res = await env.VECTORIZE.upsert(payload);
  return json({ upserted: payload.length, mutation_id: res?.mutationId ?? null }, 200);
}

// POST /internal/search/delete —— body: { topic_ids: [...] }
// Topic 被合併或降級成 candidate 時要從索引移除,否則搜尋會一直指到一個
// 讀者點不進去的地方。
export async function handleSearchDelete(request, env) {
  const gate = requireIndex(env, undefined);
  if (gate) return gate;
  const body = await readJson(request);
  const ids = Array.isArray(body?.topic_ids) ? body.topic_ids.filter((x) => typeof x === "string") : [];
  if (ids.length === 0) return json({ deleted: 0 }, 200);
  const res = await env.VECTORIZE.deleteByIds(ids);
  return json({ deleted: ids.length, mutation_id: res?.mutationId ?? null }, 200);
}
