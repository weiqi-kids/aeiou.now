# aeiou.now — 專案手冊(每次 session 自動載入)

> 本檔是**索引與紅線**,不是現況報告。
> 詳細內容:`docs/01-architecture.md`(架構)、`docs/02-data-model.md`(**資料結構權威文件**)、
> `docs/briefs/api-contract.md`(API 契約)、`docs/TODO.md`(**待辦**)。

## § 現況一律用指令查(本手冊第一鐵則)

**本檔與 `docs/` 底下所有文件 100% 禁止寫死「現況數字與狀態描述」**——表數、頁數、Topic 數、
貼文數、站台是不是最新、翻譯完成幾語、哪些 job 跑過……文件只寫**查法**,答案以指令輸出為準。
歷史事實(含當時數字)只進「事故」條目並標日期。發現任何檔寫死現況,當場改成查法。

| 要知道什麼 | 查法(皆已實測) |
|---|---|
| 主機庫有哪些表、各表幾筆 | `sqlite3 db/aeiou.sqlite ".tables"`;筆數 `sqlite3 db/aeiou.sqlite "SELECT 'topics',COUNT(*) FROM topics UNION ALL SELECT 'posts',COUNT(*) FROM posts"`(依需要換表名) |
| D1 有哪些表 | `cd api && npx wrangler d1 execute aeiou-ugc --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"` |
| Worker 網址與版本 | `cd api && npx wrangler deployments list \| head -20` |
| Worker 現在活著嗎 | `curl -s -o /dev/null -w '%{http_code}\n' "$(cat docs/.api-url 2>/dev/null || echo https://aeiou-api.lightman-chang.workers.dev)/v1/me"` |
| 某站線上是不是最新版 | `curl -s https://weiqi-kids.github.io/aeiou-pages-<locale小寫>/.build-id` 與 `git rev-parse HEAD` 比對(**不是比 HTTP 200**,舊版也回 200) |
| 七站分別是哪一版 | `SHA=$(git rev-parse HEAD); for l in zh-tw en ja zh-cn hi id pt-br; do printf '%-6s %s\n' "$l" "$(curl -s https://weiqi-kids.github.io/aeiou-pages-$l/.build-id \| tr -d '[:space:]' \| cut -c1-7)"; done; echo "期望 ${SHA:0:7}"` |
| 某站的 Pages 是否還在建 | `gh api repos/weiqi-kids/aeiou-pages-<x>/pages/builds/latest --jq .status` |
| CI 最近跑得如何 | `gh run list -R weiqi-kids/aeiou.now --limit 5` |
| cron 排程現況 | `cat /etc/cron.d/aeiou` |
| 最近的 job 成敗 | `sqlite3 db/aeiou.sqlite "SELECT job_name,status,datetime(scheduled_at,'unixepoch'),error_message FROM jobs ORDER BY scheduled_at DESC LIMIT 20"` |
| 哪些 job 進了 DLQ | `sqlite3 db/aeiou.sqlite "SELECT * FROM jobs WHERE status='dlq'"` |
| 有沒有待翻譯的貼文 | `curl -s -H "Authorization: Bearer $(cat ~/.config/aeiou/sync-secret)" "$API/internal/ugc/pending-translation?limit=50" \| head -c 300` |
| i18n 有沒有未翻的佔位 | `grep -l '\[TODO\]' site/src/i18n/*.json` |
| 七檔 i18n key 是否一致 | `python3 -c "import json,glob; s={f:set(json.load(open(f))) for f in glob.glob('site/src/i18n/*.json')}; b=s['site/src/i18n/zh-TW.json']; print(all(v==b for v in s.values()), len(b))"` |
| 靜態 JSON 產出了什麼 | `find data -type f -name '*.json' \| sort` |
| repo 有哪些站 | `gh repo list weiqi-kids --limit 100 \| grep aeiou` |
| 有沒有殘留的背景 server | `pgrep -af '[a]stro (dev\|preview)'; pgrep -af '[h]ttp\.server'` |

---

## ⚠ 版面與資訊架構的權威來源 = 產品草案

`/root/.claude/uploads/83eae670-5a5c-4c2f-a5cf-010b9c859fc1/e4a71c35-global_topic_platform_full_spec.md`

**要改任何頁面版面之前必須打開它讀,不准只憑本檔或計劃裡引的「草案 §44」這種編號辦事。**
關鍵節次:§1 產品定位、§22 Feed 三種排序、§44 Topic Page 完整 UI(含框線雛形)、§45 Ask the World、
§46 全球排行榜、§47 國家熱度、§54 前台首頁、§55 首頁必須有「現在」、§56 即時性原則。

> **事故(2026-08-11)**:整站重做時,交辦書照抄了計劃裡的「草案 §44 版面」編號往下發,
> 沒有任何一方打開過草案本體,結果做出雜誌文章網站而非**主題頁論壇**。
> **教訓:引用章節編號不等於讀過那份文件。**
>
> **事故(2026-08-11)**:主對話自行編了產品標語與統計數字寫進交辦書當「核心命題」,agent 照抄上首頁。
> **教訓:產品文案、品牌口吻、定位語句一律是用戶的東西**,不得代寫後當成既定前提交辦。
> 用戶核准「視覺重做」時,**範圍不是我能加的**(反面同樣成立)。

---

## 這是什麼:主題頁論壇

每個 Topic 自己就是一個看板。主題頁 = 議題介紹 + 討論串本身;討論不是附掛在文章底下的留言區,
而是那一頁存在的理由。首頁是看板列表,不是產品介紹頁。

### 階層(搞混這個是多輪返工的共同原因)

```
World
└── Topic(看板)
    ├── 議題介紹          全世界怎麼過、國旗、店家、活動 ← Topic 頁的靜態內容
    └── Post(討論串)      ← 動態,來自 Worker
        └── Comment(留言)
```

| 頁面 | 是什麼 | **絕對不該有** |
|---|---|---|
| **首頁**(`/`) | 近期話題:當令的 Topic 清單,每列右邊掛該 Topic 最熱三篇 | ❌ 時窗切換 ❌ 熱門話題區 ❌ 大家正在聊區 ❌ 店家/活動獨立清單 |
| **熱門話題**(`/topics/today/`) | 依熱度排的 Topic 清單 | — |
| **附近訊息**(`/topics/nearby/`) | **有在地資訊的 Topic** | ❌ 一份店家清單 |
| **活動資訊**(`/topics/events/`) | **有活動的 Topic** | ❌ 一份活動清單 |
| **排行榜**(`/rankings/<窗>/`) | 純 Topic 排名 | 24H/72H/7D/1M/3M/1Y 切換**只在這裡** |
| **Topic 頁**(`/topic/<slug>/`) | 單一看板 | ❌ 熱度時窗切換 ❌ 徽章 `<ul>` ❌ 七語堆疊 |

> **判準:同一批資料在同一頁出現兩次,就是階層沒分清楚。**

### 導覽 = Topic 的排序

導覽列在右上角:**首頁、熱門話題、附近訊息、活動資訊、+ 具體 Topic**。
前四項**不是四種內容,是同一份 Topic 清單的四種排序/篩選**;點任何一項看到的都是 Topic 清單。

### Topic 頁版面(2026-08-11 定版)

```
┌─────────────────────────────────────────────┐
│ header > .head-main(整幅寬)                  │
│   cover 圖 | 標題 + 「🌎 全世界怎麼過 ↓」同一行 │
│            | 本站語系的說明(只有一段)         │
├──────────────────────┬──────────────────────┤
│ 左 50%                │ 右 50%               │
│  📍 #nearby           │  💬 #talking         │
│  🎉 #events           │                      │
└──────────────────────┴──────────────────────┘
        ↓ 整頁最下面
   國旗列 + 🌎 #world(預設收合,點頁首連結才展開並捲過來)
```

硬性:頁首高度由文字決定(cover 跟著對齊,不自己撐高);三區塊**不限高、不內捲**,內容全部顯示;
**沒有 `#ask`、沒有 `#highlights`、header 內沒有 `<ul>`**。

### 討論串的四態(不可混用)

| 狀態 | 何時 | 呈現 |
|---|---|---|
| `closed`(靜態預設值) | **沒有 JS**、或 fetch 失敗 | 討論室暫時關閉 |
| `loading` | JS 一啟動就切,還沒拿到回應 | 討論室載入中 |
| `open` + 空 | fetch 成功但 `posts` 為 0 筆 | 還沒有人發言 + 參與入口 |
| `open` + 有內容 | fetch 成功且有貼文 | 列出 |

> 「動態掛掉」與「還沒人發言」是兩件事;「還沒載入」也不是「掛掉」。

### 七語系是七個獨立的站

各自 repo、各自子網域,每次 build 只吃一個 `LOCALE`。讀者只看得到一種語言——
**「本站有七種語言」不是給讀者看的資訊,不得出現在版面上**;Topic 說明也只顯示本站語系那一段。

---

## 守門七條(團隊紅線,逐字遵守)

1. 禁 px 字級——一律 `var(--text-*)` 階梯,最小 18px,內文 ≥ `--text-base`
2. 顏色只准出現在 `site/src/styles/variables.css`;**元件內連 `oklch()` 字面值也禁**,一律 `var(--color-*)`
3. 禁 `!important`
4. 禁外部 CDN(fonts.googleapis / gstatic / cdnjs / unpkg / jsdelivr)。**唯一例外:`googletagmanager.com` 的 GA4**
5. CSS 檔白名單:只准 `site/src/styles/{variables,global}.css`,元件樣式寫 scoped `<style>`
6. `--text-*` token 值一律 ≥18px(`clamp()` 以最小值計)
7. `build` 必須串 `check-design.mjs` 與 `check-content.mjs`,CI 與本地皆然

守門腳本原樣複製自 `/root/.claude/skills/new-astro-site/templates/`,**不得修改**。
`check-design.mjs` 寫死掃 `src/`,故 **`pnpm build` 一律以 `site/` 為 cwd**。

---

## 介面常數(契約,不是現況;一律照抄)

| 常數 | 值 |
|---|---|
| D1 資料庫 / binding | `aeiou-ugc` / `DB` |
| Worker 名 | `aeiou-api` |
| Cloudflare account_id | `9d9e58b5e0d1657b8f74bd2cbfc91ee3`(**必須 pin**;另一個 Gcmgcm 帳號不要用) |
| 同步 secret | Worker 側 `SYNC_SECRET`;主機側 `~/.config/aeiou/sync-secret`(chmod 600,**絕不進 git**) |
| deploy key 私鑰 | `~/.config/aeiou/deploy-keys/aeiou-pages-<locale小寫>`(**絕不進 git**) |
| 靜態站 API 位址 | 環境變數 `PUBLIC_API_URL` |
| `REACTION_SET` | `["❤️","😂","😮","😢","🤔","🎉","👏"]`(**不含 👍**,用戶明示排除) |
| reaction 可掛的對象 | `post` / `comment` / `place` / `event` |
| 主機 SQLite | `/root/aeiou.now/db/aeiou.sqlite` |
| API 路徑參數 | `/v1/topics/:id/...` 的 `:id` = **topic_id(ULID)**,不是 slug |
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

`ja→jp`、`zh-CN→cn`、`pt-BR→br` 子網域與 locale **不同名**。語系用目錄分,不用 branch,全在 main。

---

## Topic 內容維護:content/topics/*.md(要寫節日就是改這裡)

**一個 Topic 一個檔:`content/topics/<slug>.md`。格式規格與完整模板見 `docs/03-topic-content.md`。**

```
content/topics/<slug>.md   ←── 人工編輯(唯一入口)
  → node scripts/import-topics.mjs     匯入 SQLite(冪等;缺語系/缺 source 會報錯擋下)
  → node scripts/export-data.mjs       產 data/*.json(hash 沒變不寫檔)
  → build(本地)或等 cron+CI(自動)
```

- 每小時 cron 會自動跑匯入+匯出,**存檔後最慢一小時上線**;要立即看就手動跑再 build。
- 七語都要在檔案裡(可先寫 zh-TW 再請 Claude 補其餘六語);每個國家至少一個 source。
- `data/` 與 `db/aeiou.sqlite` 的這三張表(topic_i18n/topic_countries/topic_country_i18n)
  都是**產物**,直接改會被下次匯入/匯出蓋掉。
- import **不碰 `topic_scores`**(分數屬排程,不是內容)。

---

## Cron 的運行方式(全部自動化都在這裡)

| 排程 | 入口 | 做什麼 |
|---|---|---|
| 主機 `*/15 * * * *` | `scripts/cron-15min.sh` | ① `translate-posts.mjs`:D1 撈 pending 貼文 → `claude -p` 翻六語 → 寫回 D1 + **回流主機**(UGC 進主機的唯一通道) ② `sync-topics-to-d1.mjs`:主機 Topic 副本 → D1 |
| 主機 `0 * * * *` | `scripts/hourly-export.sh` | ① `import-topics.mjs`(content/ md → SQLite) ② `export-data.mjs` ③ **只 commit `data/`** ④ push source repo |
| GitHub Actions `17 * * * *` + push | `.github/workflows/build.yml` | 七語系 matrix build → SSH 推七個 publish repo(帶 `.nojekyll` 與 `.build-id`)→ 輪詢驗證**內容真的上線**(比 build-id,不是比 200) |

- 排程本體:`cat /etc/cron.d/aeiou`(檔內註解有逐行說明與排錯指引)。**Actions 排 17 分是刻意錯開主機整點 push。**
- log:`/root/aeiou.now/logs/*.log`;成敗記在 `jobs` 表(查法見上表)。
- 失敗語意:+5 分、+10 分重試,第三次進 `dlq`(不再自動重試,要人工看)。`job_locks` 防重入。
- cron 環境 PATH 必須含 `/root/.local/bin`(`claude` CLI 在那);改 cron 檔屬 C 級,先問用戶。

---

## 多國語系的運行方式

**一份碼庫、七次 build、七個站。** 沒有語言切換器,讀者只看得到一種語言。

| 層 | 機制 |
|---|---|
| **UI 字串** | `site/src/i18n/<locale>.json` 七檔,key 集合必須一致(查法見上表)。zh-TW 為準源;新增 key 時其餘六語先填 `[TODO] ` 佔位,定版後一次補譯(`grep -l '\[TODO\]' site/src/i18n/*.json` 找得到) |
| **Topic 內容** | `content/topics/*.md` 內含七個 `## locale` 段(見上節);build 時每站只取自己語系那段 |
| **UGC 貼文** | 使用者用任何語言發文 → 15 分 cron 用 `claude -p` 翻**六語**(不翻原文那語)→ 前端優先顯示本站語系譯文,缺譯顯示原文+「翻譯中」。**留言不翻譯** |
| **build** | `LOCALE=<code> pnpm build`(cwd=`site/`);`BASE_PATH=/aeiou-pages-<locale小寫>`;CI matrix 七語各跑一次 |
| **部署** | 每語系一個 publish repo(映射表見下),deploy key 各自獨立;只推單站的手法見 `docs/TODO.md` |

**改版節奏**:版面調整期只做 zh-TW 並手動推 zh-TW 一站(用戶看線上網址確認);定版後補譯 + CI 推七站。

---

## 常用指令

```bash
# ── 資料 ──
node scripts/init-db.mjs --host-only            # 建/補主機庫
node scripts/init-db.mjs --host-only --seed     # 順便灌 db/seed/*.sql
node scripts/export-data.mjs                    # 匯出靜態 JSON(hash 沒變不寫檔)

# ── 管線(cron 自動跑,手動可重現) ──
node scripts/sync-topics-to-d1.mjs              # 主機 → D1 Topic 副本
node scripts/translate-posts.mjs                # D1 撈 pending → claude -p 六語 → 寫回 + 回流主機
bash scripts/hourly-export.sh                   # export + 只 commit data/ + push

# ── 靜態站(cwd 一律 site/) ──
cd site && LOCALE=zh-TW pnpm build
cd site && for L in zh-TW en ja zh-CN hi id pt-BR; do LOCALE=$L pnpm build || break; done

# ── Worker ──
cd api && npx wrangler deploy
cd api && npx wrangler d1 execute aeiou-ugc --remote --command "SELECT ..."

# ── 部署單一語系(定版前的節奏,不動其他六站) ──
#   見 docs/TODO.md 的「只推一站」段落;CI 會推七站,手動只推一站。
```

---

## 絕不可破壞的紅線

- **兩個權威來源**:主機 SQLite(爬搜/Topic 生產)、D1(UGC)。靜態 JSON 全是衍生品。
- **降級不做 fallback 快照**:動態異常時顯示關閉狀態,**不顯示過期資料**。靜態 HTML 預設
  `data-room-state="closed"`(沒有 JS 的讀者看到的就是它,curl 驗降級也靠它)。
- **`topics.status='archived'` 仍可發文**(只是不熱);**`posts.status='archived'` 才是永久鎖定**。同名不同義。
- **Post 翻譯六語譯文(不翻原文那語)、Comment 不翻譯**。翻譯用 `claude -p` 訂閱 CLI,**不是 API**。
- **UGC 回流主機的唯一通道是 `translate-posts.mjs`**——沒有它,主機端拿不到貼文。
- **跨站 cookie 三件套缺一不可**:`SameSite=None; Secure` + `Access-Control-Allow-Credentials: true`
  + 前端 `credentials:'include'`(此時 CORS origin **不得用 `*`**)。
- **CI 推 publish repo 一律 SSH**(deploy key 是 SSH 機制);主機端 cron 才是 gh HTTPS helper,**別混**。
- **推 dist 必寫 `.nojekyll`**:Pages deploy-from-branch 會走 Jekyll,`_astro/` 會被丟棄。
- **驗「上線了沒」要比 `.build-id`,不是比 HTTP 200**——舊版同樣回 200(2026-08-11 實測假綠兩次)。
- **絕不動 `git config --global`**;要定身分用 repo 層或單次 `-c`。
- **絕不呼叫 Google Places API**、不儲存其回傳資料。導航一律純字串組裝。
- **自己起的背景 server 一定要收**。`pkill -f` 的 pattern 會比對到**自己那條指令**,
  用 `[h]ttp.server` 這種寫法迴避(2026-08-11 踩過,把自己的 shell 殺掉)。
- secret 只從 `~/.config/aeiou/` 讀,**不寫進碼、不寫進 log、不進 git**。

---

## 顯示層規則

- **熱度一律級距呈現,原始分數不得上畫面**(排行榜的名次可以)。級距定義在 `site/src/lib/heat.mjs`,
  **門檻是暫定值**,真實 HotScore(含 GA4 瀏覽面)上線後必須重新校準。
- **級距不得只靠顏色區分**,需同時有文字與長度/形狀差異。
- 品牌配色定義在 `site/src/styles/variables.css`,**已非模板佔位色**,不要改回 `#1a4f8a`。
- 活動時間鎖 `timeZone: 'UTC'`(否則主機與 CI 的 TZ 差異會 build 出不同字串);整日活動只印日期。
- **貼文內容一律純文字轉義顯示**,絕不 `innerHTML`。

---

## 明確延後(M2+;不得自行提前)

來源清冊、Moderation 啟用範圍、OAuth、**Bot 防護(Turnstile / rate limit —— 有意識的裸奔,
M2 上線自訂網域前必須補)**、IndexNow/GSC/sitemap、GA4 property 與專屬 GCP 專案+SA
(紅線:**不共用其他站金鑰**)、Markdown 渲染、圖片上傳(R2+審核)、「回報錯誤/補充」按鈕、
「加入行事曆」按鈕、19 job 完整管線、Vectorize/Topic Detection、R2 歸檔。

**未完成事項見 `docs/TODO.md`。**
