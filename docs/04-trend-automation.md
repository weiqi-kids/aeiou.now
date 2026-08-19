# 外部搜尋趨勢自動發布

## 目前流程

```text
Google Trends Trending Now RSS
        ↓
scripts/trend-pipeline.mjs
        ↓
host SQLite（trend_*、topics、topic_i18n、source_topics）
        ├─ scripts/sync-topics-to-d1.mjs  → D1 互動層
        └─ scripts/export-data.mjs       → static Topic 頁
```

`scripts/cron-15min.sh` 已把 trend pipeline 放在 Topic D1 sync 之前。趨勢 Topic 使用
`access_source='trend'` / `category='trend'`，內容權威在 SQLite；不得寫入或覆蓋
`content/topics/*.md` 的 manual Topic。

## 兩道上線閘(設定,不是現況)

趨勢管線保留,但**趨勢 Topic 不進靜態層**。閘的開關狀態一律用下面的查法查,別讀本節數字。

> **拍板紀錄(2026-08-19)**:決策當下實測 313 個 active trend Topic、29 個人工策展 Topic,
> 照原設計匯出七站 index 約九成會是機器生成的關鍵字 Topic;且前端沒有任何地方用到
> `topic_kind`/`owner`,讀者無從分辨機器 Topic 與人工 Topic。以上是當日事實,不是現況。

因此設了兩道**互相獨立**的閘,要復活必須兩邊都開:

| 閘 | 位置 | 裸執行時 | 效果 |
|---|---|---|---|
| 產製 | `scripts/trend-pipeline.mjs` 的 `AEIOU_TREND_AUTO_PUBLISH` 預設 | 關 | 不再產新的趨勢 Topic(也不再燒 claude 訂閱額度)。**TTL 過期與 stale run 收斂不受此開關影響** —— 它管的是「產新的」,不是凍結既有狀態 |
| 靜態輸出 | `scripts/export-data.mjs` 讀 `AEIOU_TREND_EXPORT` | 關 | 已存在的趨勢 Topic 不進 `data/`,stale 目錄會被既有清除邏輯移除 |

既有資料**留在主機 SQLite,不刪不改**(`topics`/`topic_i18n`/`trend_*` 都在);關的只是
「產新的」與「送上線」。要放行:

```bash
# 單次驗證(不動 cron)
AEIOU_TREND_EXPORT=1 node scripts/export-data.mjs
# 正式復活:改 trend-pipeline.mjs 的預設,export 端設 AEIOU_TREND_EXPORT=1
```

查現況(唯一可信的答案來源):

```bash
sqlite3 db/aeiou.sqlite "SELECT access_source,status,COUNT(*) FROM topics GROUP BY 1,2"
ls -d data/topics/top_tr_* 2>/dev/null | wc -l   # 靜態層目前輸出幾個趨勢 Topic
```

**復活前要先解決的**:前端無法區分機器 Topic 與人工 Topic。`export-data.mjs` 已在輸出
掛上 `topic_kind:'trend'` / `owner:'machine'`,但 `site/` 只有 `src/lib/data.mjs` 用它
把趨勢 Topic 當「近期話題」推上首頁,沒有任何標示。

## 發布閘門

- source URL 必須是 HTTPS。
- 七個 locale 的 title、summary、keywords 必須完整。
- 內容生成回傳 `publish=true` 且 `safe=true` 才能發布。
- 同一 `(provider, event_key)` 沿用同一個 Topic ID。
- 同一 `topic_id + content_hash` 不重複建立 publication。
- `AEIOU_TREND_AUTO_PUBLISH=0` 停止新發布；既有資料不會被隱性刪除。
- 趨勢 TTL 預設 48 小時；過期 Topic 轉 archived，靜態 export 不再輸出。
  **TTL 是從 `last_seen_at` 起算,不是從建立時間起算** —— 一個持續出現在趨勢裡的 Topic
  每輪都會把 `expires_at` 往後推 48 小時。所以「建立於三天前」不等於「已經過期」;
  停止產製之後才會開始真正倒數。查退場時程(唯讀,不改資料):

```bash
sqlite3 db/aeiou.sqlite "
SELECT datetime(expires_at,'unixepoch') 到期, COUNT(*) 筆數
FROM trend_topic_state WHERE state IN ('active','cooling')
GROUP BY date(expires_at,'unixepoch') ORDER BY 1"
```

## 設定

```text
AEIOU_TREND_MARKETS=TW,US,JP,IN,ID,BR
AEIOU_TREND_LIMIT=3
AEIOU_TREND_TTL_SEC=172800
AEIOU_TREND_AUTO_PUBLISH=1
AEIOU_TREND_CLAUDE_TIMEOUT_MS=600000
```

`AEIOU_TREND_CONTENT_FIXTURE` 僅供隔離測試或一次性 bootstrap 使用，不應放入 cron。
正式內容生成若失敗，pipeline fail closed，不發布半套語言內容。

## 驗證命令

```bash
node scripts/trends/cli.mjs --smoke --market US
node scripts/trend-pipeline.mjs --dry-run
node scripts/export-data.mjs
node scripts/check-final-topic-taxonomy.mjs
node scripts/check-data-completeness.mjs
cd site && pnpm build
```

## 回滾

停止新發布(已是目前預設,見上面「目前上線狀態」):

```bash
AEIOU_TREND_AUTO_PUBLISH=0 node scripts/trend-pipeline.mjs
```

要撤回已發布 Topic，應同步將 host Topic 與 D1 Topic 設為不可互動狀態，並清除
static export；不可只刪 `data/` 檔案，否則下一次 export 會重新產生。

