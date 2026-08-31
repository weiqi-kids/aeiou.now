# scripts/ 的分層

**這裡不寫「有哪些腳本、誰在跑」的清單** —— 那是現況,清單會漂。下面只寫查法與分層規則。

## 分層

| 位置 | 是什麼 | 判準 |
|---|---|---|
| `scripts/*.mjs` `*.sh` | cron 常態跑的,或被常態腳本呼叫的 | 出現在下面第一條查法的輸出裡,或被那些檔案 import/spawn |
| `scripts/lib/` | 共用模組 | 只被 import,不單獨執行 |
| `scripts/oneoff/` | **一次性**:資料 bootstrap、產生器 | 跑完就完成任務;產物已進版控,重跑會覆寫既有內容 |

## 查法

```bash
# cron 真正會跑的是哪幾支(唯一可信來源是 cron 腳本本身)
grep -ohE 'scripts/[a-z0-9-]+\.mjs' scripts/cron-15min.sh scripts/hourly-export.sh | sort -u

# 某一支有沒有人呼叫(沒有輸出=沒人呼叫)
B=export-data; grep -rl "$B" scripts .github docs site api | grep -v "scripts/$B.mjs"

# 排程本體(含逐行說明)
cat /etc/cron.d/aeiou
```

## 搜尋成長診斷（不屬於 cron）

先用每日 GSC job 累積查詢與落地頁，再產生只讀工作清單：

```bash
node scripts/gsc-topic-metrics.mjs --days 28
node scripts/seo-growth.mjs --days 28
# 每日維運由 hourly-export.sh 執行；手動補一筆主機快照時才加 --record
node scripts/seo-growth.mjs --record --days 28
node scripts/seo-growth.mjs --history
```

`gsc_query_metrics` 只存在主機，`seo-growth.mjs` 會把前十名零點擊、
11–20 名可搶救、查詢與落地頁可能不對題，以及未來 120 天的 T-21 季節跑道
排成優先序；它不改內容、不改 HotScore，也不匯出查詢字串。`--record` 只把
聚合快照與工作項寫進主機 SQLite，方便比較改版後的趨勢。

## `scripts/oneoff/` 的紅線

**這裡的腳本不要因為「看起來可以重跑」就重跑。**它們會覆寫已經人工維護過的檔案:

- `generate-local-data-expansion.mjs` 直接覆寫 `content/local-sample-data.json`
  與 `content/local-data-sources.json`。那兩個檔在產生之後已被人工修改多次
  (例如 2026-08-19 修過兩筆失效的活動來源),重跑會把那些修正清掉。
- `generate-final-topic-content.mjs` 直接寫 `content/topics/*.md`。

要重跑就先確認 `git status` 乾淨,跑完逐檔看 diff,不要整批接受。

## 為什麼有這一層

2026-08-19 的重構診斷:同一個扁平目錄裡混著 cron 常態、被常態呼叫的一次性遷移、
以及完全沒人呼叫的產生器,命名沒有任何區別,從檔名看不出哪些跑完可以退場。
上面兩支當時是**零引用**(`grep -rl` 在 scripts/.github/docs/site/api 全無命中),
搬進 `oneoff/` 是為了讓「這支還在跑嗎」變成看得出來的事。

**還沒解決的**:`migrate-topic-observances.mjs` 與 `retire-merged-topics.mjs` 是
一次性遷移,卻被 `import-topics` 等常態腳本呼叫,等於每小時重跑遷移邏輯。
它們沒被搬,因為搬了會破壞那些呼叫。要退場得先確認遷移已無殘留資料可搬,
屬於獨立的一項工作。查:

```bash
for B in migrate-topic-observances retire-merged-topics; do
  echo "$B:"; grep -rl "$B" scripts | grep -v "scripts/$B.mjs" | sed 's/^/  /'
done
```
