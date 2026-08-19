// HTTP 語意:CORS、JSON 回應、錯誤形狀、request body 解析。
// **跨站 cookie 三件套之一**:帶 credentials 時 CORS origin 不得為 *(見 CLAUDE.md 紅線)。

import { ALLOWED_ORIGINS } from "../constants.js";

export function corsHeaders(request) {
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

export function json(data, status, extra) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

export function err(status, code, message, extra) {
  return json({ error: { code, message } }, status, extra);
}

export async function readJson(request) {
  try {
    const body = await request.json();
    if (body === null || typeof body !== "object" || Array.isArray(body)) return undefined;
    return body;
  } catch {
    return undefined;
  }
}
