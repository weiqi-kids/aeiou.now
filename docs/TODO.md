# 待辦(2026-08-11 M1 收尾時整理;完成一項劃掉一項)

> 現況不要信本檔——逐項用附的指令查,查完再動手。

## 部署與基礎

- [x] **`id` 站(印尼)線上還是舊版**——2026-08-14 實測 `.build-id` 已與 HEAD 一致,GitHub 端建置恢復。
- [x] **M1 完成定義 #3 的七站全綠重驗**——2026-08-14 依「七站分別是哪一版」查法實測,七站 `.build-id` 全部等於 HEAD。
- [ ] **`weiqi-kids` 組織的 deploy key 開關**目前是開的(`deploy_keys_enabled_for_repositories=true`,
  2026-08-11 為了 aeiou 打開,影響整個組織)。用戶未表態要不要維持;要關回去前先確認
  CI 改用其他機制,否則七站部署會壞。查:`gh api /orgs/weiqi-kids --jq .deploy_keys_enabled_for_repositories`

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

- [ ] **題庫要持續補**:涵蓋日期用指令查(`SELECT MAX(qdate) FROM questions`),用完前端會停在最近一題
  (不開天窗但會失去「每日」感)。補題=編輯 `content/questions.json`。之後可排每週 claude 批次產題
  (額度回復後再議,動工前問用戶)。
- [ ] **「個人」世界公民排行榜**被 OAuth(M2)擋住(anon_id 無顯示名且 Safari 下不穩,拿來排名會做出隨機掉名次的榜);
  本次交付**社群層級**參與榜(participation 端點)。OAuth 上線後升級。
- [ ] **guess 題的答案在靜態 JSON 裡**(view-source 可先看到)——遊戲性取捨,記錄在案;要藏就得把揭曉搬進 Worker(契約變更)。
- [ ] **/questions/ 頁每卡各發一次 results 請求**:題庫累積後單次載入的並發會線性成長
  (GET results 目前無限流、無 Cache-Control)。題數過 30 前加 lazy-load(進 viewport 才 fetch)或批次端點。
- [ ] **`scripts/export-data.mjs` 含 3 個 NUL 位元組**(複合鍵分隔符,2026-08-15 驗收時發現、HEAD 既有),
  git 視其為二進位 → 這支腳本的任何改動在 diff/PR 上看不見。建議改用可見分隔字元,另案處理。

## M2 前置:GSC/GA4/DNS/Slack 設定(2026-08-11 用戶指示動工)

- [x] **網域註冊**(2026-08-15):GoDaddy。查:`curl -sL https://rdap.org/domain/aeiou.now`。
- [x] **DNS**(2026-08-15):**採 GoDaddy 自家 DNS(非 Linode 慣例)**,用戶面板手動管理,主機無 API 權限。
  記錄=apex A×4+AAAA×4(GitHub Pages 固定 IP)、六子網域 en/jp/cn/hi/id/br CNAME →
  `weiqi-kids.github.io`、GSC TXT。查:`dig @1.1.1.1 +short A aeiou.now`(換 AAAA/TXT/CNAME 各查)。
  ⚠ **切自訂網域上線前必須先補 Bot 防護**(下節紅線)。
- [ ] **GitHub org 網域驗證(防 subdomain takeover;DNS 已指向、repo 未綁,窗口開著)**:
  無 REST API(2026-08-15 實測 /orgs/*/pages* 皆 404),只能 UI:
  `github.com/organizations/weiqi-kids/settings/pages` → Add a domain → 取 TXT code →
  GoDaddy 加 `_github-pages-challenge-weiqi-kids` TXT → Verify。**用戶端動作**。
  查:`dig @1.1.1.1 +short TXT _github-pages-challenge-weiqi-kids.aeiou.now`(有值=TXT 已加)。
- [x] **GCP 專案+SA**(2026-08-12 完成):專案 `aeiou-seo`、SA `seo-ops@aeiou-seo.iam.gserviceaccount.com`、
  金鑰 `~/.config/aeiou/ga4-sa.json`(600),已啟用 analyticsadmin/analyticsdata/searchconsole API。
  隔離已驗:金鑰見 0 個外站資源。**GSC/GA4 授權後要重跑全綠驗收**:
  `node /root/seo-ops/bin/identity-audit.mjs --sa ~/.config/aeiou/ga4-sa.json --expect-only aeiou.now` exit 0。
- [x] **GA4 property**(2026-08-14 完成):property `549586494`、web stream `G-ZMTFG68ZJ5`(SA 可見,
  即檢視者已加)、`PUBLIC_GA4_ID` 已接進 CI build(`build.yml` 頂層 env)。
  查 stream:SA 打 `analyticsadmin.googleapis.com/v1beta/properties/549586494/dataStreams`;
  查上線:`curl -s https://weiqi-kids.github.io/aeiou-pages-zh-tw/ | grep -c googletagmanager`。
  ⚠ 手動單站 build/push 要自帶 `PUBLIC_GA4_ID`,否則該站 gtag 會消失到下次 CI 推。
- [x] **GSC**(2026-08-15 完成,隔離驗收 exit 0):`sc-domain:aeiou.now` 用戶建+TXT 驗證;
  SA 走 Site Verification API 繞過 UI(UI 加 SA 報「找不到電子郵件」的已知毛病)。
  完整繞法(五步,缺一不可):①用戶啟用專案的 Site Verification API ②SA 要 DNS_TXT token
  ③token 加進 DNS TXT ④SA `webResource.insert`(成為驗證擁有者)⑤**SA `sites.add`
  (webmasters v3 PUT /sites/sc-domain%3A...)把資源掛進自己帳號——沒有這步 sites.list 永遠是空的**。
  SA 為 siteOwner(API 驗證的本質),非原規劃的「完整使用者」,記錄在案。
  查:`node /root/seo-ops/bin/identity-audit.mjs --sa ~/.config/aeiou/ga4-sa.json --expect-only aeiou.now`。
- [ ] **Slack**:workspace=Weiqi.Kids、bot=`claude-helper`(有 `chat:write.public`,公開頻道免邀請)。
  token 已就位 `~/.config/aeiou/slack-bot-token`(600,2026-08-12 實測 auth.test ok)。
  剩:用戶建頻道(慣例 `#<描述>-aeiou`)→ 設 repo secrets `SLACK_BOT_TOKEN`/`SLACK_CHANNEL_ID`
  (CI 告警已改 bot-token 式,未設 secrets 會 gracefully skip)。查:`gh secret list -R weiqi-kids/aeiou.now`。

## M2 才做(用戶已同意延後;動工前先問)

- [x] Bot 防護第一、二層(2026-08-15 完成):①入口限流(Worker `RATE_LIMITS`,anon_id+IP 雙鍵,
  429;事件表 `rate_events` 只存 IP 雜湊)②價值閘門(翻譯管線內判定,沒價值→`moderation`+`skipped`
  下架不翻,判定從寬)。**切自訂網域的前置條件已滿足。**
- [ ] Turnstile(Bot 防護第三層,擋純腳本):判斷可後補——限流+價值閘門就位後,等實際被打再上
  (用戶未明示反對此排序;要提前做先問)
- [x] 七站切換自訂網域(2026-08-15 完成):CI dist 帶 `CNAME`、`BASE_PATH=/`、每站專屬
  `SITE_URL`、hreflang+x-default(=en)指向七個正式網域、Worker CORS 加七網域。
  查:`gh api repos/weiqi-kids/aeiou-pages-<x>/pages --jq '{cname,https_enforced}'` 或打各網域 `.build-id`。
- [ ] 語系切換器(是否要做、放哪:**版面事項,動工前讀產品草案並問用戶**)
- [ ] sitemap/IndexNow/GSC 提交 job(網域就位後已解鎖,M2 排程)
- [ ] OAuth(Google/GitHub/LINE;cn 市場皆不通為已知缺口)
- [ ] GA4 每日拉取 job(property 與 SA 見上節)
- [ ] Markdown 渲染(M1 純文字轉義)、圖片上傳(R2+審核)
- [ ] 「回報錯誤/補充」按鈕、「加入行事曆」按鈕(Google Calendar URL + .ics)
- [ ] 來源清冊與爬搜、19 job 完整管線、Vectorize 語意搜尋、R2 歸檔、moderation 啟用範圍

## 已知缺口(記錄在案,暫不解)

- **列表頁 cover 沒有縮圖變體**:列表每格顯示很小卻載 1200×675 全圖(已壓縮,每張約 350KB)。
  行動版 Lighthouse LCP 卡在 ~6s(2026-08-15,壓縮前 31.5s)。下一步效能槓桿=產列表用小圖
  (如 480×270)或 webp/srcset;**1200×675 PNG 契約只約束 Topic 頁 hero 與 og:image,別動**。
  查:`npx lighthouse https://aeiou.now/ --form-factor=mobile`(CHROME_PATH 用 playwright 的 chromium)。

- **claude -p 是全主機共用的訂閱額度**(2026-08-15 撞上週上限實證,seo-ops 各站 brain/reflect
  同時陣亡):額度耗盡時翻譯與價值閘門**雙雙停擺**,閘門 fail-open——垃圾貼文照常露出,
  只剩入口限流兜底。查:`echo 測試 | claude -p`(回 weekly limit 即耗盡)或看 `jobs` 表 error_message。
- [ ] **額度重置(2026-08-18 02:00 UTC)後驗證價值閘門 cron 路徑**:測試貼文 `pst_…JYH7G2` 應自動
  變 `translation_status='done'` 且 post_i18n 六語齊。查:
  `sqlite3 db/aeiou.sqlite "SELECT translation_status FROM posts WHERE post_id LIKE '%JYH7G2'"`

- Safari ITP 擋第三方 cookie → anon_id 不穩定(驗證一律用 Chromium)
- cn 市場:GA4 被牆(瀏覽數低估)、OAuth 三家皆不通
- 熱度級距門檻是暫定值(`site/src/lib/heat.mjs` 檔頭),真實 HotScore 上線後要重新校準
