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
                     │  /mnt/customer/aeiou.now/db/          │
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
- 容器帶固定屬性 `data-room-state="loading"`(2026-08-20 起;舊值 `closed` 已廢)。
- JS fetch 成功後改為 `data-room-state="open"` 並替換內容;失敗改為 `unavailable`。
- 沒有 JS 的讀者由 `<noscript>` 蓋掉載入中並顯示 `room.noscript`,不會停在永遠不結束的載入中。
- 驗證:curl 初始 HTML grep `data-room-state="loading"`(語言無關);JS 路徑另以無頭瀏覽器(Chromium)驗。

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
/mnt/customer/aeiou.now/
├── docs/                 架構與資料模型文件、briefs/
├── db/                   schema-common.sql / schema-host.sql / schema-d1.sql、seed/
├── data/                 匯出的靜態 JSON(commit 進 git)
├── scripts/              init-db、export-data、update-local-data、sync-topics-to-d1、translate-posts、hourly-export
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
| 主機 SQLite 檔 | `/mnt/customer/aeiou.now/db/aeiou.sqlite` |
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

| 位置 | 排程 | 入口 | 內容 |
|---|---|---|---|
| 主機 `/etc/cron.d/aeiou` | `*/15 * * * *` | `scripts/cron-15min.sh` | 依序跑 `translate-posts.mjs`(翻譯 + UGC 回流主機)與 `sync-topics-to-d1.mjs`(Topic 副本同步) |
| 主機 `/etc/cron.d/aeiou` | `0 * * * *` | `scripts/hourly-export.sh` | `update-local-data.mjs` → `export-data.mjs` → **只 commit 受管理的 `data/` 與活動快照** → push source repo |
| GitHub Actions `build.yml` | `17 * * * *` | — | 七語系重建與部署(刻意錯開整點,避免與主機 push 互踩) |

cron 環境的 PATH 必須含 `/root/.local/bin`(`claude` CLI 在此),`HOME=/root`(claude CLI 與 gh credential helper 都讀 `$HOME`)。

### 各支腳本的行為約定

- **`translate-posts.mjs`**:`GET /internal/ugc/pending-translation`(上限 50 則)→ 每則翻**六語**(七語系扣掉 `original_locale`)→ **先** upsert 進主機 `posts`/`post_i18n`,**再** `POST /internal/translations` 回寫 D1。順序刻意:主機先落地,萬一回寫 D1 失敗,D1 那幾則仍是 `translating`,下一輪重抓且主機 upsert 冪等,不會掉資料。翻譯一律用 `claude -p`(訂閱 CLI),**不是 Anthropic API**。
  **claude 子行程一律在 `/tmp` 下的空目錄跑**(`AEIOU_CLAUDE_CWD`,預設 `/tmp/aeiou-translate-cwd`):claude CLI 會把 cwd 及各層父目錄的 `CLAUDE.md` 讀進 context,而 cron 是 `cd /mnt/customer/aeiou.now` 之後才呼叫本支。實測同一則 prompt,cwd 在 repo 時 `cache_creation` 20854 tokens、在空目錄 8635 tokens——每次呼叫白花約 12,200 tokens,而且**譯文行為會被手冊內容影響**。空目錄必須在 `/root` 之外(`/root/CLAUDE.md` 會被 `/root` 底下任何 cwd 往上撿到)。
- **`sync-topics-to-d1.mjs`**:主機 `topics`/`topic_i18n` → `POST /internal/sync/topics`。`current_cycle_id` 取自主機 `topic_cycles` 裡 `ended_at IS NULL` 的那一筆;沒有進行中的期就給 NULL。upsert 覆蓋語意,M1 不刪 D1 上多出來的列。
  **內容沒變就不推**:payload 取 sha256 存 `db/.sync-state.json`(不進 git),與上次相同則直接記 success、**不發請求**——Topic 是人工改 `content/topics/*.md` 才會變的東西,但本支掛在 `*/15` 上,原本每輪都無條件全量 upsert。指紋**只在 Worker 回應成功後才寫**,失敗那輪下次仍重推。
  保底:即使指紋相同,距上次真正同步 ≥ `AEIOU_SYNC_FORCE_INTERVAL_SEC`(預設 6 小時)仍強制推一次,避免 D1 那側掉資料時主機因「我沒變」而永不補。`--force` 或 `AEIOU_SYNC_FORCE=1` 可手動忽略指紋。
- **`hourly-export.sh`**:`git add -- data/ content/local-sample-data.json`(**刻意不用 `git add -A`**);受管理輸出無變更則 skip,不產生空 commit;無 `origin` remote 時只 skip push 不整支噴掉。author 用 **repo local git config**,**絕不動 `git config --global`**。

### 可觀測性與失敗處理

- 每支都寫主機 SQLite 的 `jobs` 表(`job_name` = `translate-posts` / `sync-topics` / `hourly-export`)。
- 重試曲線:失敗 `next_retry_at` = +5 分 → 再失敗 +10 分 → **第三次 `status='dlq'`**(不再自動重試,`error_message` 以 `DLQ(…)` 開頭)。
  > 契約備註:`docs/02-data-model.md` §7 的 status 註解列舉沒有 `dlq`;Track D 交辦書明文要求「第三次進 DLQ 狀態」,故實作採 `status='dlq'`,語意等價於「已達 3 次失敗且 `next_retry_at IS NULL`」。
- `translate-posts.mjs` 用 `job_locks` 防重入(同 `scope`+`job_name`+`scheduled_at` 只跑一次;前一輪行程還活著也 skip),避免 15 分鐘的 cron 撞上跑很久的前一輪。`hourly-export.sh` 用 `flock` 自我互斥。
- log:`/mnt/customer/aeiou.now/logs/cron-15min.log`、`logs/hourly-export.log`(`.gitignore` 已忽略 `*.log`)。單檔超過 5MB 由 `cron-15min.sh` 自動裁到最後 2000 行,不另設 logrotate。
- 查最近狀態:

```sh
sqlite3 /mnt/customer/aeiou.now/db/aeiou.sqlite \
  "SELECT job_name,datetime(finished_at,'unixepoch'),status,attempt,records_read,error_message
     FROM jobs ORDER BY rowid DESC LIMIT 10;"
```

### 設定(全走環境變數,切自訂網域只改設定)

| 變數 | 預設 | 用途 |
|---|---|---|
| `AEIOU_API_URL` | `https://aeiou-api.lightman-chang.workers.dev` | Worker base URL |
| `AEIOU_DB_PATH` | `/mnt/customer/aeiou.now/db/aeiou.sqlite` | 主機 SQLite |
| `AEIOU_SYNC_SECRET_FILE` | `~/.config/aeiou/sync-secret` | `SYNC_SECRET`(chmod 600,**不進碼、不進 log、不進 git**) |
| `AEIOU_TRANSLATE_LIMIT` / `AEIOU_TRANSLATE_CHUNK` | `50` / `4` | 一輪抓幾則 / 一次 `claude -p` 呼叫處理幾則 |
