## 國碼統一為 ISO-2(2026-08-21 已解)

`topic_scores.scope` 曾同時存在 `country:TW` 與 `country:TWN`,指同一個國家。
**方向不是二選一**:`topic_search_metrics` 自己的 schema 註解本來就寫 `'country:XX'`(兩碼),
而 `posts.country_code`(Cloudflare,契約 §0)、`topic_observances`/`places` 的 country_code、
`data/meta/countries.json` 的 key 全是兩碼 —— 只有 GSC 給三碼。所以是 GSC 那側寫錯。

- [x] `scripts/lib/country-codes.mjs`:完整 249 組 alpha-3 → alpha-2,由
      `/usr/share/iso-codes/json/iso_3166-1.json` 產出後**寫死進 repo**
      (不在執行期讀那個檔:CI runner 不保證裝了它,一份會因環境而變的對照表比沒有更糟)。
      **不做部分對照** —— 漏掉的會靜靜變成第三套代碼。
- [x] `gsc-topic-metrics.mjs` 轉成兩碼才寫;查不到對照會**吵出來**並列出代碼,
      而且只跳過該列的國別 scope、**global 照樣累加**(第一版寫成 continue 會把 global 也跳掉)。
- [x] 既有資料已遷移:刪掉三碼列再重抓(回補窗 10 天 > 資料跨度 4 天,不會掉資料),
      `topic_scores` 重算。三處殘留皆為 0。
- [x] `export-data.mjs` 補上 `removeStaleRankingDirs` —— 舊的三碼目錄不會自己消失
      (`places` 那邊早有 `removeStaleCityFiles`,rankings 缺同一道)。

- [x] **種子題保鮮已解**(2026-08-21):`25 */4 * * *` 掛上 `seed-ask-the-world.mjs`,
      腳本改成**原地刷新**(一題一列,淡出時把 created_at 推到現在,不重翻、不長新列),
      被留言或 reaction 碰過的那一列不再刷新。詳見下方「Ask the World 保鮮」。

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

- [ ] **持續工作:再多加 Topic**(2026-08-22 這一輪加了**六個**,分兩批,見本項下方)。
      GSC 顯示會贏的查詢形態是「用語言 L 問國家 C 的節日 T」,
      Topic 數就是這個乘法的上限。挑題判準:**同一件事在七個市場的日期或制度差異夠大**,
      而且每一國都能找到該國官方網域的來源(R6)。
      反例:購物節(雙十一/Black Friday/Harbolnas)搜尋量高但沒有政府公告,R6 過不了,不要做。

      **2026-08-21 這一輪加了兩個**(用戶核准),兩個都是七個市場七個不同答案:
      · `elders-day` —— 敬老日/祖父母節。日本九月第三個星期一**放假**、中國重陽寫進
        《老年人權益保障法》但**不放假**、台灣祖父母節是教育部的行政推廣、美國的名字寫的是
        **祖父母不是老人**(定義家庭關係不是年齡層)、印尼 5/29 紀念的是「高齡的 Radjiman
        主持了建國第一場會議」、印度與巴西同在 10/1 跟著聯合國。
      · `year-end-bonus` —— 年終獎金/十三薪/THR。**確定性**是分歧的主軸:巴西十三薪是
        1962 年立法的義務(11/30、12/20 兩期,遲付有罰)、印尼 THR 必須節前七天付清不准分期
        (遲付罰 5%)、印度法定紅利的下限**與有沒有賺錢無關**、而台灣勞基法第 29 條是條件句
        (有盈餘才分配,沒金額沒期限沒罰則)、美國根本沒有,聯邦法規只管它算不算進加班費基礎。

      ⚠ **選題時先確認七個市場的官方來源從主機打得通**。這一輪原本要做 `tree-planting-day`,
      七國日期分歧也夠大,但印尼(`menlhk.go.id`/`bphn.go.id`)與美國(`usda.gov`)的頁面
      從本主機一律 403/000,查不到就不能寫(硬寫等於捏造)。改題比硬湊來源便宜。
      **選題前先確認七個市場的官方來源從主機打得通**(這件事會變,不要抄清單,自己打一次):
      ```bash
      for u in <候選網址...>; do
        printf '%s  %s\n' "$(curl -sL --max-time 25 -o /dev/null -w '%{http_code}' \
          -A 'Mozilla/5.0' "$u")" "$u"
      done
      # 000/403 = 從本主機打不通。既有 Topic 用過而且驗得過的網域可以當起點:
      grep -h '^- source:' content/topics/*.md | sed 's|^- source: ||' \
        | awk -F/ '{print $3}' | sort -u
      ```

      **2026-08-22 這一輪加了三個制度型 Topic**(用戶核准):`voting-and-elections`、
      `parental-leave`、`military-service`。三個都是「同一件事,七個市場七種制度」,
      而且每一國的引用條文都當場抓下來核對過原文。

      ⚠ **這一輪學到的兩件事,下次選題前先看**:

      ① **不是每個議題都能做成 observance。** 選舉、產假、兵役都沒有年度日期,
         而 `import-topic-occurrences.mjs` 硬性要求每個 active observance 都有今年與明年的
         occurrence(見該檔 `currentYear` 那一段)。硬塞 = 替沒有選舉的年份捏造一個日期。
         **正解是走既有的長青路線**:`perennial: yes` + 零 observance,
         七國內容放 `scripts/generate-regional-notes.mjs` 的 `notes`
         (`content/topic-regional-notes.json` 是**產物**,不要直接改)。
         R1 的覆蓋單位吃 regional_notes,所以七國照樣算七個變體。
         既有同型 Topic:`moving-home`、`weddings-and-customs`、`caregiving-across-generations`。

      ② **「狀態碼 200」不等於「這一頁有內容」。** 這一輪撞到的實例:
         `labour.gov.in` 已改成 Next.js SPA,**每一個路徑都回同一份幾 KB 的空殼**;
         `indiacode.nic.in` 回 504;`peraturan.bpk.go.id`、`npc.gov.cn`、`tse.jus.br`、
         `dol.gov` 從本主機是 403/000。這些狀況會變,**不要抄這份清單,自己打一次**,
         而且要看的是**抓下來有沒有正文**,不是狀態碼:
         ```bash
         curl -sL --max-time 25 -A 'Mozilla/5.0' "<網址>" \
           | python3 -c "import sys,re,html;t=sys.stdin.buffer.read().decode('utf-8','replace');\
         t=re.sub(r'(?is)<(script|style)[^>]*>.*?</\1>',' ',t);t=re.sub(r'<[^>]+>',' ',t);\
         print(len(re.sub(r'\s+',' ',html.unescape(t))))"
         ```
         幾百字元 = 空殼。**抓不到正文就換來源,不要靠記憶寫**(硬寫等於捏造)。
         這一輪找到的替代路徑,可以當下次的起點:各國憲法/法典全文多半抓得到 ——
         `planalto.gov.br`、`law.moj.gov.tw`、`laws.e-gov.go.jp`(含 `/api/1/lawdata/<id>`)、
         `www.gov.cn/guoqing/...` 憲法全文、`govinfo.gov` 的 USCODE、
         `cdnbbsr.s3waas.gov.in` 的印度憲法 PDF、`jdih.kemnaker.go.id/asset/data_puu/*.pdf`、
         `jdih.bawaslu.go.id/peraturan/download?id=uu_1945_1_uud1945.pdf`。

      **第二批(同日,用戶核准)**:`official-languages`、`compulsory-education`、
      `religion-and-the-state`。這三個是**照著第一批學到的限制反過來選題**的 ——
      既然中國只能用憲法或國務院文件、印度只能用憲法,那就挑**七國答案剛好都在憲法裡**
      的題目。選對題之後,七國來源一次到齊,不必再為單一國家的網站四處找路。

      ③ **七國的憲法/法典全文都已驗過可讀,這是選題時最可靠的地基**
         (一樣自己打一次,不要抄):
         TW `law.moj.gov.tw`(憲法 `A0000001`,任何法規換 pcode)、
         JP `laws.e-gov.go.jp`(⚠ 人看的網頁是 SPA,**要抓內文得用 `/api/1/lawdata/<id>`**;
         憲法 `321CONSTITUTION`)、CN `www.gov.cn/guoqing/2018-03/22/content_5276318.htm`
         (憲法全文)、US `govinfo.gov` 的 USCODE ＋ `archives.gov` 的權利法案
         (⚠ `constitution.congress.gov` 從本主機 403)、
         IN `cdnbbsr.s3waas.gov.in` 的憲法 PDF、ID `jdih.bawaslu.go.id` 的 UUD 1945 PDF、
         BR `planalto.gov.br/ccivil_03/constituicao/constituicao.htm`。

      ④ **通用來源也要先打過**。這一批兩次被 `check-source-urls.mjs` 抓到自己引進的
         死連結(`icrc.org/en/war-and-law`、`unesco.org/en/languages`,都是 404),
         兩次都是 Topic 層那個「國際組織」欄位。國別來源查得很仔細、通用來源憑印象寫,
         是這一輪重複犯的同一個錯。

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
      'https://aeiou.now/questions/')).coverageState)"`
      ⚠ 2026-08-21 修正:`inspectUrl()` 回的**就是** indexStatusResult 本身,
      舊寫法的 `.inspectionResult.indexStatusResult` 會拋 undefined。
- [ ] ⛔ **印尼 SNPMB 官網 TLS 憑證仍過期**(外部,我們改不了;2026-08-21 **再次**複驗,
      `notAfter=Oct 13 04:22:27 2024 GMT`、curl 回 000,狀況未變;原記錄:
      `notAfter=Oct 13 04:22:27 2024 GMT`,curl 回 000):
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
- [ ] ⛔ 效果觀測:看跨國/制度型那一類的平均名次有沒有從 67.6 往前走。
      **這一項不是「再等等看」**——要看的是名次分布的變化,不是時間。
      2026-08-21 把這個判準**做進工具**了:`node scripts/seo-health.mjs` 的 ③ 層現在固定印
      「意圖分類」兩行(曝光加權平均名次),不必再有人手算一次 —— 手算的判準只存在於某一次對話裡。
      **卡點有兩個前提,兩個都用指令查,不要在這裡寫當下的值**:
      ```bash
      # 前提①:Google 有沒有回來爬過改版後的頁面(改版是 2026-08-21)
      node -e "const {inspectUrl}=await import('/root/seo-ops/lib/google.mjs');
        const r=await inspectUrl('/root/.config/aeiou/ga4-sa.json','sc-domain:aeiou.now',
        'https://aeiou.now/'); console.log(r.lastCrawlTime, r.coverageState)"
      # 前提②:GSC 資料窗有沒有推進到 2026-08-21 之後(GSC 固定落後 2–3 天)
      sqlite3 db/aeiou.sqlite "SELECT MAX(metric_date) FROM topic_search_metrics WHERE scope='global'"
      ```
      兩個都到了就跑 `node scripts/seo-health.mjs`,看 ③ 層的「意圖分類」兩行,**不必再手算**。
      當時(改版前、5 天樣本)的基準已量出來:日期/名稱型 23 查詢 69 曝光 0 點擊 17.8 名;
      跨國/制度型 1 查詢 1 曝光 0 點擊 94.0 名。

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
- [x] **種子題淡出已解**(2026-08-21;下方「Ask the World 保鮮」那節就是解法:`25 */4` cron
      + 原地刷新)。複驗:`node scripts/seed-ask-the-world.mjs --dry-run`,看「在線 N 題」
      那一行是不是等於題庫題數。以下是當時的三條路,留著當紀錄 ——
- [x] ~~🔴 **種子題會在 8 小時後從討論室淡出**~~ —— 契約 §1 的 feed 只回 `created_at >= now-8h`。
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
- [ ] ⛔ 效果觀測:等 GSC 資料窗推進到 08-22 之後再看跨國/制度型查詢的平均名次(改版前是 67.6)。
      **在那之前不要拿數字說改善或沒改善。** 與上面那一項是同一件事,同一條指令:
      `node scripts/seo-health.mjs` 的 ③ 層「意圖分類」。
      與上面那一項是同一件事、同一組前提查法,不重複寫。

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
- [x] **LCP 量到了**(2026-08-22 解開)。先前記著「PSI 免金鑰配額當天用盡」,查證後發現
      那個配額是 **Google 的共用匿名池**(不帶 key 時所有人共用同一個 project_number),
      不是我們用掉的,所以「等明天」永遠不會好。而專案 SA 只有 GA4/GSC 的 scope,
      拿它打 PSI 是 403。兩條路都不通,於是被記成外部卡點。
      **真正的解法是第三條**:在自己的 GCP 專案開一把只給 PSI 用的 API key。
      本機 gcloud 是用戶本人帳號、對 `aeiou-seo` 是 owner,所以做得到:
      `gcloud services enable pagespeedonline.googleapis.com --project=aeiou-seo` +
      `gcloud services api-keys create --project=aeiou-seo --display-name=aeiou-psi
       --api-target=service=pagespeedonline.googleapis.com`;
      key 在 `~/.config/aeiou/psi-api-key`(chmod 600,**絕不進 git**)。
      工具:`node scripts/psi-check.mjs`(裸執行量四頁 × 手機;`--detail` 看 LCP 元素與改善機會)。

- [x] **手機 LCP 這一輪追到底了,降級收工**(2026-08-22 用戶拍板)。
      四頁全部停在「需改善」(≤4s),沒有一頁到「良好」(≤2.5s)。**不再追**,
      理由與證據在下面。要重新開這一項的條件寫在最後一段。

      現況一律用指令查:
      ```bash
      node scripts/psi-check.mjs                    # 四頁 × 手機,含判定
      node scripts/psi-check.mjs --detail --url <該頁>
      ```
      **看 LCP 要往下拆兩層**:①`lcp-breakdown-insight` 分成 TTFB / 資源發現延遲 /
      資源下載 / 元素渲染延遲;②`metrics` 那一支同時給 **observed(未模擬)**與
      **simulated(模擬節流後)**兩組值 —— **兩組差很多時,差距本身就是答案**。
      ⚠ 同一個網址短時間內重跑會拿到 **PSI 的快取**(兩輪數字會一模一樣),
      那不是「穩定」,拿它判雜訊無效;要獨立樣本得隔一段時間或換網址。

      ### 五個改動,結果照實記(不要只留成功的那一個)

      | 改動 | 機制有沒有生效 | LCP |
      |---|---|---|
      | 清單頁討論串改進 viewport 才 fetch | ✅ 並發請求與 long task 消失 | **沒動** |
      | GA4 `gtag/js` 延到 `load` 之後 | ✅ gtag 落到 load 之後才發 | **FCP 掉了將近兩秒**,LCP 動一點 |
      | 國旗列 + 熱度階梯收成單一元素 | ✅ Style & Layout 腰斬、TBT 剩個位數 | **沒動** |
      | CSS 內聯(`inlineStylesheets: 'always'`) | ✅ dist 已無 `<link rel=stylesheet>` | **沒動** |
      | LCP 圖 preload | ✅ 標籤有出去 | **沒動**,連 `resourceLoadDelay` 都沒變 |

      五個裡只有 GA4 那一個真的改善了使用者看得到的指標(FCP)。
      **preload 那一項量到的效益是零** —— 資源發現延遲改前改後一樣,
      因為 `<picture>` 本來就在 body 很前面,preload scanner 早就掃到了。
      它現在沒有害處(每頁的 LCP 元素都逐一確認過才下),但**不要以為它在撐著什麼**。

      ### 結論:兩條路都走到底了

      · **主執行緒不是瓶頸**:頁面自己一個 long task 都沒有、TBT 個位數,LCP 仍不動。
        → 再砍 DOM 沒有意義(討論室骨架那 76 個元素不用做);
        「清單頁分頁少畫幾張卡」也不必為了 LCP 做,而且它會減少 Topic 內鏈,方向相反。
      · **自己加 CDN 對速度沒用**:GitHub Pages 本來就在 Fastly 後面
        (查:`curl -sI https://aeiou.now/ | grep -i x-served-by`),實測 TTFB 只有幾毫秒;
        而 Lighthouse 的模擬把 RTT 寫死在模型裡,真實伺服器多快都不影響模擬值。
        ⚠ **CDN 這件事沒有死,只是理由不是速度** —— 見下方 GA4 機器流量那條紅線。

      ### 剩下的差距是模擬器的形狀,不是頁面的形狀

      同一份結果裡 observed 的 FCP 與 LCP 幾乎同時、都在一秒多,simulated 的 LCP 是它
      兩倍以上。差距來自慢速 4G + 高 RTT 的模型。**在快網路上這幾頁是好的,
      被判「需改善」的是慢速連線的讀者。** 而且 —— **PSI 沒有這個網域的 CrUX 實地資料**
      (流量太低,`loadingExperience` 是空的),所以連「真實讀者到底慢不慢」都還不知道。
      查:見 `scripts/psi-check.mjs` 檔頭。

      **要重新開這一項的條件**:CrUX 開始有這個網域的實地資料(代表流量夠了),
      而且實地的 LCP 也落在「需改善」。在那之前繼續追的是模擬器,不是讀者。

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
- [x] **第二出口複驗已接上**(2026-08-21):被擋的來源等於本輪沒被核對過,
      所以由 `check-source-urls.mjs` 補驗 —— 它跑在 GitHub Actions(build.yml),
      是現成的另一個網路出口。原本它只收 Topic 來源,現在也收
      `content/local-data-sources.json` 的在地來源(222 個網址,實測失效 0)。
      兩邊判準不同是刻意的:主機那支要決定「要不要擋住本站發佈」,CI 這支只回答
      「這個連結到底還活著嗎」。

## 國碼兩套並存 —— 已解,本節只留緣由(2026-08-22 覆核)

⚠ **這一節在 2026-08-21 標成「未解、要用戶決定」,但當天稍晚就已經解掉了**(結論寫在本檔最上面
那一節「國碼統一為 ISO-2」),兩處並存了一天,是文件漂移。**現況一律用指令查**:

```bash
sqlite3 db/aeiou.sqlite "SELECT DISTINCT scope FROM topic_scores        WHERE scope LIKE 'country:%'"
sqlite3 db/aeiou.sqlite "SELECT DISTINCT scope FROM topic_search_metrics WHERE scope LIKE 'country:%'"
ls data/rankings/
```
三處出現的國碼都應該是**兩碼**;冒出三碼(`TWN`/`JPN`/`BRA`)就是 `gsc-topic-metrics.mjs`
的轉碼漏了,查 `scripts/lib/country-codes.mjs` 的對照。

緣由(歷史事實,留著是因為它解釋了為什麼對照表必須是完整 249 組):
`topic_scores.scope` 曾同時存在 `country:TW` 與 `country:TWN`,指同一個國家 ——
GSC 給的是 ISO-3,而 `posts.country_code`(Cloudflare,契約 §0)、`topic_observances`/`places`
的 country_code、`data/meta/countries.json` 的 key 全是 ISO-2。`compute-topic-scores.mjs`
兩邊都直接 `country:${代碼}` 串進 scope,於是同一國被切成兩個。方向選 ISO-2(產品這邊),
因為只有 GSC 那一側是外來編碼。**只做七個市場的部分對照不行** —— 貼文可能來自任何國家,
漏掉的會靜靜地變成第三套代碼。

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
- [ ] 🔴 **新增/修改內容之後,本機一定要 build 七語系,不能只 build zh-TW**
  (2026-08-22 事故)。`religion-and-the-state` 上線後 CI **連續五次失敗**,
  en 與 br 兩站因此落後兩個 commit —— 而 zh-TW 那五站是綠的,
  「七站分別是哪一版」以外的查法完全看不出來。
  根因是渲染層 D3(同一段文字在同一頁出現兩次):我在 en 與 pt-BR 的 summary 裡
  **逐字引了日本憲法第二十條那一句**,而 JP 那一格的 regional note 也引了同一句 ——
  **只有那兩個語系會撞**,中文/日文/印地文/印尼文都不會,因為它們的譯法不同。
  ⚠ 這類錯誤**天生只在部分語系出現**,本機 build 一個語系必定漏掉。
  ```bash
  cd site && for L in zh-TW en ja zh-CN hi id pt-BR; do LOCALE=$L pnpm build || break; done
  ```
  修法是改 summary 不是改 note ——「summary 的工作是預告,不是引述」。

- [ ] 🔴 **不要因為「不盯 CI」就不看 CI 結果**(2026-08-22 同一次事故的另一半)。
  「不要花時間等 CI」與「不要檢查 CI 有沒有紅」是兩件事;這一輪把兩者混在一起,
  結果五次失敗都沒被發現,直到全面巡檢才抓到。
  收尾時至少跑一次:`gh run list -R weiqi-kids/aeiou.now --limit 5`

- [ ] **持續工作:新增 Topic 一律要一次補到水位**。閘門會擋,但擋下來的是部署不是內容——
  別靠閘門提醒才想到要寫。
  (2026-08-21 的兩個新 Topic 都是四要件同一輪進:md、occurrence、cover、taxonomy 白名單
  與 52 週日曆,baseline 當輪重鎖。**水位現況查 `node scripts/check-content-depth.mjs --report`**,
  不在這裡寫字元數。)

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

- [x] **emoji 排序已在靜態排好**(2026-08-21 用戶核准)。真正的後果不只是讀者看得到排序跳一次,
  而是**不執行 JS 的爬蟲看到的永遠是未排序的那一版**。
  新增 `GET /internal/ugc/reaction-totals`(只回聚合,不回 actor_id)、
  `scripts/sync-reactions-from-d1.mjs`(**整批覆蓋而非 upsert** —— reaction 可以被收回,
  只 upsert 的話歸零的目標會永遠停在最後一次的非零值)、主機表 `reaction_totals`(副本非權威)。
  掛在 `hourly-export.sh`,不 fail-closed。`local-data.mjs` 兩支比較器與
  `pages/topics/[sort].astro` 前端那段**逐項相同** —— 不一致的話 JS 一載入就跳一次順序。
  查:`sqlite3 db/aeiou.sqlite "SELECT target_type,COUNT(*) FROM reaction_totals GROUP BY 1"`
- [x] **重新整理後「我按過的 emoji」不再消失**(2026-08-21 用戶核准的契約變更)。
  feed 與 `/v1/reactions/summary` 都補了 `mine`,**一律是陣列**(沒 cookie、沒按過都是 `[]`,
  不是缺 key —— 缺席會逼前端為兩件事寫兩套判斷)。summary 順帶改成「每個被問到的 id 都有一格」。
  查:`curl -s "$API/v1/topics/<id>/feed?limit=1" | grep -o '"mine":\[[^]]*\]'`
- [x] **每個 Topic 都要有正式 cover 圖**(`site/public/covers/<slug>.png`,1200×675、16:9)。
  Google Discover 的大圖最低寬度與預覽比例以此為驗收；`coverPath()` 只接受 `.png`。
- [x] **首頁「近期話題」內容稀疏**:已建立共通性 Topic、`content/topic-calendar.json` 的 52 週排程與七語內容；
  `scripts/check-topic-calendar.mjs` 會阻擋缺週或缺圖的匯出。
- [x] **常青 Topic 拿得到熱度分數了**(2026-08-21)。診斷:不是「新 Topic 沒分數」,是
  **沒有 observance 的常青 Topic 七項全 0** —— 沒有發生日 → Proximity 0,來源掛在
  regional notes 而不是 observance → SourceScore 也 0 → 整個 Topic 不進 `topic_scores`。
  而它們同時是 `topic-calendar.json` 排進本週的主打 Topic:一邊主打、一邊宣告「這個沒人在意」。
  改法:①有真實發生日就用它,沒有才退到日曆週次(年度環狀)換算成天數,餵進同一個高斯衰減;
  ②SourceScore 補讀第三處來源(`content/topic-regional-notes.json`)。
  查:`node scripts/compute-topic-scores.mjs --dry-run`(n 應等於 active 人工 Topic 數)。

## 每日世界一問(2026-08-15 上線;規格=docs/briefs/daily-question.md)

- [ ] **題庫要持續補**(2026-08-21 一輪;2026-08-22 兩輪,分別加 10-03～10-09 與 10-10～10-16)。
  💡 **出題最省力的來源是制度型 Topic**:`voting-and-elections`、`parental-leave`、
  `military-service`、`official-languages`、`compulsory-education`、`religion-and-the-state`
  這幾個每一個都是現成的「七國七種答案」,而且條文都已核對過原文 ——
  guess 的解說可以直接從 `scripts/generate-regional-notes.mjs` 的內容改寫,不必重查。
  ⚠ 但**答案國別要刻意分散**:10-10～10-16 那一輪的七題答案剛好是
  pt-BR / en / ja / zh-TW / id / hi / zh-CN 各一次,這是排出來的不是碰巧。涵蓋到哪天、還剩幾天,一律查:
  `sqlite3 db/aeiou.sqlite "SELECT COUNT(DISTINCT qdate) 未來天數, MAX(qdate) FROM questions WHERE qdate >= date('now')"`
  用完前端不開天窗(退最近一題),但那等於每天給讀者同一題,是可見的產品破口。
  補法:往 `content/questions.json` 檔尾加題(一天一 poll 一 guess),七語齊全、掛既有 topic;
  `guess` 的選項用社群 locale 代碼,標籤在所有題目裡都一樣,可以直接沿用既有題目的寫法。
  存檔後 `node scripts/import-questions.mjs` 會驗(缺語系、topic 不存在、answer 不在選項裡都會擋),
  再走同一條 hourly 管線上線。**題目內容要有可查證的事實**——與 Topic 內容同一條紅線
  (不開天窗但會失去「每日」感)。補題=編輯 `content/questions.json`。之後可排每週 claude 批次產題
  (額度回復後再議,動工前問用戶)。
- [ ] ⛔ **「個人」世界公民排行榜**被 OAuth 擋住(anon_id 無顯示名且 Safari 下不穩,拿來排名
  會做出隨機掉名次的榜);本次交付**社群層級**參與榜(participation 端點)。
  **解鎖條件**:下面那條 OAuth。用戶 2026-08-21 表示會去開 OAuth app。
- [x] **guess 的答案已搬進 Worker**(2026-08-21 用戶核准的契約變更)。判準只有一條:
  **`mine` 非 null 才給** —— 投過票就給,不是「投對才給」也不是「過了某時間才給」。
  靜態層只留 `has_answer` 布林;缺該語系的解說就不給句子,不退回別的語言。
  D1 `questions` 加 `answer_option` / `explain_json` 兩欄。
  查:`curl -s "$API/v1/questions/<id>/results?locale=zh-TW" | python3 -c "import sys,json;print('answer' in json.load(sys.stdin))"` → 沒投票時應為 False
- [x] **/questions/ 改成進 viewport 才發 results 請求**(2026-08-21)。原本一次載入就是 N 發並發,
  而卡數等於題庫大小、每天長一題。沒有 `IntersectionObserver` 就退回全部立刻發 ——
  降級要是可用的舊行為,不是永遠停在 loading。
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

- [x] **前端已能區分機器 Topic 與人工 Topic**(2026-08-21 用戶核准;動工前讀過產品草案
  §2/§44/§53 —— 草案沒有規定這個標示的長相,所以是新的產品決定,不是照抄編號)。
  TopicRow 一顆**虛線**徽章(不能只靠顏色分辨)+ Topic 頁頁首一句完整的話:
  徽章的兩三個字說不完「沒有經過人工查證」,而那正是讀者要判斷的事。
  判準是輸出層契約 `topic_kind`,不是 category。查:`grep -c 'badge--machine' site/dist/index.html`
- [x] **趨勢 Topic 的排序策略已定**(2026-08-21):首頁「近期話題」的**第一排序鍵改成策展層**。
  趨勢 Topic 的 `season_distance` 是 0,但那個 0 是「沒有文化日期」的佔位、不是「今天就是」;
  與長青主題的 0 放在同一個鍵上比,等於讓機器彙整的話題與人工策展的當令議題並列在首頁最前面,
  而前者數量可以是後者的十倍。人工的先排完,機器的接在後面,各自內部再比距離與熱度。
  🔴 復活時要改的仍然是 `sync-topics-to-d1.mjs` 的那個 WHERE,改完要跑一次 `--force`。
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
- [x] **Turnstile 的碼與測試已到位**(2026-08-21 用戶核准提前做),⛔ **只差 widget 的鑰匙**——
  主機的 wrangler token 沒有 Turnstile scope(實測 `challenges/widgets` 回 Authentication error),
  建不了 widget。**解鎖條件**:在 Cloudflare 儀表板建一個 Turnstile widget,然後
  `cd api && npx wrangler secret put TURNSTILE_SECRET`、並在 `wrangler.jsonc` 的 `vars` 加
  `TURNSTILE_SITEKEY`。兩個都設才生效,設了之後 `POST /v1/posts` 與 `/v1/comments` 要帶
  `turnstile_token`。設計上的三個決定:①開關由 Worker 說了算(前端問 `/v1/me`),
  **七個靜態站不必為了開關重建** —— 真的被打的時候沒有等 CI 跑完七站的時間;
  ②siteverify 打不通回 **503 不放行**(驗不到就當通過 = 在對方最想要的時刻自動關掉);
  ③一個討論室只掛一個 widget,發文框與二十個回覆框共用。
  查現在是開是關:`curl -s "$API/v1/me" | grep -o '"turnstile":{[^}]*}'`
- [x] 七站切換自訂網域(2026-08-15 完成):CI dist 帶 `CNAME`、`BASE_PATH=/`、每站專屬
  `SITE_URL`、hreflang+x-default(=en)指向七個正式網域、Worker CORS 加七網域。
  查:`gh api repos/weiqi-kids/aeiou-pages-<x>/pages --jq '{cname,https_enforced}'` 或打各網域 `.build-id`。
- [x] **語系切換器已做**(2026-08-21 用戶明示要做)。⚠ 我當時**不建議**做:與「七語系是七個
  獨立的站、讀者只看得到一種語言」有張力。用戶明示後用最不打擾的方式做:放**頁尾**不進導覽、
  連到**同一頁**的其他語系網址(不是丟回別站首頁)、每個連結掛 hreflang + lang、
  不做 `<select>`、不做 JS 自動轉向(偵測到的語言不等於讀者想要的語言)。
  要撤掉就刪 `BaseLayout.astro` 的 `<nav class="footer-langs">` 那一段,其餘版面不受影響。
- [x] **IndexNow**(2026-08-19,用戶指示提前):`scripts/indexnow.mjs`,CI 的 indexnow job 在
  七站全部部署完之後跑(best-effort,不擋部署)。只送近 48h 內 `facts.json` 的 `updated_at`
  有變的 Topic —— 該欄位在同日修好無條件推新之前不能拿來當判準。七個網域各送一次
  (payload 的 host 必須與 urlList 相符,混送會整批被拒)。
  查:`node scripts/indexnow.mjs --dry-run`;金鑰檔 `curl -s https://aeiou.now/<key>.txt`。
- [x] **sitemap**:隨 build 產出,七站皆已在 GSC 提交(0 錯誤 0 警告),Topic 頁已帶 lastmod。
- [x] GSC 提交 job:**不需要** —— sitemap 提交是一次性動作,七站皆已完成。
- [ ] ⛔ **OAuth**(Google/GitHub/LINE;cn 市場皆不通為已知缺口)——用戶 2026-08-21 表示會去開。
  **解鎖條件**:三家的 client id / secret。拿到之後放 `~/.config/aeiou/`(不進 git),
  Worker 側用 `wrangler secret put`。在那之前 `topicGate` 對 `access_level >= 1` 一律 401。
- [x] **GA4 每日拉取 job 已上線**(2026-08-22)。
  ⚠ **先前把這一項記成「卡在專屬 property 與 SA 還沒開」,那是錯的** —— 用戶反問
  「GA4 不是原本就有嗎?不然你怎麼抓報告的?」之後查證:aeiou 早就有自己的 GCP 專案與 SA
  (`seo-ops@aeiou-seo.iam.gserviceaccount.com`,專案 `aeiou-seo`),
  `node /root/seo-ops/bin/identity-audit.mjs --all` 實測它**不在**共用金鑰的分組裡
  (那支工具會列出當下誰跟誰共用,現況以它的輸出為準),
  而 `seo-health.mjs` 一直在用它讀 GA4。缺的從來不是授權,只是腳本沒寫。
  **教訓:把「還沒做」寫成「被擋住」,會讓一件五分鐘的事永遠排不進來。**
  現在 `scripts/ga4-daily.mjs` 同時寫 `page_views`(原始)與 `page_views_human`
  (只計 Organic Search)—— 只寫其中一個都會說謊。掛在 hourly 但用 job_locks 自我節流成
  每日(**新增 cron 排程行屬 C 級,沒問過就不加**)。
  🔴 拉進來的數字仍然**不准算 HotScore 的瀏覽面**(2026-08-20 拍板未變)。
  查:`node scripts/ga4-daily.mjs --report`

- [x] **圖片上傳(R2+審核)已上線**(2026-08-22)。R2 bucket 已建好,所以這一項不再卡住。
  🔴 **設計上的關鍵決定:上傳成功 ≠ 看得到。** 圖片預設 `pending`,要人在工作檯放行才公開。
  這個站沒有影像分類模型也沒有隨時在線的審核者,在那個前提下直接公開任意使用者圖片,
  是整個系統裡風險最高的一件事 —— 文字最糟是難看,圖片最糟是違法內容掛在七個網域上。
  **這不是保守,是現在唯一誠實的做法**;有了分類模型或有人固定看隊列之後再放寬。
  型別用魔術位元組判定不看 Content-Type;供圖走 Worker 代理而不是開放 bucket
  (R2 一開公開,那個網址就永遠是公開的,「下架」對它沒有作用)。
  pending/rejected 一律回 404 不回 403。契約 §1c。
  查:`node scripts/moderation-queue.mjs --report`(最後幾行有待放行圖片的查法)
  放行:`node scripts/moderation-queue.mjs --approve <media_id>`
- [x] **「加入行事曆」與「回報錯誤/補充」都已上線**(2026-08-21 用戶核准)。
  行事曆:純字串組裝的 Google TEMPLATE 網址 + .ics data URI,不打任何 API、不需要 JS
  (同「導航一律純字串組裝」那條紅線)。三條限制各有代價作為理由 —— **只出本站市場那一國**
  (七國各兩條連結實測讓每頁多 14KB,而這個站剛為 LCP 壓過封面)、日期是估算或地方變體時不出
  (把「大概是那天」寫進別人的日曆是替他做我們沒把握的決定)、說明截到 180 字。
  ⚠ 全日事件的 DTEND **排他**,要 +1 天;DTSTAMP 用起始時間而非「現在」,否則每次 build
  產生不同位元組,「hash 沒變就不動」那整套保護會失效。
  回報錯誤:**不另開端點、不另開表單** —— 按下去把前綴插進討論室發文框並捲過去,走同一條
  翻譯路、同一道價值閘門、同一個限流。更正因此是公開可討論的(這是主題頁論壇;收在私人信箱
  裡的更正只有我們知道它被回報過)。沒有 JS 或沒有討論室時整顆按鈕不出現。
- [x] **來源清冊與爬搜、19 job 完整管線、Vectorize 語意搜尋、R2 歸檔、moderation 啟用範圍**
  —— 2026-08-22 用戶指示「也都要」,五項全部上線。對照表:`docs/05-job-pipeline.md`。

  · **moderation 啟用範圍**定版:Post 兩層(規則層 + LLM 價值閘門)、Comment 只有規則層、
    Image/User/人工檢舉不做(沒有圖片上傳、沒有帳號系統;檢舉沒有帳號會變成新的攻擊面)。
    **診斷的方法**(不是結論)—— 比對主機與 D1 的留言數,差額就是沒被看過的那些:
    ```bash
    sqlite3 db/aeiou.sqlite "SELECT COUNT(*) FROM comments"
    cd api && npx wrangler d1 execute aeiou-ugc --remote --command "SELECT COUNT(*) FROM comments"
    node scripts/moderation-queue.mjs --report      # 工作檯待複核
    ```
    成因是結構性的:留言不翻譯就不進價值閘門,又不回流主機,所以主機端看不到它。
  · **19 job**:補齊 #2 #9 #10 #15 #16 #17 #18 #19。過程中揭出一個沉默的 bug ——
    `posts.cross_country_engagements` 從來沒有任何東西寫過它,而 CrossCountryScore
    一直在讀它(HotScore 七項裡有一項恆為 0,從分數上完全看不出來)。
    ⚠ **刻意不照抄草案的「全部每 15 分鐘」**:跑得比資料變化還快產生的是雜訊不是新鮮度,
    三個實例與理由寫在 `docs/05-job-pipeline.md`。
  · **來源清冊**:`content/source-registry.json`(人工入口)。爬蟲守則逐條實作 ——
    robots.txt、Crawl-delay、表明身分、同網域串行、**401/403 一律當「不准抓」不繞過**。
    查:`node scripts/source-refresh.mjs --report`
  · **R2 歸檔**:專屬 bucket `aeiou-archive`(不與同帳號其他專案共用)。
    先寫 R2 → 確認成功 → 才清原文。查:`node scripts/archive-to-r2.mjs --report`
  · **Vectorize**:index `aeiou-topics`,一個 Topic 一個向量(多語模型的全部理由)。
    2026-08-22 當時掃過一輪真實查詢,結論是**單靠相似度門檻分不開**(真陽性與雜訊的分數
    區間重疊),所以改成兩層:字面比對命中即確定、向量只管「用不同的字講同一件事」。
    判準與當時的量測值寫在 `api/src/routes/search.js` 檔頭(那是判準的依據,不是現況)。
    **現況一律重測**:
    ```bash
    curl -s -G "$API/v1/search" --data-urlencode "q=バレンタイン" | python3 -m json.tool
    curl -s -G "$API/v1/search" --data-urlencode "q=<詞>" --data-urlencode "min_score=0.3"  # 看分數分佈,校準門檻用
    cd api && npx wrangler vectorize info aeiou-topics                                       # 索引裡有幾個向量
    ```
    契約 §1b。

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
