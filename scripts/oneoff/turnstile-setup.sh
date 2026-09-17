#!/usr/bin/env bash
# aeiou.now — Turnstile 一次性開通(2026-09-17;CLAUDE.md「明確延後」裡的 Bot 防護那一項)
#
# 做四件事,每件都可重跑:
#   1. 用 Cloudflare API(金鑰 ~/.config/aeiou/cf-api-token)建一個 managed 模式的 Turnstile widget,
#      網域 = 七站。已經有同名 widget 就沿用,不重建。
#   2. 把 widget 的 secret 直接管進 `npx wrangler secret put TURNSTILE_SECRET`(**不落地、不印出**)。
#   3. 把 sitekey 寫進 api/wrangler.jsonc 的 vars.TURNSTILE_SITEKEY(sitekey 是公開值,可以進 git)。
#   4. `npx wrangler deploy`,然後 curl /v1/me 確認 turnstile.required=true。
#
# 為什麼是腳本而不是 agent 直接做:寫 secret store 屬於要人親手按下去的動作。
# 跑法(在 repo 根目錄):bash scripts/oneoff/turnstile-setup.sh
# 之後前端不必重建:討論室元件會問 /v1/me,required=true 才載入 challenges.cloudflare.com 的 script。
set -euo pipefail
cd "$(dirname "$0")/../.."

ACCOUNT="9d9e58b5e0d1657b8f74bd2cbfc91ee3"
TOKEN="$(cat ~/.config/aeiou/cf-api-token)"
API="https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/challenges/widgets"
NAME="aeiou.now discussion"
DOMAINS='["aeiou.now","en.aeiou.now","jp.aeiou.now","cn.aeiou.now","hi.aeiou.now","id.aeiou.now","br.aeiou.now"]'

# 1. 找或建 widget(回傳 sitekey;secret 只在建立當下拿得到,之後要用 rotate)
existing="$(curl -sf -H "Authorization: Bearer $TOKEN" "$API?per_page=50" \
  | python3 -c "import sys,json; r=json.load(sys.stdin)['result'] or []; m=[w for w in r if w.get('name')=='$NAME']; print(m[0]['sitekey'] if m else '')")"
if [ -n "$existing" ]; then
  echo "既有 widget:sitekey=$existing(secret 不可再讀;要重設 secret 用 rotate)"
  SITEKEY="$existing"
  SECRET="$(curl -sf -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    --data '{"invalidate_immediately":true}' "$API/$SITEKEY/rotate_secret" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['secret'])")"
else
  created="$(curl -sf -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    --data "{\"name\":\"$NAME\",\"domains\":$DOMAINS,\"mode\":\"managed\",\"bot_fight_mode\":false,\"region\":\"world\",\"offlabel\":false}" \
    "$API")"
  SITEKEY="$(printf '%s' "$created" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['sitekey'])")"
  SECRET="$(printf '%s' "$created" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['secret'])")"
  echo "已建 widget:sitekey=$SITEKEY(managed,七站)"
fi

# 2. secret 進 Worker(從 stdin 餵,不落地)
( cd api && printf '%s' "$SECRET" | npx wrangler secret put TURNSTILE_SECRET )
unset SECRET

# 3. sitekey 進 wrangler.jsonc 的 vars(沒有 vars 區塊就在 compatibility_flags 後面插一段)
if grep -q '"TURNSTILE_SITEKEY"' api/wrangler.jsonc; then
  sed -i "s|\"TURNSTILE_SITEKEY\": \"[^\"]*\"|\"TURNSTILE_SITEKEY\": \"$SITEKEY\"|" api/wrangler.jsonc
else
  sed -i "/\"compatibility_flags\": \[\"nodejs_compat\"\],/a\\  // Turnstile(2026-08-21 用戶核准;2026-09-17 開通):sitekey 是公開值。secret 走 wrangler secret put TURNSTILE_SECRET。\\n  // 兩個都設 Worker 才回 required=true,七個站不必為了開關重建(前端問 /v1/me)。\\n  \"vars\": { \"TURNSTILE_SITEKEY\": \"$SITEKEY\" }," api/wrangler.jsonc
fi
echo "wrangler.jsonc 已寫入 TURNSTILE_SITEKEY"

# 4. 部署並驗證
( cd api && npx wrangler deploy )
sleep 5
echo -n "/v1/me → "; curl -s "https://aeiou-api.lightman-chang.workers.dev/v1/me" | grep -o '"turnstile":{[^}]*}' || echo "(讀不到 turnstile 欄位)"
echo "完成。記得 commit api/wrangler.jsonc。"
