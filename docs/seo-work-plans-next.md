# SEO／GSC 下一輪工作計劃

> 用途：`/clear` 後直接從這份文件接續執行。基準日：2026-09-03 UTC。
> 目前工作樹已有未提交修改；執行前不得 reset、restore 或覆蓋既有變更。除非使用者另行確認，本計劃不包含發布。

## 目前基準

- GSC 近 28 日：1,516 queries、5,256 impressions、6 clicks；17 個有效資料日；約 58% 查詢在 51 名以後。
- GA4 近 28 日：306 sessions；約 77% 被啟發式判為疑似污染；較可信的 real-ish 流量約 70。GA4 只作輔助，不取代 GSC。
- JP 首頁 `Crawled - currently not indexed`，但 robots、indexing allowed、sitemap 與 canonical 未見技術阻擋；先做品質／選擇訊號追蹤，不修改共用 SEO 程式。
- 目前 working tree 的內容批次：
  - 第一批跨語：`teachers-day` hi、`halloween` pt-BR、`womens-day` pt-BR、`ramadan-and-eid` zh-TW。
  - 第二批英文：`labour-day`、`minimum-wage`、`official-languages`，只改 `## locale en`。

## 固定執行規則

1. 先讀 `CLAUDE.md`、`docs/03-topic-content.md`、`docs/seo-current-state.md` 與本文件，再看 `git status --short`／`git diff`。
2. Topic 原始來源是 `content/topics/*.md`；修改後固定走：

   ```text
   content/topics/*.md
     → node scripts/import-topics.mjs
     → node scripts/export-data.mjs
     → LOCALE=<code> pnpm build（cwd=site）
   ```

3. 不直接手改 `data/topics/*`；export 產生的 hash／timestamp 變更要保留，排名、stamp 與動態 snapshot 雜訊不要混入內容批次。
4. 每輪最多 2–3 個 Topic，明確記錄「哪個 locale、哪個需求主題國、哪組 query、哪個假設」；不要把 GSC searcher-country 當成 query target country。
5. 不把本地 build、發布成功或少量曝光當成排名成效；必須等 Google 重爬後再比較。
6. 共用 route、資料模型或 UI 只有在有跨站證據時才改；單一語系內容優化只修改對應的 `## locale`。

## Plan 0：清理後重新接線與鎖定基準（P0）

### 目的

確認目前未提交內容沒有被遺失，並重新取得可比較的 GSC／GA4／重爬基準。

### 執行

```bash
git status --short
git diff -- content/topics docs/seo-current-state.md docs/seo-work-plans-next.md
node scripts/gsc-demand-country.mjs --report
node scripts/seo-health.mjs --no-inspect --days 28
node scripts/crawl-freshness.mjs --sample 20
```

若 URL Inspection 配額不足，保留錯誤輸出，不為了補樣本修改程式；改用已有直接 Inspection 結果，並把日期寫入 snapshot。

### 完成條件

- 確認 7 個 locale 的 locale／market／origin 對照沒有改變。
- 確認第二批英文三頁仍是未發布版本，沒有宣稱線上成效。
- 記下 GSC 最新資料日、目標頁是否已重爬，以及下一輪 query × page 比較窗。

## Plan 1：完成目前英文第二批並準備發布（P0）

### 目標頁

| locale | Topic | 目前證據 | 主要假設 |
|---|---|---:|---|
| en | `labour-day` | 74 imp、平均位置 63.5 | 日期型 title／首段能更準確承接 1 May 與 US September 查詢 |
| en | `minimum-wage/cn` | 35 imp、平均位置 79.5 | 直接使用 China minimum wage 查詢叫法能改善相關性 |
| en | `official-languages/cn` | 19 imp、平均位置 73.3 | 先回答 China official language 的法律差異能改善落地匹配 |

### 執行

1. 只檢查，不再擴大文案範圍：[labour-day.md](../content/topics/labour-day.md)、[minimum-wage.md](../content/topics/minimum-wage.md)、[official-languages.md](../content/topics/official-languages.md)。
2. 執行 import／export。
3. 執行三檔 targeted content gate、資料完整性、內容厚度與 `LOCALE=en pnpm build`。
4. 若使用者確認發布，再依既有 release 流程發布 en；發布後記錄 `.build-id`，不要只驗 HTTP 200。

### 完成條件

- `LOCALE=en pnpm build` 的 SEO／GEO／AEO、sitemap、hreflang、內鏈、rendered depth、local scope 全通過。
- 發布前工作樹 diff 只包含預期的內容、同步資料與紀錄。
- 不在重爬前再改這三頁。

## Plan 2：跨語系「需求主題國」內容批次（P1）

這是下一個最有機會帶來實際成長的方向：locale 不等於搜尋者查詢的國家，應在正確語系中補正確國家答案。

### Batch A：高量、高集中度

1. `zh-TW / ramadan-and-eid → Indonesia`：128/128 impressions。
2. `en / childrens-day → India`：64/71 impressions。

每頁補一個真正回答該國日期／規則／放假差異的 country answer block，並從 Topic root 用自然 anchor link 指向該國頁；不要把其他語系文字直譯過來。

### Batch B：中量、制度型

1. `en / teachers-day → China`：33/42 impressions。
2. `zh-TW / labour-day → United States`：51/51 impressions。
3. `zh-TW / national-days → Japan`：44/62 impressions。

`national-days` 先跑 targeted content gate；若遇到既有 zh-TW／zh-CN AI-style ERROR，只修受影響句子並保留事實與來源，不做整檔重寫。

### Batch C：跨站反向需求

1. `ja / long-holiday-weeks → Taiwan`：18/21 impressions。
2. `zh-TW / elders-day → Japan`：10/10 impressions。
3. `zh-TW / diwali → India`：14/14 impressions。

### 每個 Batch 的固定流程

1. 先用 `node scripts/gsc-demand-country.mjs --report` 確認需求主題國仍成立。
2. 查現有 country block、官方來源、日期與當地叫法；沒有來源就先補來源，不先寫文案。
3. 只改該 locale；title／summary／keywords 只承接已出現的 query，正文則補具體 country answer、H2 與 1–2 個相關內鏈。
4. 跑 `import-topics`、`export-data`、內容 gate、完整性、厚度與受影響 locale build。
5. 每批完成後記錄變更假設；等待重爬，下一批不得同時修改同一頁。

## Plan 3：把需求主題國做成內鏈路徑（P1）

### 目的

讓 Google 與讀者從 Topic root 能直接走到最常被搜尋的國家答案，而不是只靠 country page 自己取得曝光。

### 執行

- 對每個高集中度 `(locale, Topic, country)`，確保 Topic root 有一個上下文相關的 country link。
- 讓至少一個同語系、同主題鄰近 Topic 也能自然連到該國頁；anchor 使用當地實際叫法，避免重複堆砌 exact-match。
- 先用現有 Astro route 與 Markdown 內容完成，不新增共用 UI。
- 只有發現多個 locale 都缺同一種入口時，才提出共用元件或 route 改動。

### 完成條件

- 受影響 locale build 通過。
- `node scripts/check-internal-links.mjs --dist site/dist --gate` 通過。
- 高優先 country page 不再是只靠 sitemap 才能抵達的孤島；沒有新增 orphan／single-inbound 頁面。

## Plan 4：JP 首頁索引品質專案（P1，獨立於英文）

### 先做診斷

```bash
(cd site && LOCALE=ja pnpm build)
rg -n "<title>|canonical|hreflang|Topic|topic/" site/dist/index.html
node scripts/seo-health.mjs --days 28
```

對照 jp、en、zh-TW 首頁的：可見日文文字量、首屏價值主張、Topic 入口、內鏈數量、canonical 與 sitemap 狀態。

### 只有確認品質缺口後才做

- 補獨立、自然的日文首頁導言與主要 Topic 入口。
- 優先連到有日文需求或日本相關需求主題國的 Topic，不用把英文頁面機械翻成日文。
- 檢查日文 title／description 是否真的表達「跨國制度比較」價值。

### 停止線

若 robots、canonical、sitemap、rendered depth 與 local scope 都正常，就不改共用程式、不批量重寫日文 Topic；發布後再重新做 URL Inspection。

## Plan 5：發布後實驗與決策（P0，所有內容批次共用）

### 時間窗

- 發布當天：記錄 `.build-id`、sitemap URL 數、變更頁清單。
- 7 天：只確認是否開始有 crawl／impression，不改同一批頁面。
- 14–28 天：用固定 query × page 做前後比較；GSC 延遲時標明資料截止日。

### 判讀規則

- position 10–20 且有曝光、clicks 低：先測 title／snippet 承諾與答案是否一致。
- position 20–70：優先補首段、H2、country answer 與內鏈。
- position 51+ 且曝光很少：先查需求、索引、來源與內容對題性，不再只改 title。
- 已有 clicks 或 position 上升：保留版本，避免為了增加變更而反覆重寫。

### 交付紀錄

每批在 [seo-current-state.md](seo-current-state.md) 記下：變更日期、目標 query、需求主題國、發布 build-id、重爬狀態、前後數據與下一步；沒有重爬就不寫「排名改善」。

## Plan 6：GA4 污染隔離（P2）

### 目的

讓 GA4 能回答「較可信流量是否閱讀內容」，但不讓疑似 bot 的 Direct 流量干擾 SEO 決策。

### 執行

- 保留 raw sessions 與 real-ish sessions 兩套數字，不合併成一個漂亮但不可解釋的 KPI。
- 報表固定切 `hostname`、locale、source／medium、landing page、engaged session 與 engagement time。
- 若要進一步處理，先查 server／CDN access log 的 user-agent、頻率與路徑，再決定是否要改追蹤或過濾；不要先改前端事件。

### 完成條件

- GSC 報告與 GA4 行為報告分開呈現。
- 任何「真人流量」字樣都標明是 heuristic，不宣稱已完成 bot 識別。

## 建議的實際順序

```text
Plan 0 重新接線與基準
  ↓
Plan 1 完成／發布目前 en 第二批（需使用者確認發布）
  ↓ 等 Google 重爬，不改同一批頁面
Plan 2 Batch A：Ramadan→Indonesia、Children’s Day→India
  ↓
Plan 3 同批 country answer 的內鏈路徑
  ↓
Plan 2 Batch B：Teachers’ Day→China、Labour Day→US、National Days→Japan
  ↓
Plan 4 JP 首頁獨立品質檢查
  ↓
Plan 5 14–28 日實驗判讀
  ↓
Plan 2 Batch C 與 Plan 6（依數據再決定）
```

## 最終驗收指令

單一 locale 內容批次：

```bash
node scripts/import-topics.mjs
node scripts/export-data.mjs
node scripts/check-data-completeness.mjs
node scripts/check-content-depth.mjs
(cd site && LOCALE=<code> pnpm build)
git diff --check
```

若改到共用程式、資料模型、UI 或 route，改跑七站：

```bash
cd site && for L in zh-TW en ja zh-CN hi id pt-BR; do LOCALE=$L pnpm build || break; done
```
