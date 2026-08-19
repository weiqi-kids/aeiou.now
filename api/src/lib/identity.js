// 身分與輸入正規化:ULID、匿名 ID cookie、字數、來自 Cloudflare 的國別/城市。
// 不碰 HTTP 語意 —— 那在 lib/http.js。

// ---------- 基礎工具 ----------

// ULID(Crockford base32;26 字元)。32 整除 256,無 modulo bias。
export const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function ulid(now = Date.now()) {
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

export const ANON_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function charLen(s) {
  // 以 code point 計字元數(契約:post ≤5000 / comment ≤2000 字元)
  return [...s].length;
}

// city_code = lowercase-slugify(request.cf.city);無 city 時 NULL
export function cityCode(cf) {
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

export function countryCode(cf) {
  // posts.country_code NOT NULL;request.cf 極少數情況無 country 時退 "XX"
  return (cf && cf.country) || "XX";
}

export function getAnonId(request) {
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

export function anonCookie(anonId) {
  // 跨站 cookie 三件套之一;缺一不可(_shared-context.md)
  return `anon_id=${anonId}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=None`;
}
