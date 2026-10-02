#!/usr/bin/env bash
# aeiou.now — Turnstile 一次性開通(2026-09-17;CLAUDE.md「明確延後」裡的 Bot 防護那一項)
#
# 做四件事,每件都可重跑:
#   1. 用 Cloudflare API(金鑰 ~/.config/aeiou/cf-api-token)建一個 managed 模式的 Turnstile widget,
#      網域 = 七站。已經有同名 widget 就沿用並 rotate secret(secret 只在建立當下拿得到)。
#      ⚠ 這把 token 要有「Account → Turnstile → Edit」權限;2026-09-17 實測它只能 list 不能 create
#        (API 回 code 10000 Authentication error)。在 Cloudflare 儀表板 → My Profile → API Tokens
#        把該權限加進這把 token,或另建一把並蓋掉 ~/.config/aeiou/cf-api-token。
#   2. 把 widget 的 secret 直接管進 `npx wrangler secret put TURNSTILE_SECRET`(**不落地、不印出**)。
#   3. 把 sitekey 寫進 api/wrangler.jsonc 的 vars.TURNSTILE_SITEKEY(sitekey 是公開值,可以進 git)。
#   4. `npx wrangler deploy`,然後 curl /v1/me 確認 turnstile.required=true。
#
# 為什麼是腳本而不是 agent 直接做:寫 secret store 屬於要人親手按下去的動作。
# 跑法(在 repo 根目錄):bash scripts/oneoff/turnstile-setup.sh
# 每一步失敗都會把 API 的錯誤訊息印出來再停,不會靜靜結束。
# 之後前端不必重建:討論室元件會問 /v1/me,required=true 才載入 challenges.cloudflare.com 的 script。
set -euo pipefail
cd "$(dirname "$0")/../.."

ACCOUNT="9d9e58b5e0d1657b8f74bd2cbfc91ee3"
TOKEN="$(cat ~/.config/aeiou/cf-api-token)"
API="https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/challenges/widgets"
NAME="aeiou.now discussion"
DOMAINS='["aeiou.now","en.aeiou.now","jp.aeiou.now","cn.aeiou.now","hi.aeiou.now","id.aeiou.now","br.aeiou.now"]'

# 從 API 回應取一個欄位;success=false 就把錯誤印出來並以非零結束(呼叫端的 set -e 會停)。
# 用法:pick <json> <python 表達式,r 是 result>
pick() {
  printf '%s' "$1" | python3 -c '
import sys, json
raw = sys.stdin.read()
try:
    d = json.loads(raw)
except Exception:
    print("API 回的不是 JSON:" + raw[:300], file=sys.stderr); sys.exit(1)
if not d.get("success"):
    for e in d.get("errors", []):
        print("Cloudflare API 錯誤 %s:%s" % (e.get("code"), e.get("message")), file=sys.stderr)
    if any(e.get("code") == 10000 for e in d.get("errors", [])):
        print("→ 這把 token 沒有 Turnstile 的寫入權限。儀表板 → My Profile → API Tokens → 加 Account/Turnstile/Edit。", file=sys.stderr)
    sys.exit(1)
r = d.get("result")
print(eval(sys.argv[1]))
' "$2"
}

echo "[1/4] 找或建 Turnstile widget「$NAME」…"
LIST="$(curl -s -H "Authorization: Bearer $TOKEN" "$API?per_page=50")"
SITEKEY="$(pick "$LIST" 'next((w["sitekey"] for w in (r or []) if w.get("name") == "'"$NAME"'"), "")')"
if [ -n "$SITEKEY" ]; then
  echo "      既有 widget:sitekey=$SITEKEY;rotate secret(舊 secret 立即失效)…"
  ROT="$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    --data '{"invalidate_immediately":true}' "$API/$SITEKEY/rotate_secret")"
  SECRET="$(pick "$ROT" 'r["secret"]')"
else
  CREATED="$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    --data "{\"name\":\"$NAME\",\"domains\":$DOMAINS,\"mode\":\"managed\",\"bot_fight_mode\":false,\"region\":\"world\",\"offlabel\":false}" \
    "$API")"
  SITEKEY="$(pick "$CREATED" 'r["sitekey"]')"
  SECRET="$(pick "$CREATED" 'r["secret"]')"
  echo "      已建 widget:sitekey=$SITEKEY(managed,七站)"
fi

echo "[2/4] secret 進 Worker(wrangler secret put TURNSTILE_SECRET)…"
( cd api && printf '%s' "$SECRET" | npx wrangler secret put TURNSTILE_SECRET )
unset SECRET

echo "[3/4] sitekey 進 api/wrangler.jsonc…"
if grep -q '"TURNSTILE_SITEKEY"' api/wrangler.jsonc; then
  sed -i "s|\"TURNSTILE_SITEKEY\": \"[^\"]*\"|\"TURNSTILE_SITEKEY\": \"$SITEKEY\"|" api/wrangler.jsonc
else
  sed -i "/\"compatibility_flags\": \[\"nodejs_compat\"\],/a\\  // Turnstile(2026-08-21 用戶核准;2026-09-17 開通):sitekey 是公開值。secret 走 wrangler secret put TURNSTILE_SECRET。\\n  // 兩個都設 Worker 才回 required=true,七個站不必為了開關重建(前端問 /v1/me)。\\n  \"vars\": { \"TURNSTILE_SITEKEY\": \"$SITEKEY\" }," api/wrangler.jsonc
fi
grep -q "\"TURNSTILE_SITEKEY\": \"$SITEKEY\"" api/wrangler.jsonc || { echo "wrangler.jsonc 沒寫進去,停" >&2; exit 1; }

echo "[4/4] 部署並驗證…"
( cd api && npx wrangler deploy )
sleep 5
echo -n "      /v1/me → "; curl -s "https://aeiou-api.lightman-chang.workers.dev/v1/me" | grep -o '"turnstile":{[^}]*}' || echo "(讀不到 turnstile 欄位)"
echo "完成。記得 commit api/wrangler.jsonc。"
