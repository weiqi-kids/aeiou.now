# 共用脈絡(全部 Track 一律遵守;各 track-*.md 開頭都要求先讀本檔)

> 這些是**已拍板的定案**。不得重議、不得自創名稱、不得提前做「明確延後」清單裡的項目。
> 與各 Track 工作項目衝突時,以該 Track 的工作項目為準,並在回報時明講矛盾——不得自行仲裁。

---

## 專案是什麼

aeiou.now = 全球議題平台(World → Topic → People → Place → Action),七語系市場。
本階段 = **M1 走通式骨架**:1–2 個示範 Topic 打通全鏈路,每層薄,端到端能跑。

**資料結構的權威文件**:`/root/aeiou.now/docs/02-data-model.md`(定案,照做)
**架構文件**:`/root/aeiou.now/docs/01-architecture.md`
**API 契約**:`/root/aeiou.now/docs/briefs/api-contract.md`
**版面與資訊架構的權威來源**:`/root/.claude/uploads/83eae670-5a5c-4c2f-a5cf-010b9c859fc1/e4a71c35-global_topic_platform_full_spec.md`
—— **要碰版面就必須打開它讀**(§44 主題頁、§54 首頁、§55「現在」),
**不准只憑本檔或計劃裡引的「草案 §44」這種編號辦事**。2026-08-11 的整站重做事故就是這樣發生的:
交辦書照抄編號往下發,沒人打開過草案,結果把主題頁論壇做成了雜誌文章網站。

**這是主題頁論壇**:每個 Topic 自己就是一個看板,主題頁 = 議題介紹 + 討論串本身。
**七語系是七個獨立的站**,讀者只看得到一種語言——「本站有七種語言」不得出現在版面上。

---

## 拓樸(三方分工)

- **主機 cron = 生產者**(爬搜、Topic 生產、翻譯、匯出、同步)
- **Cloudflare Worker = 動態互動層**(討論室、8H 即時 feed)
- **GitHub Pages = 靜態閱讀層 + CI 品質守門**

**Cloudflare 保持 Workers Free(0 元)**:只用 Worker + D1 + Vectorize + Workers AI。
**不用** Workers Paid、Durable Objects、Queues、Workflows、Cloudflare Cron Triggers、Analytics Engine。
自動化**全部在主機 cron**;GitHub Actions 只做 CI/CD 與排程重建。

**網域尚未註冊**。開發期靜態站 = `https://weiqi-kids.github.io/aeiou-pages-<locale小寫>/`(帶 base path),Worker 用 workers.dev。site/base/API URL 全走環境變數。

### Locale ↔ Repo ↔ 子網域(唯一映射表)

| locale | publish repo | 正式子網域(日後) |
|---|---|---|
| `zh-TW` | `weiqi-kids/aeiou-pages-zh-tw` | `aeiou.now`(主站) |
| `en` | `weiqi-kids/aeiou-pages-en` | `en.aeiou.now` |
| `ja` | `weiqi-kids/aeiou-pages-ja` | `jp.aeiou.now` |
| `zh-CN` | `weiqi-kids/aeiou-pages-zh-cn` | `cn.aeiou.now` |
| `hi` | `weiqi-kids/aeiou-pages-hi` | `hi.aeiou.now` |
| `id` | `weiqi-kids/aeiou-pages-id` | `id.aeiou.now` |
| `pt-BR` | `weiqi-kids/aeiou-pages-pt-br` | `br.aeiou.now` |

注意 `ja→jp`、`zh-CN→cn`、`pt-BR→br` 子網域與 locale 不同名。
source repo:`weiqi-kids/aeiou.now`。語系用**目錄**分,不用 branch,全在 main。

---

## 介面常數(跨 Track 契約,一律照抄,不得自創名稱)

| 常數 | 值 |
|---|---|
| D1 資料庫名 | `aeiou-ugc` |
| D1 binding 名 | `DB` |
| Worker 名 | `aeiou-api` |
| Cloudflare account_id | `9d9e58b5e0d1657b8f74bd2cbfc91ee3`(Lightman.chang@gmail.com's Account;**另一個 Gcmgcm 帳號不要用**) |
| 同步 secret(Worker 側) | `SYNC_SECRET`(`npx wrangler secret put SYNC_SECRET`) |
| 同步 secret(主機側) | `~/.config/aeiou/sync-secret`(chmod 600,已產生);`/root/.claude/secrets.md` 只記路徑不記值;**絕不進 git** |
| 靜態站注入的 API 位址 | 環境變數 `PUBLIC_API_URL` |
| Deploy key secrets 名 | `DEPLOY_KEY_ZH_TW` `DEPLOY_KEY_EN` `DEPLOY_KEY_JA` `DEPLOY_KEY_ZH_CN` `DEPLOY_KEY_HI` `DEPLOY_KEY_ID` `DEPLOY_KEY_PT_BR` |
| `REACTION_SET` | `["❤️","😂","😮","😢","🤔","🎉","👏"]`(**不含 👍,用戶明示排除**) |
| 主機 SQLite 檔 | `/root/aeiou.now/db/aeiou.sqlite`(絕對路徑,全部腳本引用同一個) |
| API 路徑參數 | `/v1/topics/:id/...` 的 `:id` = **topic_id(ULID 主鍵)**,不是 slug |
| city_code | `lowercase-slugify(request.cf.city)`;`request.cf` 無 city 時留 NULL |
| Slack secret 名 | `SLACK_WEBHOOK_URL`(M1 可不設值) |
| wrangler | 主機**沒有全域 `wrangler` 指令**,一律 `npx wrangler`;OAuth 憑證已在 `~/.config/.wrangler/` |

### anon_id 與跨站 cookie(三件套缺一不可)

Worker 首次寫入時發 httpOnly cookie(隨機 ULID,一年效期)。同一匿名者的 posts/reactions 都用它,`reactions` PK 依賴其穩定性。

1. cookie 帶 `SameSite=None; Secure`
2. Worker 回 `Access-Control-Allow-Credentials: true`(此時 CORS origin **不得**用 `*`)
3. 前端 fetch 帶 `credentials: 'include'`

已知缺口:Safari ITP 擋第三方 cookie,該類瀏覽器 anon_id 不穩定——記入延後清單,M1 無頭瀏覽器驗證一律用 **Chromium**。

---

## 降級模型(用戶原話)

動態異常時,動態區塊顯示「討論室暫時關閉」之類狀態,**不做 fallback 快照、不顯示過期資料**。

> ⚠️ **契約已於 2026-08-20 變更**:靜態預設值由 `closed` 改為 `loading`,失敗態改名 `unavailable`,無 JS 由 `<noscript>` 收尾。原因與四態表見 CLAUDE.md「討論串的四態」。以下敘述保留當時原文,**不要照它實作**。

**實作規定(為了讓降級可驗證)**:討論室區塊的**靜態 HTML 預設就渲染 fallback 文案**(該 locale 的 i18n 字串),且容器帶固定屬性 **`data-room-state="closed"`**;JS fetch 成功後改為 `data-room-state="open"` 並替換內容。curl 驗證統一 grep `data-room-state="closed"`(與語言無關),JS 路徑另以無頭瀏覽器(Chromium)驗。

- **靜態(build 時算好)**:Topic 文化比較、24H/72H/7D/1M/3M/1Y 排行、歷史精華、店家/導航連結、活動。
- **動態(CF 供應)**:討論室(發文/留言/reaction)、**8H 即時 feed(唯一即時層)**、語意搜尋(M2)。
- 瀏覽統計 = GA4 tag 前端直送 Google,不經 Worker,**無 beacon 端點**。

---

## 設計與內容守門(團隊紅線,逐字遵守)

1. **禁 px 字級**——一律 `var(--text-*)` 階梯,最小 18px,內文 ≥ `--text-base`
2. **顏色只准出現在 `src/styles/variables.css`**(oklch 為準 + hex fallback)
3. **禁 `!important`**
4. **禁外部 CDN**(fonts.googleapis / fonts.gstatic / cdnjs / unpkg / jsdelivr)——字型自託管。**唯一例外:`googletagmanager.com` 的 GA4 gtag**(用戶拍板),check-design 不攔它,不視為違規
5. **CSS 檔白名單**:只准 `src/styles/{variables,global}.css`,元件樣式寫 scoped `<style>`
6. **`--text-*` token 值一律 ≥18px**(`clamp()` 以最小值計)
7. **`build` 指令必須串 `check-design.mjs` 與 `check-content.mjs`**,CI 與本地皆然

**加嚴一條**:元件內連 `oklch(...)` 字面值也禁止(check-design.mjs 只攔 hex/rgb/hsl,攔不到 oklch——機械守門弱於紅線),一律 `var(--color-*)`。

守門腳本從 `/root/.claude/skills/new-astro-site/templates/` **原樣複製到 `site/scripts/`,不得修改**。`check-design.mjs` 寫死掃 `src/`(相對 cwd),故 **`pnpm build` 一律以 `site/` 為 cwd**(本地與 CI 相同)。

M1 的內容多為 `.astro`,`check-content.mjs` 掃 `.md(x)` 可能為 0 檔——**如實回報「已串進 build、本輪掃描 0 檔」**,不得宣稱「內容守門通過」以外的意思。

---

## 資料要點(不可忘的)

- 兩個權威來源:主機 SQLite(爬搜/Topic 生產)、D1(UGC)。雙向同步經 Worker 內部端點 + `SYNC_SECRET`。
- **Post 翻譯七語(實際產出六語譯文,不翻原文那一語)、Comment 不翻譯**。翻譯由主機 cron 每 15 分鐘批次 `claude -p`(訂閱 CLI,**不是 API**)。顯示時原文+譯文並陳,未翻完顯示原文+「翻譯中」。
- CrossCountryScore = **跨國貼文互動**,不算跨國留言。
- Vectorize 只放 Topic;Post/Comment 不做搜尋。**M1 不接 Vectorize**。
- `topics.status='archived'` = 只是不熱,**仍可發文**;`posts.status='archived'` = 永久鎖定。**同名不同義**。
- Post 榜三層:即時 Feed(動態)/ 本期精華(cycle,靜態)/ 歷史精華(alltime,靜態)。**無七時窗 Post 榜**。
- Ask the World = 普通長青 Topic(`is_perennial=1`),貼文歸屬唯一。
- `access_level`(0 匿名 / 1 登入 / 2 登入+滿18,繼承制)**只 gate 討論室,不 gate 靜態頁**。
- geo 來自 `request.cf`(城市級,**不存座標**)。
- **Reaction = 純 emoji,無獨立 like,不含 👍**。同一 actor 可按多個不同 emoji;EngagementScore 計 distinct actor 不分種類;**share 不進 DB**(前端複製連結)。
- **發文 = 無標題、Markdown 安全子集**(禁 raw HTML,渲染必 sanitize)。**M1 儲存 Markdown 但顯示為純文字轉義**;M2 才上 Markdown 渲染;**圖片上傳 M2**(`media_json` M1 恆 NULL)。
- 靜態 JSON 照 `docs/02-data-model.md` §9;**內容 hash 沒變就不寫檔**。
- M1 只在 BaseLayout 埋 GA4 tag(`PUBLIC_GA4_ID` env,**未設則完全不輸出**)。

---

## 明確延後(用戶同意不做/後補;執行者不得自行提前)

- 來源清冊(七市場合法 RSS/API)——骨架用手動 seed。
- Moderation 啟用範圍——schema 全建,設定檔控制,後定。
- OAuth 實作——M1 示範 Topic 全部 `access_level=0`。
- **Bot 防護(Turnstile / rate limit)——M1 刻意不做**。workers.dev 網址不對外宣傳,M2 上線自訂網域前必須補。**這是有意識的裸奔,不是遺漏**。
- IndexNow / GSC / sitemap 提交——網域註冊後才有意義(`build.yml` **不放 indexnow job**)。
- GA4 property 建立、專屬 GCP 專案+SA、每日拉取 job——M2(M1 只埋 tag)。
- Safari ITP 下 anon_id 不穩定——已知缺口,暫不解。
- Markdown 渲染、圖片上傳(R2+審核)、「回報錯誤/補充」按鈕、「加入行事曆」按鈕——**全排 M2**。
- 19 job 完整管線、Vectorize/Topic Detection、R2 歸檔——M2+。

---

## 環境事實

- 主機:4 核 / 7GB(可用 4GB)/ 磁碟剩 28GB(82% 已用)。已有 pm2、NPM、15 個 cron 專案。
- `claude` 與 `codex` CLI 在 `/root/.local/bin/`(**訂閱帳號**;cron 環境的 PATH 必須含此路徑)。
- `gh` 已登入 `LightChang`(scopes 含 repo/workflow);git global user = `weiqi-kids <lightman.chang@gmail.com>`。**絕不動 `git config --global`**;要定身分請用 repo 層或單次 `-c`。
- `npx wrangler`(4.120.1),OAuth 已登入。
- node v22.22.0(**內建 `node:sqlite` 可用,無需外部依賴**)、pnpm 10.32.1。
- 建站模板:`/root/.claude/skills/new-astro-site/templates/`。

---

## 工作紀律(全 Track)

- **一律不 `git commit` / 不 `git push`**——主對話在波次驗收後統一 commit。
- **自己起的背景 server 一定要收**(preview/dev server 用完必 kill,這是主機紅線)。
- 「驗收」欄 = 該項完成的唯一判準,回報必附對應證據;**沒跑過的不准說跑過,沒綠的不准說綠**。
- 卡住時:屬外部障礙(API 掛、權限不足)標 ⛔ 附卡點與解鎖條件後繼續做其他項;屬計劃內部矛盾,以工作項目清單為準並在收尾回報。
