# SEO／多站工作現況

> 這是可更新的工作交接快照，不是即時監控面板。最後量測：2026-09-04 UTC。
> **2026-09-17 更新發布狀態**：本輪 Plan 2 A/B/C、Plan 3、Plan 4/6 的內容批次**已於 2026-09-17 上線**，七站 `.build-id` 已對齊 HEAD。
> 起因是 hourly-export 自 09-03 起連續 14 天 fail-closed（在地來源腐化＋守門的兩個判準盲點），修好重啟管線時 import-topics 讀的是工作目錄，
> 於是這批仍在 working tree 的內容隨 data/ 一併發布；原始檔已補提交，git 與線上一致。
> ⚠ **量測數字仍是 2026-09-04 的**，而且新 title／摘要還沒等到 Google 重爬 —— 發布不等於有成效，要判效果先跑 `node scripts/crawl-freshness.mjs`。
> 開始 GSC、GA4、SEO 或多站內容任務時先讀這份；只有快照過期、共用程式改動，或使用者明確要求重新量測，才重跑完整診斷。
> 下一輪可執行工作拆解見 [seo-work-plans-next.md](seo-work-plans-next.md)。

## 2026-09-18:重新量測,判定升級為「站級排名降權」並訂正三個作廢數字

> 這一段取代下面 2026-09-17 那段的**數字與機制判定**;凍結條款本身沒有被推翻,理由改寫(見末段)。
> 查法一律用 `node scripts/gsc-topic-metrics.mjs --report-raw`(2026-09-18 新增),**不要再用 `--report`** 做站級判斷。

### 先訂正儀器:舊數字全部少報一半到六倍

`site_search_daily`、`topic_search_metrics`、`gsc_query_metrics` 三張表都由
`dimensions=['date','page','country']` 加總而來,而 Google 對每一列套匿名化門檻,列愈細遮愈多。
2026-09-18 實測(2026-08-15~09-16):

| 維度 | 曝光 | 點擊 |
|---|---:|---:|
| `['date']`(站級真值) | 13,702 | 69 |
| `['date','page','country']`(三張表的來源) | 6,639 | 11 |
| 留存率 | 48.5% | **15.9%** |

留存率逐日在 15%~88% 之間跳,**不能用常數校正回去**。已新增 `gsc_daily_raw` 表
(dim = date / device / country / page),回補到 2026-08-15,每日 cron 自動累積。

🔴 **以下四個數字作廢,不要再引用**:
「1801 → 13 曝光」「586 個查詢 → 2」「CTR 0.166%」「平均名次 14.2 → 73」。
真值是:高原峰值 08-30 **3,244** 曝光、09-01 **2,113 曝光 19 點擊 名次 14.2**、
現在每日 **13~43** 曝光 0~1 點擊;歷來 CTR **0.51%**(不是 0.166%)。

### 斷崖的真實形狀:行動裝置那一整塊不見了

`['date','device']`(09-02 前 vs 後):

| 裝置 | 前:曝光/名次 | 後:曝光/名次 | 留存 |
|---|---:|---:|---:|
| MOBILE | 7,394 / **10.0** | 39 / 30.5 | **0.5%** |
| DESKTOP | 5,622 / 43.5 | 349 / 52.1 | 6.2% |

**站上唯一好看的名次一直只在行動裝置上**(桌機從頭到尾都在 43 名),而那一整塊在 09-02 消失。
`['date','country']` 同樣不對稱:ind 0.3%、idn 0.4%、twn 1.7%、bra 1.6%,
但 usa 13.7%、can 14.9%、deu 16.9%、gbr 12.7% —— 行動裝置為主的市場歸零,桌機為主的西方市場留一成。
名次也真的退了(不是只有曝光消失):twn 9.5 → 65.8、bra 14.9 → 44.0、hkg 12.7 → 60.7。

`['searchAppearance']` 只有 FORUMS 6 → 5 筆,所以**不是失去某個 rich result 資格**。
`type=image` 546 曝光、video/news/discover 全 0,沒有第二條流量線。

### 排除掉的三個解釋

- **不是季節性**:`dia da mulher 2027`(3/8)、`cap go meh 2027`(2 月)這些淡季查詢,
  08-21~09-01 每日穩定 4~33 曝光、名次 8.8~9.9,09-02 之後歸零。季節性在萬聖節與印度教師節
  那裡預測的是**漲**,實際是零。
- **不是新頁蜜月期到期**:08-15 就上線的 Topic 主頁,08-16~09-01 穩在每日 100~140 曝光
  (`gsc_query_metrics` 尺度),09-02 掉到 21,之後每日 0~5。舊頁與新頁同日同幅度掉。
- **不是量測假象**:`['date']` 原始 API 獨立確認,GA4 organic 同步 16 → 0~4。

### 判定

**站級排名降權**(升級:09-17 版說「重評/降權,機制未定」)。索引沒掉(1156 個受檢 URL
981 個 Submitted and indexed),技術面全部正常(七站 `.build-id` 對齊 HEAD、CI 全綠、robots 正常、
watchdog 0 異常),但同一批頁面在同一批查詢上的名次退了 40~55 名,且行動裝置那一面近乎全滅。

⚠ **「索引沒掉」只對 zh-TW 與 en 成立**:`url_inspections` 只有 en 563 + aeiou.now 544 + jp 49 三個 host,
hi/id/cn/br **從未被檢查過**,而 hi 正是斷崖前曝光最大的站。`url-inspection-sweep` 09-18 起
每天跑到軟上限 3000000ms 就停、零產出,這個缺口不會自癒。

### 凍結:條款不變,理由改寫

凍結至 2026-12-16 的四條照舊。但理由從「等站級降權解除」改成
**「成因未定時不要再製造一次大規模結構變動訊號,以免之後任何變化都無法歸因」** ——
這個改寫不放鬆任何一條,但讓 12-16 的判讀不必依賴一個沒被證立的前提。

🔴 **復原判準必須改寫,現行那條做不到**:09-17 訂的「舊 Topic 主頁每日曝光回到約 150–200」
掛在被遮罩的 `site_search_daily` 上,而擴張前的實測基線(`['date']` 尺度)是
**08-16~08-21 每日 100~120 曝光**。照現況執行,12-16 必然讀出「沒回來」,凍結會自動延長。
建議改成三條並列,且**加上「沒回來」的分支**:曝光未回但固定 query×page cohort 的名次
回到原位 → 判為曝光資格問題、直接解凍。**這條要站主拍板。**

### 2026-09-18 已做的三件修正

1. **`gsc_daily_raw` 站級真值表**(`scripts/gsc-topic-metrics.mjs`):另打 date/device/country/page
   四個維度,回補至 2026-08-15,新增 `--report-raw`。舊表保留原樣不回填(換源會讓曲線
   在切換當天跳 2~7 倍、長得像復原)。
2. **Topic 主頁排序的時區抖動**(`site/src/lib/occurrence.mjs`):`occurrenceDistance()` 原本用
   occurrence 自己的時區算「今天」,同日多國的順序因此一天翻好幾次 → 每輪推新 lastmod。
   實測 **15 個 Topic 在一天內會翻轉**,而 09-18 的 sitemap 正好有 **15 個 Topic 主頁標成當天**,
   逐一對得上。鎖成 UTC 後 0 個。這是 CLAUDE.md 那條紅線的**第三個入口**
   (前兩個是 RENDER_AT 與導覽列的 24h 排行捷徑)。測試 `tests/site/occurrence-order.test.mjs`。
3. **`gsc-demand-country.mjs` 的 90 天滾動窗釘住窗底**:窗內唯一有量的資料是 08-19~09-01,
   2026-11-17 起會被滾出窗外 → `topic_demand_country` 的 21 筆自己消失 →
   **七站共用 title 與 description 第一句在無人動手的情況下集體改寫,並推一次全站 lastmod**,
   時間點正好在 12-16 判讀前一個月。窗底釘在 2026-08-15(窗只會變長不會變短,今日輸出完全相同,
   雜湊 `ae3af76a…` 未變),解凍時刪掉 `DEMAND_WINDOW_FLOOR`。

---

## 2026-09-17:站級降權與 90 天凍結(有日期的快照,不是 live truth)

- **事實**:GSC(原始 API,type=web)09-01 曝光 2,113、點擊 19、平均名次 14.2;09-02 198/1;09-03 起每日 16–54,至 09-14 沒有回升。七個子網域同日一起掉;GA4 organic 同步 16→0–4。頁面仍 Submitted and indexed(br /topic/halloween/ 等抽驗),熱門頁 lastCrawl 停在 08-20~08-27。GSC 介面「專人介入處理」「安全性問題」均為空(站主 09-17 確認)。
- **判定**:演算法的站級重評／降權,不是處分。站方 08-30~09-02 的部署沒有 Google 看得到的變化(七個 publish repo 逐版比對過);最合理的觸發物是 08-26/27 兩天七站從約 385 URL 膨脹到約 3,800(逐國頁 379×7)加上 08-26~09-01 每天整站 lastmod=當天、每天 8~27 次全站重部署、外部連結 0、UGC 0。恢復以月計,沒有通知。
- **凍結範圍(至 2026-12-16)**:① 共用 title／description／h3 規則不改(明確的 bug 逐條記錄例外);② 不開任何新頁型(Topic×城市、問題單頁、嵌入 widget 都不開);③ 不砍逐國頁、不加 noindex(它是斷崖前 74% 曝光來源,現在的「未索引」可能反映站級狀態不是頁薄;要動也照 TODO「先重爬比例、再用 Google 判決」的順序);④ 新 Topic 仍可加,但走 new-territory B 段先量需求。內容加厚(制度數字、缺漏 observance、題庫)只備料不上線,等 `crawl-freshness` ≥70%。備料在 [reports/content-thickening-prep-2026-09.md](reports/content-thickening-prep-2026-09.md)(⚠ 它引用的 GSC 數字全在斷崖前窗,解凍時用同一條查法重算再動手)。
- **已做的止血**:sitemap 指紋洗掉每小時輪替的導覽捷徑,CI 改拿上一版 HTML 重算比對(09-17 這輪七站 0 頁誤推);CI notify job;主機看門狗;在地來源改逐筆隔離;GSC 就緒度決策記在 `content/gsc-readiness-decision.json`(維持門檻,12-16 再看)。
- **怎麼判有沒有回來**:`node scripts/gsc-topic-metrics.mjs --report`(站級逐日曝光/點擊,表 `site_search_daily`,2026-09-17 起)或 `node scripts/seo-health.mjs --no-inspect --days 28` 的逐日曝光;判準是舊 Topic 主頁(08-26 前就存在的那 55 個路徑)每日曝光回到約 150–200 —— 09-02 前的基線,不是逐國頁的峰值。第一次檢查 10-15,之後每兩週。

## 先記住的結論

- 這不是「一份內容翻成七種語言」的單一網站，而是**一份碼庫、七次 build、七個獨立發布站**。共用程式與資料模型，搜尋成效、發布版本、GSC 觀測則按站分開。
- `en` 先做一輪是合理的市場實驗，但 en-only 文案不應自動同步到其他語系；確認搜尋意圖後，再按各站的查詢與當地叫法另寫。
- 所有已寫好的內容批次（含第二批與 Plan 2 A/B/C）都已 commit、push 並完成七站發布（2026-09-17）；**GSC 尚未必看得到新標題，因為仍要等 Google 重爬**。發布日與見效日是兩件事，不能把上線當成排名成效。

## 目前的站點模型

| 層次 | 共用／獨立 | 維護方式 |
|---|---|---|
| Astro route、SEO 邏輯、日期排序、內鏈檢查 | 共用 | 改動可能影響七站；先看 `CLAUDE.md`，最後跑七站 build。 |
| Topic 原始內容 | 同檔分語系 | `content/topics/*.md` 有七個 `## locale` 段；en-only 修改只改 `## locale en`，不是把英文翻回所有站。 |
| UI 字串 | 共用結構、各語系文字獨立 | `site/src/i18n/*.json` key 必須一致；新增 key 才需要補六語。 |
| 靜態輸出與網域 | 獨立 | `LOCALE=<code> pnpm build` 一次只產一站；各站有自己的 origin、publish repo 與 GSC property。 |
| GA4 | 量測串流共用 | 同一個 GA4 web stream，以 hostname／locale 分析；不能把它當成七站共用的 SEO 成效。 |
| GSC | 觀測獨立 | 七份 sitemap、七個 host；en 的曝光、查詢、索引與其他站分開判斷。 |
| UGC | 原文共用、譯文按站呈現 | 使用者貼文由流程翻六語；這與 Topic 靜態內容的人工在地化是兩條流程。 |

穩定的 locale、market、origin 對照仍以 [site/src/lib/config.mjs](../site/src/lib/config.mjs) 與 [site/astro.config.mjs](../site/astro.config.mjs) 為準；不要把這份快照當成設定檔。

## 本輪已完成

### 共用 SEO／品質基礎

- Topic 日期摘要依實際 `next_occurrence.starts_on` 排序，不再用資料列順序猜第一個日期。
- `crawl-freshness` 改成七站 sitemap 的分層抽樣、重試、失敗關閉；可用 `--sample 0` 做全量檢查。
- 新增內部連結圖檢查與 build gate，避免 indexable 頁面沒有可爬入口或因重複連結誤判。
- FAQPage schema 保留，但不再把不可見的 FAQ schema 當成 release gate；可見答案仍須存在。
- 日文 Diwali 名稱補上 `ディーワーリー`，日期排序與 SEO regression tests 已補上。

### en 第一批

依 en 的 query × page 證據調整了四個 Topic 的英文 title／keywords：

| Topic | en title | 主要補強的查詢意圖 |
|---|---|---|
| `back-to-school` | `School Start Dates` | school start dates、when does school start、back-to-school dates |
| `parental-leave` | `Maternity, Paternity and Parental Leave` | maternity leave by country、maternity leave in China、how long is maternity leave |
| `exam-season` | `University Entrance Exams` | university／college entrance exams、college admissions tests、exam dates by country |
| `diwali` | `Diwali Dates and Holidays` | Diwali dates、Diwali holidays、Diwali 2026、Deepavali |

另修正共用 Topic title year 與 description lead 使用不同國家資料的問題：先用 `facts.demand_countries[LOCALE]`，沒有可靠需求主題國時才退回本站市場／全部觀測。這是共用 route 修正，不是 en 專屬邏輯。

### en 第二批（2026-09-17 已發布）

依 2026-09-03 的 GSC query × page 近 28 日證據，這批只改三個英文制度／日期型 Topic 的 `title`、首段與 `keywords`：

| Topic | page 證據 | 主要補強的查詢意圖 |
|---|---:|---|
| `labour-day` | 74 impressions、平均位置 63.5 | Labour Day dates by country、1 May、US Labor Day September |
| `minimum-wage/cn` | 35 impressions、平均位置 79.5 | China minimum wage、minimum salary in China、Chinese minimum wage in USD |
| `official-languages/cn` | 19 impressions、平均位置 73.3 | national language of China、China official language、official language of China |

本批只修改各檔的 `## locale en`，沒有把英文文案同步到其他語系；先完成 import／export 與英文版 build，發布和 Google 重爬後才評估成效。

## GSC／GA4 快照與解讀邊界

以下表格數字是 2026-09-03 的基準診斷快照，不能當成即時值；2026-09-04 的重新量測摘要另記在上方「2026-09-04 本輪執行與驗證紀錄」；GSC 最新資料約落後 2–3 天，且 page/query 維度不可直接相加。

| 觀測 | 快照 | 解讀 |
|---|---|---|
| GSC query 近 28 日（全站診斷層） | 1,516 queries、5,256 impressions、6 clicks；最新資料至 2026-08-31；17 個有效資料日；約 58% 查詢在 51 名以後 | 曝光有增加，但樣本仍小，不能用這個窗宣稱單批 title 的因果。 |
| en page 維度（較早的 page 快照） | 1,505 impressions、2 clicks、平均位置 61.1 | 目前仍把 en 視為曝光最大但排名最弱的市場；待下一次 page 維度回補再更新。 |
| sitemap／URL Inspection | 7 份 sitemap，最後下載日 2026-09-01，0 errors／warnings；根首頁抽查為 en、zh-TW 已提交且已索引，jp 為 Crawled - currently not indexed | 提交與技術門檻正常；jp 首頁需獨立追查，不先牽動 en。 |
| GA4 | 306 sessions；236 筆疑似污染，約 77%；較可信的 real-ish 流量約 70；Organic Search 67 sessions、39 engaged、平均 58 秒 | 不用 GA4 直接替代 GSC 來做搜尋排名或 HotScore 判斷。 |
| Google 重爬 freshness（上一輪樣本） | 20-url 分層樣本，19 筆有 crawl history；基準日後重爬 1 筆，約 5%；19 筆仍 stale | 這個樣本沒有證明目標頁已被重爬；本批發布後仍需重新觀察。 |

本次抽查的索引異常是 `https://jp.aeiou.now/` 的 `Crawled - currently not indexed`。重新檢查顯示 robots、indexing allowed、sitemap／canonical 與 Google 選擇的 canonical 都沒有明顯技術阻擋，因此先視為品質／選擇訊號持續監測，不做共用程式的高風險修正。

### en query × page 的第一批證據

這些是用來選擇本輪修改對象的低量訊號，不是成效結論：

- `2027 teachers day date` → `/topic/teachers-day/`：6 imp、position 10.7。
- `when does school start in taiwan` → `/topic/back-to-school/tw/`：約 position 11。
- `china maternity leave`／`maternity leave in china`／`parental leave china` → `/topic/parental-leave/cn/`：各 2 imp，position 約 54–57。
- `when are college entrance exams in japan` → `/topic/exam-season/jp/`：2 imp，position 70。
- `diwali holidays` → `/topic/diwali/`：3 imp，position 73.3。

重點不是看到少量曝光就大改全部頁面，而是讓 title 與頁面真正回答已出現的查詢；本次第二批已完成本地修改，接下來等發布、重爬和更多資料再決定下一批。

### en query × page 的第二批證據

- `labor day date`／`when is labour day`／`is Labour Day celebrated in other countries` → `/topic/labour-day/`：合計 74 imp、平均 position 63.5；首段補上 1 May、US September 與各國放假差異。
- `china minimum wage`／`minimum salary in china`／`chinese minimum wage in usd` → `/topic/minimum-wage/cn/`：35 imp、平均 position 79.5；title 與 keywords 直接採用這組需求叫法，首段先回答制度差異。
- `national language of china`／`china official language`／`official language of china` → `/topic/official-languages/cn/`：19 imp、平均 position 73.3；title、keywords 與首段先區分官方語言、國家語言和法律依據。

### Plan 2 跨語系需求主題國（2026-09-17 已發布）

依 GSC query × page 與需求主題國報告，這輪維持「locale 不等於需求主題國」的判斷，且每批只改對應 locale：

| 批次 | locale／需求主題國 | query 證據 | 實作假設與變更 |
|---|---|---|---|
| A | `zh-TW / ramadan-and-eid → Indonesia`；`en / childrens-day → India` | `2027印尼齋戒月時間`、`印尼齋戒月2027`；`when is children's day in india 2026`、`children day 2026 india` | 首段先回答印尼 sidang isbat／cuti bersama與印度 Bal Diwas／中央政府清單範圍，保留日期與放假差異。 |
| B | `en / teachers-day → China`；`zh-TW / labour-day → United States`；`zh-TW / national-days → Japan` | `teachers day in china 2026`、`teachers day china 2026`；`美國勞動節 日期`；`日本国庆日`、`日本國慶日` | 先回答當地叫法、日期與制度層級：中國教師節 9/10、美国 Labor Day 2026/9/7、日文 `建国記念の日` 2/11；不把紀念日直接寫成全民放假。 |
| C | `ja / long-holiday-weeks → Taiwan`；`zh-TW / elders-day → Japan`；`zh-TW / diwali → India` | `台湾 春節 2027`、`2027年 台湾 春節`；`日本敬老日2026`；`印度排燈節2026`、`排燈節 2026` | 補台灣 2027 政府行政機關春節 2/4–2/10 七日並標明民間適用差異；補日本 2026/9/21、`老人の日／老人週間`與私人雇主界線；補印度 Diwali 2026/11/8 的 All India／中央政府清單範圍，避免把五天文化節期寫成全印度五天公假。 |

三批均先保留既有 country block，再以官方來源做最小修正；研究底稿見 [Batch A](reports/seo-research-batch-a-2026-09.md)、[Batch B](reports/seo-research-batch-b-2026-09.md)、[Batch C](reports/seo-research-batch-c-2026-09.md)。未修改共用 route、資料模型或 UI，也未發布。

Diwali 的 Bhai Dooj 2026 occurrence 仍因 repo 既有 11 月 10 日與官方 11 月 11 日資料衝突而保留 `estimated`，本輪沒有擅自改動 occurrence 日期。

### 2026-09-04 本輪執行與驗證紀錄

- Plan 0 重新接線結果：GSC 90 日 query × page 1,631 rows、命名需求 681 impressions，72 個集中格中 14 個勝出；Plan 2 A/B/C 依序選出上述八個 locale／Topic／需求主題國組合。28 日 GSC 仍是 1,704 queries、6,271 impressions、10 clicks、18 個有效曝光日；排名 1–10／11–20／21–50／51+ 為 356／253／142／953，不能解讀為本地 build 的成效。
- Plan 3 不需新增共用程式：現有 Topic root 已由 Astro route 產生需求主題國入口，相關 Topic 也沿用既有同語系關聯。最後 ja dist 的 gate 為 559 個 sitemap URL、567 個 rendered HTML，零入口 0、單一入口 0、最少 2。
- Plan 4 JP 首頁診斷正常：ja build 的 `<html lang="ja">`、日文 title／H1、`https://jp.aeiou.now/` canonical、sitemap、7 個 hreflang 加 x-default 與可見 Topic 入口均存在，因此沒有改共用 SEO 程式。當次 `seo-health` 的 URL Inspection（544 頁）為 460 Submitted and indexed、69 Discovered - currently not indexed、5 Crawled - currently not indexed、9 URL unknown、1 Internal error；這是觀測快照，不是本地建置失敗。
- Plan 6 分開保留 GA4 raw 與 heuristic：本次 28 日診斷為 308 sessions、235 筆疑似機器流量、73 筆 real-ish；`real-ish` 只是啟發式標籤，不是已完成的 bot 識別。GSC 與 GA4 不合併成單一 SEO KPI。
- 最終內容 gate：完整性 63 Topic／243 observance／247 regional notes／108 places／54 events／172 sources；內容厚度 63 個公開 Topic（最薄 1,222 字元）；七人格 review、`git diff --check` 均通過。來源 URL 檢查為 736 個 URL 全部被擋／暫時失敗、失效 0，屬 WAF／網路可達性問題，不判定為死鏈。
- Release-candidate QA：八組 locale／Topic／需求主題國頁面已核對 root link 與首段答案；七語 build 依序全部通過：zh-TW 552／544、en 571／563、ja 567／559、zh-CN 548／540、hi／id／pt-BR 各 571／563（pages／sitemap）。本輪只調整 `check-rendered-depth` 對全域導覽標籤的 D3 誤判排除，未改 rendered UI、route 或資料模型。
- Plan 5 尚未進入發布後實驗：本輪內容雖已於 2026-09-17 上線，但還沒有任何**重爬後**的排名改善可報告。線上七站 `.build-id` 已對齊當時的 HEAD `328bf63`；發布是起點不是結果，成效要等 Google 重爬。

## 驗證狀態

- CI run `33465126454` 成功：測試、來源連結檢查與七站 build／deploy 全部通過。
- 2026-09-04 唯讀重查七站 `.build-id` 全部為 `51f3af9`（2026-09-02 commit），彼此一致但落後本地 HEAD —— 後來查明那不是「尚未發布」，是 **CI 從 09-03 起連續失敗**（check-source-urls 擋在腐化的來源上），七站因此凍結了兩週。2026-09-17 修復後重查，七站 `.build-id` 已對齊 HEAD `328bf63`。
  🔴 教訓：「七站一致但落後 HEAD」不等於尚未發布，**先看 `gh run list`**；只比 `.build-id` 看不出管線是停了還是還沒推。
- 最新 en build 通過：571 pages、563 sitemap URLs、SEO／GEO／AEO gate 通過、內鏈 gate 通過。
- 本輪七語 build 均通過；共用的 D3 檢查器只做導覽標籤誤判修正，rendered UI、route 與資料模型沒有變更。
- 上一輪線上 en 四個目標頁已呈現新 title；本地第二批 en build 產生 563 個 `<loc>` 與 563 個 `<lastmod>`。
- 最新測試通過：5 個 test files、0 failures。
- `git diff --check` 通過。
- 本輪七語 build 全部通過 SEO／GEO／AEO、sitemap、hreflang、內鏈、渲染厚度與本地範圍守門；完整測試為 5 files、0 failures。

## 下一步，不要重做整套分析

### 本輪內容批次發布後

1. 本輪已於 2026-09-17 發布，七站 `.build-id` 已確認對齊 HEAD。下一步不是再發一次，是等重爬：先跑 `node scripts/crawl-freshness.mjs`，重爬比例沒到 70% 就不要再調文案。
2. Google 重爬後只看本檔記錄的 query × page 證據，檢查 impressions、clicks、position 是否改善。
3. 若位置仍在 20–70，下一步優先補 country page 入口、h2、答案與內鏈；若仍幾乎無曝光，先查需求與索引，不再批量換 title。

### 若改共用程式、資料模型或 UI

1. 讀 `CLAUDE.md` 對應章節與受影響檔案。
2. 跑七語 build、tests、SEO gates；上線後用各站 `.build-id` 驗證，不只看 HTTP 200。
3. 若只改單一 locale 的 Topic 文字，不需要先重跑七站 GSC／GA4 全量診斷；但 release 仍要依部署規則驗七站。

### 只有以下情況才刷新完整 GSC／GA4

- 本快照超過 7 天；
- 使用者明確要求「檢查 GA／GSC」；
- Google 已重爬一批頁面，需要做前後比較；或
- 發現索引、sitemap、追蹤或 bot 汙染狀況可能改變。

量測入口：`node scripts/seo-health.mjs --sample`、`node scripts/crawl-freshness.mjs --sample 20`。每次真正重跑後，只更新本檔的快照、結論與下一步，不另起一份無法銜接的分析。

## 持續經營 SOP

### 每一輪的固定順序

1. 先選一個市場與一小批有證據的 Topic；目前先完成 en，不把七站一起大改。
2. 發布後確認該站 `.build-id`，再等 Google 重爬；未重爬前不把新 title 當成實驗結果。
3. 用 GSC 的 query × page 看同一頁實際被哪些詞觸發，再決定只改一個主要問題：
   - 有曝光、位置已接近前 20、點擊低：先檢查 title／description 是否準確承諾頁面答案。
   - 有曝光、位置在 20–70：補強首段答案、國家頁入口、h2 與內鏈，不只換標題。
   - 幾乎沒有曝光：先查索引、sitemap、referring links 與需求，不批量重寫整站。
   - 已有點擊或排名上升：先保留，避免為了「看起來有在做事」反覆改文案。
4. 只做小批變更，完成 import／export、build、tests，再記錄變更與假設。
5. 累積到足夠重爬資料後，判斷保留、回滾方向或進入下一批；GA4 只用來看較可信的使用品質，不取代 GSC。

### 各站怎麼獨立經營

- `en`：用英文 query 與英文讀者的國家意圖選 title、首段和 country page，不把中文站的標題直譯過來。
- 其他 locale：沿用同一套判斷框架，但重新看該站自己的 query、當地叫法、需求主題國與市場資料；可重用結構，不能假設關鍵字相同。
- 共用 route／SEO／資料邏輯：視為產品級改動，七站一起 build／驗證。
- 單一 Topic 的單一 locale 文字：視為市場級改動，先驗該站；發布前仍按七站部署規則確認沒有共用輸出問題。

### 長期內容節奏

- 季節性 Topic：在新年度日期與官方來源確定後更新，不把過期年份留在 title／摘要中。
- 常青制度型 Topic：優先補能回答具體查詢的國家頁、來源與內鏈，不用大量複製短頁。
- 新 Topic：先有可觀察的需求與足夠內容深度，再建立頁面；沒有需求證據時先改善現有入口。
- 每輪完成後更新本檔的「目前快照／本輪已完成／下一步」，使下一次工作能從決策點繼續，而不是重新解讀全部檔案。

## 更新規則

- 每完成一個 SEO 批次或一次正式 GSC／GA4 量測，就更新本檔的日期、變更、驗證與下一步。
- 把「快照」和「設定權威」分開：live status 仍以指令輸出為準，locale／route／data schema 仍以程式與架構文件為準。
- 不把未部署的 working-tree 結果寫成線上成效；沒有重爬前不宣稱 title 已影響排名或 CTR。
