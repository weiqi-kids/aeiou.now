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
- [ ] **D1 仍留著趨勢 Topic 副本要不要清**(`sync-topics-to-d1.mjs` 照同步,不看靜態閘)。
  2026-08-19 修好 TTL 之後**會自然退場**(過期轉 archived 再隨同步下架);在那之前
  TTL 被 kill switch 一起凍結,所以不會自己消失。查退場進度:
  `sqlite3 db/aeiou.sqlite "SELECT status,COUNT(*) FROM topics WHERE access_source='trend' GROUP BY 1"`
  Worker 沒有列出 Topic 的端點、靜態層也不產生連結,所以讀者路徑上到不了;TTL 到期會轉 archived。
  等趨勢復活與否定案再決定。查數量:
  `cd api && npx wrangler d1 execute aeiou-ugc --remote --command "SELECT COUNT(*) FROM topics WHERE topic_id LIKE 'top_tr_%'"`
- [ ] **`trend_runs` 有一批 status='running' 的殘列**(2026-08-17～08-18 那段連續失敗期留下的,
  之後沒再增加)。`run_key` 唯一且 `INSERT OR IGNORE`,不會擋住後續執行,純屬統計雜訊。
  查:`sqlite3 db/aeiou.sqlite "SELECT status,COUNT(*) FROM trend_runs GROUP BY 1"`

## M2 前置:GSC/GA4/DNS/Slack 設定(2026-08-11 用戶指示動工)

- [x] **網域註冊**(2026-08-15):GoDaddy。查:`curl -sL https://rdap.org/domain/aeiou.now`。
- [x] **DNS**(2026-08-15):**採 GoDaddy 自家 DNS(非 Linode 慣例)**,用戶面板手動管理,主機無 API 權限。
  記錄=apex A×4+AAAA×4(GitHub Pages 固定 IP)、六子網域 en/jp/cn/hi/id/br CNAME →
  `weiqi-kids.github.io`、GSC TXT。查:`dig @1.1.1.1 +short A aeiou.now`(換 AAAA/TXT/CNAME 各查)。
  ⚠ **切自訂網域上線前必須先補 Bot 防護**(下節紅線)。
- [ ] **GitHub org 網域驗證:TXT 已就位,剩 UI 按 Verify**(2026-08-19 實測 TXT 查得到)。
  原始說明(防 subdomain takeover;DNS 已指向、repo 未綁):
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
  互動事件已接入：`topic_open`、`question_vote`、`discussion_view`、`discussion_post`、
  `discussion_comment`、`reaction_click`、`source_click`、`local_action_click`。
- [x] **GSC**(2026-08-15 完成,隔離驗收 exit 0):`sc-domain:aeiou.now` 用戶建+TXT 驗證;
  SA 走 Site Verification API 繞過 UI(UI 加 SA 報「找不到電子郵件」的已知毛病)。
  完整繞法(五步,缺一不可):①用戶啟用專案的 Site Verification API ②SA 要 DNS_TXT token
  ③token 加進 DNS TXT ④SA `webResource.insert`(成為驗證擁有者)⑤**SA `sites.add`
  (webmasters v3 PUT /sites/sc-domain%3A...)把資源掛進自己帳號——沒有這步 sites.list 永遠是空的**。
  SA 為 siteOwner(API 驗證的本質),非原規劃的「完整使用者」,記錄在案。
  查:`node /root/seo-ops/bin/identity-audit.mjs --sa ~/.config/aeiou/ga4-sa.json --expect-only aeiou.now`。
- [x] **Slack**:workspace=Weiqi.Kids、bot=`claude-helper`(有 `chat:write.public`,公開頻道免邀請;
  **沒有 `channels:read`,所以 `conversations.info` 會回 `missing_scope`,那是正常的,別當故障**)。
  token 在 `~/.config/aeiou/slack-bot-token`(600)。
  2026-08-19 實測:`auth.test` ok、對頻道 `chat.postMessage` ok(CI 實際走的就是這條)。
  頻道已建:`#天天開心-aeiou-now` / `C0BPMFZ50KG`。
  repo secrets `SLACK_BOT_TOKEN`/`SLACK_CHANNEL_ID` 已於 2026-08-19 設定,告警路徑接通。
  (在此之前 CI 的失敗告警一直 gracefully skip,所以頻道從建立到當天零訊息,不是壞掉。)
  查:`gh secret list -R weiqi-kids/aeiou.now | grep -i slack`。
  **尚未驗證**:真實 build 失敗時的告警(至今沒有失敗的 build 可觀察);下次 CI 紅的時候看頻道有沒有收到。

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
