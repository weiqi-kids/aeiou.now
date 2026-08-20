# aeiou.now — 專案手冊(每次 session 自動載入)

> 本檔是**索引與紅線**,不是現況報告。
> 詳細內容:`docs/01-architecture.md`(架構)、`docs/02-data-model.md`(**資料結構權威文件**)、
> `docs/briefs/api-contract.md`(API 契約)、`docs/briefs/daily-question.md`(**每日世界一問規格**)、
> `docs/TODO.md`(**待辦**)。

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
| **線上資料有多新**(與「是不是最新版」不同,見下) | `git log -1 --format=%cr -- data/`(最後一次 data 匯出距今多久);異常判準:超過約 2 小時就該查 `jobs` 表 |
| 某站線上是不是最新版 | `curl -s https://<站網域>/.build-id`(網域見下方映射表)與 `git rev-parse HEAD` 比對(**不是比 HTTP 200**,舊版也回 200) |
| 七站分別是哪一版 | `SHA=$(git rev-parse HEAD); for d in aeiou.now en.aeiou.now jp.aeiou.now cn.aeiou.now hi.aeiou.now id.aeiou.now br.aeiou.now; do printf '%-14s %s\n' "$d" "$(curl -s https://$d/.build-id \| tr -d '[:space:]' \| cut -c1-7)"; done; echo "期望 ${SHA:0:7}"` |
| 某站網域綁定/HTTPS 狀態 | `gh api repos/weiqi-kids/aeiou-pages-<x>/pages --jq '{cname,https_enforced,status}'` |
| 某站的 Pages 是否還在建 | `gh api repos/weiqi-kids/aeiou-pages-<x>/pages/builds/latest --jq .status` |
| CI 最近跑得如何 | `gh run list -R weiqi-kids/aeiou.now --limit 5` |
| cron 排程現況 | `cat /etc/cron.d/aeiou` |
| **hourly-export 連續失敗了嗎** | `sqlite3 db/aeiou.sqlite "SELECT status,datetime(scheduled_at,'unixepoch') FROM jobs WHERE job_name='hourly-export' ORDER BY scheduled_at DESC LIMIT 5"` |
| 最近的 job 成敗 | `sqlite3 db/aeiou.sqlite "SELECT job_name,status,datetime(scheduled_at,'unixepoch'),error_message FROM jobs ORDER BY scheduled_at DESC LIMIT 20"` |
| 哪些 job 進了 DLQ | `sqlite3 db/aeiou.sqlite "SELECT * FROM jobs WHERE status='dlq'"` |
| 有沒有待翻譯的貼文 | `curl -s -H "Authorization: Bearer $(cat ~/.config/aeiou/sync-secret)" "$API/internal/ugc/pending-translation?limit=50" \| head -c 300` |
| i18n 有沒有未翻的佔位 | `grep -l '\[TODO\]' site/src/i18n/*.json` |
| 七檔 i18n key 是否一致 | `python3 -c "import json,glob; s={f:set(json.load(open(f))) for f in glob.glob('site/src/i18n/*.json')}; b=s['site/src/i18n/zh-TW.json']; print(all(v==b for v in s.values()), len(b))"` |
| 靜態 JSON 產出了什麼 | `find data -type f -name '*.json' \| sort` |
| repo 有哪些站 | `gh repo list weiqi-kids --limit 100 \| grep aeiou` |
| 有沒有殘留的背景 server | `pgrep -af '[a]stro (dev\|preview)'; pgrep -af '[h]ttp\.server'` |
| 題庫有幾題、涵蓋到哪天 | `sqlite3 db/aeiou.sqlite "SELECT kind,COUNT(*),MIN(qdate),MAX(qdate) FROM questions GROUP BY kind"` |
| 線上投票數(D1) | `cd api && npx wrangler d1 execute aeiou-ugc --remote --command "SELECT COUNT(*) n, COUNT(DISTINCT question_id) q FROM question_votes"` |
| **D1 用量(讀寫列數、查詢次數)** | `cd api && npx wrangler d1 info aeiou-ugc`——看 `rows_written_24h` 與 `rows_read_24h`。判準:**寫入量應該與真人流量同一個量級**;寫遠大於讀就是自己的同步在灌(2026-08-20 事故) |

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

### 討論串的四態(不可混用;2026-08-20 用戶指正後改定)

| 狀態 | 何時 | 呈現 |
|---|---|---|
| `loading`(**靜態預設值**) | 靜態 HTML 出廠值,也是 JS 發 fetch 之前 | 討論室載入中 |
| `open` + 空 | fetch 成功但 `posts` 為 0 筆 | 還沒有人發言 + 參與入口 |
| `open` + 有內容 | fetch 成功且有貼文 | 列出 |
| `unavailable` | fetch 失敗/非 2xx/JSON 壞/未設 API 位址 | 討論室暫時無法載入 |
| (沒有 JS) | `<noscript>` 蓋掉 loading | 討論需要 JavaScript |

> 「動態掛掉」與「還沒人發言」是兩件事;「還沒載入」也不是「掛掉」。
> **而且「還沒載入」更不是「已關閉」——討論室從來沒有被關閉過。**
>
> **事故(2026-08-20)**:靜態預設值原本是 `closed`,畫面直接印「討論室暫時關閉」。
> 於是首頁與三個清單頁上,每一張 Topic 卡都對讀者宣告一個不存在的故障(一頁 30 次),
> 不執行 JS 的爬蟲看到的是一整頁關著的論壇;`/questions/` 每張卡則印「投票暫時關閉」。
> **教訓:狀態名稱要說事實。「還沒拿到資料」的事實是 loading,不是 closed。**
> 同一組修正套用在 `DiscussionRoom` / `TopicPosts` / `QuestionCard` / `Participation` 四個元件。

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
| GA4 量測 ID(`PUBLIC_GA4_ID`) | `G-ZMTFG68ZJ5`(七站共用一個 web stream,報表以 hostname 區分;CI 已設,手動 build 要自帶,未設不輸出 gtag) |
| `REACTION_SET` | `["❤️","😂","😮","😢","🤔","🎉","👏"]`(**不含 👍**,用戶明示排除) |
| reaction 可掛的對象 | `post` / `comment` / `place` / `event` |
| 主機 SQLite | `/root/aeiou.now/db/aeiou.sqlite` |
| API 路徑參數 | `/v1/topics/:id/...` 的 `:id` = **topic_id(ULID)**,不是 slug |
| wrangler | 主機無全域指令,一律 `npx wrangler` |

### Locale ↔ Repo ↔ 子網域(唯一映射表;2026-08-15 起自訂網域上線)

| locale | publish repo | 正式網域 |
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
**每日一問題庫:`content/questions.json`(唯一入口,格式與紅線見 `docs/briefs/daily-question.md`);
補題=往檔尾加題(七語齊、掛既有 topic),存檔後走同一條 hourly 管線上線。題庫用完不開天窗(前端退最近一題)。**

```
content/topics/<slug>.md   ←── 人工編輯(唯一入口)
  → node scripts/import-topics.mjs     匯入 SQLite(冪等;缺語系/缺 source 會報錯擋下)
  → node scripts/export-data.mjs       產 data/*.json(hash 沒變不寫檔)
  → build(本地)或等 cron+CI(自動)
```

- 每小時 cron 會自動跑匯入+匯出,**存檔後最慢一小時上線**;要立即看就手動跑再 build。
- 七語都要在檔案裡(可先寫 zh-TW 再請 Claude 補其餘六語);每個國家至少一個 source。
- `data/` 與 `db/aeiou.sqlite` 的這三張表(topic_i18n/topic_observances/topic_observance_i18n)
  都是**產物**,直接改會被下次匯入/匯出蓋掉。
- import **不碰 `topic_scores`**(分數屬排程,不是內容)。

---

## Cron 的運行方式(全部自動化都在這裡)

| 排程 | 入口 | 做什麼 |
|---|---|---|
| 主機 `*/15 * * * *` | `scripts/cron-15min.sh` | ① `translate-posts.mjs`:D1 撈 pending 貼文 → `claude -p` 翻六語 → 寫回 D1 + **回流主機**(UGC 進主機的唯一通道) ② `sync-topics-to-d1.mjs`:主機 Topic 副本 → D1 ③ `sync-questions-to-d1.mjs`:題庫精簡副本 → D1(2026-08-15 起) |
| 主機 `0 * * * *` | `scripts/hourly-export.sh` | ① `import-topics.mjs`(content/ md → SQLite) ② `import-questions.mjs`(content/questions.json → SQLite,壞題庫即中止) ③ `export-data.mjs` ④ **只 commit `data/`** ⑤ push source repo |
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
| **build** | `LOCALE=<code> pnpm build`(cwd=`site/`);預設 `BASE_PATH=/`+`SITE_URL=`該站正式網域(裸執行即正確,環境變數是逃生口);CI matrix 七語各跑一次 |
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
- **降級不做 fallback 快照**:動態異常時顯示 `unavailable`,**不顯示過期資料**。靜態 HTML 預設
  `data-room-state="loading"`(2026-08-20 起;**舊值 `closed` 已廢**,見上方四態表的事故)。
  curl 驗降級改查 `curl -s https://aeiou.now/topic/<slug>/ | grep -o 'data-room-state="[a-z]*"'`
  → 應為 `loading`;沒有 JS 的讀者由 `<noscript>` 收尾,不會停在永遠不結束的載入中。
- **`topics.status='archived'` 仍可發文**(只是不熱);**`posts.status='archived'` 才是永久鎖定**。同名不同義。
- **Post 翻譯前先過價值閘門**(2026-08-15,用戶拍板):同一次 claude 呼叫先判有沒有價值,
  沒價值(廣告/亂碼/灌水/詐騙)→ `status='moderation'`+`translation_status='skipped'`,
  不翻譯、feed 自動下架;判定**從寬**,不確定就留。有價值才翻**六語譯文(不翻原文那語)**、
  **Comment 不翻譯**。翻譯用 `claude -p` 訂閱 CLI,**不是 API**。
- **寫入端點有入口限流**(Worker `RATE_LIMITS`,anon_id+IP 雙鍵,超限 429):上限值是介面常數,
  改動屬契約變更要問用戶。IP 只存 sha256(SYNC_SECRET+ip),**絕不存明文 IP**。
- **`claude -p` 一律在 `/tmp` 空目錄跑,絕不在 repo 目錄跑**——claude 會把 cwd 與各層父目錄的
  `CLAUDE.md` 讀進 context,在 repo 跑等於每次呼叫白花約 12,200 tokens,且譯文行為會被手冊內容綁住。
  改 `scripts/translate-posts.mjs` 的 `cwd` 前先讀該檔檔頭(2026-08-13 實測數據在那)。
- **腳本裸執行(不帶任何參數)就必須是正確且完整的行為**;旗標只能是逃生口或縮減行為,
  不得是「不帶就會壞掉」。cron 呼叫一律不帶參數,不能依賴有人記得讀本手冊。
- **推 D1 只推真的變了的列**——Worker 的 `/internal/sync/*` 是純 upsert、不做 delete,
  所以主機端可以只送差異;`sync-topics-to-d1.mjs` 以 state 檔的逐列 hash 判斷。
  全量推只在 `--force` 與保底重推時發生(D1 掉資料時靠它補回來)。
  改這裡之前先看 `npx wrangler d1 info aeiou-ugc` 的 `rows_written_24h`。
- **UGC 回流主機的唯一通道是 `translate-posts.mjs`**——沒有它,主機端拿不到貼文。
- **跨站 cookie 三件套缺一不可**:`SameSite=None; Secure` + `Access-Control-Allow-Credentials: true`
  + 前端 `credentials:'include'`(此時 CORS origin **不得用 `*`**)。
- **CI 推 publish repo 一律 SSH**(deploy key 是 SSH 機制);主機端 cron 才是 gh HTTPS helper,**別混**。
- **推 dist 必寫 `.nojekyll` 與 `CNAME`**:少了 `.nojekyll`,Jekyll 丟棄 `_astro/`;
  少了 `CNAME`(內容=該站網域),GitHub 直接**解除自訂網域綁定**,整站從網域上消失。
- **驗「上線了沒」要比 `.build-id`,不是比 HTTP 200**——舊版同樣回 200(2026-08-11 實測假綠兩次)。
- **絕不動 `git config --global`**;要定身分用 repo 層或單次 `-c`。
- **查各國資料一律先用當地語言、查該國官方網域**(對照表見 `docs/03-topic-content.md`
  §「來源怎麼找」)。只用英文搜尋會把來源系統性地拉向觀光站與英文百科;`japan.travel` 是
  `.travel` 頂級網域,不是日本政府網域。閘門:`node scripts/check-content-depth.mjs`(R6)。
- **驗來源連結不能只看狀態碼**——要看跟完 redirect 之後落在哪裡,而且**判死前要複驗**。
  (2026-08-20 兩個坑:`www.tad.gov.tw` 整批 302 到 `ErrorPage.html` 卻回 200;
  `bndigital.bn.gov.br` 從主機回 403、從 GitHub Actions 回 404。緣由見 `docs/TODO.md`
  §「事故:兩種『狀態碼騙人』的來源」。)
  現況查法:`node scripts/check-source-urls.mjs`(exit 1 代表有死連結)。
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
M2 上線自訂網域前必須補)**、GA4 property 與專屬 GCP 專案+SA
(紅線:**不共用其他站金鑰**)、Markdown 渲染、圖片上傳(R2+審核)、「回報錯誤/補充」按鈕、
「加入行事曆」按鈕、19 job 完整管線、Vectorize/Topic Detection、R2 歸檔。

> **已提前實作(用戶指示,不再屬延後範圍)**:sitemap(隨 build 產出,已在 GSC 提交)、
> IndexNow(2026-08-19,`scripts/indexnow.mjs` + CI 的 indexnow job,七站各送一次)。
> 查:`curl -s https://aeiou.now/<key>.txt`(key 見腳本)、`node scripts/indexnow.mjs --dry-run`。

**未完成事項見 `docs/TODO.md`。**

---

## Agent skills

> 本段供 mattpocock-skills 系列 skill 讀取設定,不是給人看的現況報告。
> 要換 issue tracker 或重來,重跑 `/mattpocock-skills:setup-matt-pocock-skills`;
> 只是微調則直接改 `docs/agents/*.md`。

### Issue tracker

Issue 與 spec 走 GitHub Issues(`weiqi-kids/aeiou.now`),一律用 `gh` CLI。見 `docs/agents/issue-tracker.md`。

### Triage labels

沿用五個標準角色,標籤字串與角色同名。見 `docs/agents/triage-labels.md`。

### Domain docs

單一 context:根層 `CONTEXT.md` + `docs/adr/`(skill 會在真正需要時才建,不存在是預期狀態)。
見 `docs/agents/domain.md`。
