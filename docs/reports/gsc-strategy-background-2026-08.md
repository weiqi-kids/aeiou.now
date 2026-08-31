# GSC／SEO 策略背景研究草稿（2026-08）

產出時間：2026-08-31 UTC
研究性質：只讀背景研究；沒有執行會寫入 SQLite、D1 或靜態資料的 job。

## 一、資料來源與時間窗

本次先讀取 [`CLAUDE.md`](../../CLAUDE.md)，再對照既有 GSC／SEO 腳本與主機庫。資料語意以腳本實作為準：GSC 的 `date` 是資料日，通常落後 2–3 天；`position_sum` 用於計算曝光加權平均名次。[`gsc-topic-metrics.mjs`](../../scripts/gsc-topic-metrics.mjs)、[`db/schema-host.sql`](../../db/schema-host.sql)

|來源|讀取方式與時間窗|本次可用範圍|
|---|---|---|
|live GSC Search Analytics|property `sc-domain:aeiou.now`；2026-08-03–2026-08-31（28 天查詢窗）|query 維度 536 個查詢、1,487 曝光、2 點擊；有正曝光的資料日 14 天，最新有資料日為 08-28。另讀 query×page 作落地頁與國家錯配診斷。|
|主機 `topic_search_metrics`|只讀 SQLite；累積資料日 2026-08-15–08-27，共 13 天|global scope 812 曝光、2 點擊；63 個 active Topic 中 32 個有曝光、31 個尚無曝光。|
|主機 `gsc_query_metrics`|只讀 SQLite；2026-08-15–08-27，共 13 天|445 筆原始 query×page×date 列、317 個查詢、116 個頁面；合併後 332 個工作項目，950 曝光、2 點擊。|
|SEO 工作清單／歷史|`node scripts/seo-growth.mjs --days 28 --json`、`--history`，未帶 `--record`|最近快照顯示 08-31：950 曝光、2 點擊、加權平均名次 28.2、P0 17／P1 25／P2 0／P3 290。|
|索引與抓取|live sitemap、7 個 sitemap API 狀態、5 個 URL Inspection 直接抽查|7 份 sitemap 最後下載日 08-30，錯誤／警告皆 0；抽查的 Topic 主頁與 Ask the World 頁都回 `Submitted and indexed`，但最後抓取日不一致。|
|內容與站台盤點|主機庫、靜態 export、`check-content-depth.mjs --report`|63 個 active Topic；38 個有 observance、25 個沒有；內容厚度 gate 顯示 0/63 未達目標。live sitemap 共 541 URL：63 Topic 主頁、421 國家頁、21 holiday、25 question、6 ranking。|

`gsc-topic-metrics` 最近一次 job（08-30）成功，歷史 job 無失敗或 DLQ；因此本地資料落後 live GSC，主要符合 GSC 延遲，不像是收集管線停止。本次沒有執行 `gsc-topic-metrics`、`gsc-demand-country --report` 或任何 `--record` 模式；`gsc-demand-country --report` 的實作仍會先 ensure schema，故改以只讀查詢既有表格。

## 二、最重要的數據證據

### 1. 搜尋量開始形成，但排名分布仍是主要瓶頸

live GSC query 維度如下：

|指標|數值|
|---|---:|
|查詢列|536|
|曝光|1,487|
|點擊|2|
|CTR|0.13%（診斷腳本四捨五入顯示 0%）|
|曝光加權平均名次|約 29.0|
|排名 1–10／11–20／21–50／51+|82／69／47／338 查詢列|
|51+ 佔查詢列|63.1%|

本次剛好通過 repo 設定的排名結構判讀門檻（至少 14 個有資料日、至少 500 曝光），所以「大量查詢仍在 51 名以後」可以暫視為排名競爭力問題，而不只是站台太新。[`seo-health.mjs`](../../scripts/seo-health.mjs) 仍提醒這只是 14 天有效樣本，不能把單日波動當成長期趨勢。

### 2. 需求集中在「年份／日期／節日」長尾；國家需求是重要但尚未穩定的資產

目前診斷腳本的四類 query 分類結果：

|工具分類|查詢|曝光|點擊|曝光加權平均名次|
|---|---:|---:|---:|---:|
|跨國／比較／制度規則|32|39|0|61.1|
|國家×節日／單一國制度|122|257|1|30.8|
|名稱／翻譯|9|28|0|71.5|
|純日期型|191|918|1|16.1|
|未分類（不納入上述平均）|182|—|—|—|

高曝光且已接近首頁的 query 例子：

|query|曝光|點擊|平均名次|
|---|---:|---:|---:|
|`2026年祖父母節是哪一天`|178|1|10.84|
|`dia da mulher 2027`|128|0|8.98|
|`2027印尼齋戒月時間`|59|1|4.95|
|`dia das bruxas 2026`|54|0|6.81|
|`teacher day kab hai 2026`|36|0|10.86|

這表示目前最可靠的成長入口不是泛泛的 Topic 名，而是「節日／制度 + 年份 + 國家或日期」的具體問題。純日期型帶來最多曝光，但 CTR 幾乎沒有；國家×節日的量較小、排名較弱，卻較符合網站能提供跨國差異與在地制度的內容優勢。分類規則與加權方式見 [`seo-health.mjs`](../../scripts/seo-health.mjs)。

### 3. 「搜尋者所在國」與「查詢問哪一國」已出現明顯分離

query×page 的 named-country 診斷結果：

|類別|查詢列|曝光|點擊|平均名次|
|---|---:|---:|---:|---:|
|問本國／home|6|6|0|57.2|
|問外國／foreign|127|259|1|30.2|
|其中排名前 15|外國 38 列／本國 1 列|152／—|1／—|—|

例如 `2027印尼齋戒月`、`美國勞動節 日期`、`grandparents day taiwan` 都顯示 query 的目標國家與落地站的 home country 不同。這直接支持 description 首句應以「query 指向的需求主題國」為 lead，而不能把 GSC 的 searcher-country 維度當成 query target country。兩者的資料契約在 [`CLAUDE.md`](../../CLAUDE.md)、[`gsc-demand-country.mjs`](../../scripts/gsc-demand-country.mjs) 與 [`demand-country.mjs`](../../scripts/lib/demand-country.mjs)。

目前 `topic_demand_country` 只有兩個採用中的 override：

- `ramadan-and-eid@zh-TW → ID`：102 指名曝光、100%，90 天窗。
- `childrens-day@en → CN`：5 指名曝光、100%，90 天窗。

前者是目前較有用的方向訊號；後者剛好踩在「至少 5 曝光」門檻，穩定性仍不足。需求主題國的機制應保守維持，不能因一次跨國 query 就大規模改寫所有頁面。

### 4. Topic 覆蓋與內容厚度不是同一件事

主機累積 GSC 表顯示，63 個 active Topic 中只有 32 個已在 28 天 global scope 出現曝光；有曝光的 Topic 每題曝光中位數為 6，範圍 1–197。repo 規定要到中位數至少 30，且重新校準 heat tiers，才可用 GSC 驅動 HotScore；目前仍未達標。[`gsc-topic-metrics.mjs`](../../scripts/gsc-topic-metrics.mjs)

另一方面，`check-content-depth.mjs --report` 顯示 0/63 未達目標。這只證明頁面通過既定的結構／資料厚度 gate，不代表 query 對題、摘要能帶來點擊，或頁面已有足夠外部權威。因此目前不宜把「再批量加厚所有 Topic」當作唯一解釋；更像是要處理 query–landing relevance、snippet CTR、內鏈與權威訊號。

### 5. GA4 不適合作為搜尋成長的主 KPI

`seo-health.mjs --no-inspect` 的 28 天 GA4 heuristic：247 sessions，其中 Direct 209、Unassigned 7 被判為疑似機器流量，合計 216（87%）；工具可暫當真人看的只有 31，且 Organic Search 為 31。這是 repo 的機器流量啟發式，不是經過驗證的真人標籤；對搜尋策略應以 GSC impression、position、click 和 query×page 為主，GA4 只作輔助行為訊號。[`seo-health.mjs`](../../scripts/seo-health.mjs)

### 6. 索引面沒有看到全站性阻斷，但 sitemap freshness 有運維異常

7 份 sitemap 的 API 狀態都為 0 error／0 warning；5 個直接 Inspection sample（ramadan、elders、women、teachers、ask-the-world）均為 `Submitted and indexed`。因此目前證據不支持「全站尚未進索引」是主要瓶頸。

但 live `sitemap.xml` 的 541 個 URL 全部帶 `lastmod=2026-08-31`；local `site/dist/sitemap.xml` 的 541 個 URL 也同樣整批共用單一日期（本地 build 時為 08-28）。這與 [`site/scripts/sitemap-lastmod.mjs`](../../site/scripts/sitemap-lastmod.mjs) 和 [`CLAUDE.md`](../../CLAUDE.md) 所要求的「只在逐頁 HTML 真正改變時更新」不一致。這是應先查明的訊號，不是本次要直接修 code 的事項。

## 三、可能的策略結論

以下是依證據形成的方向假說，交給主 agent 決定是否轉成執行計畫：

1. **先優化已經被 Google 找到、且位於前 20 的 query–page 組合。** 優先看 `2027印尼齋戒月時間`、`2026年祖父母節是哪一天`、`dia da mulher 2027`、`dia das bruxas 2026` 等，而不是先擴大 Topic 數量。檢查同一 query 是否落到正確的國家頁、title／description／首段／FAQ 是否直接回答年份與日期、是否存在 home page 與 country page 的落地分散。

2. **把「需求主題國 + 年份／日期」當成目前最清楚的內容產品形狀。** title 可以保留本市場 local name 的辨識度，但 snippet 首句與頁面首屏需要對上 query 所問的國家與日期；這與現有需求主題國 fallback 機制一致。不能把 `country:XX`（搜尋者位置）誤當成要寫進摘要的國家。

3. **用 query evidence 選擇季節跑道，不要平均處理 63 個 Topic。** 以 08-31 的 `seo-growth` 跑道，近期值得核對的節點包括 09-03 `war-dead-and-veterans`、09-05 `teachers-day`、09-07 `labour-day`／`national-days`、09-12 `jewish-calendar-days`、09-13 `elders-day`。這些日期是資料層的 upcoming signal，不等於已被 GSC 證明有需求；應優先挑已有曝光或國家需求匹配者準備內鏈、snippet 與落地頁。[`seo-growth.mjs`](../../scripts/seo-growth.mjs)

4. **短期目標應是提升前 20 的 CTR 與前 50 的可見度，而不是把 GSC 立刻接進 HotScore。** live query rows 的 63.1% 在 51+，而本地主題曝光中位數只有 6；這同時支持排名／權威／內鏈工作，也明確表示目前資料還不足以穩定排序 Topic。若內容厚度 gate 已綠，新增內容應優先補「查詢缺的獨有答案、可信來源、國家內鏈」，而非重複通用段落。

5. **保留七個 locale 與國家頁架構，但以落地品質作為擴張門檻。** live query×page 已看到 `/topic/.../id/`、`/cn/` 等國家頁進入前 20；這是保留 country landing 的正面訊號。但目前 421 個 country pages 的存在本身不是需求證明，新增或擴張前仍要有 query、日期或國家資料支撐。

6. **把抓取與 lastmod 的可信度先修復成可觀測，再判斷改版成效。** 目前一個 Ramadan query 已有 1 click，但 GSC 只有 14 個有效資料日，而且抽查的最後抓取日從 08-16 到 08-29 不等；不能把這 1 click 歸因於最近的 title／description 改版，直到 Google 重爬狀態與 sitemap timestamp 可被一致驗證。

## 四、仍需主 agent 驗證的疑點

1. **`crawl-freshness` 與直接 Inspection 相互矛盾。** `node scripts/crawl-freshness.mjs --since 2026-08-26` 回報 Topic 主頁 63 頁有抓取紀錄 0；但同一研究中直接 `inspectUrl` 的 ramadan、elders、women、teachers、ask-the-world 均回 indexed 且有 `lastCrawlTime`。需要檢查該腳本是否吞掉 API error、quota／property 參數或 URL 格式問題，並以分 locale、分 page type 的有效 sample 重跑；在此之前不能用「0% 重爬」判定改版沒被看見。[`crawl-freshness.mjs`](../../scripts/crawl-freshness.mjs)

2. **為什麼 live sitemap 的 541 個 lastmod 全部變成今天？** 需查 CI／publish repo 的 `.page-stamps.json` 是否缺失或被視為 first run，以及 rendered HTML fingerprint 是否被 volatile data（例如 upcoming／ranking／全站 render 輸出）誤判為全頁變更。應先找出原因，再決定是否影響 Google 抓取優先序。[`site/scripts/sitemap-lastmod.mjs`](../../site/scripts/sitemap-lastmod.mjs)、[`site/src/pages/sitemap.xml.ts`](../../site/src/pages/sitemap.xml.ts)

3. **query 維度與 query×page 維度不能直接相加。** live query 維度是 1,487 曝光；query×page、page、host 的總和會不同，可能涉及維度聚合與匿名化，但本 repo 尚未把差異定義成正式 KPI。主 agent 需決定：總體搜尋成效固定採 query 維度，query×page 僅作落地診斷，並在後續報表保持這個界線。

4. **樣本仍高度集中在單日。** live date 維度中 08-27 約 530 曝光、08-28 約 1,102 曝光，合計佔 1,487 的大部分；加上 GSC 延遲 2–3 天，應等後續資料補齊後再判斷是否為可重現的成長，而不是單次季節／抓取波動。

5. **需求主題國 override 的穩定性尚未證明。** `ramadan-and-eid@zh-TW → ID` 有 102 曝光但可能仍是單一 query cluster；`childrens-day@en → CN` 只有門檻最低的 5 曝光。需觀察至少數個重算週期，並抽查首句是否真的與 query 對題。

6. **意圖分類是 regex heuristic。** 目前仍有 182/536 query 未分類；分類順序也會影響同時含國名、年份、制度詞的 query 歸屬。策略決策前應抽樣核對 query 原文，尤其不能只因「純日期型曝光最多」就放棄國家差異內容。

7. **31 個 active Topic 無本地 global 曝光，不等於未索引或沒有市場需求。** 它們可能是新頁、尚未被 GSC 觀察、query 落在非 Topic 頁，或確實沒有 demand。需要 join `topics` 的建立／狀態資訊、URL Inspection 與 query×page 後，才可決定補內容、改內鏈或淘汰。

8. **目前 5 頁 Inspection 只能證明抽樣頁。** 它們均 indexed，但 referring URL 主要是站內頁或 sitemap，尚未證明全站各 locale、country page 及外部連結／權威狀態都相同；若要把「權威不足」列為正式結論，需做分層抽樣並保留結果。

## 五、可重現的只讀入口

```bash
node scripts/seo-health.mjs --no-inspect
node scripts/seo-growth.mjs --days 28 --json
node scripts/seo-growth.mjs --history
sqlite3 -readonly -header -column db/aeiou.sqlite '<只讀聚合查詢>'
```

上述入口對應的 GSC 查詢、排名門檻、內容 gate、priority 與資料表語意分別在 [`seo-health.mjs`](../../scripts/seo-health.mjs)、[`seo-growth.mjs`](../../scripts/seo-growth.mjs)、[`check-content-depth.mjs`](../../scripts/check-content-depth.mjs) 與 [`db/schema-host.sql`](../../db/schema-host.sql)。

## 六、主 agent live 驗證補充（2026-08-31）

主 agent 重新直接查詢 live GSC 後，需把兩個數字口徑固定下來：

- 無維度全站總量（全站 KPI）：3,297 impressions、12 clicks，平均位置 27.60，資料到 08-28。
- page 維度（落地頁分布）：491 pages、3,341 impressions、12 clicks；因維度聚合／匿名化，與無維度總量不必然完全相等。
- query 維度（較適合分析可見 query）：1,487 impressions、2 clicks，536 queries，平均位置 27.60。這不是全站 clicks；query 維度會省略部分匿名查詢，不能拿來當全站總量。

page 維度的 locale 分布為：en 854/1、zh-TW 841/6、pt-BR 522/0、hi 519/2、ja 244/3、id 203/0、zh-CN 158/0（格式為 impressions/clicks）。主要 click page 包含 zh-TW elders 238/1、hi India teachers 212/1、zh-TW Ramadan 168/1、jp Eid al-Adha 23/1、id 2027 holidays 7/1 與 id back-to-school 8/1。這些頁面比 query 維度報表更適合作為優化候選與成效基準。

直接 URL Inspection 的抽查頁均為 `Submitted and indexed`、canonical 自指；但最後抓取時間分布不一致（例如 Ramadan 08-28、elders 08-22、women 08-20）。因此 `crawl-freshness` 回報 0 筆不能直接解讀為「Google 完全沒有抓取」，應先修正腳本對 API error 的呈現，再做因果判斷。

最後，live sitemap 的 541 個 URL 在本次查驗全部為同一個 `lastmod=2026-08-31T00:11:31.073Z`。這仍是最優先的可觀測性問題：在 CI／HTML fingerprint 的原因查清前，不宜用 lastmod 或一次 snippet 改動來宣稱排名成效。

## 七、已執行 sprint（2026-08-31）

依照上述優先順序，這次已完成以下可觀測的改動：

- Topic 直接答案表改以需求國家優先，並在有資料時連到該國年度日曆；同時保留問題入口，讓 query → answer → next action 成為一條路徑。
- pt-BR `womens-day` 首段與標題補上 `Dia da Mulher` 的實際搜尋用語；新增勞動節的兩個在地化問題，讓 `/questions/labour-day/` 有可持續更新的社群入口。
- 新增每個支援國家 2026–2028 年的 CSV／ICS 年度假日資料資產，含日期狀態、來源與可匯入行事曆格式；下載行為以 `calendar_asset_click` 追蹤。
- 既有的 lastmod、occurrence／regional scope 與資料完整性修正納入本輪驗證，避免用整站同一時間戳製造更新訊號。

本地驗證結果：七個 locale build 全部通過；每個 build 的 SEO／GEO／AEO、rendered depth、local scope gate 均通過。資料完整性為 63 Topics、243 observances、247 regional notes、108 places、54 events、172 sources；測試套件 5/5 通過。`seo-growth` 目前列出 23 個 P0、51 個 P1 query/page 工作項，接下來以這份清單與下載／答案行為事件作為基準。

這些改動要等 Google 重新抓取並累積新的 GSC 資料後才判斷 CTR 或排名是否改善；下一次固定比較應至少保留 7–14 天的新資料，並以 query 維度作全站搜尋 KPI、query×page 作落地診斷。
