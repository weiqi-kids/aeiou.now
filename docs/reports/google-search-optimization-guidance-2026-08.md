# aeiou.now GSC／SEO 官方文件研究指引（2026-08）

- 研究日期：2026-08-31（UTC）
- 性質：獨立、只讀研究；只使用 Google Search Central／Search Console 官方文件與本 repo 的相關實作。
- 範圍：支援下一步 GSC／SEO 檢視，不是本次 live GSC 數據稽核；未執行寫入 DB／D1 的命令，也未修改程式。

## 先講結論

1. Search Analytics 的 property total、query、page、query×page 是不同聚合口徑。aeiou.now 目前把全站／頁面×國家指標放在 `topic_search_metrics`，把 query×page 證據放在 `gsc_query_metrics`，方向正確；兩者不能相加當成總量。[Search Analytics dimensions](https://support.google.com/webmasters/answer/17011259?hl=en)、[Search Analytics API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)、[repo 實作](../../scripts/gsc-topic-metrics.mjs#L117-L214)
2. Title、meta description 和 SERP snippet 都不是固定字數欄位。它們是 Google 產生搜尋呈現的輸入訊號；Google 可依 query、裝置與頁面內容改寫。優化重點應是「query／landing page／可見標題與首段」一致，而不是追逐某個字元數。[title links](https://developers.google.com/search/docs/appearance/title-link)、[snippets](https://developers.google.com/search/docs/appearance/snippet)
3. Sitemap、canonical、內部連結是強弱不同的發現／規範化訊號，沒有任何一項保證索引或特定呈現。repo 現行逐頁 HTML fingerprint 產生 `lastmod` 的方向符合官方「準確、可驗證、重大更新才更新」原則；`priority`／`changefreq` 則不應列為 Google 優化缺口。[sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)、[canonicalization](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)、[crawlable links](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)
4. 一個高信心的現況提醒：Google 官方更新指出 FAQ rich result 自 2026-05-07 起不再出現在 Google Search；因此 `check-seo.mjs` 把 `FAQPage` 當 Topic 頁的必要 release gate，不能再解讀成當前 GSC 缺口。這是後續程式／schema 策略調整候選，本報告不直接修改它。[Google Search updates](https://developers.google.com/search/updates)、[目前支援的 structured-data features](https://developers.google.com/search/docs/appearance/structured-data/search-gallery)

## 1. Search Analytics：query、page、total 要怎麼讀

Google 將 dimension 定義為分組資料的方式；Search Analytics API 不帶 dimension 時，把符合條件的值合併成一列，帶 dimension 時每個唯一 dimension 組合各成一列。[API query](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)

| 視圖 | 官方口徑 | 對 aeiou.now 的用途 |
| --- | --- | --- |
| property total／無 dimension | 全 property 的聚合 KPI；圖表是 property 層級 | 趨勢、locale／全站曝光與點擊的唯一總量基準 |
| query | 以搜尋字詞分組；匿名／稀有 query 可能不列在表格，圖表總量仍可能包含；只顯示部分重要／頂部 rows | 找意圖、品牌／非品牌、曝光高但 CTR 低的文案機會；不能用可見 query rows 回加總量 |
| page | 以 landing page 分組；redirect 後的 final URL、canonical attribution 會影響歸屬 | 找哪個頁面承接曝光與點擊；先看 canonical／實際 landing page |
| query × page | 同時以 query 與 page 分組，粒度更細、資料更容易受 top-row／匿名化限制 | SEO 工作清單與落地頁診斷；不是全站 KPI |
| country | 搜尋發生的國家，不是 query 中「詢問哪個國家」 | `topic_search_metrics.scope='country:XX'` 與由 query 解析的 `topic_demand_country` 必須分開解讀；[repo schema](../../db/schema-host.sql#L407-L458) |

本 repo 的 collector 明確抓 `[date,page,country]` 與 `[date,query,page]`，並將 query×page 聚合到 `gsc_query_metrics`；同一頁的平均排名以 `SUM(position_sum) / SUM(impressions)` 計算，這比直接平均各 row 正確。[collector](../../scripts/gsc-topic-metrics.mjs#L33-L37) [collector aggregation](../../scripts/gsc-topic-metrics.mjs#L134-L214) [query schema](../../db/schema-host.sql#L429-L442)

實務上應固定以下判讀規則：

- 「query rows 少於 total」通常是匿名化、top rows、表格上限或 query filter 的正常結果，不是 GSC 串接遺漏。Search Console 也明確說圖表總量可高於表格列總和。[About Search Console data](https://support.google.com/webmasters/answer/96568?hl=en)
- 不要把 query、page、query×page 各自的 impressions 相加。Search Analytics 的 chart／table 還可能使用 property 與 page 不同的 aggregation；API 回應的 `responseAggregationType` 應被視為口徑資訊。[Search Analytics performance report](https://support.google.com/webmasters/answer/7576553?hl=en-GB) [API aggregation](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)
- 最近 2–3 天沒有完整資料、數值後續變動，先視為 Search Console 的資料延遲／處理特性，再判斷是否真有資料管線問題。[About Search Console data](https://support.google.com/webmasters/answer/96568?hl=en)

## 2. Title、meta description 與 snippet：可控範圍

### 可以控制的部分

- 每頁應有簡潔、描述性、符合頁面語言／文字系統的 `<title>`；不要 keyword stuffing、重複 boilerplate 或讓品牌名遮蔽主題。[title links](https://developers.google.com/search/docs/appearance/title-link)
- `<meta name="description">` 是頁面的摘要提示，但 Google 主要仍可從頁面可見內容產生 snippet；description 應逐頁獨特，且真正描述該頁，而非整站通用口號。[snippets](https://developers.google.com/search/docs/appearance/snippet)
- Google 的 title link 可能參考 `<title>`、可見主標題／heading、頁面文字、`og:title`、anchor text、連結文字與 `WebSite` structured data；snippet 則可能隨 query 改變。因此能控制的是輸入訊號與內容一致性，不能保證 SERP 顯示原字串。[title sources](https://developers.google.com/search/docs/appearance/title-link) [snippet generation](https://developers.google.com/search/docs/appearance/snippet)

### 不應當成官方硬限制的部分

- Google 沒有為 `<title>` 或 meta description 設定固定最大字元數；title／snippet 會按可用寬度截斷，且 title link 可能被改寫。repo 的 `SEO_COPY.descVisible`、`compactDescription(..., max = 170)` 是本地文案／版面 heuristic，不是 GSC pass/fail 規則。[repo SEO copy](../../site/src/lib/seo.mjs#L60-L183) [title length](https://developers.google.com/search/docs/appearance/title-link) [snippet length](https://developers.google.com/search/docs/appearance/snippet)
- 改完不會立即反映；Google 需要重新抓取與處理，title link 文件說可能需數天至數週。[title links](https://developers.google.com/search/docs/appearance/title-link)

目前 BaseLayout 會輸出 title、description、absolute canonical、hreflang 與 JSON-LD，而 Topic route 另組合地方名稱／年份／suffix 的 `pageTitle` 與 `metaDescription`；可見 H1 仍是主題 title。[BaseLayout](../../site/src/layouts/BaseLayout.astro#L56-L73) [Topic metadata](../../site/src/pages/topic/%5Bslug%5D.astro#L363-L473) [Topic render](../../site/src/pages/topic/%5Bslug%5D.astro#L629-L666)

下一輪只讀檢視應以 query×page 找「曝光高、CTR 低」的群組，再逐頁核對 canonical landing URL、title、H1、首段、國家／年份承諾是否一致；不要先用字元數判定缺陷。[Search Analytics query opportunities](https://support.google.com/webmasters/answer/17011259?hl=en)

## 3. Sitemap、canonical 與內部連結

### Sitemap／`lastmod`

- Sitemap 應放想讓 Google 搜尋、且偏好的 canonical URL，使用 absolute URL；提交 sitemap 是 discovery hint，不保證下載、抓取、索引或排名。[Build and submit a sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) [How Search works](https://developers.google.com/search/docs/fundamentals/how-search-works)
- `<lastmod>` 只有在「持續準確、可驗證」時才有用，應代表頁面重大更新；主內容、structured data 或 links 變更通常算重大，CSS 或 copyright date 不算。Google 忽略 `<priority>` 與 `<changefreq>`。[sitemap lastmod](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap)
- repo 目前由 `sitemap.xml.ts` 產生 URL，再由 `sitemap-lastmod.mjs` 比對逐頁 HTML fingerprint，刻意排除 style／asset hash／Astro attribute 的雜訊，保留可見文字、links 與 JSON-LD；這與官方原則一致，但仍值得定期抽樣確認 fingerprint 沒漏掉重大 rendered change。[sitemap generator](../../site/src/pages/sitemap.xml.ts#L17-L150) [lastmod postbuild](../../site/scripts/sitemap-lastmod.mjs#L48-L125)
- 「每個可索引頁都必須有 `lastmod`」是 repo 的嚴格營運政策，不是 Google 的必要條件；缺少它可列 sitemap hygiene 項目，不能直接稱為 GSC coverage gap。[repo policy](../../CLAUDE.md#L406-L410)

### Canonical

Google 的訊號強度大致是 redirect 最強、`rel="canonical"` 次之、sitemap 較弱；訊號衝突時 Google 仍可能選不同的 canonical，且沒有 canonical preference 時也能自行選擇。[canonical signals](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)

因此應檢查「是否一致」而非只檢查「有沒有 tag」：absolute self-canonical、sitemap loc、內部 links、redirect 與 hreflang 是否指向同一組偏好 URL；不要用 robots.txt 做 canonicalization，也不要讓同一組 duplicate URL 發出互相衝突訊號。[canonical guidance](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)

目前 BaseLayout 輸出 absolute canonical，sitemap 也輸出 absolute loc；country Topic route 使用自身 URL 作 canonical。這代表實作有正確基礎，但仍應以 rendered HTML 與 URL Inspection 的 declared／Google-selected canonical 做抽樣驗證，不能只由 source code 推定 Google 已採用。[BaseLayout canonical](../../site/src/layouts/BaseLayout.astro#L68-L91) [country Topic](../../site/src/pages/topic/%5Bslug%5D%2F%5Bcountry%5D.astro#L1-L30)

### 內部連結／發現

Google 一般可靠地抓取 `<a href>`；anchor text 與周邊語境有助於理解連結頁。每個重要頁至少應有一個其他頁面的 crawlable 內部連結，但 Google 沒有公布「理想連結數」。[Crawlable links](https://developers.google.com/search/docs/crawling-indexing/links-crawlable)

repo 的 Topic、country、holiday、questions 頁已有多組靜態 `<a href>` 互鏈；但目前 release gate 主要驗 sitemap／HTML 元件，沒有明確驗證「sitemap 中每個 URL 的 inbound internal-link count」。[Topic links](../../site/src/pages/topic/%5Bslug%5D.astro#L891-L1068) [country links](../../site/src/pages/topic/%5Bslug%5D%2F%5Bcountry%5D.astro#L59-L265) [SEO gate](../../site/scripts/check-seo.mjs#L141-L177)

建議新增的是只讀 graph audit：按 locale 從 rendered HTML 計算 sitemap URL 的 inbound crawlable links，優先找零 inbound 的 holiday、country 與 ranking pages；這是可操作的發現改善候選，不等於已確認的 GSC 錯誤。

## 4. Structured data：發現與呈現的界線

Structured data 可幫助 Google 理解內容，並可能讓頁面符合某種 rich result eligibility；即使格式有效，也不保證 rich result、特殊外觀或排名。資料必須與頁面可見內容一致、完整、準確，且 JSON-LD／圖片等資源不能被 robots 或 noindex 阻擋。[Introduction to structured data](https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data) [structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)

對目前 repo 的重點：

- `BaseLayout` 已輸出 WebPage／CollectionPage、Breadcrumb、Organization／WebSite 等 graph；Topic 另輸出 DefinedTerm、FAQPage 與多個 Event。這些應按 Google 目前支援的 feature 與頁面拓撲逐類驗證，而不是把任意 schema.org 有效當成 Google rich-result 缺口。[BaseLayout JSON-LD](../../site/src/layouts/BaseLayout.astro#L101-L154) [Topic schemas](../../site/src/pages/topic/%5Bslug%5D.astro#L566-L607) [Search gallery](https://developers.google.com/search/docs/appearance/structured-data/search-gallery)
- FAQ：Google 官方更新已說 FAQ rich result 不再顯示；所以沒有 FAQ appearance、或 `FAQPage` 不再帶來 GSC rich-result，不應列為缺口。Topic 頁的 `FAQPage` 可另作語意／相容性決策，但不應再是 Google Search 的必要條件。[FAQ removal](https://developers.google.com/search/updates) [structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
- 不要機械改成 QAPage：官方 QAPage 要求一頁一個問題，且使用者可提交答案；目前 Topic 是多問題的編輯內容，另有 client-side DiscussionRoom，不符合直接套用 QAPage 的條件。[QAPage](https://developers.google.com/search/docs/appearance/structured-data/qapage) [DiscussionRoom implementation](../../site/src/components/DiscussionRoom.astro#L6-L17)
- Forum：若要支援 Discussion Forum rich result，`DiscussionForumPosting` 應描述真正的 user-generated post，且該 post／comments 全文要在頁面上可見；不能把 publisher-authored Topic shell 標成 UGC。現行 DiscussionRoom 以 client-side feed 載入，應先決定是否要建立可索引的 post／profile URL，再談 markup。[Discussion forum](https://developers.google.com/search/docs/appearance/structured-data/discussion-forum) [DiscussionRoom](../../site/src/components/DiscussionRoom.astro#L185-L213)
- Event：Google 的 Event rich result 以單一 event、獨立 leaf URL、公開且可參加的活動為前提。現行 Topic 將多個 event schema 掛在主題頁，應列為 eligibility review candidate，而非直接宣稱 schema 錯誤。[Event structured data](https://developers.google.com/search/docs/appearance/structured-data/event) [Topic event schema](../../site/src/pages/topic/%5Bslug%5D.astro#L566-L574)
- Breadcrumb：官方重點是反映使用者典型瀏覽路徑、至少兩個 `ListItem`；不是要求把完整 URL 每一段都塞進去。現行 graph 可檢查語意路徑是否合理，但 breadcrumb 缺少某個 URL segment 不應自動列為 GSC 缺口。[Breadcrumb](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb)

## 5. 明確不應誤列為 GSC 缺口

| 觀察 | 正確分類 |
| --- | --- |
| query table rows 的 impressions／clicks 小於 chart total | Search Console 匿名化、top rows、表格限制與聚合差異；不是資料遺失 |
| query、page、query×page 三份數字無法相加 | 不同 dimension／property-vs-page aggregation；不是 collector 必須修成相等 |
| GSC 與 GA4 sessions、users、bot 或 conversion 不一致 | 不同產品、定義與處理流程；不是 GSC coverage gap。[About data](https://support.google.com/webmasters/answer/96568?hl=en) |
| Google 顯示不同 title／snippet、description 被改寫、字數超過本地 heuristic | Google 的 algorithmic presentation；不是 HTML 欄位失效。[title links](https://developers.google.com/search/docs/appearance/title-link) [snippets](https://developers.google.com/search/docs/appearance/snippet) |
| valid structured data 沒有 rich result／FAQ appearance | Eligibility 不等於保證；FAQ rich result 目前已移除。[structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies) [updates](https://developers.google.com/search/updates) |
| `priority`／`changefreq` 不理想，或每一頁沒有 `lastmod` | 前者被 Google 忽略；後者是 sitemap hygiene／repo policy，不是必然 indexing error。[sitemap](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) |
| 沒有 IndexNow 或 IndexNow 失敗 | repo 已明確註記 Google 不使用 IndexNow；Google 端看 sitemap／links 等 discovery signals。[IndexNow note](../../scripts/indexnow.mjs#L3-L8) [How Search works](https://developers.google.com/search/docs/fundamentals/how-search-works) |
| OG／Twitter card、`fetchpriority`、cover 尺寸、preload、GA4 或 design gate 未通過 | 可是社群分享、效能、分析或 repo release 品質項目；Google 最低技術要求是 Googlebot 可存取、HTTP 200、頁面有可索引內容，不應全部叫作 GSC 缺口。[repo SEO gate](../../site/scripts/check-seo.mjs#L76-L177) [technical requirements](https://developers.google.com/search/docs/essentials/technical) |

## 6. 建議的下一輪只讀檢視順序

1. 先分開跑／讀 property total、page、query、query×page；保存日期窗、filters 與 aggregation type，絕不回加不同視圖。
2. 每個 locale 抽樣 rendered HTML + URL Inspection：indexability、declared／selected canonical、robots、title／H1／description 與 structured data。
3. 從 sitemap 建 inbound-link graph，找零 inbound 的重要 URL；再檢查 anchor text 是否說清楚目的地。
4. 只讀比對 sitemap `lastmod` 與 rendered main content、JSON-LD、links 的實際變更；找「全部同一天」或長期不更新的異常，但不以 `priority`／`changefreq` 排優先序。
5. 將 FAQ 從「Google rich-result 必要 gate」降級；分別評估 Event 是否有單一 leaf page、DiscussionForumPosting 是否有可索引 UGC post，最後才用 Rich Results Test／URL Inspection 驗證。[Rich Results Test guidance](https://developers.google.com/search/docs/appearance/structured-data/sd-policies)
6. 對曝光高／CTR 低的 query×page 做 title、H1、首段與搜尋意圖一致性修正，等待重新抓取後再觀察，不用一次性的 SERP snippet 當成唯一驗收結果。

## 來源索引

### Google 官方

[Search Analytics dimensions](https://support.google.com/webmasters/answer/17011259?hl=en) · [Search Analytics performance report](https://support.google.com/webmasters/answer/7576553?hl=en-GB) · [Search Analytics API](https://developers.google.com/webmaster-tools/v1/searchanalytics/query) · [About Search Console data](https://support.google.com/webmasters/answer/96568?hl=en) · [Title links](https://developers.google.com/search/docs/appearance/title-link) · [Snippets](https://developers.google.com/search/docs/appearance/snippet) · [Sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap) · [Canonicalization](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) · [Crawlable links](https://developers.google.com/search/docs/crawling-indexing/links-crawlable) · [How Search works](https://developers.google.com/search/docs/fundamentals/how-search-works) · [Technical requirements](https://developers.google.com/search/docs/essentials/technical) · [Structured-data policies](https://developers.google.com/search/docs/appearance/structured-data/sd-policies) · [Search gallery](https://developers.google.com/search/docs/appearance/structured-data/search-gallery) · [Discussion forum](https://developers.google.com/search/docs/appearance/structured-data/discussion-forum) · [QAPage](https://developers.google.com/search/docs/appearance/structured-data/qapage) · [Event](https://developers.google.com/search/docs/appearance/structured-data/event) · [Breadcrumb](https://developers.google.com/search/docs/appearance/structured-data/breadcrumb) · [Google Search updates](https://developers.google.com/search/updates)

### Repo 實作

[CLAUDE.md](../../CLAUDE.md) · [GSC collector](../../scripts/gsc-topic-metrics.mjs) · [GSC schema](../../db/schema-host.sql) · [BaseLayout](../../site/src/layouts/BaseLayout.astro) · [sitemap generator](../../site/src/pages/sitemap.xml.ts) · [sitemap lastmod postbuild](../../site/scripts/sitemap-lastmod.mjs) · [SEO release gate](../../site/scripts/check-seo.mjs) · [Topic page](../../site/src/pages/topic/%5Bslug%5D.astro) · [DiscussionRoom](../../site/src/components/DiscussionRoom.astro) · [IndexNow note](../../scripts/indexnow.mjs)
