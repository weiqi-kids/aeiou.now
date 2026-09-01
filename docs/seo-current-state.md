# SEO／多站工作現況

> 這是可更新的工作交接快照，不是即時監控面板。最後量測：2026-09-01 UTC；最後發布驗證：commit `8369a10`。
> 開始 GSC、GA4、SEO 或多站內容任務時先讀這份；只有快照過期、共用程式改動，或使用者明確要求重新量測，才重跑完整診斷。

## 先記住的結論

- 這不是「一份內容翻成七種語言」的單一網站，而是**一份碼庫、七次 build、七個獨立發布站**。共用程式與資料模型，搜尋成效、發布版本、GSC 觀測則按站分開。
- `en` 先做一輪是合理的市場實驗，但 en-only 文案不應自動同步到其他語系；確認搜尋意圖後，再按各站的查詢與當地叫法另寫。
- 本輪改動已 commit、push 並完成七站發布；**GSC 尚未必看得到新標題，因為仍要等 Google 重爬**。目前不要把發布成功誤當成排名成效。

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

## GSC／GA4 快照與解讀邊界

以下數字是 2026-09-01 的診斷快照，不能當成今天的即時值；GSC 最新資料約落後 2–3 天，且 page/query 維度不可直接相加。

| 觀測 | 快照 | 解讀 |
|---|---|---|
| GSC query 近 28 日（全站診斷層） | 843 queries、2,251 impressions、4 clicks；最新資料至 2026-08-29；15 個有效資料日 | 樣本仍小，不能用單日或單批 title 改動宣稱因果。 |
| en page 維度 | 1,505 impressions、2 clicks、平均位置 61.1 | en 是曝光最大但排名最弱的站，先做市場實驗。 |
| sitemap／URL Inspection | 7 份 sitemap，0 errors／warnings；抽查 6 URLs 均 Submitted and indexed | 基本提交與索引鏈路正常。 |
| GA4 | 271 sessions；227 筆疑似 bot，約 84%；較可信的 real-ish 流量約 44 | 不用 GA4 直接替代 GSC 來做搜尋排名或 HotScore 判斷。 |
| Google 重爬 freshness | 20-url 分層樣本，19 筆 crawl history；8 筆在 8/26 後重爬，約 40%；12 筆仍 stale | 批量文案實驗要等重爬；明顯的資料一致性 bug 可以先修。 |

### en query × page 的第一批證據

這些是用來選擇本輪修改對象的低量訊號，不是成效結論：

- `2027 teachers day date` → `/topic/teachers-day/`：6 imp、position 10.7。
- `when does school start in taiwan` → `/topic/back-to-school/tw/`：約 position 11。
- `china maternity leave`／`maternity leave in china`／`parental leave china` → `/topic/parental-leave/cn/`：各 2 imp，position 約 54–57。
- `when are college entrance exams in japan` → `/topic/exam-season/jp/`：2 imp，position 70。
- `diwali holidays` → `/topic/diwali/`：3 imp，position 73.3。

重點不是看到少量曝光就大改全部頁面，而是讓 title 與頁面真正回答已出現的查詢；等重爬和更多資料後再決定第二批。

## 驗證狀態

- CI run `33465126454` 成功：測試、來源連結檢查與七站 build／deploy 全部通過。
- 七個正式網域的 `.build-id` 全部是 `8369a10`，代表線上版本已與本次發布一致。
- 最新 en build 通過：571 pages、563 sitemap URLs、SEO／GEO／AEO gate 通過、內鏈 gate 通過。
- 線上 en 四個目標頁已呈現新 title；en sitemap 有 563 個 `<loc>` 與 563 個 `<lastmod>`。
- 最新測試通過：5 個 test files、0 failures。
- `git diff --check` 通過。
- 最新七語 build 全部通過；各站的 SEO／GEO／AEO、sitemap、hreflang、內鏈、渲染厚度與本地範圍守門均通過。

## 下一步，不要重做整套分析

### 若繼續 en-only 優化

1. 先等這批已發布頁面被 Google 重爬；在此之前只修明顯錯誤，不再批量換文案。
2. 重爬後只看本檔的 en 證據與待測 query，檢查四個新 title 對應的 query/page impressions、clicks、position。
3. 確認需要第二批後，才編輯 `content/topics/<slug>.md` 的 `## locale en`，再跑 import／export、build、tests 與七站 release。

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
