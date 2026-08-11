# 待辦(2026-08-11 M1 收尾時整理;完成一項劃掉一項)

> 現況不要信本檔——逐項用附的指令查,查完再動手。

## 部署與基礎

- [ ] **`id` 站(印尼)線上還是舊版**。publish repo 已收到最新內容(commit `deploy id @ …`),
  但 GitHub Pages 的建置卡在 `building` 超過 30 分鐘(GitHub 端問題,已推 nudge commit 一次)。
  查:`gh api repos/weiqi-kids/aeiou-pages-id/pages/builds/latest --jq .status` 與
  `curl -s https://weiqi-kids.github.io/aeiou-pages-id/.build-id`(比對 `git rev-parse HEAD`)。
  若持續卡住:再推一個空 commit 到該 repo,或到 repo Settings→Pages 關掉再開。
- [ ] **M1 完成定義 #3 的七站全綠重驗**(定版後只驗了六站,`id` 卡住)。
  查法在 `CLAUDE.md § 現況一律用指令查` 的「七站分別是哪一版」。
- [ ] **`weiqi-kids` 組織的 deploy key 開關**目前是開的(`deploy_keys_enabled_for_repositories=true`,
  2026-08-11 為了 aeiou 打開,影響整個組織)。用戶未表態要不要維持;要關回去前先確認
  CI 改用其他機制,否則七站部署會壞。查:`gh api /orgs/weiqi-kids --jq .deploy_keys_enabled_for_repositories`

## 產品功能(版面已定版,這些是資料/行為層)

- [ ] **`/topics/events/`、`/topics/nearby/` 的 emoji 排序只在前端做**(JS 拿
  `/v1/reactions/summary` 後重排)。要靜態排好,需把 reaction 計數從 D1 回流主機再進 `data/`
  (加一支 cron 腳本 + export 欄位)。
- [ ] **重新整理後「我按過的 emoji」會消失**:feed 端點不回 `mine`(契約 §1 限制)。
  要修就改契約讓 feed 依 anon_id 附 `mine`,Worker 一條 JOIN 的事,但屬契約變更。
- [ ] **cover 圖是純色塊佔位**(`site/public/covers/<slug>.svg`,1200×630)。
  用戶說之後用 codex 產圖:出同尺寸 `.png` 放同目錄即可(`coverPath()` 會優先取 `.png`),版面不用動。
- [ ] **首頁「近期話題」內容稀疏**:等用戶用 `content/topics/*.md` 撰寫節日
  (格式見 `docs/03-topic-content.md`)。**這是用戶接下來要做的事,不要代寫內容。**
- [ ] **新 Topic 沒有熱度分數**(import 不碰 `topic_scores`),級距顯示最低階。
  排名 job 屬 M2 的 19 job 管線;過渡期可決定要不要手動塞 demo 分數(要問用戶,不要自作主張)。

## M2 才做(用戶已同意延後;動工前先問)

- [ ] Bot 防護(Turnstile / rate limit)——**上自訂網域前必須補**(現在是有意識的裸奔)
- [ ] 網域註冊 + Linode DNS + 七站自訂網域(hreflang、語系切換器、sitemap/IndexNow/GSC 都卡在這之後)
- [ ] OAuth(Google/GitHub/LINE;cn 市場皆不通為已知缺口)
- [ ] GA4 property + aeiou 專屬 GCP 專案與 SA(紅線:不共用其他站金鑰)+ 每日拉取 job
- [ ] Markdown 渲染(M1 純文字轉義)、圖片上傳(R2+審核)
- [ ] 「回報錯誤/補充」按鈕、「加入行事曆」按鈕(Google Calendar URL + .ics)
- [ ] 來源清冊與爬搜、19 job 完整管線、Vectorize 語意搜尋、R2 歸檔、moderation 啟用範圍

## 已知缺口(記錄在案,暫不解)

- Safari ITP 擋第三方 cookie → anon_id 不穩定(驗證一律用 Chromium)
- cn 市場:GA4 被牆(瀏覽數低估)、OAuth 三家皆不通
- 熱度級距門檻是暫定值(`site/src/lib/heat.mjs` 檔頭),真實 HotScore 上線後要重新校準
