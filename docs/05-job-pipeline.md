# 19 job 完整管線(草案 §9 對照表)

> 這是**對照表**,不是現況報告。每一列的最後一欄是查法,答案以指令輸出為準。
> 跑得如何一律查 `jobs` 表:
> ```bash
> sqlite3 -header -column db/aeiou.sqlite \
>   "SELECT job_name,status,datetime(scheduled_at,'unixepoch') at,error_message
>      FROM jobs ORDER BY scheduled_at DESC LIMIT 20"
> sqlite3 db/aeiou.sqlite "SELECT * FROM jobs WHERE status='dlq'"   # 要人看的
> ```

## 為什麼不是每個 job 每 15 分鐘跑一次

草案 §9 把十九個 job 全部寫成「15 分鐘」。這個站**刻意不照抄**,理由都是同一種:
**跑得比資料變化還快,產生的不是新鮮度,是雜訊**。

| 情形 | 實例 | 後果 |
|---|---|---|
| 來源比頻率穩定 | 官方法規頁一年改不了幾次 | 每 15 分鐘抓一次是對別人的網站施壓,而且自己也白花頻寬 |
| 上游每小時才動 | 分數在 `compute-topic-scores`(hourly)才變 | 每 15 分鐘存一次排名快照,會存出四份一模一樣的「歷史」 |
| 來源本身是每日的 | GSC 只給到 date 粒度 | 攤進 96 個 15 分鐘桶,得到 95 個 0 與 1 個真值 —— 假的解析度 |

所以節奏分三層:**15 分鐘**(讀者等得到的事)、**每小時**(內容與分數)、**每日**(冷資料)。

## 對照表

| # | 草案 §9 的 job | 實作 | 節奏 | 查法 |
|---|---|---|---|---|
| 1 | Local Topic Search | `source-refresh.mjs`(清冊 `content/source-registry.json`)＋`update-local-data.mjs` | 每小時 | `node scripts/source-refresh.mjs --report` |
| 2 | Source Refresh | 同上(`next_crawl_at` 到期才抓,分級 900/3600/21600/86400) | 每小時 | 同上 |
| 3 | Topic Detection | `trend-pipeline.mjs` —— **kill switch 預設關閉**(2026-08-19 用戶拍板) | 15 分鐘 | `grep -n AEIOU_TREND_AUTO_PUBLISH scripts/trend-pipeline.mjs` |
| 4 | Topic Merge | `import-topics.mjs` 的合併 ＋ `retire-merged-topics.mjs` | 每小時 | `sqlite3 db/aeiou.sqlite "SELECT COUNT(*) FROM topics WHERE status='merged'"` |
| 5 | Cross-language Aggregation | `import-topics.mjs`(`content/topics/*.md` 的七語段) | 每小時 | `node scripts/check-content-depth.mjs --report` |
| 6 | Translation Refresh | `translate-posts.mjs`(UGC 六語)＋`translate-date-rules.mjs` | 15 分鐘 | `jobs` 表的 `translate-posts` |
| 7 | Trend Calculation | `compute-topic-scores.mjs`(HotScore 七項) | 每小時 | `node scripts/compute-topic-scores.mjs --dry-run` |
| 8 | Feed Ranking | **Worker 即時聚合**(契約 §1 `sort=hot`),不是 job | 每次請求 | `curl -s "$API/v1/topics/<id>/feed?sort=hot"` |
| 9 | Feed Expiration | `feed-maintenance.mjs` → Worker `/internal/jobs/feed-maintenance` | 每小時 | `jobs` 表的 `feed-maintenance` |
| 10 | Comment Activity | 同 #9(**一次掃描做兩件事** —— D1 免費額度按 rows_read 計) | 每小時 | 同上 |
| 11 | Nearby Refresh | `update-local-data.mjs` | 每小時 | `find data/places -name '*.json'` |
| 12 | Event Refresh | 同 #11(順帶清過期活動) | 每小時 | `find data/events -name '*.json'` |
| 13 | SEO Update | `export-data.mjs` ＋ build(title/description/lastmod) | 每小時 + CI | `curl -s https://aeiou.now/sitemap.xml \| grep -c '<lastmod>'` |
| 14 | Sitemap Update | build 時產出 | CI | 同上,`<lastmod>` 應等於 `<loc>` |
| 15 | Content Quality Check | `quality-check.mjs`(五個標籤寫進 `quality_checks`) | 每小時 | `node scripts/quality-check.mjs --report` |
| 16 | Duplicate Check | 同 #15(Source / Topic / Translation 三種) | 每小時 | 同上 |
| 17 | Moderation Queue | Worker 規則層(寫入當下)＋ `moderation-queue.mjs`(工作檯) | 15 分鐘 | `node scripts/moderation-queue.mjs --report` |
| 18 | Ranking Snapshot | `ranking-snapshot.mjs`(Top 100;hourly 留 30 天、daily 永久) | 每小時 | `node scripts/ranking-snapshot.mjs --report` |
| 19 | Analytics Aggregation | `analytics-aggregate.mjs`(GSC 搜尋面 + 互動面)＋ `ga4-daily.mjs`(瀏覽面) | 每小時 / 每日 | `node scripts/analytics-aggregate.mjs --report`、`node scripts/ga4-daily.mjs --report` |

管線外另有三支(草案沒列,但這個站需要):
`sync-topics-to-d1` / `sync-questions-to-d1` / `sync-reactions-from-d1`(主機 ↔ D1)、
`sync-search-index`(Topic → Vectorize)、`archive-to-r2`(冷資料)、
`gsc-topic-metrics`(每日 GSC)、`seed-ask-the-world`(種子題保鮮)、
`gsc-demand-country`(每小時,排在 `export-data` 前面 —— 結論要進 facts.json)。

`gsc-demand-country` 算的是**每個 (Topic × 站) 的搜尋需求問的是哪一國**,
Topic 頁的 description 第一句就講那一國。⚠ 那個「哪一國」是**查詢問誰**,
不是**搜尋者住哪** —— 後者在 `topic_search_metrics.scope`(`country:XX`),兩者不可混用。
沒算出結論的格子,前端退回本市場那一國(＝2026-08-21 的行為);
所以這一支**不 fail-closed**,失敗只是不新鮮,不會讓讀者看到假資料。
查法:`node scripts/gsc-demand-country.mjs --report`。

## 三個刻意的缺口(是決定,不是漏做)

1. **#19 的 `page_views` 有,但它旁邊一定要有第二個數字。**
   ⚠ 2026-08-22 更正:先前我把這一項記成「卡在專屬 property 與 SA 還沒開」,**那是錯的**。
   aeiou 早就有自己的 GCP 專案與 SA(`seo-ops@aeiou-seo`),`identity-audit --all` 實測
   它**不在**共用金鑰的分組裡(現況以那支工具的輸出為準),
   而 `seo-health.mjs` 一直在用它讀 GA4。缺的從來不是授權,只是腳本沒寫。
   現在由 `ga4-daily.mjs` 拉,而且**同時寫兩個 metric**:
   `page_views`(原始值,是事實但不是「有人在看」的證據)與 `page_views_human`
   (只計 Organic Search —— 本專案認定可當真人看的那一部分)。只寫其中一個都會說謊。
   🔴 **仍然不准拿它算 HotScore 的瀏覽面**(2026-08-20 拍板未變);瀏覽面走 GSC。

   這一條的普遍教訓:**不為了湊滿草案的維度去填一個沒有來源的欄位** —— 一個恆為 0 的
   欄位比沒有這個欄位更糟,它看起來像量測結果。`posts.views`/`unique_views` 就是這種欄位;
   `cross_country_engagements` 曾經也是,而它一直被 CrossCountryScore 讀著
   —— 2026-08-22 由 #10 補上。

2. **#3 Topic Detection 的開關是關的。** 它產生機器 Topic,而前端雖然已能標示
   (虛線徽章 + 頁首說明),排序策略也定了(策展層:人工先、機器後),
   要不要放行仍是產品決定。抓回來的內容只進 `source_contents`,不會自己長出 Topic。

3. **#8 不是 job。** 草案把 Feed Ranking 列成 15 分鐘的 job,但這個站的即時排序是
   Worker 在請求當下算的(契約 §1 明訂 `COUNT(DISTINCT actor_id) + comments`)。
   排成 job 反而會讓讀者看到的順序落後 15 分鐘。

## 失敗語意

- 每一支各自寫 `jobs` 表;`+5 分 / +10 分`重試,第三次進 `dlq`(不再自動重試,要人看)。
- `job_locks` 防重入(同一 scope+job+slot 只跑一份,並用 pid 存活檢查擋前一輪還在跑)。
- **hourly-export.sh 是 fail-closed 的**,但新加的這幾支**一律不 fail-closed** ——
  它們算的是熱度、快照、標籤、索引,錯了只是不新鮮;而 fail-closed 的那幾步錯了
  會讓讀者看到假資料。兩種性質不同,不要混。
