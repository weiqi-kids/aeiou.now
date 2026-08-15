#!/usr/bin/env bash
# aeiou.now — 每 15 分鐘的管線(Track D / W4.4 的 */15 那一行)
#   /root/aeiou.now/scripts/cron-15min.sh
#
# 順序刻意:
#   1. translate-posts.mjs —— D1 待翻 post → claude -p 六語 → 回寫 D1 + **回流主機 posts/post_i18n**
#      (UGC 回流主機的唯一通道;內建 job_locks 防重入,前一輪還在跑就自己 skip)
#   2. sync-topics-to-d1.mjs —— 主機 topics/topic_i18n → D1 精簡副本(含 current_cycle_id)
#      翻譯先跑:同步是秒級的,擺後面才不會被長跑的翻譯卡住整輪。
#   3. sync-questions-to-d1.mjs(2026-08-15 加)—— 主機 questions/question_options →
#      D1 每日世界一問精簡副本(供 Worker 驗票);同樣是秒級,排在 sync-topics 之後。
#
# 三支各自寫 jobs 表,任一支失敗不影響其他支(所以不 set -e)。
# 失敗看:本檔 log(見 /etc/cron.d/aeiou 的重導)+ 主機 SQLite 的 jobs 表:
#   sqlite3 /root/aeiou.now/db/aeiou.sqlite \
#     "SELECT job_name,datetime(finished_at,'unixepoch'),status,attempt,error_message
#        FROM jobs ORDER BY rowid DESC LIMIT 10;"

set -uo pipefail

REPO="${AEIOU_REPO:-/root/aeiou.now}"
NODE_BIN="${AEIOU_NODE_BIN:-/usr/bin/node}"
LOG_DIR="$REPO/logs"
MAX_LOG_BYTES=$((5 * 1024 * 1024))

mkdir -p "$LOG_DIR"

# log 自我修剪(每 15 分鐘檢查一次,兩支 log 都管;主機磁碟吃緊,不留無界成長的檔)
for f in "$LOG_DIR"/cron-15min.log "$LOG_DIR"/hourly-export.log; do
  if [ -f "$f" ] && [ "$(stat -c%s "$f")" -gt "$MAX_LOG_BYTES" ]; then
    # 就地截斷、**不換 inode** —— cron 的 `>>` 已經開著這個檔的 fd,
    # 用 mv 換檔會讓本輪剩下的輸出寫進已刪除的 inode(等於憑空消失)。
    tmp="$(mktemp)"
    tail -n 2000 "$f" > "$tmp" && cat "$tmp" > "$f"
    rm -f "$tmp"
    echo "$(date -Is) [cron-15min] trimmed $f to last 2000 lines"
  fi
done

cd "$REPO" || { echo "$(date -Is) [cron-15min] FATAL: cannot cd $REPO"; exit 1; }

echo "$(date -Is) [cron-15min] === start ==="

"$NODE_BIN" "$REPO/scripts/translate-posts.mjs"
rc_translate=$?

"$NODE_BIN" "$REPO/scripts/sync-topics-to-d1.mjs"
rc_sync=$?

"$NODE_BIN" "$REPO/scripts/sync-questions-to-d1.mjs"
rc_sync_questions=$?

echo "$(date -Is) [cron-15min] === end (translate=$rc_translate sync=$rc_sync sync_questions=$rc_sync_questions) ==="
[ $rc_translate -eq 0 ] && [ $rc_sync -eq 0 ] && [ $rc_sync_questions -eq 0 ]
