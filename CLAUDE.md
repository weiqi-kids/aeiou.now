# aeiou.now — 專案手冊(每次 session 自動載入)

> 本檔是索引與紅線。詳細內容見 `docs/`:
> `docs/01-architecture.md`(架構與拓樸)、`docs/02-data-model.md`(**資料結構權威文件**)、
> `docs/briefs/api-contract.md`(API 契約)、`docs/briefs/_shared-context.md`(決策帳全文)。

## ⚠ 版面與資訊架構的權威來源 = 產品草案

`/root/.claude/uploads/83eae670-5a5c-4c2f-a5cf-010b9c859fc1/e4a71c35-global_topic_platform_full_spec.md`

**要改任何頁面版面之前必須打開它讀,不准只憑本檔或計劃裡引的「草案 §44」這種編號辦事。**
關鍵節次:§1 產品定位、§22 Feed 三種排序、§44 Topic Page 完整 UI(含框線雛形)、§45 Ask the World、
§46 全球排行榜、§47 國家熱度、§54 前台首頁、§55 首頁必須有「現在」、§56 即時性原則。

> **事故(2026-08-11)**:整站視覺重做時,交辦書照抄了計劃裡的「草案 §44 版面」編號往下發,
> 沒有任何一方打開過草案本體。結果做出雜誌文章網站而非**主題頁論壇**:首頁變成有標語與
> 「追蹤議題 2」統計的 landing page(§54 根本沒有這些),主題頁把討論縮成角落小面板
> (§44 的 💬 People Are Talking About 是主幹段落),國旗列、8H 時窗、Ask the World 入口全漏。
> **教訓:引用章節編號不等於讀過那份文件。**

**這是主題頁論壇**:每個 Topic 自己就是一個看板,主題頁 = 議題介紹 + 討論串本身,
討論不是附掛在文章底下的留言區,而是那一頁存在的理由。首頁是看板列表,不是產品介紹頁。

### 階層(2026-08-11 用戶拍板;搞混這個是前四輪失敗的共同原因)

```
World
└── Topic(看板)          情人節、問世界
    ├── 議題介紹          全世界怎麼過、國旗、店家、活動 ← Topic 頁的靜態內容
    └── Post(討論串)      N 則貼文                      ← 動態,來自 Worker
        └── Comment(留言)
```

| 頁面 | 是什麼 | **絕對不該有** |
|---|---|---|
| **首頁 = 全球熱門** | Topic 清單,**每個 Topic 底下掛 N 則該議題的 Post** | ❌ 時窗切換 ❌ 熱門話題區 ❌ 大家正在聊區 |
| **排行榜** `/rankings/<窗>/` | 純 Topic 排名 | 24H/72H/7D/1M/3M/1Y 切換**只在這裡** |
| **熱門話題 / 附近訊息 / 活動資訊** | Topic 清單的另三種排序,各有自己的頁 | ❌ 不該出現在首頁 |
| **Topic 頁** | 單一看板 = 議題介紹 + 該議題討論串 | (§44 的熱度七窗**要留**,那是規格) |

> **事故(2026-08-11)**:首頁曾同時放了時窗切換、`#today 熱門話題`、`#talking 大家正在聊` 三者。
> 時窗切換是**排行榜層**的東西;熱門話題是導覽的另一種排序、有自己的頁;
> 「大家正在聊」則是**同一批 Post 在同一頁出現第二次**——首頁每個 Topic 底下本來就該有 Post。
> **判準:同一批資料在同一頁出現兩次,就是階層沒分清楚。**

### 看板清單的形狀(2026-08-11 用戶拍板)

**四個排序頁(全球熱門/首頁、熱門話題、附近訊息、活動資訊)共用同一種以看板為主的清單**,
長相一致,每一列都帶討論串。不是只有首頁才有貼文。

每一列 = **左右兩欄**(窄螢幕堆疊成上下,先左後右):

```
┌────────────────────────────┬──────────────────────┐
│ 左:主題介紹                 │ 右:該 Topic 最高的三篇 │
│ 名次/標題/徽章/摘要/熱度級距  │ sort=hot&limit=3      │
└────────────────────────────┴──────────────────────┘
```

「最高的三篇」= **熱度最高**,所以是 `sort=hot`,**不是 `sort=new`**。

**討論串的三態要分清楚**(前一輪只做了第一態就交件,被退):

| 狀態 | 何時 | 呈現 |
|---|---|---|
| **關閉** `data-room-state="closed"` | 動態層不可用(fetch 失敗/非 2xx/JSON 壞/`PUBLIC_API_URL` 未設) | 討論室暫時關閉 |
| **空** (容器仍 `open`) | fetch **成功**但 `posts` 為 0 筆 | 這個看板還沒有人發言 + 參與入口 |
| **有內容** | fetch 成功且有貼文 | 列出最高三篇 |

> 「動態掛掉」與「還沒人發言」是**兩件事**,不可混用同一個狀態。

### 導覽 = Topic 的排序(2026-08-11 用戶拍板)

導覽列在右上角,內容是:**全球熱門、熱門話題、附近訊息、活動資訊、+ 具體 Topic**。

**「全球熱門 / 熱門話題 / 附近訊息 / 活動資訊」不是四種不同的內容,是同一份 Topic 清單的四種排序或篩選。**
點任何一項,看到的都是 **Topic 清單**;導覽尾端的具體 Topic 則是一步跳進該看板。

| 導覽項目 | 是什麼 | 不是什麼 |
|---|---|---|
| 全球熱門 | 依全球熱度排的 Topic | — |
| 熱門話題 | 當令的 Topic(`observed_date` 落在近期,或 `is_perennial`) | — |
| 附近訊息 | **有在地資訊的 Topic** | ❌ 一份店家清單 |
| 活動資訊 | **有活動的 Topic** | ❌ 一份活動清單 |

> **事故(2026-08-11)**:曾把「附近」做成店家清單、「活動」做成活動清單,當成獨立內容區塊掛在首頁。
> 那是**把 Topic 的屬性誤當成獨立內容**。店家與活動屬於各自的 Topic 頁(§44 的 📍 Near You / 🎉 Events),
> 首頁不該有它們的獨立清單。

**M1 的「附近」有誠實邊界**:靜態層不知道讀者位置(真正依讀者定位排序要靠 Worker 的 `request.cf`,屬動態層),
所以「附近訊息」= 有在地資料的 Topic 按城市分組,**不得假裝知道讀者在哪**。

**七語系是七個獨立的站**(各自 repo、各自子網域,每次 build 只吃一個 `LOCALE`)。
讀者只會看到一種語言,**「本站有七種語言」不是給讀者看的資訊**,不得出現在版面上。

---

## 這是什麼

aeiou.now = 全球議題平台(World → Topic → People → Place → Action),七語系市場。
現階段 = **M1 走通式骨架**:1–2 個示範 Topic 打通全鏈路,每層薄,端到端能跑。

---

## 技術棧與三方分工

| 角色 | 技術 | 職責 |
|---|---|---|
| **生產者** | 主機 cron + SQLite(`node:sqlite`,零 npm 依賴) | 爬搜、Topic 生產、翻譯(`claude -p` 訂閱 CLI)、匯出靜態 JSON、雙向同步 |
| **動態互動層** | Cloudflare Worker `aeiou-api` + D1 `aeiou-ugc` | 討論室(發文/留言/reaction)、8H 即時 feed |
| **靜態閱讀層** | Astro(`output: 'static'`)→ GitHub Pages ×7 | 七語系靜態站,GitHub Actions 每小時重建 |

**Cloudflare 保持 Workers Free(0 元)**:只用 Worker + D1 + Vectorize(M2)+ Workers AI(M2)。
**不用** Workers Paid / Durable Objects / Queues / Workflows / Cloudflare Cron Triggers / Analytics Engine。
**自動化全部在主機 cron**;GitHub Actions 只做 CI/CD 與排程重建。瀏覽統計走 GA4(前端直送 Google,不經 Worker)。

---

## 守門七條(團隊紅線,逐字遵守)

1. 禁 px 字級——一律 `var(--text-*)` 階梯,最小 18px,內文 ≥ `--text-base`
2. 顏色只准出現在 `site/src/styles/variables.css`(oklch 為準 + hex fallback);**元件內連 `oklch()` 字面值也禁**,一律 `var(--color-*)`
3. 禁 `!important`
4. 禁外部 CDN(fonts.googleapis / fonts.gstatic / cdnjs / unpkg / jsdelivr)——字型自託管。**唯一例外:`googletagmanager.com` 的 GA4 gtag**
5. CSS 檔白名單:只准 `site/src/styles/{variables,global}.css`,元件樣式寫 scoped `<style>`
6. `--text-*` token 值一律 ≥18px(`clamp()` 以最小值計)
7. `build` 指令必須串 `check-design.mjs` 與 `check-content.mjs`,CI 與本地皆然

守門腳本原樣複製自 `/root/.claude/skills/new-astro-site/templates/`,**不得修改**。
`check-design.mjs` 寫死掃 `src/`(相對 cwd),故 **`pnpm build` 一律以 `site/` 為 cwd**。

---

## 介面常數(跨層契約,一律照抄,不得自創名稱)

| 常數 | 值 |
|---|---|
| D1 資料庫名 / binding | `aeiou-ugc` / `DB` |
| Worker 名 | `aeiou-api` |
| Cloudflare account_id | `9d9e58b5e0d1657b8f74bd2cbfc91ee3`(**必須 pin**;另一個 Gcmgcm 帳號不要用) |
| 同步 secret | Worker 側 `SYNC_SECRET`;主機側 `~/.config/aeiou/sync-secret`(chmod 600,**絕不進 git**) |
| 靜態站 API 位址 | 環境變數 `PUBLIC_API_URL` |
| Deploy key secrets | `DEPLOY_KEY_ZH_TW` `DEPLOY_KEY_EN` `DEPLOY_KEY_JA` `DEPLOY_KEY_ZH_CN` `DEPLOY_KEY_HI` `DEPLOY_KEY_ID` `DEPLOY_KEY_PT_BR` |
| `REACTION_SET` | `["❤️","😂","😮","😢","🤔","🎉","👏"]`(**不含 👍**,用戶明示排除) |
| 主機 SQLite | `/root/aeiou.now/db/aeiou.sqlite` |
| API 路徑參數 | `/v1/topics/:id/...` 的 `:id` = **topic_id(ULID)**,不是 slug |
| city_code | `lowercase-slugify(request.cf.city)`,無 city 時 NULL |
| wrangler | 主機無全域指令,一律 `npx wrangler` |

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

`ja→jp`、`zh-CN→cn`、`pt-BR→br` 子網域與 locale **不同名**。語系用**目錄**分,不用 branch,全在 main。

---

## 常用指令

```bash
# 建主機庫(29 張表)
node scripts/init-db.mjs --host-only
node scripts/init-db.mjs --host-only --seed     # 順便灌 db/seed/*.sql

# 建 D1 並灌 schema(權責在 Worker 那一側)
node scripts/init-db.mjs --d1-only

# 匯出靜態 JSON(內容 hash 沒變不寫檔)
node scripts/export-data.mjs

# 主機 → D1 Topic 副本同步
node scripts/sync-topics-to-d1.mjs

# 翻譯:D1 撈 pending → claude -p 六語 → 寫回 D1 + 回流主機
node scripts/translate-posts.mjs

# 匯出 + commit data/ + push(cron 每小時跑這支)
bash scripts/hourly-export.sh

# 靜態站(cwd 一律 site/)
cd site && LOCALE=zh-TW pnpm build

# Worker
cd api && npx wrangler deploy
npx wrangler d1 execute aeiou-ugc --remote --command "SELECT name FROM sqlite_master WHERE type='table'"

# GitHub 一次性布署(建 repo、deploy key、secrets、Pages)
bash scripts/setup-github.sh
```

## 現況一律用指令查(不要相信文件裡的數字)

| 要知道什麼 | 查法 |
|---|---|
| 主機庫有哪些表 / 各表筆數 | `node scripts/init-db.mjs --host-only`(尾段列表)/ `sqlite3 db/aeiou.sqlite` |
| D1 有哪些表 | `npx wrangler d1 execute aeiou-ugc --remote --command "SELECT name FROM sqlite_master WHERE type='table'"` |
| Worker 網址 | `cd api && npx wrangler deployments list` |
| 排程現況 | `cat /etc/cron.d/aeiou` |
| 靜態站有幾個 / 叫什麼 | `gh repo list weiqi-kids --limit 100 \| grep aeiou-pages` |
| 最近 job 跑得如何 | `sqlite3 db/aeiou.sqlite "SELECT job_name,status,finished_at,error_message FROM jobs ORDER BY scheduled_at DESC LIMIT 20"` |

---

## 排程

| 位置 | 排程 | 內容 |
|---|---|---|
| 主機 `/etc/cron.d/aeiou` | `*/15 * * * *` | 翻譯 + 同步 |
| 主機 `/etc/cron.d/aeiou` | `0 * * * *` | export + git push |
| Actions `build.yml` | `17 * * * *` | 七語系重建與部署(**刻意錯開整點**,避免與主機整點 push 互踩) |

cron 環境的 PATH 必須含 `/root/.local/bin`(`claude` CLI 在此)。

---

## 絕不可破壞的紅線

- **兩個權威來源**:主機 SQLite(爬搜/Topic 生產)、D1(UGC)。靜態 JSON 全是衍生品,可隨時重生。
- **降級不做 fallback 快照**:動態異常時討論室顯示關閉狀態,**不顯示過期資料**。靜態 HTML 預設就渲染 fallback + `data-room-state="closed"`,JS 成功才改 `"open"`。
- **`topics.status='archived'` 仍可發文**(只是不熱);**`posts.status='archived'` 才是永久鎖定**。同名不同義。
- **Post 翻譯七語(實產六語譯文)、Comment 不翻譯**。翻譯用 `claude -p` 訂閱 CLI,**不是 Anthropic API**。
- **UGC 回流主機的唯一通道是 `translate-posts.mjs`**——沒有它,主機端 `post_highlights` 與靜態 `highlights.json` 永遠拿不到資料。
- **跨站 cookie 三件套缺一不可**:`SameSite=None; Secure` + `Access-Control-Allow-Credentials: true` + 前端 `credentials:'include'`(此時 CORS origin **不得用 `*`**)。
- **CI 推 publish repo 一律 SSH**(deploy key 是 SSH 機制,走 HTTPS 是死路);主機端 cron 才是 gh HTTPS credential helper,**兩者不同,別混**。
- **推 dist 必寫 `.nojekyll`**:Pages deploy-from-branch 會走 Jekyll,`_astro/` 底線目錄會被丟棄。
- **絕不動 `git config --global`**(曾有 session 用 `--global` 設假身分污染全機 cron 的 commit 作者)。要定身分用 repo 層或單次 `-c`。
- **絕不呼叫 Google Places API**、不儲存其回傳資料(條款禁長存)。店家探索 = `claude -p` 自帶搜尋抽店名 + 純字串組裝導航連結。
- **自己起的背景 server 一定要收**(preview/dev/wrangler dev 用完必 kill)。
- secret 只從 `~/.config/aeiou/sync-secret` 讀,**不寫進碼、不寫進 log、不進 git**。

---

## 顯示層規則(2026-08-11 用戶拍板)

- **熱度一律以級距呈現,原始分數不得出現在畫面上**(首頁卡片、topic 頁六窗、排行頁三處一致)。排行頁的**名次**可以顯示,那是名次不是分數。級距定義集中在 `site/src/lib/heat.mjs`,呈現走 `HeatMeter.astro`,標籤進七語系 i18n。
- **級距門檻是暫定值**:M1 的 HotScore 未完整實作(瀏覽面待 GA4,屬 M2),現有分數是 seed demo 值。**M2 真實 HotScore 上線後必須重新校準**,理由與現行門檻寫在 `heat.mjs` 檔頭。
- **級距不得只靠顏色區分**(灰階/色盲要能讀),需同時有文字標籤與形狀/長度差異。
- 品牌配色定義在 `site/src/styles/variables.css`(oklch + hex 兩處),選色理由寫在檔頭。**已非模板佔位色,不要改回 `#1a4f8a`**。
- 活動時間一律鎖 `timeZone: 'UTC'`(否則主機與 CI 的 TZ 差異會 build 出不同字串);落在整點午夜的時間戳視為整日活動,只印日期。

## 明確延後(M2+;不得自行提前)

來源清冊、Moderation 啟用範圍、OAuth、**Bot 防護(Turnstile / rate limit —— M1 刻意不做,是有意識的裸奔;M2 上線自訂網域前必須補)**、IndexNow/GSC/sitemap 提交、GA4 property 與專屬 GCP 專案+SA(紅線:**不共用其他站金鑰**)、Markdown 渲染、圖片上傳(R2+審核)、「回報錯誤/補充」按鈕、「加入行事曆」按鈕、19 job 完整管線、Vectorize/Topic Detection、R2 歸檔。
