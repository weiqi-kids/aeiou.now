# aeiou.now — 架構(M1 走通式骨架)

> 本檔取代已作廢的 `01-layering.md`(其 Cloudflare 全套方案與 fallback 快照機制皆已推翻)。
> 資料結構的權威文件是 `02-data-model.md`;本檔只描述「東西放哪裡、誰跑什麼、怎麼串」。
> 定案日期:2026-08-11。

---

## 1. 三方分工

| 角色 | 位置 | 職責 |
|---|---|---|
| **生產者** | 主機 cron(`/etc/cron.d/aeiou`) | 爬搜、Topic 生產、翻譯、匯出靜態 JSON、雙向同步 |
| **動態互動層** | Cloudflare Worker(`aeiou-api`) | 討論室(發文/留言/reaction)、8H 即時 feed、語意搜尋(M2) |
| **靜態閱讀層** | GitHub Pages ×7 | 七語系靜態站,每小時由 GitHub Actions 重建 |

**自動化全部在主機 cron。** GitHub Actions 只做 CI/CD 與排程重建;不使用 Cloudflare Cron Triggers。

---

## 2. Cloudflare 用量邊界(Workers Free,0 元)

**使用**:Workers、D1、Vectorize(M2)、Workers AI(M2)。
**不使用**:Workers Paid、Durable Objects、Queues、Workflows、Cloudflare Cron Triggers、Analytics Engine。

瀏覽統計改由 **GA4** 承擔(前端直送 Google,不經 Worker,無 beacon 端點)。

---

## 3. 資料流

```
                     ┌──────────────────────────────┐
                     │  主機 SQLite                  │
                     │  /root/aeiou.now/db/          │
                     │       aeiou.sqlite            │
                     │  (爬搜/Topic 生產的權威來源)   │
                     └───────┬──────────────┬────────┘
                             │              │
      ① Topic 精簡副本        │              │ ④ export-data.mjs
        POST /internal/      │              │    (內容 hash 沒變不寫檔)
        sync/topics          │              ▼
                             │        data/*.json ──git push──▶ source repo
                             │                                     │
                             ▼                              ⑤ Actions 每小時
                     ┌──────────────────┐                    matrix ×7 build
                     │  Cloudflare D1    │                          │
                     │  aeiou-ugc        │                          ▼
                     │  (UGC 權威來源)   │                7 個 publish repo
                     └───────┬──────────┘                  → GitHub Pages
                             │
      ② GET /internal/ugc/pending-translation
      ③ POST /internal/translations
        (translate-posts.mjs 每 15 分;同時把原文+譯文
         upsert 回主機 posts/post_i18n —— UGC 回流唯一通道)
```

- 主機用 SQLite 而非 Postgres:與 D1 同一套 SQL 方言,schema 單一定義,不會型別漂移。
- 靜態 JSON 是衍生品,可隨時重生;主機 SQLite 與 D1 都不可丟失。

---

## 4. 網域與環境變數

**網域尚未註冊**(開發完成才註冊,DNS 放 Linode)。開發期一律走環境變數,日後切自訂網域只改設定值:

| 變數 | 開發期值 |
|---|---|
| `SITE_URL` | `https://weiqi-kids.github.io` |
| `BASE_PATH` | `/aeiou-pages-<locale 小寫>` |
| `PUBLIC_API_URL` | Worker 的 workers.dev 網址 |
| `PUBLIC_GA4_ID` | M1 未設(未設則 BaseLayout 完全不輸出 gtag) |
| `LOCALE` | 決定 build 哪一語系 |

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

source repo:`weiqi-kids/aeiou.now`(唯一有人 commit)。語系用**目錄**分,不用 branch,全在 main。

---

## 5. 靜態 vs 動態的切分

| 靜態(build 時算好) | 動態(Worker 供應) |
|---|---|
| Topic 文化比較(全世界怎麼過) | 討論室:發文/留言/reaction |
| 24H/72H/7D/1M/3M/1Y 排行 | **8H 即時 feed(唯一即時層)** |
| 歷史精華(`post_highlights.kind='alltime'`) | 語意搜尋(M2) |
| 店家/導航連結、活動 | |

8H 不出靜態;靜態只出六窗。

---

## 6. 降級模型

動態異常時,動態區塊顯示「討論室暫時關閉」狀態。**不做 fallback 快照、不顯示過期資料。**

實作規定(讓降級可驗證):

- 討論室區塊的靜態 HTML **預設就渲染 fallback 文案**(該 locale 的 i18n 字串)。
- 容器帶固定屬性 `data-room-state="closed"`。
- JS fetch 成功後改為 `data-room-state="open"` 並替換內容。
- 驗證:curl 初始 HTML grep `data-room-state="closed"`(語言無關);JS 路徑另以無頭瀏覽器(Chromium)驗。

---

## 7. 儲存位置與權威

見 `02-data-model.md` §0。摘要:

| | 主機 SQLite | Cloudflare D1 | 靜態 JSON(git) |
|---|---|---|---|
| 權威來源 | 爬搜、來源、Topic 生產 | **UGC(貼文/留言/使用者)** | 無(全部衍生) |
| 可丟失? | 不可 | 不可 | 可 |

---

## 8. Monorepo 結構

```
/root/aeiou.now/
├── docs/                 架構與資料模型文件、briefs/
├── db/                   schema-common.sql / schema-host.sql / schema-d1.sql、seed/
├── data/                 匯出的靜態 JSON(commit 進 git)
├── scripts/              init-db、export-data、sync-topics-to-d1、translate-posts、hourly-export
├── site/                 Astro 專案(build cwd 一律 site/;site/scripts/ 放守門腳本)
├── api/                  Cloudflare Worker(aeiou-api)
└── .github/workflows/build.yml
```

`site/src/data/` 是 gitignored 的鏡像,由 build 鏈的 `copy-data` 從根層 `data/` 複製(本地與 CI 同一條鏈)。

---

## 9. 設計與內容守門(七條紅線)

1. 禁 px 字級——一律 `var(--text-*)` 階梯,最小 18px,內文 ≥ `--text-base`
2. 顏色只准出現在 `src/styles/variables.css`(oklch 為準 + hex fallback);**元件內連 `oklch()` 字面值也禁**,一律 `var(--color-*)`
3. 禁 `!important`
4. 禁外部 CDN(fonts.googleapis/gstatic、cdnjs、unpkg、jsdelivr)——字型自託管。唯一例外:`googletagmanager.com` 的 GA4 gtag
5. CSS 檔白名單:只准 `src/styles/{variables,global}.css`,元件樣式寫 scoped `<style>`
6. `--text-*` token 值一律 ≥18px(`clamp()` 以最小值計)
7. `build` 指令必須串 `check-design.mjs` 與 `check-content.mjs`,CI 與本地皆然

守門腳本從 `/root/.claude/skills/new-astro-site/templates/` 原樣複製到 `site/scripts/`。`check-design.mjs` 寫死掃 `src/`(相對 cwd),故 `pnpm build` 一律以 `site/` 為 cwd。

---

## 10. 介面常數(跨 Track 契約)

| 常數 | 值 |
|---|---|
| D1 資料庫名 | `aeiou-ugc` |
| D1 binding 名 | `DB` |
| Worker 名 | `aeiou-api` |
| Cloudflare account_id | `9d9e58b5e0d1657b8f74bd2cbfc91ee3` |
| 同步 secret(Worker 側) | `SYNC_SECRET` |
| 同步 secret(主機側) | `~/.config/aeiou/sync-secret`(chmod 600,絕不進 git) |
| 靜態站 API 位址 | 環境變數 `PUBLIC_API_URL` |
| Deploy key secrets | `DEPLOY_KEY_ZH_TW` `DEPLOY_KEY_EN` `DEPLOY_KEY_JA` `DEPLOY_KEY_ZH_CN` `DEPLOY_KEY_HI` `DEPLOY_KEY_ID` `DEPLOY_KEY_PT_BR` |
| `REACTION_SET` | `["❤️","😂","😮","😢","🤔","🎉","👏"]`(不含 👍) |
| 主機 SQLite 檔 | `/root/aeiou.now/db/aeiou.sqlite` |
| API 路徑參數 | `/v1/topics/:id/...` 的 `:id` = **topic_id(ULID)**,不是 slug |
| city_code | `lowercase-slugify(request.cf.city)`,無 city 時 NULL |
| wrangler | 主機無全域指令,一律 `npx wrangler` |

### anon_id 與跨站 cookie

Worker 首次寫入時發 httpOnly cookie(隨機 ULID,一年效期)。同一匿名者的 posts/reactions 都用它,`reactions` PK 依賴其穩定性。**跨站 cookie 三件套缺一不可**:

1. cookie 帶 `SameSite=None; Secure`
2. Worker 回 `Access-Control-Allow-Credentials: true`(此時 CORS origin 不得用 `*`)
3. 前端 fetch 帶 `credentials: 'include'`

已知缺口:Safari ITP 擋第三方 cookie,該類瀏覽器 anon_id 不穩定(暫不解;M1 無頭瀏覽器驗證一律用 Chromium)。

---

## 11. M1 範圍與明確延後

M1 = 走通式骨架:1–2 個示範 Topic 打通全鏈路,每層薄,端到端能跑。

**明確延後(不得自行提前)**:來源清冊、Moderation 啟用範圍、OAuth、**Bot 防護(Turnstile / rate limit)**、IndexNow / GSC / sitemap 提交、GA4 property 與專屬 GCP 專案+SA、Markdown 渲染、圖片上傳(R2)、「回報錯誤/補充」按鈕、「加入行事曆」按鈕、19 job 完整管線、Vectorize/Topic Detection、R2 歸檔。

> **Bot 防護是有意識的裸奔,不是遺漏**:workers.dev 網址不對外宣傳,M2 上線自訂網域前必須補。

---

## 12. 排程

| 位置 | 排程 | 內容 |
|---|---|---|
| 主機 `/etc/cron.d/aeiou` | `*/15 * * * *` | 翻譯 + 同步 |
| 主機 `/etc/cron.d/aeiou` | `0 * * * *` | export + git push |
| GitHub Actions `build.yml` | `17 * * * *` | 七語系重建與部署(刻意錯開整點,避免與主機 push 互踩) |

cron 環境的 PATH 必須含 `/root/.local/bin`(`claude` CLI 在此)。
