#!/usr/bin/env bash
# aeiou.now — 每 15 分鐘的管線(Track D / W4.4 的 */15 那一行)
#   /root/aeiou.now/scripts/cron-15min.sh
#
# 順序刻意:
#   1. translate-posts.mjs —— D1 待翻 post → claude -p 六語 → 回寫 D1 + **回流主機 posts/post_i18n**
#      (UGC 回流主機的唯一通道;內建 job_locks 防重入,前一輪還在跑就自己 skip)
#   2. trend-pipeline.mjs —— 外部搜尋趨勢 → 七語 machine-owned Topic
#      **2026-08-19 起 kill switch 預設關閉**(見下方 AEIOU_TREND_AUTO_PUBLISH)。
#   3. sync-topics-to-d1.mjs —— 主機 topics/topic_i18n → D1 精簡副本(含 current_cycle_id)
#      翻譯先跑:同步是秒級的,擺後面才不會被長跑的翻譯卡住整輪。
#   4. sync-questions-to-d1.mjs(2026-08-15 加)—— 主機 questions/question_options →
#      D1 每日世界一問精簡副本(供 Worker 驗票);同樣是秒級,排在 sync-topics 之後。
#
# 四支各自寫 jobs 表,任一支失敗不影響其他支(所以不 set -e)。
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

# 趨勢自動發布 kill switch。2026-08-19 用戶拍板:管線保留、暫不上線 ——
#   當時主機 SQLite 已累積 313 個 active trend Topic,人工策展 Topic 只有 29 個,
#   一旦匯出,七站 index 會有九成是機器生成的關鍵字 Topic,且前端無法與人工 Topic 區分。
# 關掉的是「產新的」;既有資料留在 SQLite 不刪不改,靜態層另由 export-data.mjs 過濾
# (AEIOU_TREND_EXPORT=1 才匯出)。兩道各自獨立,要復活兩邊都要開。
# **預設值的正本在 scripts/trend-pipeline.mjs 裡**(裸執行就不發布);這裡不再重複設定,
# 免得兩處各有一份預設、改了一邊以為就生效。要放行:AEIOU_TREND_AUTO_PUBLISH=1 跑一次,
# 或改腳本裡的預設。
"$NODE_BIN" "$REPO/scripts/trend-pipeline.mjs"
rc_trend=$?

"$NODE_BIN" "$REPO/scripts/sync-topics-to-d1.mjs"
rc_sync=$?

"$NODE_BIN" "$REPO/scripts/sync-questions-to-d1.mjs"
rc_sync_questions=$?

"$NODE_BIN" "$REPO/scripts/moderation-queue.mjs"
rc_moderation=$?

echo "$(date -Is) [cron-15min] === end (translate=$rc_translate trend=$rc_trend sync=$rc_sync sync_questions=$rc_sync_questions moderation=$rc_moderation) ==="
[ $rc_translate -eq 0 ] && [ $rc_trend -eq 0 ] && [ $rc_sync -eq 0 ] && [ $rc_sync_questions -eq 0 ] && [ $rc_moderation -eq 0 ]
