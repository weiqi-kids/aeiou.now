#!/usr/bin/env bash
# aeiou.now — GitHub 一次性布署(W0.4 / W0.5 / W5.2)
#
# 為什麼是一支腳本:主對話的 `gh repo create` 與 `gh api -X POST .../repos`
# 被 Claude Code 的權限分類器擋下(建立公開 repo 屬對外動作,需用戶核准)。
# 本腳本把「建 8 個 repo + 布 7 對 deploy key + 灌 7 個 secrets + 開 7 站 Pages」
# 收斂成一次核准即可完成的動作。
#
# 用法(在主機上):
#   bash /root/aeiou.now/scripts/setup-github.sh
#
# 冪等:全部步驟先查後建,重跑安全。
set -euo pipefail

OWNER="weiqi-kids"
SOURCE_REPO="$OWNER/aeiou.now"
ROOT="/root/aeiou.now"
KEYDIR="$HOME/.config/aeiou/deploy-keys"

# locale 小寫後綴 → GitHub secret 名後綴(secrets 只准 [A-Z0-9_])
LOCALES=(zh-tw en ja zh-cn hi id pt-br)
SUFFIXES=(ZH_TW EN JA ZH_CN HI ID PT_BR)

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# ---------- 1. source repo ----------
say "1/5 source repo $SOURCE_REPO"
if gh repo view "$SOURCE_REPO" >/dev/null 2>&1; then
  echo "已存在,略過建立"
else
  gh repo create "$SOURCE_REPO" --public \
    --description "aeiou.now — 全球議題平台(source repo:docs / db / scripts / site / api / CI)"
fi
cd "$ROOT"
git remote get-url origin >/dev/null 2>&1 || \
  git remote add origin "https://github.com/$SOURCE_REPO.git"
git push -u origin main

# ---------- 2. 7 個 publish repo ----------
say "2/5 publish repos"
for l in "${LOCALES[@]}"; do
  repo="$OWNER/aeiou-pages-$l"
  if gh repo view "$repo" >/dev/null 2>&1; then
    echo "  $repo 已存在"
  else
    gh repo create "$repo" --public \
      --description "aeiou.now 靜態站($l)— 由 weiqi-kids/aeiou.now 的 CI 自動部署,請勿手動修改"
    # 放 README 佔位,讓 main 分支存在(Pages 需要有分支才能開)
    tmp="$(mktemp -d)"
    git -c init.defaultBranch=main init -q "$tmp"
    git -C "$tmp" config user.name  "weiqi-kids"
    git -C "$tmp" config user.email "lightman.chang@gmail.com"
    printf '# aeiou-pages-%s\n\naeiou.now 靜態站(%s)。\n\n本 repo 內容由 `weiqi-kids/aeiou.now` 的 GitHub Actions 自動產生並覆蓋,**請勿手動修改**。\n' "$l" "$l" > "$tmp/README.md"
    touch "$tmp/.nojekyll"   # Pages deploy-from-branch 會走 Jekyll,會吃掉 _astro/
    git -C "$tmp" add -A
    git -C "$tmp" commit -q -m "初始化佔位"
    git -C "$tmp" remote add origin "https://github.com/$repo.git"
    git -C "$tmp" push -q -u origin main
    rm -rf "$tmp"
    echo "  $repo 已建立"
  fi
done

# ---------- 3. deploy keys(公鑰 → publish repo,可寫) ----------
say "3/5 deploy keys → publish repos"
for l in "${LOCALES[@]}"; do
  repo="$OWNER/aeiou-pages-$l"
  if gh repo deploy-key list -R "$repo" 2>/dev/null | grep -q "aeiou-ci"; then
    echo "  $repo 已有 deploy key"
  else
    gh repo deploy-key add "$KEYDIR/aeiou-pages-$l.pub" \
      -R "$repo" -t "aeiou-ci" --allow-write
    echo "  $repo deploy key 已加入(可寫)"
  fi
done

# ---------- 4. 私鑰 → source repo secrets ----------
say "4/5 deploy key 私鑰 → $SOURCE_REPO secrets"
for i in "${!LOCALES[@]}"; do
  l="${LOCALES[$i]}"; s="${SUFFIXES[$i]}"
  gh secret set "DEPLOY_KEY_$s" -R "$SOURCE_REPO" < "$KEYDIR/aeiou-pages-$l"
  echo "  DEPLOY_KEY_$s 已設"
done

# ---------- 5. 開 Pages(deploy from branch,main / root) ----------
say "5/5 GitHub Pages"
for l in "${LOCALES[@]}"; do
  repo="$OWNER/aeiou-pages-$l"
  if gh api "repos/$repo/pages" >/dev/null 2>&1; then
    echo "  $repo Pages 已開通"
  else
    gh api -X POST "repos/$repo/pages" \
      -f 'source[branch]=main' -f 'source[path]=/' >/dev/null
    echo "  $repo Pages 已開通(main / root)"
  fi
done

say "完成。驗收:"
echo "  gh repo list $OWNER --limit 100 | grep aeiou"
echo "  gh secret list -R $SOURCE_REPO"
echo "  for l in ${LOCALES[*]}; do gh repo deploy-key list -R $OWNER/aeiou-pages-\$l; done"
