# 待辦(2026-08-11 M1 收尾時整理;完成一項劃掉一項)

> 現況不要信本檔——逐項用附的指令查,查完再動手。

## 部署與基礎

- [x] **主機 checkout 一定要停在 main**(2026-08-19 事故):`hourly-export.sh` 刻意
  「推目前所在分支」,所以 checkout 留在哪條分支,每小時的 data 匯出就推到哪。2026-08-16
  PR #5 squash-merge 後功能分支沒收掉、checkout 也沒切回來,27 次匯出全堆在分支上,
  線上資料靜默停更三天 —— 而 CI 全綠、七站 `.build-id` 也與 main 相符,**既有查法完全看不出來**。
  查:`git -C /root/aeiou.now rev-parse --abbrev-ref HEAD` 應為 `main`。
- [x] **「資料新鮮度」查法已補進 CLAUDE.md**(2026-08-19):`git log -1 --format=%cr -- data/`。原問題:目前所有查法都只驗「站台是不是 main 的最新版」,
  驗不到「main 的資料是不是最近匯出的」。建議加一條比對 `data/` 最後 commit 時間與現在的差距。

- [x] **`id` 站(印尼)線上還是舊版**——2026-08-14 實測 `.build-id` 已與 HEAD 一致,GitHub 端建置恢復。
- [x] **M1 完成定義 #3 的七站全綠重驗**——2026-08-14 依「七站分別是哪一版」查法實測,七站 `.build-id` 全部等於 HEAD。
- [x] **`weiqi-kids` 組織的 deploy key 開關維持開啟**(2026-08-20 用戶拍板)。
  2026-08-11 為了 aeiou 的七個 publish repo 打開,這是組織層開關、影響整個組織。
  當時是我自己開的、沒問過,所以掛在這裡等確認——**確認結果是維持**,理由:
  關掉會直接打斷七站部署(deploy key 是 SSH 機制,CI 推 publish repo 只走這條),
  改用 GitHub App 或 PAT 反而是更多長期祕密要管;而實際暴露面可以逐一數出來、不會默默長大。
  審計查法(要看的是「誰真的掛了鑰匙」,不是那個布林值):
  ```bash
  gh api /orgs/weiqi-kids --jq .deploy_keys_enabled_for_repositories   # 開關本身
  for r in $(gh repo list weiqi-kids --limit 200 --json name --jq '.[].name'); do \
    n=$(gh api "repos/weiqi-kids/$r/keys" --jq 'length' 2>/dev/null || echo '?'); \
    [ "$n" != "0" ] && [ "$n" != "?" ] && echo "$r : $n"; done
  ```
  發現 aeiou-pages-* 以外的 repo 掛了 deploy key,那才是要查的事。
- [x] **組織不強制兩階段驗證**(2026-08-20 用戶拍板:不開)。**這是決定,不是待辦,別再提案。**
      當時查齊的事實:成員只有 `LightChang` 1 位且已啟用 2FA;外部協作者 2 位
      (`a23222229-dev`、`vegeta1260-ai`)**都未啟用**,開啟強制會直接切掉他們的存取權。
      現況查法(要看的是「誰真的沒開」,不是那個布林值):
      `gh api '/orgs/weiqi-kids/outside_collaborators?filter=2fa_disabled' --jq '.[].login'`;
      開關本身 `gh api /orgs/weiqi-kids --jq .two_factor_requirement_enabled`。
      順帶完成的 deploy key 審計:掛 key 的只有 7 個 `aeiou-pages-*`、各 1 把,沒有意外的 repo
      (判準見本檔上方那條:`aeiou-pages-*` 以外的 repo 掛了 key 才是要查的事)。

## 新增 Topic(2026-08-20 起 cover 已自動化)

三個 Topic 已上線:`womens-day`、`exam-season`、`islamic-calendar-days`。
封面用 `node scripts/generate-topic-cover.mjs --slug <slug> --prompt "…"` 產(走 codex 的
image_gen,不需要 API key)。四要件與紅線見 `docs/03-topic-content.md`。

- [ ] **持續工作:再多加 Topic**。GSC 顯示會贏的查詢形態是「用語言 L 問國家 C 的節日 T」,
      Topic 數就是這個乘法的上限。挑題判準:**同一件事在七個市場的日期或制度差異夠大**,
      而且每一國都能找到該國官方網域的來源(R6)。
      反例:購物節(雙十一/Black Friday/Harbolnas)搜尋量高但沒有政府公告,R6 過不了,不要做。

## 這一輪的收尾(2026-08-20)

- [x] **HotScore 兩半都接上了**。`compute-topic-scores.mjs` 七項全實作,串進
      `hourly-export.sh`(不 fail-closed:算不出分數只是熱度不新鮮,不值得停整條管線)。
      結果:排行榜六窗從 thin 恢復索引(可索引頁 39→45)、首頁五個級距全部出現。
      現況查法:`node scripts/compute-topic-scores.mjs --dry-run`(看分佈)、
      `--explain <slug>`(看單一 Topic 的分項)。
- [x] **`/questions/` 的內部連結補上了**(1/53 → 53/53,頁尾)。
      根因是內鏈幾乎為零,不是 description(那個也修了,但不是全部)。
      **是否真的進索引要等 Google 重爬**,複驗:
      `node -e "const {inspectUrl}=await import('/root/seo-ops/lib/google.mjs');
      console.log((await inspectUrl('/root/.config/aeiou/ga4-sa.json','sc-domain:aeiou.now',
      'https://aeiou.now/questions/')).inspectionResult.indexStatusResult.coverageState)"`
- [ ] **印尼 SNPMB 官網 TLS 憑證仍過期**(外部,我們改不了):
      `snpmb.bppp.kemdikbud.go.id` 回 certificate has expired。
      `exam-season` 的 ID 來源暫用 `portalbpsdm.jambiprov.go.id`(`.go.id` 省級政府,
      明載「Berdasarkan jadwal resmi dari SNPMB」)。查:`curl -sI https://snpmb.bppp.kemdikbud.go.id/`,
      修好了就把來源換回官方站。

## 搜尋意圖重新對準(2026-08-21 完成;起因是「距離 20,000 瀏覽人數還有多遠」)

診斷:把 GSC 的查詢按意圖分兩類後,**站上唯一有優勢的那一類排最差**——

| 意圖 | 查詢數 | 曝光 | 點擊 | 平均名次 |
|---|---|---|---|---|
| 日期/名稱型(沒有優勢,而且是 Google 答案框的標準品) | 44 | 85 | 0 | 32.7 |
| 跨國/制度/解釋型(七國制度比較 = 唯一資產) | 19 | 25 | 0 | **67.6** |

真人流量的量測基準:GA4 全期 sessions 裡 96% 是機器,可當真人看的只有 Organic Search 那幾筆。
現況一律重查:`node scripts/seo-health.mjs`(① 量測層 ③ 排名層)。

- [x] **title 後綴改成跨國比較**(`SEO_COPY.compareSuffix`,七語各自的句子,`{count}` 由資料填)。
- [x] **description 第一句改成本市場那一國的制度答案**,日期壓到句末。
      與 `check-local-scope.mjs` 的 `assertHomeCountryFirst` 不衝突,是合流:
      讀者要的正是他自己國家的答案。敘述本來就以國名開頭時不再加一次前綴。
- [x] **🌎 底下每一國的 h3 改成問句**(`topic.q_how_country` / `topic.q_country_has`)。
      同一國有兩筆時把當地叫法接在問句後面(**同一個文字節點**,否則 D3 重複段落守門會擋);
      🔴 不要拿 local_name 當問句主詞——試過,pt-BR 站會印出
      「Japão: como vivenciam バレンタインデー?」,讀者看不懂的字進了主詞位置。
- [x] **FAQPage 結構化資料補逐國問答**,問題字串就是頁面上那個 h3(Google 要求 FAQ 內容可見)。
- [ ] 效果觀測:等 GSC 累積後重跑 `node scripts/seo-health.mjs`,看跨國/制度型那一類的平均名次
      有沒有從 67.6 往前走。**這一項不是「再等等看」**——要看的是名次分布的變化,不是時間。

## Ask the World 上線(2026-08-21;草案 §45)

`posts.target_country` 從 M1 就在 schema 裡,但 **feed 不回它、前端也沒有地方填** ——
寫得進去、讀不出來,等於這個功能對讀者不存在。

- [x] Worker:feed 的 SELECT 與回應物件補 `target_country`;發文回應同構補上。
- [x] Worker:`target_country` 加格式驗證(ISO 3166-1 alpha-2 大寫兩碼,否則 400)。
      這個值會進 DB 也會回給所有讀者,不接受自由字串。加驗前 D1 實查全為 NULL,不影響既有資料。
- [x] 前端:發文框內加國家選單(**不另開 `#ask` 區塊**,版面硬性規定沒有它);
      名單 = 該 Topic 實際涵蓋的國家;貼文列表上標「問{country}」。
- [x] 測試:`tests/api/worker.test.mjs` 的「Ask the World:target_country」一組(7 個)。
- [x] **冷啟動第一批題已上線**(2026-08-21 用戶核准)。題庫 `content/ask-the-world.json`
      (人工編輯的唯一入口),上線 `node scripts/seed-ask-the-world.mjs`(冪等,裸執行即正確)。
      走 D1 直寫而不是打 `/v1/posts`,理由有兩個且都實測過:① Worker 的 `country_code` 取自
      `request.cf`,主機在日本,經 API 發文會把站方的題標成「來自日本」;② 入口限流 3 篇/5 分鐘
      會擋住整批(那道限流是對的,不該為種子資料放寬)。`translation_status='pending'`,
      走與真人貼文同一條翻譯路,不特例。
- [ ] 🔴 **種子題會在 8 小時後從討論室淡出** —— 契約 §1 的 feed 只回 `created_at >= now-8h`。
      重跑腳本會補一則新的(冪等判準就是「這一題現在有沒有活著的副本」),但**要有人或 cron 去跑**。
      三條路,都要用戶決定:
        (a) 把 `seed-ask-the-world.mjs` 掛上 cron(改 cron 檔屬 C 級,先問);
        (b) 改 feed 的時間窗(契約變更);
        (c) 就讓它淡出,等真人貼文接手。
      查現在還有幾題在線:`node scripts/seed-ask-the-world.mjs --dry-run`(「已在線 N 題」那一行)。

## 「快速回答」改表 + 兩個單語外洩(2026-08-21)

用戶指正:`#answers` 的兩個 `<dd>` 用「；」把六七個國家串成一行純文字,
而且沒有 observance 的國家(日本)在第二格尾巴變成沒有下文的孤兒詞。

- [x] 兩張卡改成一國一列的 `<table>`:`caption` =「各地怎麼過?」、欄位 = 國家 | 什麼時候?,
      國名連到 🌎 對應段落的錨點;窄螢幕堆疊(`data-label`),≥768px 才是真表格。
      同一國有兩筆(womens-day 的印度、齋戒月的印尼)在國名後接當地叫法區分。
- [x] `date_rule` **從畫面上整個移除**(表格與 🌎 的 `.country-rule` 都拿掉)。
      理由:它在資料裡是單一字串、**83 筆 100% 中文**,沒有 per-locale 版本,
      於是 en/ja/hi/id/pt-BR 五個站長期在畫面上漏中文
      (`5 月第一個完整星期，地方學區日期可能不同` 出現在 en.aeiou.now 的 🌎)。
- [x] `local_name` 裡的中文註解清掉 13 筆(`Diwali（紐約市公立學校假日）`→`Diwali` 等)。
      每一條註解的內容在**逐國散文**裡都有(散文是 per-locale 的,會翻譯),所以沒有掉資訊,
      掉的是重複。`content-depth-baseline.json` 因此下修並重鎖(那是去重,不是退步)。
      查法:`node -e` 掃 `data/topics/*/facts.json`,非 CJK 國家的 `local_name` 不得含漢字。
- [x] **`date_rule` 七語化完成**(2026-08-21 用戶核准),「日期怎麼定」那一欄已加回表格。
      `topic_observance_i18n` 多一欄 `date_rule_text`(可為 NULL;固定日期的 observance
      本來就沒有規則可講);md 側是 `### date_rule <CC> <key>`,**zh-TW 不寫**——
      `- date_rule:` 那一行就是中文原文,再抄一次只會製造兩份會漂移的同一句話。
      匯入會擋缺譯;補譯用 `node scripts/translate-date-rules.mjs`(冪等,只補缺的)。
      既有主機庫的欄位由 `import-topics.mjs` 自我修補(`PRAGMA table_info` + `ALTER`),
      不需要有人記得先跑 migration。
      前端一律走 `dateRuleText(i18n, observance)`,**不得再讀 `observance.date_rule`**。

## Ask the World 保鮮(2026-08-21)

- [x] `25 */4 * * *` 掛上 `seed-ask-the-world.mjs`(用戶核准的 C 級改動)。
      4 小時配 8 小時時間窗:淡出當下的下一輪就接上,空窗趨近於零。
- [x] 腳本改成**原地刷新**而不是補新的:一題一列,淡出時把 `created_at` 推到現在。
      第一版「淡出就補一則新的」會每天多出十幾列一樣的貼文,而且每一列都是
      `translation_status='pending'`,等於每天再花數十次 claude 呼叫翻同一段話。
      被留言或 reaction 碰過的那一列**不再刷新**——它已經是一串有歷史的討論。
- [x] 接上 `jobs` 表(`job_name='ask-the-world-seed'`),否則 cron 檔尾那條維護查詢看不到它。
      查:`sqlite3 db/aeiou.sqlite "SELECT * FROM jobs WHERE job_name='ask-the-world-seed' ORDER BY rowid DESC LIMIT 5"`

## 改版效果為什麼還量不到(2026-08-21 查證;訊號面已修)

被問「一天過去有沒有改善」時查到的三件事實,**都不是時間問題**:

1. **Google 最後爬取是 08-15/16,改版是 08-21 上線** —— 它還沒看過新標題。
   查法:`inspectUrl` 的 `lastCrawlTime`(見 seo-health.mjs ② 那段的用法)。
2. **GSC 資料固定落後 2–3 天**,查的當下最新只到 08-19,那是改版前兩天。
   拿當下的 GSC 數字比較改版效果沒有意義;要等資料窗推進到 08-21 之後。
3. 12 個可索引頁**完全沒有 lastmod**,而 Topic 頁的 lastmod 只反映資料、不反映模板。

- [x] **每一個可索引頁都給 lastmod**(2026-08-21 用戶拍板)。時間戳集中在
      `data/meta/stamps.json`,由 `export-data.mjs` 以「hash 沒變就沿用舊時間戳」寫入:
      首頁與三個清單頁取 `topics_latest`、問答頁取 `questions`、
      六個排行榜頁各取自己的 `ranking:<window>`、關於頁只取 `render`。
      查法:`curl -s https://aeiou.now/sitemap.xml | grep -c '<lastmod>'` 應等於 `grep -c '<loc>'`。
- [x] **模板改動也算進 lastmod**:每頁取 `max(自己的內容時間戳, render 時間戳)`,
      `render` = `site/src` 的指紋(**排除 `site/src/data`** 這個資料鏡像,
      不然每小時資料一變就等於宣告模板變了 = 狼來了)。
      驗過:連跑三次 export 不會動時間戳(第三次 0 次寫入);在 `site/src` 動一個檔就推新。
      ⚠ 時間差:模板改動要等下一輪 hourly-export 才會反映到 stamps.json。
      CI 若搶在那之前 build,sitemap 會沿用上一個 render 時間戳(最多晚一小時),
      下一輪 hourly 提交 stamps.json 會再觸發一次 CI,自己收斂。
- [ ] 效果觀測:等 GSC 資料窗推進到 08-22 之後再看跨國/制度型查詢的平均名次
      (改版前是 67.6)。**在那之前不要拿數字說改善或沒改善。**

## 部署與封面(2026-08-21 用戶核准三項)

- [x] **CI deploy 加重試**:`clone` 與 `push` 各重試 3 次(10s / 20s 遞增)。
      當天實測同一次推送裡 `ssh: connect to host github.com port 22: Connection refused`
      連中兩次,七個語系是七個獨立 job、不是原子的,站台停在「六站新版、主站舊版」——
      不同語系跑不同的碼,比整輪失敗更糟。clone/push 都是冪等的(publish repo 只有這個 job 寫)。
      ⚠ `retry()` 的區域變數一律帶 `_retry_` 前綴:bash 的 `local` 是動態作用域,
      被呼叫的函式會看到它們;用 `n` 這種通用名會互相踩(寫的時候實測踩到)。
- [x] **封面壓縮**:33 張封面裡有 3 張是 1.7–1.8 MB(exam-season、islamic-calendar-days、
      womens-day),而 Topic 頁的封面是 `loading="eager" fetchpriority="high"` —— 它就是那頁的
      LCP 圖。連同 about.png 共四張壓過:1712→422 KB 等,縮 76–79%,逐張看過沒有色帶。
      現在 41 張全部落在 266–461 KB。
- [x] **壓縮進管線**:`generate-topic-cover.mjs` 產完就跑 pngquant(65–90)。
      「裸執行就必須是正確且完整的行為」—— 出圖出來就該跟兄弟一致,不靠有人記得補一刀。
      壓不小就用原檔;pngquant 不在只印警告不當錯誤。
- [ ] 觀測:那三頁的 LCP 有沒有改善。手上沒有 RUM,要量得用 PageSpeed Insights 之類的外部工具。

## 外站的 bot 封鎖不再擋下整條 hourly(2026-08-21 用戶拍板,已解)

2026-08-21 03:00 的 hourly-export 被
`https://www.jakarta.go.id/siaran-pers/6855-SP-HMS-07-2026` 的 HTTP 404 停掉整條管線。
複驗發現**那個網域連根目錄都回 403**——不是那一頁沒了,是主機被 WAF 擋
(同一天用腳本的 UA 再打反而是 200,狀態碼本身就在騙人)。
與 2026-08-20 `bndigital.bn.gov.br`(主機 403、Actions 404)同一個模式。

- [x] `update-local-data.mjs` 的失敗分類從兩類變三類,新增**封鎖層**:
      4xx 時先打該網域根目錄再判 —— 根目錄通 → 照舊 fail(內容真的沒了);
      根目錄也連不上 → 只 WARN、**永不擋輸出**,也不計入傳輸層的容忍計數
      (等再久都不會變,擋下去只是懲罰七個站)。
      ⚠ 判準是**根目錄通不通**,不是狀態碼幾號。
- [x] 兩個分支都用本地伺服器實跑驗過:根目錄 200 + 頁面 404 → fail、擋下輸出;
      根目錄 403 + 頁面 404 → WARN + 放行。
- [x] 健康檔加修剪:已不在來源目錄裡的 URL 會被清掉(封鎖層的條目不會因為下一輪成功
      而自動消失,更需要這道)。
- [x] **再加一層「不可信」**(2026-08-21 用戶核准):4xx 且**這個 URL 24 小時內驗過 OK**
      → 降為傳輸層,走「連續 3 輪才擋」。實測 jakarta 那個來源同一分鐘內 8 次請求
      得到 4 次 200、3 次 404,三次重試全落空的機率仍有約 12.5% = 每天還會停 3 次。
      **代價講清楚**:真的被撤掉的來源從「立刻擋下」變成「約 3 小時後擋下」。
      判準用「24 小時內」而不是「上一輪」——中間有輪次被擋掉時,「上一輪」會誤判成
      「從來沒驗過」而立刻擋。健康檔的 `ok_at` 在降級與封鎖的分支都要保留,
      不留的話第一次降級就把證據弄丟,第二輪等於這一層沒做。
      三條路徑都實跑驗過:驗過 OK → 1/3、2/3 放行、第 3 輪擋下;從沒驗過 OK → 立刻擋。
- [ ] 被擋的來源等於**本輪沒被核對過**。要確認是不是真的失效,得從別的網路打一次
      (GitHub Actions 就是現成的第二個出口)。要不要做成自動複驗尚未決定。

## 🔴 國碼有兩套並存(2026-08-21 發現,未解,要用戶決定)

`topic_scores.scope` 同時存在 `country:TW` 與 `country:TWN`,指同一個國家。來源:

| 來源 | 欄位 | 編碼 | 出處 |
|---|---|---|---|
| GSC 每日曝光 | `topic_search_metrics.scope` | **ISO-3**(`TWN`/`JPN`/`BRA`) | Google 給的就是 ISO-3(`gsc-topic-metrics.mjs`) |
| UGC 貼文 | `posts.country_code` | **ISO-2**(`TW`/`JP`/`BR`) | Cloudflare `request.cf.country`(契約 §0) |

`compute-topic-scores.mjs` 兩邊都直接 `country:${代碼}` 串進 scope,於是同一國被切成兩個。
這是既存設計,2026-08-21 之前沒被看見只是因為主機上的貼文太少;
放了 Ask the World 種子題(`country_code='TW'`)之後 `data/rankings/TW/` 就冒出來了,
與旁邊的 `TWN/` 並排。

**現在不影響讀者**:站上只讀 `rankings/global/<window>.json`,
country scope 有輸出但沒有任何頁面吃它(查:`grep -rn "rankings/" site/src/lib/ranking.mjs`)。

要決定的是**哪一套當標準**,兩個方向都要動資料與腳本:
- 站在產品這邊 → ISO-2(observance 的 `country_code`、`target_country`、`countryFlag()` 都是 ISO-2),
  那就要在 `gsc-topic-metrics.mjs` 把 ISO-3 轉成 ISO-2,並把既有的 `topic_search_metrics` 轉一次
  (目前只有幾天資料,轉起來便宜)。
- 站在既有資料量這邊 → ISO-3(現在絕大多數 scope 是 ISO-3),那就在 `compute-topic-scores.mjs`
  把 posts 的 ISO-2 轉成 ISO-3。
兩個方向都需要一份完整的 alpha-2 ↔ alpha-3 對照(Node 沒有內建),**只做七個市場的部分對照不行**
——貼文可能來自任何國家,漏掉的會靜靜地變成第三套代碼。
**屬資料模型決定(`docs/02-data-model.md`),動工前問用戶。**

## 搜尋數據(2026-08-20 開工)

### 已完成(2026-08-20)

- [x] **`gsc-topic-metrics` 每日 cron 已排**(用戶 2026-08-20 同意)。`40 4 * * *`,
      時刻避開整點 hourly-export、*/15 cron-15min 與 Actions 的 17 分。
      已用 cron 的實際環境(空 env、cwd=/root、cron 的 PATH)實跑驗過。
      查:`grep gsc-topic-metrics /etc/cron.d/aeiou`;累積狀況查 CLAUDE.md 那一列。
- [x] **HotScore 瀏覽面改接 GSC,不接 GA4**。GA4 汙染比例查法:`node scripts/seo-health.mjs` ①。
- [x] **`topic_search_metrics` 表 + 累積腳本**,已回補 GSC 全部保留期。
      現況查法見 CLAUDE.md「搜尋曝光累積了幾天」那一列。
- [x] **`/questions/` 的 description 不再等於 title**——七站唯一沒進索引的一頁。
      進索引與否要過幾天才看得出來,查法:seo-health ② 層的 URL Inspection。
- [x] **`claude -p` 一律 pin `--model`**(原本吃 CLI 預設 = Opus 5 1M)。
- [x] **Topic 頁國別錨點改可讀**(`#observance-id-ramadan`)。
- [x] **CI build-id 輪詢 5 → 10 分鐘**(假紅:發布較慢被判失敗,但七站其實都上線了)。
- [x] **兩個會說謊的指標修掉**:`regional_notes=0` 不再誤報成國別缺口;
      seo-health ③ 的排名佔比一定要跟樣本量一起印。緣由見該次 commit。

### 不要再做的事(2026-08-20 查證後撤銷)

- ~~補那 7 個 `regional_notes=0` 的 Topic~~ —— **不是缺口**。它們七國都有 observance,
  而 regional_notes 只在該國沒有 observance 時才渲染,補了也不會上畫面。
- ~~把 Topic 名稱加進每個國別小標~~ —— 年份與日期**本來就在同一個 `<li>` 裡**
  (`.country-when` 印的是「2027年2月8日」,含年份)。再把 Topic 名稱重複七次是關鍵字堆砌。

## 內容厚度補資料(2026-08-20 開工;缺口用指令查,不要信本節數字)

GA/GSC 診斷的結論是「頁面撐不起排名」。閘門已上線,補資料是持續工作。

```bash
node scripts/check-content-depth.mjs --report   # 缺口清單(排序=最該先補的在最上面)
node scripts/check-content-depth.mjs            # 閘門;存量以 baseline 凍住只能升不能降
node scripts/seo-health.mjs                     # 量測/索引/排名/內容四層分開診斷
node scripts/check-source-urls.mjs              # 來源連結存活(404/410、或 redirect 落在錯誤頁才擋)
```

- [x] **全部 Topic 補到目標水位(2026-08-20)**。目標=每語系 1,200 唯一字元、5 個地方變體
  (對照基準:2026-08-19 實測 folk.tw 主力內容頁渲染後去重 1,600–2,930 字元)。
  現況查法:`node scripts/check-content-depth.mjs --report`(看最後一行「未達目標」)。
  補完一批一定要跑 `--update-baseline` 把新水位鎖住,否則下次改動可以無聲退回去。
- [x] **R6:來源不在該國網域的 observance**(2026-08-20 當時已清空;`r6_exempt` 現況查
  `python3 -c "import json;print(json.load(open('content/content-depth-baseline.json'))['r6_exempt'])"`;
  這份清單只能縮不能長)。
  成因是先前查資料只用英文,拿回 japan.travel 的 `/en/` 觀光頁而非該國官方網域。
  **往後一律先用當地語言查該國官方網域**(日本→`*.go.jp`、印尼→`*.go.id`、
  巴西→`planalto.gov.br`/`*.gov.br`、中國→`gov.cn`、台灣→`*.gov.tw`、印度→`*.gov.in`),
  英文頁只當補充。⚠️ `japan.travel` 是 `.travel` 頂級網域,不是日本政府網域。
- [x] **同一段 lede 與國別敘述印兩次已修掉**(2026-08-20 移除 Topic 頁重複的兩張回答卡;
  FAQPage JSON-LD 仍保留四題)。查:`cd site && node scripts/check-rendered-depth.mjs --report`
  (看最後一行「有長段落重複兩次的頁面」)。
- [x] **清單頁的「討論室暫時關閉」已改掉**(2026-08-20;靜態預設值改為 `loading`,
  失敗態另名 `unavailable`)。查:`curl -s https://aeiou.now/ | grep -o 'data-room-state="[a-z]*"' | sort | uniq -c`。
- [x] **排行榜 thin 視窗已 noindex 並退出 sitemap**(2026-08-20),等 `topic_scores`
  排名 job 上線、筆數超過門檻會自動恢復索引,不需要改碼。查:`node scripts/check-content-depth.mjs`。
- [ ] **持續工作:新增 Topic 一律要一次補到水位**。閘門會擋,但擋下來的是部署不是內容——
  別靠閘門提醒才想到要寫。

### 補資料:讀者在自己國家那一格看到空白(2026-08-20 結案,轉為維護)

**缺口清單一律用指令查,不要讀這段的數字**:

```bash
node -e "const fs=require('fs');const CC=['TW','US','JP','CN','IN','ID','BR'];let n=0;
for(const e of fs.readdirSync('data/topics')){if(!e.startsWith('top_'))continue;
const fp='data/topics/'+e+'/facts.json';if(!fs.existsSync(fp))continue;
const f=JSON.parse(fs.readFileSync(fp,'utf8'));
if(f.status!=='active'||String(f.slug).startsWith('trend-'))continue;
const have=new Set([...(f.observances||[]).map(o=>o.country_code),...(f.regional_notes||[]).map(x=>x.country_code)]);
const miss=CC.filter(c=>!have.has(c));if(miss.length){n+=miss.length;console.log(String(miss.length).padStart(2),f.slug.padEnd(34),miss.join(','));}}
console.log('缺口',n,'格');"
```

七個站台各對應一個國家(zh-TW→TW、en→US、ja→JP、zh-CN→CN、hi→IN、id→ID、pt-BR→BR)。
某個 Topic 缺某國,就代表**那個站的讀者在那一頁上看不到自己的國家**。
發現的路徑是 `node scripts/seo-health.mjs` ③ 的「查詢×頁面」對照表:
排名第 9 的 `kapan hari valentine 2027` 落在 id 站的 affection-and-reciprocity,
而那個 Topic 當時沒有任何 ID 條目。

**兩種補法(重要,寧缺勿造)**:
1. **那裡其實有** → 補 observance(`content/topics/<slug>.md` + `content/observance-occurrences.json`)。
   實例:印尼丹格朗的 Peh Cun、山口洋的 Cap Go Meh。
2. **那裡真的沒有** → 補**缺席說明**(`scripts/generate-regional-notes.mjs` 的 `absences` 表)。
   缺席也是內容:用戶 2026-08-20 明示「沒有就沒有,但是可以讓那個語系的人知道沒有那個節日啊」。
   缺席筆會標 `kind='absence'`,前端印「這裡沒有這個節日／不在官方名單上」,
   **不會**印成「日期待確認」——「沒有」與「還沒查到」是兩件事。

**寫缺席說明的判準**:
- 缺席要能從**該國官方名單**證明(TW `law.moj.gov.tw` D0020095、JP `cao.go.jp` 祝日、
  CN `gov.cn` 放假辦法、US `usa.gov/holidays`、IN `india.gov.in/calendar`、
  ID `setneg.go.id` SKB、BR 662/9093 兩法)。這些預設來源寫在
  `/tmp` 之外的 `scripts/generate-regional-notes.mjs` 沒有——見該檔 `absences` 上方註解。
- **一定要說出「那這裡發生什麼」**。只寫「這裡沒有」是把空白換成一句空話;
  要嘛指出當地的對應節期(例:印度的 Sharad Purnima 對中秋、Pitru Paksha 對清明、
  爪哇的 Nyadran 對掃墓、西爪哇的 Seren Taun 對收成),要嘛說出制度上的原因
  (例:巴西的宗教假日由市決定、上限四天;日本要加假日只能修法)。
- 查不到就不要寫。硬寫一段等於捏造,比空白更糟。

### 事故:兩種「狀態碼騙人」的來源(2026-08-20)

兩個坑都長成同一個樣子——**HTTP 狀態碼說活著,實際上不是**。下面是當時的事實紀錄;
**要知道現在有沒有失效來源,跑指令,不要讀這一段的數字**:

```bash
node scripts/check-source-urls.mjs            # 失效數與清單;exit 1 代表有死連結
node scripts/check-source-urls.mjs --warn-only # 只看報表不擋
```

**坑一:302 到錯誤頁,狀態碼回 200。**
`www.tad.gov.tw`(觀光局舊網域)的來源整批 302 到 `eng.taiwan.net.tw/ErrorPage.html`,
最終狀態是 **200**。當時的 `check-source-urls.mjs` 只看狀態碼,判成「可達」放行;
那一批裡剛好有一個回 404,才把整批拖出來——**死連結是靠巧合曝光的,不是靠 gate**。
修法:把「跟完 redirect 落在錯誤頁」納入失效判定(判準寫在腳本檔頭的 `ERROR_PATH`)。

**坑二:同一個網址,不同網路給不同狀態碼。**
`bndigital.bn.gov.br` 從本主機回 403(WAF),從 GitHub Actions 的網路回 404,
排程 build 因此紅了一次。修法:404/410 或錯誤頁判定成立前,間隔複驗一次才判死,
避免對方 WAF 的地域差異變成本站 CI 的間歇性紅燈。

**教訓:驗連結不能只看狀態碼,要看跟完 redirect 之後落在哪裡;而且判死前要複驗。**
同一條線上的親戚:`japan.travel` 是 `.travel` 頂級網域不是日本政府網域(見
`docs/03-topic-content.md` §「來源怎麼找」),兩者都是**看起來對、其實不是**的來源。

## 產品功能(版面已定版,這些是資料/行為層)

- [ ] **`/topics/events/`、`/topics/nearby/` 的 emoji 排序只在前端做**(JS 拿
  `/v1/reactions/summary` 後重排)。要靜態排好,需把 reaction 計數從 D1 回流主機再進 `data/`
  (加一支 cron 腳本 + export 欄位)。
- [ ] **重新整理後「我按過的 emoji」會消失**:feed 端點不回 `mine`(契約 §1 限制)。
  要修就改契約讓 feed 依 anon_id 附 `mine`,Worker 一條 JOIN 的事,但屬契約變更。
- [x] **每個 Topic 都要有正式 cover 圖**(`site/public/covers/<slug>.png`,1200×675、16:9)。
  Google Discover 的大圖最低寬度與預覽比例以此為驗收；`coverPath()` 只接受 `.png`。
- [x] **首頁「近期話題」內容稀疏**:已建立共通性 Topic、`content/topic-calendar.json` 的 52 週排程與七語內容；
  `scripts/check-topic-calendar.mjs` 會阻擋缺週或缺圖的匯出。
- [ ] **新 Topic 沒有熱度分數**(import 不碰 `topic_scores`),級距顯示最低階。
  排名 job 屬 M2 的 19 job 管線;過渡期可決定要不要手動塞 demo 分數(要問用戶,不要自作主張)。

## 每日世界一問(2026-08-15 上線;規格=docs/briefs/daily-question.md)

- [ ] **題庫要持續補**。涵蓋到哪天、還剩幾天,一律查:
  `sqlite3 db/aeiou.sqlite "SELECT COUNT(DISTINCT qdate) 未來天數, MAX(qdate) FROM questions WHERE qdate >= date('now')"`
  用完前端不開天窗(退最近一題),但那等於每天給讀者同一題,是可見的產品破口。
  補法:往 `content/questions.json` 檔尾加題(一天一 poll 一 guess),七語齊全、掛既有 topic;
  `guess` 的選項用社群 locale 代碼,標籤在所有題目裡都一樣,可以直接沿用既有題目的寫法。
  存檔後 `node scripts/import-questions.mjs` 會驗(缺語系、topic 不存在、answer 不在選項裡都會擋),
  再走同一條 hourly 管線上線。**題目內容要有可查證的事實**——與 Topic 內容同一條紅線
  (不開天窗但會失去「每日」感)。補題=編輯 `content/questions.json`。之後可排每週 claude 批次產題
  (額度回復後再議,動工前問用戶)。
- [ ] **「個人」世界公民排行榜**被 OAuth(M2)擋住(anon_id 無顯示名且 Safari 下不穩,拿來排名會做出隨機掉名次的榜);
  本次交付**社群層級**參與榜(participation 端點)。OAuth 上線後升級。
- [ ] **guess 題的答案在靜態 JSON 裡**(view-source 可先看到)——遊戲性取捨,記錄在案;要藏就得把揭曉搬進 Worker(契約變更)。
- [ ] **/questions/ 頁每卡各發一次 results 請求**:題庫累積後單次載入的並發會線性成長
  (GET results 目前無限流、無 Cache-Control)。題數過 30 前加 lazy-load(進 viewport 才 fetch)或批次端點。
- [x] **`scripts/export-data.mjs` 的 NUL 位元組已移除**(2026-08-19)。原問題:三個 NUL 當
  複合鍵分隔符(2026-08-15 發現),git 視其為二進位 → 改動在 diff/PR 上看不見;grep 也一樣,
  且是**靜默回空不報錯**(2026-08-19 診斷時實際被騙過)。改法是複合鍵用巢狀 Map,不用分隔符。
  查:`python3 -c "print(open('scripts/export-data.mjs','rb').read().count(b'\x00'))"` 應為 0。

## 外部搜尋趨勢(2026-08-19 進版控;管線開著、上線閘關著)

規格與復活條件見 `docs/04-trend-automation.md`。現況查法:

```bash
sqlite3 db/aeiou.sqlite "SELECT access_source,status,COUNT(*) FROM topics GROUP BY 1,2"
ls -d data/topics/top_tr_* 2>/dev/null | wc -l    # 靜態層輸出幾個趨勢 Topic
```

- [ ] **復活前必須先做:前端要能區分機器 Topic 與人工 Topic**。`export-data.mjs` 已在輸出掛
  `topic_kind:'trend'`/`owner:'machine'`,但 `site/` 只有 `src/lib/data.mjs` 用它把趨勢
  Topic 當「近期話題」推上首頁(`season_distance: 0`),版面上沒有任何標示。
  拍板當日(2026-08-19)實測 313 個 active trend Topic 對 29 個人工 Topic —— 當日事實,現況請用上面的查法。
  ⚠ 版面怎麼標示屬產品決定,動工前先問用戶,並先讀產品草案本體。
- [ ] **趨勢 Topic 的熱度與排序策略未定**:趨勢沒有文化日期,目前是直接給最高「近期」優先序,
  等同蓋過人工策展的節奏。復活時要一併決定。
- [x] **差異同步已在 production 走到差異路徑**(2026-08-20)。清完趨勢副本後那一輪:
  「內容有變,差異 upsert(送 0 topics / 0 topic_i18n,全量會是 38 / 266)」
  ——payload 少了 317 個 Topic 所以整體 hash 變了,但留下的每一列都沒變,於是一列都沒送。
  查法:`grep -oE '(全量|差異) upsert.*' logs/cron-15min.log | tail -3`
- [x] **D1 的趨勢 Topic 副本已清**(2026-08-20 用戶指示)。刪之前實查 D1:
  指到趨勢 Topic 的 posts / comments / reactions / ranking_items 全部為 0,所以刪除是安全的;
  刪除前先把 topics 與 topic_i18n 兩份匯出到 `logs/d1-trend-topics-backup-*.json` 並驗過筆數。
  同時把 `sync-topics-to-d1.mjs` 的查詢加上 `access_source IS NOT 'trend'`(topics 與 topic_i18n
  兩邊都要,否則會留下指不到 topic 的孤兒 i18n 列)。
  🔴 **趨勢 Topic 復活時要改的就是那個 WHERE**,而且改回來之後要跑一次 `--force`
  ——差異同步不會自己想起沒送過的列。
  現況查法:
  `cd api && npx wrangler d1 execute aeiou-ugc --remote --command "SELECT COUNT(*) FROM topics"`
- [ ] Turnstile(Bot 防護第三層,擋純腳本):判斷可後補——限流+價值閘門就位後,等實際被打再上
  (用戶未明示反對此排序;要提前做先問)
- [x] 七站切換自訂網域(2026-08-15 完成):CI dist 帶 `CNAME`、`BASE_PATH=/`、每站專屬
  `SITE_URL`、hreflang+x-default(=en)指向七個正式網域、Worker CORS 加七網域。
  查:`gh api repos/weiqi-kids/aeiou-pages-<x>/pages --jq '{cname,https_enforced}'` 或打各網域 `.build-id`。
- [ ] 語系切換器(是否要做、放哪:**版面事項,動工前讀產品草案並問用戶**)
- [x] **IndexNow**(2026-08-19,用戶指示提前):`scripts/indexnow.mjs`,CI 的 indexnow job 在
  七站全部部署完之後跑(best-effort,不擋部署)。只送近 48h 內 `facts.json` 的 `updated_at`
  有變的 Topic —— 該欄位在同日修好無條件推新之前不能拿來當判準。七個網域各送一次
  (payload 的 host 必須與 urlList 相符,混送會整批被拒)。
  查:`node scripts/indexnow.mjs --dry-run`;金鑰檔 `curl -s https://aeiou.now/<key>.txt`。
- [x] **sitemap**:隨 build 產出,七站皆已在 GSC 提交(0 錯誤 0 警告),Topic 頁已帶 lastmod。
- [x] GSC 提交 job:**不需要** —— sitemap 提交是一次性動作,七站皆已完成。
- [ ] OAuth(Google/GitHub/LINE;cn 市場皆不通為已知缺口)
- [ ] GA4 每日拉取 job(property 與 SA 見上節)
- [ ] Markdown 渲染(M1 純文字轉義)、圖片上傳(R2+審核)
- [ ] 「回報錯誤/補充」按鈕、「加入行事曆」按鈕(Google Calendar URL + .ics)
- [ ] 來源清冊與爬搜、19 job 完整管線、Vectorize 語意搜尋、R2 歸檔、moderation 啟用範圍

## 已知缺口(記錄在案,暫不解)

- [x] **列表頁 cover 縮圖**(2026-08-16):新增 `site/public/covers/thumbs/*.webp`
  (480×270, 約 636KB 全集),TopicRow 以 `<picture>` 優先載入縮圖；1200×675 PNG 仍保留給
  Topic 頁 hero 與 `og:image`。查:`find site/public/covers/thumbs -name '*.webp'`。

- **claude -p 是全主機共用的訂閱額度**(2026-08-15 撞上週上限實證,seo-ops 各站 brain/reflect
  同時陣亡):額度耗盡時翻譯與價值閘門**雙雙停擺**,閘門 fail-open——垃圾貼文照常露出,
  只剩入口限流兜底。查:`echo 測試 | claude -p`(回 weekly limit 即耗盡)或看 `jobs` 表 error_message。
- [x] **價值閘門 cron 路徑已驗證**(2026-08-19):原為額度重置後待驗:測試貼文 `pst_…JYH7G2` 應自動
  變 `translation_status='done'` 且 post_i18n 六語齊。查:
  `sqlite3 db/aeiou.sqlite "SELECT translation_status FROM posts WHERE post_id LIKE '%JYH7G2'"`

- Safari ITP 擋第三方 cookie → anon_id 不穩定(驗證一律用 Chromium)
- cn 市場:GA4 被牆(瀏覽數低估)、OAuth 三家皆不通
- 熱度級距門檻是暫定值(`site/src/lib/heat.mjs` 檔頭),真實 HotScore 上線後要重新校準
