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
- [ ] **組織未強制兩階段驗證**(`two_factor_requirement_enabled=false`)。這與上一條無關,
  但爆炸半徑比它大得多。查:`gh api /orgs/weiqi-kids --jq .two_factor_requirement_enabled`。
  要開之前得先確認組織成員(含機器帳號)都已設定 2FA,否則會被踢出組織——**動工前先問用戶**。

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
