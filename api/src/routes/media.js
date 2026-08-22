// 圖片上傳與供圖(草案 §33 的 Image 那一列;2026-08-22)。
//
// ── 安全預設:上傳成功 ≠ 看得到 ────────────────────────────────────────────
// 這個站沒有影像分類模型,也沒有隨時在線的審核者。在那個前提下,
// **接受任意使用者圖片並直接公開**是這整個系統裡風險最高的一件事 ——
// 文字最糟是難看,圖片最糟是違法內容掛在七個網域上。
//
// 所以圖片的預設是 `pending`:存得進去、**看不到**,要有人在工作檯上放行才會公開。
// 這不是保守,是這個站現在唯一誠實的做法 —— 有了分類模型或有人固定看隊列之後再放寬。
// 放行:`node scripts/moderation-queue.mjs --approve <media_id>`
//
// ── 為什麼供圖走 Worker 而不是公開 bucket ─────────────────────────────────
// R2 開公開存取之後,那個網址就永遠是公開的 —— 審核判定「下架」對一個已經在外面
// 流傳的網址沒有作用。走 Worker 代理,`status` 一改,下一次請求就是 404。
// 代價是每次看圖多一次 Worker 呼叫,值得。
//
// ── 限制 ────────────────────────────────────────────────────────────────
// 只收 JPEG/PNG/WebP,且**用魔術位元組判斷**不看 Content-Type ——
// 後者是使用者送的,說什麼都行。單檔上限見 MEDIA_MAX_BYTES(契約常數)。

import { MEDIA_MAX_BYTES, MEDIA_MAX_PER_POST } from "../constants.js";
import { json, err } from "../lib/http.js";
import { ulid, getAnonId, anonCookie } from "../lib/identity.js";
import { rateLimit } from "../lib/gates.js";

/** 魔術位元組 → 副檔名與 MIME。**不看使用者送的 Content-Type**。 */
function sniff(bytes) {
  const b = new Uint8Array(bytes);
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: "png", mime: "image/png" };
  // RIFF....WEBP
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return { ext: "webp", mime: "image/webp" };
  return null;
}

function requireBucket(env, cors) {
  if (!env.ARCHIVE) return err(503, "media_unavailable", "R2 binding is not configured", cors);
  return null;
}

// POST /v1/uploads —— body 是原始位元組(不是 multipart:少一層解析、少一種可以騙人的地方)
export async function handleUpload(request, env, ctx, cors) {
  const gate = requireBucket(env, cors);
  if (gate) return gate;
  const limited = await rateLimit(request, env, ctx, "upload", getAnonId(request), cors);
  if (limited) return limited;

  const buf = await request.arrayBuffer();
  if (buf.byteLength === 0) return err(400, "invalid_body", "empty body", cors);
  if (buf.byteLength > MEDIA_MAX_BYTES)
    return err(413, "media_too_large", `image exceeds ${MEDIA_MAX_BYTES} bytes`, cors);

  const kind = sniff(buf);
  if (!kind) return err(400, "unsupported_media", "only JPEG / PNG / WebP", cors);

  let anonId = getAnonId(request);
  let setCookie = null;
  if (!anonId) {
    anonId = ulid();
    setCookie = anonCookie(anonId);
  }

  const mediaId = `med_${ulid()}`;
  const key = `media/${mediaId}.${kind.ext}`;
  const now = Math.floor(Date.now() / 1000);

  await env.ARCHIVE.put(key, buf, { httpMetadata: { contentType: kind.mime } });
  await env.DB.prepare(
    `INSERT INTO media (media_id, r2_key, mime, bytes, anon_id, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`
  )
    .bind(mediaId, key, kind.mime, buf.byteLength, anonId, now)
    .run();

  // 進審核工作檯。target_type='image' 是草案 §33 列的四種之一。
  ctx.waitUntil(
    env.DB.prepare(
      `INSERT INTO moderation_flags
         (target_type, target_id, anon_id, severity, reason, detail, created_at, synced_at)
       VALUES ('image', ?, ?, 'medium', 'needs_review', ?, ?, NULL)
       ON CONFLICT (target_type, target_id) DO NOTHING`
    )
      .bind(mediaId, anonId, `${kind.mime} ${buf.byteLength}B`, now)
      .run()
      .catch(() => {})
  );

  const headers = { ...cors };
  if (setCookie) headers["Set-Cookie"] = setCookie;
  // **明說它還看不到**。回一個看起來成功的回應卻不講這件事,會讓前端做出
  // 「圖片壞了」的錯誤結論(同討論室四態的紀律:狀態名稱要說事實)。
  return json(
    {
      media_id: mediaId,
      status: "pending",
      url: `/v1/media/${mediaId}`,
      note: "pending review — not publicly visible yet",
      max_per_post: MEDIA_MAX_PER_POST,
    },
    201,
    headers
  );
}

// GET /v1/media/:id —— 只有 approved 的才給
export async function handleMediaGet(env, mediaId, cors) {
  const gate = requireBucket(env, cors);
  if (gate) return gate;
  const row = await env.DB.prepare(
    "SELECT r2_key, mime, status FROM media WHERE media_id = ?"
  )
    .bind(mediaId)
    .first();
  // pending 與 rejected 都回 404,**不回 403** —— 403 等於告訴對方「東西在這裡,
  // 只是不給你」,那是在確認一個他不該知道的事實。
  if (!row || row.status !== "approved") return err(404, "not_found", "media not found", cors);

  const obj = await env.ARCHIVE.get(row.r2_key);
  if (!obj) return err(404, "not_found", "media not found", cors);
  return new Response(obj.body, {
    status: 200,
    headers: {
      ...cors,
      "Content-Type": row.mime,
      // 放行之後才拿得到,所以可以放心讓它被快取久一點;下架靠的是狀態改了之後
      // 新的請求拿不到,不是靠快取失效。
      "Cache-Control": "public, max-age=86400",
    },
  });
}
