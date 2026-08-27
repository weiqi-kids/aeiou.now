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

## 版型巡檢(2026-08-27;用 headless 實際渲染,不是讀碼)

做法:`site/dist` 起本機 server → playwright 開 1280 與 390 兩個寬度 → 逐頁量
`scrollWidth`／`scrollHeight`／每一列的高度,再截全頁圖看。**只讀 .astro 看不出這些**——
底下每一條都是量出來的,不是推論。

已修(見同一輪 commit):
- [x] 手機整站橫向溢出:`.row-flags` 七面國旗 `white-space: nowrap`,390px 視窗量到
      那一個 span 就 356px,首頁與三個清單頁的 `scrollWidth` 都是 554px。改成國名後 390。
- [x] 國旗 emoji 在 Linux 變虛線字母方框:字型堆疊末端的 `FreeSans` 收了 regional
      indicator 的**單字元**字形,Chromium 挑中它之後兩個 code point 就併不成旗。
      實測三面旗 154.6px(六個方框)vs 113.9px(三面旗)。emoji 家族已插到 FreeSans 前面。
      ⚠ **Windows 沒有國旗字形,那邊仍是字母方框**(這台機器驗不到,是已知平台限制)——
      所以每一面國旗旁邊都要有國名,不能拿國旗當唯一的國家標示。
- [x] 手機沒有左右水溝:`main { padding-inline: 0 }` 是 2026-08-11 對著**桌機截圖**下的指示,
      桌機有 `.container` 的 72rem 置中所以看不出來;390px 量到四個頁型的 h1 `left = 0`,
      正文整段貼著螢幕邊緣。已在 `< 640px` 補回 1rem,**≥640px 行為完全沒動**。
- [x] 假日總表在手機一行一個字:`.hol-date` 是 nowrap,390px 下日期欄自己吃掉 421px,
      「名稱」只剩 68px。61 列疊成 16,947px。已改成窄螢幕堆疊,10,134px。
- [x] 排行榜 57 列零配圖(桌機 13,280px 的灰階條紋)。封面圖本來就有,只是這頁沒用。
- [x] Topic 頁底部來源清單:16 個項目一行一個、其中三個網域各出現兩次而**畫面上一模一樣**
      (`sourceLabel()` 只印 hostname)。改成橫向流排 + `sourceLabels()` 保證同頁唯一。
- [x] 逐國頁四個 CSS token 根本不存在(`--color-border`／`--color-text-muted`／`--color-link`),
      整頁的分隔線與弱化文字**靜靜失效**。守門腳本抓不到「用了沒定義的 var()」。
- [x] `/questions/` 第一屏是十一行只有日期的空列:QuestionCard 在 `unavailable` 態
      `root.hidden = true`,而日期是外層 `.archive-item` 印的,卡片消失日期不會跟著消失。

還沒動,要用戶拍板的三件:
- [ ] **53/65 個 Topic 頁的「你附近」與「相關活動」兩區都是「目前沒有資料。」**
      查法(先 `cd site && LOCALE=zh-TW pnpm build`,⚠ 每個站只看得到自己市場那一城):
      `python3 -c "import glob;h=[open(f,encoding='utf-8').read() for f in glob.glob('site/dist/topic/*/index.html')];print(sum(1 for x in h if '目前沒有資料' in x.split('id=\"nearby\"')[1][:1200] and '目前沒有資料' in x.split('id=\"events\"')[1][:1200]),'/',len(h))"`
      版面是 2026-08-11 定版的左 50% / 右 50%,所以八成的 Topic 頁有半版是兩行空話,
      而右邊的討論室被壓在 50% 裡。**改比例等於改定版,不自己動**。
      可能的做法:兩區都空時左欄收成一行、討論室吃滿寬;或維持現狀等在地資料補上來。
- [ ] **TopicPosts / Participation 的「暫時無法載入」訊息是死碼**:兩支都在 `unavailable`
      態 `root.hidden = true`,底下 `.posts-closed-title` / `.posts-closed-hint` 永遠印不出來。
      DiscussionRoom 只是**碰巧**沒事 —— 它的 `[data-room-state='unavailable']` 設了
      `display: flex`,把 `[hidden]` 蓋掉了。三支要一致,但「API 掛掉時首頁十列各印一次
      故障」是產品決定(2026-08-20 那次事故的教訓正好在這條線上),不自己動。
- [ ] 首頁 hero「一件事,到了不同地/方,做法可能完全不同」在「地方」中間斷行。
      CSS 無解:`text-wrap: balance` 與 `word-break: auto-phrase` 實測對中文都不改變斷點
      (auto-phrase 目前只對日文有效)。要修只能在文案裡放斷行提示,**那是用戶的東西**。

## 流量診斷(2026-08-27;起因是用戶問「流量一直起不來」)

近 28 天:查詢 159、曝光 523、**點擊 1**;GA4 真人 organic session 10(其餘 95% 是機器)。
內容層 0 缺口、版面剛巡檢過 —— 兩層都不是瓶頸。查出來的是這條:

- [x] **sitemap 的 lastmod 是狼來了。** 469 個 URL 的 lastmod 全部都是今天,而且天天如此
      (`RENDER_AT` = 整包 `site/src` 的指紋,08-26 一天變七次)。
      後果:抽 19 個 Topic 主頁,最後抓取日**中位數 08-19**,而標題/摘要在 08-21/25/26
      改過三次 —— Google 一次都沒看過。「523 曝光 1 點擊」量到的是舊摘要。
      已改成逐頁比對算出來的 HTML 指紋(`site/scripts/sitemap-lastmod.mjs`)。
- [x] **驗收指令**:`node scripts/crawl-freshness.mjs`。改版當天實測重爬比例 **8%**。
      判準:<70% 就不要調文案。

### 還沒解:逐國頁到底要不要縮

379 個逐國頁裡,全站 URL Inspection 逐頁驗的結果是 186 頁「Discovered - currently not indexed」、
40 頁「URL is unknown to Google」。同一天抽樣:逐國頁最後抓取日中位 08-27、Topic 主頁 08-19。
看起來像「薄頁吃掉爬取預算」,但**證據不足以據此砍頁**:

- 試過的判準:「該國專屬文字 ÷ 該 Topic 共用摘要」的比值。抽 34 頁查 Google 的實際索引結果,
  分佈是 `0–0.8: 2/2`、`0.8–1: 2/4`、`1–1.2: 1/9`、`1.2–1.6: 4/9`、`1.6+: 5/10`
  —— **不單調,而且每格樣本只有 2–10,是雜訊**。比值預測不了 Google 索不索引,已放棄。
- 而且逐國頁是 08-26 才生出來的,「新頁被爬、舊頁沒被爬」本來就可能只是新舊之分,
  與「吃掉預算」是兩回事 —— 那正好也是 lastmod 那個坑造成的。**兩個原因會互相冒充。**
- [ ] **正確順序:先讓 lastmod 的修法跑一週,再用 `crawl-freshness.mjs` 重測。**
      如果 Topic 主頁的重爬比例上來了,就不需要砍逐國頁;還是沒上來,才有理由動它,
      而且到時候該用的判準是**Google 自己的判決**(持續 N 天 Discovered-not-indexed 的退出 sitemap),
      不是猜一個內容量門檻。

### 需求端(這才是天花板,要用戶決定方向)

- [ ] 523 曝光/28 天,就算 CTR 修到 5% 也只有 ~26 次點擊/月。**技術修完不會改變量級。**
- [ ] 站上排進前 10 的有 23 個查詢,但曝光都是個位數到 47。把已經排 5–10 名的那幾格
      (`dia da mulher 2027` 47 曝光名次 9.0、`2027印尼齋戒月時間` 45 曝光名次 5.2)推進前三,
      比再開一個頁型有效。
- [ ] **486 題 × 7 語只有 `/questions/` 一個 URL**,而 379 個自動生成的逐國頁各有一個。
      這是站上唯一 Google 答不出來的內容。但**別直接開 3,402 個問題頁**(會重演逐國頁),
      正確做法是掛回那 57 個 Topic 頁,加深已經在贏的頁面。
- [ ] **外部連結 = 0**:`referringUrls` 全是自己七站互連 + 自己的 sitemap。爬取預算的上限來自這裡,
      沒有技術手段能繞過。

# 待辦(2026-08-11 M1 收尾時整理;完成一項劃掉一項)

> 現況不要信本檔——逐項用附的指令查,查完再動手。

## 全面巡檢的做法(2026-08-22 第一次做,抓到一件真的壞掉的事)

**巡檢的價值不在「確認一切正常」,在於抓到那種「只有一條查法看得出來」的故障。**
這次就抓到:CI 連續五次失敗、en 與 br 兩站落後兩個 commit,而其餘五站是綠的 ——
除了「七站分別是哪一版」那條,其他查法全部正常。緣由與修法見上面那兩條 🔴。

要跑的清單(全部是 CLAUDE.md 已有的查法,這裡只記順序與判準):

| # | 查什麼 | 判準 |
|---|---|---|
| 1 | 七站 `.build-id` vs `git rev-parse HEAD` | **七個都要等於 HEAD**;有一個落後就往下查 CI |
| 2 | `gh run list -R weiqi-kids/aeiou.now --limit 5` | 有 failure 就看 `--log-failed` |
| 3 | `git log -1 --format=%cr -- data/` | 超過約 2 小時就查 `jobs` 表 |
| 4 | `jobs` 表非 success/skipped 的列 | ⚠ 要**排除已標註處理過的舊列**再看,否則會被歷史嚇到 |
| 5 | 七語系全部 build | 只 build 一個語系必定漏掉「只在部分語系撞」的錯 |
| 6 | i18n 佔位與 key 一致 / sitemap lastmod=loc | 兩個數字必須相等 |
| 7 | `seo-health.mjs` 四層 | ② 層列出的未索引頁要逐一判「是新頁還是有缺陷」 |
| 8 | 各 `--report`(quality/source/ranking/archive/ga4/moderation) | 看有沒有需要人看的項目 |
| 9 | `npx wrangler d1 info aeiou-ugc` | **讀應該多於寫**;寫遠大於讀=自己的同步在灌 |
| 10 | `npx wrangler vectorize info aeiou-topics` | 向量數應等於 active Topic 數 |
| 11 | `pgrep -af '[a]stro (dev\|preview)'` / `'[h]ttp\.server'` | 必須是空的 |
| 12 | `/root/.claude/bin/maint-summary.sh --brief` | 主機層,不屬本專案但會影響 seo-ops |

⚠ **巡檢時最容易自己騙自己的一點**:用自己臨時寫的解析去讀 API 回應。
這次查語意搜尋時我讀成 `results` 而回應其實叫 `matches`,差點把好的功能報成壞的。
**照 CLAUDE.md 寫的查法用 `python3 -m json.tool` 看原始回應**,不要自己挑欄位。

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
- [x] 效果觀測**已結案(2026-08-25)**,但結論不是「有沒有從 67.6 往前走」——
      **那個 67.6 本身是分類器造出來的假象,基準作廢,不要再拿它比。**
      當天解鎖(GSC 資料窗推進到 08-22)後一查,舊的二分類說「跨國/制度型 2 查詢、86.5 名」,
      看起來像這類查詢根本沒需求。實際上是 `INST_RE` 只抓顯式多國詞(哪些國家/各國/怎麼過),
      **抓不到「節日＋國名」** —— 而那才是這個站真正排得上去的查詢。
      拆成三類重算,同一份資料結論相反:
      | 意圖(2026-08-25 量;現況一律重跑指令) | 查詢 | 曝光 | 點擊 | 平均名次 |
      |---|---|---|---|---|
      | 跨國/比較/制度規則 | 10 | 12 | 0 | 63.0 |
      | **國家×節日(單一國制度)** | 26 | 98 | 0 | **15.0 ← 全站最好** |
      | 名稱/翻譯型(diwali 中文 / diwali とは) | 7 | 19 | 0 | 69.5 |
      | 純日期型(答案框標準品) | 49 | 261 | 1 | 18.2 |
      分類器已改進 `scripts/seo-health.mjs` ③ 層(四行 + 錯配層),**不要改回二分類**;
      理由與實測寫在該檔那一段的註解裡。現況一律 `node scripts/seo-health.mjs` 重跑。
- [x] **真正的瓶頸:摘要答錯國家 —— 已修**(2026-08-25 查出並經用戶核准後改掉)。
      `query × page` 交叉下去,站上**排進前 15 名的帶國名查詢全部是「本市場的人問外國的事」**
      (11 個查詢、83 曝光、平均 6.5 名、**0 點擊**),問本國的查詢**一個都沒進前 15**。
      最大那一筆:`2027印尼齋戒月時間` 排 5.2、41 曝光、0 點擊,搜尋者在 TWN/HKG/IDN,
      落在 zh-TW 站的 `ramadan-and-eid` —— 而 description 開頭是
      「台灣不把開齋節列為法定假日…」。**頁面上有印尼那一段**(該 Topic 涵蓋 6 國含 ID),
      只是摘要沒把它擺前面。一個問印尼的人看到摘要在講台灣,不點是理性的。
      ⚠ **這不是推翻 2026-08-21**:「把日期換成制度」那半是對的(純日期型 32.7→18.2),
      換掉的只是「哪一國」的選法。
      改法(五處,都已上線):
      1. `scripts/lib/demand-country.mjs` —— 查詢字串 → 國碼的解析。國名讀
         `data/meta/countries.json`(七國七語),**不寫死國名**;另有一小張別名表
         (`usa`/`america`、簡繁寫法、`jepang`/`tiongkok`…),長名先比,
         免得「印度尼西亞」被判成「印度」。門檻也在這裡。
      2. `scripts/gsc-demand-country.mjs` —— 從 `gsc_query_metrics` 算每個
         (topic, locale) 的需求主題國,寫 `topic_demand_country`。整批覆蓋,
         掉到門檻以下要能退回舊行為。
      3. `scripts/export-data.mjs` —— 匯出成 `facts.json` 的 `demand_countries`。
      4. `site/src/pages/topic/[slug].astro` —— `leadCountryCode` 決定第一句講誰;
         lead 不是本市場時,本市場那一句排第二順位(塞得下就塞)。
      5. `site/scripts/check-local-scope.mjs` —— 守門改成檢查 lead 排最前面。
      🔴 **`topic_search_metrics.scope` 的 `country:XX` 不能拿來做這件事** ——
      那是**搜尋者所在國**,不是**查詢問的那一國**。上面那筆搜尋者在 TWN/HKG/IDN,
      問的卻是印尼。我在 2026-08-25 的第一版提案裡就講錯過一次,寫在這裡免得再錯。
      門檻刻意保守(指名曝光 >=5 且佔該格多數):這是會改變每個讀者看到什麼的判斷,
      寧可少改也不要靠一兩次曝光就翻盤。**沒有結論的格子退回本市場那一國**,
      所以絕大多數頁面在資料累積起來之前不會變 —— 這是設計,不是還沒生效。
      現況一律查:`node scripts/gsc-demand-country.mjs --report`。
- [ ] ⛔ 效果觀測:看那 83 曝光有沒有開始有點擊。**不是「再等等看」** —— 要看的是
      `seo-health.mjs` 的「摘要答對國家了嗎」那一層,「問外國」那行的 CTR。
      前提同上面那項(Google 要先重爬過改版後的頁面,`inspectUrl` 查 `lastCrawlTime`)。
      判準:那一行的曝光基數已經夠(83),所以**只要有點擊出現就是訊號**;
      若重爬後仍長期 0 點擊,下一個要查的是 SERP 上有沒有答案框吃掉這類查詢。

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
- [x] 效果觀測**已結案(2026-08-25)**:GSC 資料窗推進到 08-22 後查完了,
      結論見上面「搜尋意圖重新對準」段的結案條目 —— **舊的 67.6 基準作廢**(分類器的假象),
      真正的瓶頸是「摘要答錯國家」。同一條指令:`node scripts/seo-health.mjs` 的 ③ 層。

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
- [x] **SEO 成長工作清單改成每日可回看的快照**(2026-08-23)。
      `seo-growth.mjs` 預設仍是唯讀；`--record` 由 hourly-export 以 `job_locks` 對齊 UTC 日,
      把 GSC query/page 的 P0–P3、GA4 原始／可當真人看的瀏覽、意圖分類與 120 天季節跑道
      寫入主機私有的 `seo_growth_snapshots`／`seo_growth_actions`。查:
      `node scripts/seo-growth.mjs --history`。這些資料不進 data/、D1 或前端。
- [x] **首頁與關於頁去產品簡報語氣**(2026-08-23)。七語系改成讀者實際會查的問題、
      來源、下一步與經驗分享；移除「平台／Topic Engine／自動彙整」作為價值主張,
      `scripts/check-editorial-voice.mjs` 已加入 CI 守門。趨勢 Topic 的自動產生仍明白標註,
      不把自動化冒充人工查證。

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

- [x] **全部 Topic 補到目標水位(2026-08-23)**。目標=每語系 1,200 唯一字元、5 個地方變體
  (對照基準:2026-08-19 實測 folk.tw 主力內容頁渲染後去重 1,600–2,930 字元)。
  現況查法:`node scripts/check-content-depth.mjs --report`(看最後一行「未達目標」)。
  補完一批一定要跑 `--update-baseline` 把新水位鎖住,否則下次改動可以無聲退回去。
  本輪補強了 `pet-preparedness` 與 `pets-and-family` 的簡體中文實質段落，現在 43/43 通過,
  最薄頁為 1,210 唯一字元，baseline 已在 2026-08-23 重鎖。
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

## 這一輪的收尾(2026-08-27):13 個新 Topic + 假日母表上線後留下的東西

**成效一句都還不能講** —— 這輪改動在 08-26/27,而 GSC 的資料窗本身固定落後 2–3 天,
新頁的曝光筆數是 0(是「還沒進資料」,不是「差」)。判「有沒有效」之前先確認 Google 重爬過:
`inspectUrl` 的 `lastCrawlTime`。08-27 抽驗的結果**已經**回答了一件事:

| 抽驗網址 | coverageState | lastCrawlTime | referringUrls |
|---|---|---|---|
| `/holidays/{tw,br,jp}/2027/`、`/holidays/cn/2026/` | URL is unknown to Google | never | **0** |
| `/topic/{carnival,halloween,shopping-festivals,tanabata-and-qixi,equinox-and-seasonal-turns}/` | URL is unknown to Google | never | 0 |
| `/topic/war-dead-and-veterans/`、`/topic/womens-day/`、`/topic/ramadan-and-eid/id/` | Submitted and indexed | 08-25～08-26 | 1–4 |

→ 同一天上線的新頁,有站內連結的已被索引、沒有的一個都還沒被發現。
**`referringUrls` 0 是自己的問題,不是 Google 慢。** 已修的兩件見下。

- [x] **假日總表接上站內入口**(逐國頁底部「<國>的假日總表」,判準共用 `holidayCellsFor()`)。
- [x] **IndexNow 涵蓋新頁**:`scripts/indexnow.mjs` 原本只認 Topic 變動 → 147 個假日網址
      一次都沒送過;更糟的是它在 CI 是獨立 job(只 checkout 不 build),讀
      `site/dist/sitemap.xml` **永遠讀不到**,所以逐國頁那一段從 08-26 上線以來也是
      靜靜地送 0 筆。已改成抓**線上** sitemap(逐 origin 各自一份,就是真的上線的那一份)。
      查:`node scripts/indexnow.mjs --dry-run`(七站各應有數百筆,不是幾十筆)。
- [x] **17 個 active Topic 沒排進 52 週日曆**(含這輪 11 個新的與 carnival / exam-season /
      islamic-calendar-days):已依實際發生週次補進 `content/topic-calendar.json`。
      `check-topic-calendar.mjs` 只驗「每週至少一個」,所以它擋不下這種漏 ——
      查法是比對兩邊:週次清單 vs `topics` 的可見 manual Topic。
- [x] **中國 2027/2028 的日期語意**:2026 是含調休的實際放假起迄,2027/2028 是法定天數區間。
      只靠 `date_status: estimated` 說不出這件事 → 新增 `year_notes`(七語)印在表格上方。
- [x] **印度來源換掉觀光英文頁**(推翻 08-26 的「這台主機做不到」,見下一節)。
- [x] **新 Topic 的在地資料**(2026-08-27 補完十個地點):掛得到地點的 Topic 12 → 23。
      東京 国立天文台三鷹キャンパス(equinox)、上海猶太難民紀念館(jewish)、南京路步行街(shopping)、
      宋慶齡故居(womens-day)、台北國父紀念館(founders)、孔廟(exam-season)、市立動物園(environment)、
      兒童新樂園(halloween)、聖保羅 Museu Afro Brasil(emancipation)、Catedral da Sé(christian),
      雅加達 Istiqlal 補掛 islamic-calendar-days。每一個都逐頁驗過 marker,來源全是官方頁。
      **仍然沒有地點的兩個**:`tanabata-and-qixi`(台北霞海城隍廟官網從本機連不上;東京大神宮的頁面
      沒有七夕字樣,掛上去等於用一個頁面沒說的事當來源)、`long-holiday-weeks`(連假不對應任何一個
      可造訪的地點,硬掛會是為了填格子而填)。現況查法:
      `sqlite3 db/aeiou.sqlite "SELECT COUNT(DISTINCT topic_id) FROM place_topics"`。
      ⚠ 在地資料的市場城市固定七個(taipei/tokyo/shanghai/loveland/pune/jakarta/sao-paulo),
      而且**每個站只看得到自己市場那一城** —— 所以上海的地點在 zh-TW 站上是看不到的,
      驗收要在該語系的 build 裡查(實測:zh-CN build 才看得到宋慶齡故居)。
- [x] **題庫延長**(2026-08-27):2027-01-14 → **2027-04-14**(+90 天、+180 題)。
      實測吞吐:並行 8 → 20.3 秒/天(牆鐘,177 天/小時),比 08-26 量到的 27.6 秒/天更快。
      ⚠ **裸 `--until` 補不到區間內部的洞**:它從「題庫最後一天」往後算,看不到中間缺的日子。
      這一輪 90 天裡有 3 天第一輪 JSON 解析失敗被放棄,要用
      `--from 2027-01-31 --until 2027-04-14` 才補得到(冪等,已有的日期自動跳過)。
      現況查法:`sqlite3 db/aeiou.sqlite "SELECT kind,COUNT(*),MIN(qdate),MAX(qdate) FROM questions GROUP BY kind"`。
- [~] **活動快見底** —— 這一輪只補得到一場,**不是沒找,是公告還沒出來**:
      | 找過的 | 結果 |
      |---|---|
      | Liga-SP 2027 出場順序 | ✅ 已收:Grupo Especial 2027-02-05～06,Sambódromo do Anhembi |
      | Loveland Winter Wonderlights 2026 | 官網寫著這一季不辦 |
      | 聖保羅 Natal Iluminado 2026 | 只有 2025 檔期的頁面,2026 未公告 |
      | Dagdusheth Ganeshotsav 2026 | 官方頁面的時程表仍停在 2025 場次 |
      | 臺北天文館 9 月活動 | 那則新聞的網址已下架(404) |
      八月底找十月以後的活動,多數主辦單位還沒公告 —— 這是季節性的,不是搜尋方法的問題。
      所以改成**讓系統自己講**:`update-local-data.mjs` 每輪印「活動存量」,
      未來場次 < 10、最近一場 > 14 天、或某個市場一場都沒有,就 WARN(永不擋輸出)。
      門檻可用 `AEIOU_EVENT_RUNWAY_MIN` / `AEIOU_EVENT_RUNWAY_DAYS` 調。
      查:`node scripts/update-local-data.mjs --check-only | grep 活動存量`。
      🔴 補活動的硬條件:官方頁面上要**真的印著那個日期**(`date_markers`),否則收不進來 ——
      這道門是刻意的,它擋掉「我記得大概是十月」這種資料。
### 假日母表的資料品質(都已標註,尚未解)

- **中國**:記者節(11/8)整筆沒收(所有可達的 `.gov.cn` 頁都驗不到日期);
  第四條的少數民族節日整批沒收(國家層級不存在清單)。
- **印度**:`hazrat-ali-birthday` 少了 2026-12-23 那一列 —— 2026 年有兩個 13 Rajab,
  而 schema 是「一年一個日期」塞不下;statutory 17 天裡只有 14 天全國強制,
  另外 3 天由各地 CGEWCC 自選,schema 也表達不出來。
- **印尼**:Nyepi 2027 日期存疑(我方演算法 3/9,峇里曆網站 3/8);
  commemorative 類完全沒有(Hari Kartini 等各由獨立 Keppres 訂,找不到彙整)。
- **日本**:2028 的「無振替休日」結論繼承 estimated —— 2027 年 2 月官報公告春分/秋分後要重跑。
- **台灣**:2028 端午(5/28 週日)的補假未填(規則上必有,公告未出,**不自己生**)。
- **巴西**:Good Friday 的法律定性未釐清 —— MGI 表印 feriado nacional,
  而 Lei 9.093/1995 把它列為市定宗教假日。屬 `easter.md` 的範圍。

### Topic 內容的已知問題

- `shopping-festivals` 的 IN `big-billion-days` 三年日期相同且無官方來源(估計佔位)。
- `beer-festivals` 的 2027/2028 全部 estimated(從單一年度反推規律),公告出來要覆蓋;
  兩個青島來源仍是 `http://` —— 見下面「卡點」。
- `long-holiday-weeks` 與 `labour-day` 同時掛著 JP `golden-week`(同一個 observance 在兩個
  Topic)。repo 有先例,判斷保留;要改就是挑一邊當主、另一邊改用 regional note。

### 卡點(外部因素)

- **`beer-festivals` 兩個青島來源仍是 `http://`**:伺服器只送 leaf、不送中介憑證,
  瀏覽器走 AIA 補得回來,Node 的 fetch 不會 → 守門永遠 `fetch failed`。
  解鎖條件:青島市政府補送中介憑證,或守門支援 AIA。
  2026-08-27 把整條鏈追出來了(可據此實作,也可據此判斷值不值得):
  leaf 的 AIA → `http://ica.wt.trustasia.com/TrustAsiaDVTLSRSACA2024.crt`,
  該中介的 AIA →`…/TrustAsiaTLSRSARootCA.crt`,而那張根憑證是由 **Certum Trusted Network CA
  交叉簽發**的 —— Certum 在系統信任庫裡。實測:
  `openssl verify -CAfile /etc/ssl/certs/ca-certificates.crt -untrusted <兩張> leaf.pem` → OK。
  也就是說**要追兩跳**才接得回信任根;只補第一張中介會變成「把中介當信任錨」,那是降低驗證強度,不要那樣做。
  ⚠ 順帶量過:目前其他 `fetch failed` 的來源(utsav.gov.in、unesco.org、npm.edu.tw)
  TLS 都是 `Verify return code: 0 (ok)` —— 失敗原因不是憑證鏈,所以實作 AIA 只會救到青島這兩筆。
- **`www.npm.edu.tw` 整站從本機連不上**(2026-08-27):連根目錄都 `fetch failed`,
  WebFetch 那條網路也是 ECONNRESET。它是 zh-TW 的一個 place 來源,
  原本會被算成三輪傳輸層失敗然後**擋掉整條 hourly-export** —— 已改判為封鎖層(只 WARN)。
  要確認那一頁是否真的還在,得從別的網路打一次。
- **74 個來源從未被驗證**:46 個被擋/暫時失敗(403/5xx)+ 28 個 robots `Disallow: /`
  (主要 `law.moj.gov.tw`)。前者要從別的網路出口複驗,後者只能人工開。
  🔴 403 一律當「不准抓」,不換 UA、不重試、不繞路。

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

## 26 個 Topic 零曝光(2026-08-26 查證;title 兩項已改,其餘列為缺口)

起因:用戶問「為什麼 26 個 Topic 連曝光都沒有」。43 個 active Topic 裡只有 17 個
在 `topic_search_metrics` 有任何曝光。

**先排除的三件事(都實測,不是推論)**

| 檢查 | 做法 | 結果 |
|---|---|---|
| 收錄狀態 | GSC URL Inspection 逐一查 26 個 | 26/26 `Submitted and indexed`、robots `ALLOWED`、fetch `SUCCESSFUL` |
| sitemap | `curl sitemap.xml` 比對 active slug | 43/43 都在;`<loc>` 與 `<lastmod>` 數相等 |
| 累積管線 | `jobs` 表查 `gsc-topic-metrics` | 08-23/24/25 皆 success;資料只到 08-22 是 GSC 自己的 3 天延遲 |

⚠ **`lastCrawlTime` 不能拿來推「第一次被爬是什麼時候」** —— 它是最後一次。
對照組(17 個有曝光的)裡 `womens-day`、`moving-home` 的 lastCrawl 也在 08-25。
要判「這頁存在多久」用 `topics.created_at`,不要用 lastCrawlTime。

**真正的原因:站上只贏得了一種查詢型態**

`gsc_query_metrics` 全部 180 列按「查詢裡有沒有年份」切開:

| 型態 | 查詢數 | 曝光 | 曝光加權平均名次 |
|---|---|---|---|
| 含年份(`2026年祖父母節是哪一天`、`dia da mulher 2027`) | 33 | 245 | **12.3** |
| 不含年份(`劳动节`、`diwali とは`、`labor day date`) | 98 | 134 | **63.1** |

頭部大詞的實測名次是 60 幾名。能進前 15 的只有「專有名詞 + 年份」這種低競爭長尾。
26 個零曝光頁各自因為不同理由打不到它:

1. **19 頁沒有任何 observance** → title 生不出年份,後綴還掛著「N 國怎麼過、哪裡放假」
   (兵役、義務教育、官方語言、婚俗、喪葬、寵物…)。**已改**:後綴依資料三選一。
2. **5 頁有節日但 title 用自創上位詞**。專有名詞只活在內文:
   `中元節` 內文 12 次 / title 0 / h1–h3 0;`農民節` 16 / 0 / 0;`學測` 24 / 0 / 0;
   `春運` 6 / 0 / 0(連 description 都沒有)。中元節就是隔天(08-27),那頁旺季中仍 0 曝光
   —— 不是季節問題。**已改**:title 前置本市場當地叫法,🌎 的 h3 一律帶當地叫法。
3. **5 頁名稱對但撞頭部大詞 + 淡季**(聖誕節、春節、元宵節、端午節、中秋)。**未解**,
   這一類要贏得靠長尾角度,不是靠改標題。
4. 9 頁建立於 08-21~08-23,而資料窗只到 08-22。**這是附註不是主因**:
   `elders-day` 建於 08-21 16:01,08-22 單日就拿到 105 曝光、名次 10.6;
   `year-end-bonus` 晚它 21 分鐘建立,0 曝光。年齡不是免死金牌。

**這一輪改了什麼**(`site/src/lib/seo.mjs` + `site/src/pages/topic/[slug].astro`)

- `compareSuffix` / `ruleSuffix` / `practiceSuffix` 三選一,判準取自
  `countries.length` 與 `facts.category`,七語系字串齊。
- title 開頭前置本市場那一國的 `local_name`(Topic 名退第二段,h1/麵包屑不動)。
  只取本市場那一國;Topic 名已經提到任一個當地叫法就完全不前置。
- 🌎 的 h3:本市場那一國一律帶當地叫法(其餘國家維持「同一國有兩筆才帶」)。

實作時踩到的四個坑(規則就是為了擋它們才長成現在這樣,不要簡化掉):

| 誤傷 | 現象 | 擋法 |
|---|---|---|
| 拿地方活動蓋掉節日本名 | 元宵節頁變成「鹽水蜂炮｜元宵節 2027」 | 判斷「講過了沒」要看**同一國全部** observance,不能用每國只留一筆的 `countries` |
| 括號裡就是 Topic 名 | 聖誕節頁前置「行憲紀念日（同日為聖誕節）」 | 逐「段」比對(拆 `／/｜|（）()`),不拿整串比 |
| 斜線後半就是 Topic 名 | 年終獎金頁前置「Holiday / year-end bonus」 | 同上,逐段雙向包含 |
| 近義的第二筆重複 | 「冬のボーナス(期末手当)、夏のボーナス(期末手当)」 | 共用同一段就視為同一叫法的變體,只留一個 |

**同一輪查出、還沒解的缺口**

- 🔴 **制度型 Topic 的 h3 問句是壞的**:`topic.q_how_country` 是「{country}怎麼過{topic}？」,
  套到沒有節日的 Topic 就變成「巴西怎麼過兵役:被叫去的、只要登記的、和寫在憲法裡沒人叫的？」。
  這跟剛修掉的「哪裡放假」是同一種病,只是在 h3 那一層。要修需要新增一組問句字串
  (制度型用「X 國的兵役怎麼規定？」),七語系各一份 —— 屬文案,等用戶拍板。
- **在地資料是種子量**:`places` 20 筆(每市場 3 筆)、`events` 8 筆(每市場 1 筆),
  43 個 active Topic 裡只有 8 個掛得到 place、6 個掛得到 event。導覽有「附近訊息」
  「活動資訊」兩個入口,點進去幾乎是空的。查:
  `sqlite3 db/aeiou.sqlite "SELECT city_code,COUNT(*) FROM places GROUP BY city_code"`。
- **活動即將見底**:未來場次只剩個位數,taipei 下一場是 08-29。
- **題庫見底日**:`SELECT kind,COUNT(*),MAX(qdate) FROM questions GROUP BY kind`。
- **UGC 幾乎是空的**:posts 15、comments 0。討論串是這個產品存在的理由。
- **local_name 欄位混進了狀態與字體錯置**(4 筆,查法見下),它們現在會被前置到 title:
  - `ghosts-ancestors-and-remembrance/CN` 寫「中元節」(繁體)出現在簡體站
  - `eid-al-adha/TW`「宰牲節／古爾邦節（非法定假日）」、`ramadan-and-eid/TW`
    「開齋節（非法定假日）」、`labour-day/JP`「五月一日（非祝日）／ゴールデンウィーク」
    —— 名字欄裡寫了「是不是假日」,那是 `date_status` 的事。
- **`popularity_rank` 排錯**:ja 的 `ghosts-ancestors-and-remembrance` 讓「節分」排在
  「お盆」前面,於是 title 前置的是節分。
- **來源仍偏英文版路徑**:`check-content-depth.mjs` 有 9 筆 WARN,其中 7 筆 IN 全部指向
  同一個 `incredibleindia.gov.in/en/...` 頁。
- **trend 與 event_website 來源從沒抓過**:`source-refresh.mjs --report` 顯示
  trend 303 筆「抓過 0」、event_website 15 筆「抓過 0」。

## 印度來源換成當地語言版 —— ✅ 已解(2026-08-27),但**不是**靠 dopt.gov.in

**08-26 的結論下錯了一半**:對的是「印度中央部會的網域從兩條網路都進不去」,
錯的是由此推論「換不掉」。DoPT 那份年度 O.M. 本身是**被各中央機關轉貼的**,
而那些機關的網域進得去:

| 換上去的來源 | 這是什麼 | 本機 curl |
|---|---|---|
| `dfe.gov.in/uploads/documents/list-of-gazetted-holidays-2026.pdf` | 2026 年 17 天必放的 gazetted holidays,抬頭直接寫「As per DOPT OM No.F.No.12/2/2023-JCA dated 03 July 2025」 | 200(PDF,可抽文字) |
| `etribal.maharashtra.gov.in/Uploads/General/Public_Holidays_2025.pdf` | 馬哈拉施特拉邦公報,**馬拉地文** | 200 |

七筆 IN 的 WARN 全部消掉(`node scripts/check-content-depth.mjs` 現在 0 筆 ⚠️),
`affection-and-reciprocity/IN/valentine-week` 那筆的「來源撐不住主張」也一併解決 ——
那段散文本來就是在論證「全國清單十七項裡沒有情人節」,現在指的就是那份清單本身。

⚠ **順帶抓到一個內容錯誤**:`labour-day/IN` 七語都寫「May Day 在馬哈拉施特拉、
泰米爾納德等邦是邦級假日」。翻開馬拉地文的邦公報,五月一日那一列寫的是
**महाराष्ट्र दिन(Maharashtra Din,建邦紀念日)**,不是勞動節 —— 同一天放假,
名目是另一件事。七語散文已改成講這件事。**只用英文來源就看不到這一層**,
這正是那條紅線要防的。(泰米爾納德那半沒有可達的官方來源佐證,已刪。)

**仍然做不到的**:`dopt.gov.in` 原始 O.M.、`india.gov.in` 的印地文行事曆。
下表是 08-26 的實測;08-27 只抽驗了 `india.gov.in`、`mha.gov.in`、`labour.gov.in`、
`dopt.gov.in` 四個(結果與表相同),其餘未複驗,保留備查。


`check-content-depth.mjs` 的 9 筆 WARN,其中 7 筆是 IN,全部指向同一個網址:
`https://www.incredibleindia.gov.in/en/plan-your-trip/public-holidays`
(labour-day、christmas、national-days、easter、eid-al-adha、affection-and-reciprocity、ramadan-and-eid)。

**中央部會網域從這台主機與 WebFetch 兩條網路都進不去(08-26 全表實測;08-27 抽驗四個相同)。**
逐一實測根目錄(判準是根目錄通不通,不是狀態碼幾號 —— 見 CLAUDE.md 該條紅線):

| 網域 | 本機 curl | WebFetch |
|---|---|---|
| `incredibleindia.gov.in` | 200 | — |
| `india.gov.in` | 403 | 403 |
| `mha.gov.in` | 403 | — |
| `pib.gov.in` / `www.pib.gov.in` | 403 | — |
| `labour.gov.in` | 403 | — |
| `education.gov.in` | 403 | — |
| `knowindia.india.gov.in` | 403 | — |
| `dopt.gov.in` | 000(連不上) | ECONNRESET |
| `persmin.gov.in` | 000(連不上) | — |

403 一律當「不准抓」,**不換 UA、不重試、不繞路**(紅線)。已從第二條網路複驗過,結果相同。
`incredibleindia.gov.in` 是唯一進得去的 .gov.in,而它**沒有印地文版**:
`/hi/plan-your-trip/public-holidays` 回 404,`/en/` 那頁的 title 是 `Public holidays`、
देवनागरी 字元數 0。所以「回頭找同一站的當地語言版」在這一站不存在。

**還沒解鎖的部分**:要引用 `dopt.gov.in` 的 O.M. 原檔或 india.gov.in 的印地文行事曆,
仍然需要另一條出口網路。但這已經不擋內容 —— 轉貼那份 O.M. 的中央機關網域可用(見本節開頭)。

~~⚠ 順便查到一個更嚴重的:`affection-and-reciprocity/IN/valentine-week` 的來源撐不住主張~~
→ 2026-08-27 已解:那段散文論證的就是「全國清單裡沒有情人節」,來源換成清單本身即成立。

**印尼那兩筆已解**:`kemenag.go.id` 去掉 `/en/` 同網址可用(200 + `lang="id"`),三處已換。
`fathers-day/ID` 的 `pa-tulungagung.go.id` 已改存**正規的印尼文路徑**(不帶 `/en/`);
那站的 Joomla 仍會把任何路徑導回 `/en/`,但文章本文是印尼文(title `Hari Ayah Nasional |
Sabtu, 12 November 2022`),`/en/` 只是樣板語言。守門的 WARN 因此消掉,而存的網址也更正確。
候選替代 `ham.go.id`(法務與人權部人權總局,印尼文,講 2006 梭羅那場宣告)**從本機連不上**
(000),之後複驗再考慮補上。

## 六個 civic Topic 的標題是句子不是名詞片語(2026-08-26 記錄,未解)

`compulsory-education`、`military-service`、`official-languages`、`parental-leave`、
`religion-and-the-state`、`voting-and-elections` 的 title 在部分語系是**整句話**:
「兵役:被叫去的、只要登記的、和寫在憲法裡沒人叫的」「生了小孩之後,法律給你多少天」
「Conscripted, registered, or merely obliged on paper」。

後果:逐國頁的 title 會印成「巴西：兵役:被叫去的、只要登記的、和寫在憲法裡沒人叫的」。
已經做的緩解是取「第一個冒號之前」,但**冒號在各語系不一致**——
`military-service` 的 en/pt-BR/hi 標題根本沒有冒號,所以那三語仍然是整句。
問句那一層已經改成不嵌主題名(見 `topic.q_rule_country` / `q_practice_country`),
所以 h1 與 h3 沒問題,剩下的只有 title。

要根治只有一條路:**把那六個 Topic 的 title 改成名詞片語**(七語各一份)。
那是產品文案,屬用戶。字串手術在這裡是死路,不要再試。

---

## 零曝光的真因是「需求在裸詞、我們只贏年份詞」(2026-08-26 第二輪,Bing 實測)

起因:用戶再問一次「為什麼這些 Topic 連曝光都沒有?除了這些之外沒有別的 Topic 可以做了嗎?」

**先對數字**:當下 active 44、有曝光 19、零曝光 **25**(page 面 `topic_search_metrics`
與 query 面 `gsc_query_metrics` 兩種算法同為 25)。上一節寫 26 是那一刻的數(當時 active 43)。
查法:見 CLAUDE.md;不要引用這裡的數字。

### 量測工具(這一輪第一次用在本專案上)

`node /root/seo-ops/bin/keyword-demand.mjs --file <字表> --country <cc> --language <ll-CC>`
—— Bing Webmaster `GetKeyword`,是本主機唯一能在伺服器端直接量到絕對搜尋需求的來源。

- **對照組已驗**:`carnaval 2027` @ br/pt-BR 回 exact 38,488,與 `fecb9ab` 當時的數字一致。
- ⚠ **參數坑(實測)**:印尼的 `language` 用 `id-ID` / `id` / `in-ID` **全部**回
  `argument was out of the range of valid values`,**只有 `en-ID` 可用**。
  其餘六站:tw↔zh-TW、us↔en-US、jp↔ja-JP、cn↔zh-CN、in↔hi-IN、br↔pt-BR。
- ⚠ 連續打會回 `ThrottleUser`;一輪 20~30 字、市場之間並行沒事,再多要分批。
- ⚠ 判讀邊界照 `connections.md`:這是 **Bing** 的量,只能判「是不是 0」與相對大小,
  不能當絕對流量預估;**有量 ≠ 打得贏**。

### 這一輪推翻的假設:不是「季節沒到」,也不是「沒有需求」

同一個詞量「裸詞」與「加年份」兩種形狀,結論很硬:

| 市場 | 裸詞 exact | 加年份 exact |
|---|---|---|
| 端午節(tw) | **5,251** | 端午節 2027 = **0** |
| 中秋節(tw) | 2,902 | 中秋節 2026 = 1,426 |
| 中元節(tw) | 1,122 | 中元節 2026 = 619 |
| 元宵節(tw) | 105 | 元宵節 2027 = **0** |
| 學測(tw) | 790 | 學測 2027 = **0** |
| お盆(jp) | **63,888** | お盆 2026 = 46,413 |
| 十五夜(jp) | 2,991 | —— |

站上唯一贏得下來的查詢形狀是「專有名詞 + 年份」(上一節實測:含年份 12.3 名、
不含年份 63.1 名)。而**需求的大宗在裸詞**,加年份那一支往往等於 0。
所以「零曝光」不是季節、不是沒人搜 —— 是**我們只在需求最細的那一條縫裡排得上去**。

### 25 個零曝光的五種真因(互斥,各有實測)

| 類 | 幾個 | 是什麼 | 證據 |
|---|---|---|---|
| A 構不成年份查詢 | 14 | 沒有任何 observance,主題本身不接年份(兵役/義務教育/官方語言/投票/育嬰假/寵物/喪葬/婚俗/成年/滿月/長照/畢業/ask-the-world) | 官方語言・投票年齡・喪禮・婚禮習俗・養寵物 @tw **全 0**;育嬰假 1,732、畢業典禮 322、兵役 235 有量但都是裸詞,且第一名是勞動部那種機關頁 |
| B 需求在裸詞、當令、我們仍 0 | 5 | mid-autumn / ghosts / lantern / dragon-boat / exam-season | 見上表。中元節就是隔天、中秋不到一個月,需求量得到,曝光是 0 |
| C 年份型需求 = 0,裸詞是頭部大詞 | 4 | christmas / new-year / year-end-bonus / islamic-calendar-days | 聖誕節 2026=0、クリスマス 2026 exact=0、正月 2027=0、ano novo 2027=0、tahun baru 2027=0、年終獎金 2027=0、maulid nabi・isra miraj・tahun baru islam 2027 **全 0** |
| D 主題名對的市場沒需求 | 1 | harvest-and-gratitude | 農民節 @tw = **0**(連 Bing 都沒人搜);同一個 Topic 的 Thanksgiving 2026 @us = **143,357**、勤労感謝の日 @jp = 1,400 |
| E 太新,量不到 | 1 | carnival | 08-26 建立,GSC 窗只到 08-23 |

🔴 **B 與 D 的補救(title 前置當地叫法、後綴依資料三選一)全部在 08-26 04:11~13:08 才上線,
而 GSC 資料窗到 08-23 —— 也就是那批修正一次都還沒被量測過。** 現在論斷它有沒有效都是推論。
線上已驗:jp ghosts = `お盆、節分｜…`、tw mid-autumn = `中秋節｜…`、
en harvest = `Thanksgiving Day | …`、逐國頁 = `Memorial Day, Halloween 2026 | United States: …`。

### 「沒有別的 Topic 可以做了嗎?」—— 相反,最大的幾個都還沒做

本輪量到、**站上沒有對應 Topic**(或只當成別的 Topic 的第二順位 observance 埋著)的字:

| 市場 | 字 | exact / 3 個月 | 站上現況 |
|---|---|---|---|
| us | `memorial day 2027` | **51,340** | 埋在 ghosts 的 US rank 2 |
| us | `veterans day 2026` | 27,169 | 無 |
| us | `columbus day 2026` | 26,721 | 無 |
| us | `rosh hashanah 2026` + `yom kippur 2026` + `passover 2027` + `hanukkah 2026` | 26,640 + 18,388 + 6,434 + 5,012 = **56,474** | 無 —— 缺一個與 `islamic-calendar-days` 對稱的猶太曆 Topic |
| us | `presidents day 2027` | 19,260 | 無 |
| jp | `シルバーウィーク 2026` | 13,816 | 無 |
| jp | `ハロウィン`(裸) | 11,047 | 只在 ghosts 的 US 那格 |
| br | `feriados 2027` | **14,940** | 無 —— 這是「某國某年假日總表」型態,逐國頁是 Topic×國家,缺的是國家×年份 |
| us | `juneteenth 2027` | 5,034 | 無 |
| us / br | `oktoberfest 2026` | 4,452 / 1,041 | 無 |
| jp | `お彼岸 2026` | 4,218 | 無 |
| jp | `ゴールデンウィーク`(裸) | 3,022 | 無 |
| us / br / tw | `black friday` 系 | 2,814 / 1,741 / 138 | 無 |
| br | `corpus christi 2027` | 2,112 | 無 |
| us | `earth day 2027` | 1,982 | 無 |
| tw | `七夕`(裸) | 1,438 | 無(affection 只有情人節) |
| tw | `萬聖節`(裸) | 330 | ghosts 的 TW 那格沒有萬聖節 |
| tw | `感恩節`(裸) | 211 | harvest 的 TW 那格是農民節(0 需求) |

**同一輪量到的零需求字**(寫了等於白工,記下來免得下次又想做):
`festa junina 2027`、`dia dos namorados 2027`、`dia de acao de gracas 2026`、
`sao joao 2027`、`tiradentes 2027`、`finados 2026`、`sete de setembro 2026`、
`農民節`、`春運`、`韓國中秋`、`日本黃金週`(從 tw 問)、`侯麗節`、
`hari guru/ibu/ayah/anak 2026`、`hari kartini/buruh 2027`、`waisak 2027`、
`法定节假日 2027`、`放假安排 2027`、`bank holidays 2027`、`april fools day 2027`。

⚠ id 與 in 兩個市場整體量值都很小(idul fitri 2027 = 24、diwali 2026 @in = 82),
那是 **Bing 在這兩國市佔低**,不是沒需求 —— 這兩站只能判「是不是 0」,不能拿數字跨市場比大小。
