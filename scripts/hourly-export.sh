#!/usr/bin/env bash
# aeiou.now — 每小時匯出靜態 JSON 並推 source repo(Track D / W4.3)
#   /root/aeiou.now/scripts/hourly-export.sh
#
# 1. node scripts/export-data.mjs  → 主機 SQLite 匯出到根層 data/(內容 hash 沒變就不寫檔)
# 2. **只 commit 根層 data/**(git add data/ —— 刻意不用 git add -A;
#    site/ api/ db/ docs/ 的變動不歸這支管,由人工/其他流程處理)
# 3. push 到 source repo(weiqi-kids/aeiou.now)
#    - HTTPS credential 走 gh 的 credential helper(主機已 gh auth login 為 LightChang)
#    - author/committer 用 **repo local git config**(/root/aeiou.now 已設 weiqi-kids <lightman.chang@gmail.com>)
#    - **絕不動 git config --global**(主機紅線:曾有 session 用 --global 設假身分,污染全機 cron 的 commit 作者)
# 4. data/ 無變更 → skip,不產生空 commit
# 5. 無 remote / push 失敗 → 不整支噴掉,記進 jobs 表(status=failed,error_message 寫清楚)
#
# jobs 紀錄:job_name='hourly-export'(記錄寫檔數與 commit/push 結果)
# 同時只跑一份:flock 自我互斥(前一輪還在跑就直接 skip)

set -uo pipefail

REPO="${AEIOU_REPO:-/root/aeiou.now}"   # 可覆寫僅為了在複本上做端到端演練;cron 用預設值
NODE_BIN="${AEIOU_NODE_BIN:-/usr/bin/node}"
LOCK_FILE="/run/lock/aeiou-hourly-export.lock"

# --- flock 自我互斥(-E 99 讓「搶不到鎖」與「子行程失敗」的 exit code 可區分)---
if [ "${AEIOU_HOURLY_LOCKED:-}" != "1" ]; then
  export AEIOU_HOURLY_LOCKED=1
  mkdir -p "$(dirname "$LOCK_FILE")"
  flock -n -E 99 "$LOCK_FILE" "$0" "$@"
  rc=$?
  if [ $rc -eq 99 ]; then
    echo "$(date -Is) [hourly-export] skip: another run holds $LOCK_FILE"
    exit 0
  fi
  exit $rc
fi

cd "$REPO" || { echo "$(date -Is) [hourly-export] FATAL: cannot cd $REPO"; exit 1; }
mkdir -p "$REPO/logs"
# 推目前所在分支(語系用目錄分不用 branch,正常一直是 main;不寫死才不會在別的分支上推錯 ref)
BRANCH="${AEIOU_PUSH_BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"

log() { echo "$(date -Is) [hourly-export] $*"; }

record_job() {
  # $1=status $2=read $3=created $4=updated $5=failed $6=error(可省略)
  local args=(--job-name hourly-export --status "$1"
              --read "$2" --created "$3" --updated "$4" --failed "$5")
  [ -n "${6:-}" ] && args+=(--error "$6")
  "$NODE_BIN" "$REPO/scripts/record-job.mjs" "${args[@]}" 2>&1 | tail -1
}

# --- 1. 匯出 ---------------------------------------------------------------
log "export-data.mjs ..."
EXPORT_OUT="$("$NODE_BIN" "$REPO/scripts/export-data.mjs" 2>&1)"
EXPORT_RC=$?
echo "$EXPORT_OUT"
if [ $EXPORT_RC -ne 0 ]; then
  log "FAILED: export-data.mjs exited $EXPORT_RC"
  record_job failed 0 0 0 1 "export-data.mjs exited $EXPORT_RC: $(echo "$EXPORT_OUT" | tail -3 | tr '\n' ' ')"
  exit 1
fi
WROTE="$(echo "$EXPORT_OUT" | grep -c '^write ')"

# --- 2. 只看根層 data/ 有沒有變 ---------------------------------------------
CHANGED="$(git status --porcelain -- data/ | wc -l)"
if [ "$CHANGED" -eq 0 ]; then
  log "data/ unchanged — skip commit & push (files written this run: $WROTE)"
  record_job skipped "$WROTE" 0 0 0
  exit 0
fi
log "data/ has $CHANGED changed path(s) — committing"

# --- 3. commit(只加 data/,不用 git add -A) --------------------------------
git add -- data/ || { log "FAILED: git add"; record_job failed "$WROTE" 0 0 1 "git add data/ failed"; exit 1; }

# 保險:即使 index 裡混進別的東西也只 commit data/(-- data/ 限定路徑)
if ! git commit -q -m "chore(data): hourly export $(date -u +%Y-%m-%dT%H:%MZ)" -- data/; then
  log "FAILED: git commit"
  record_job failed "$WROTE" 0 0 1 "git commit failed"
  exit 1
fi
COMMIT="$(git rev-parse --short HEAD)"
FILES="$(git show --stat --oneline HEAD | tail -1)"
log "committed $COMMIT ($FILES)"

# --- 4. push(容忍無 remote) -----------------------------------------------
if ! git remote get-url origin >/dev/null 2>&1; then
  log "no 'origin' remote — commit kept locally, push skipped"
  record_job failed "$WROTE" "$CHANGED" 0 0 "commit $COMMIT ok but no origin remote; push skipped"
  exit 0
fi

PUSH_OUT="$(git push origin "$BRANCH" 2>&1)"
PUSH_RC=$?
if [ $PUSH_RC -ne 0 ]; then
  log "push FAILED (rc=$PUSH_RC): $PUSH_OUT"
  record_job failed "$WROTE" "$CHANGED" 0 0 "commit $COMMIT ok but push failed: $(echo "$PUSH_OUT" | tail -2 | tr '\n' ' ')"
  exit 1
fi

log "pushed $COMMIT to origin/$BRANCH"
record_job success "$WROTE" "$CHANGED" 0 0
exit 0
