# 重構診斷(2026-08-19)

> **本檔是某個時點的診斷,不是現況報告。**每一項都附查法;重看這份文件時請重跑查法,
> 不要相信文中的數字——它們是寫作當日的觀測值,只用來說明問題的量級。
> 已修的項目留在檔內是為了記錄「為什麼會這樣」,不是待辦 —— **每個已修項目的標題下方都有 ✅ 橫幅**,
> 橫幅以下的內文是診斷當下的狀態,不要當現況讀。沒有橫幅的項目(3.2 / 3.3 / 4.2)才是仍然成立的描述。

分級:

- 🔴 **線上有影響,或正在擋住開發**
- 🟡 **技術債:不會壞,但讓每次改動變貴**
- 🟢 **觀察:記錄在案,現在動的收益不明顯**

---

## 零、根因:四層沒有共用語彙

其餘大部分問題都是這一項的下游。`CONTEXT.md` 已把語彙釘死,`scripts/lib/topics.mjs`
已把判準變成程式碼,**但只有 `scripts/` 在用**。

三層跑在三個 runtime(主機 node / Astro build / Cloudflare Workers),沒有共用模組的現成路徑,
於是各自散裝列舉字串值。

查法:

```bash
grep -rn "'active'" site/src api/src --include=*.astro --include=*.mjs --include=*.js | grep -v node_modules
```

### 🟡 0.1 首頁的過濾判準寫錯(目前那條路走不到)

> **2026-08-19 更正**:本項原評為 🔴 並寫成「等排名 job 上線就會靜默發作」。
> 實際查證後降級 —— 判準確實寫錯、也已修,但**當時與現在的實際影響都是零**,
> 因為那段程式碼走不到。原評級是我沒有實測就下的結論。

`site/src/pages/index.astro` 曾用 `topic.status === 'active'` 過濾首頁的次要清單。
依資料模型,`archived` 是**公開可見且可發文**的,只是不熱——用熱度軸的一個值去
表達可見性,是本專案反覆出錯的那個混淆。已改用 `isPubliclyVisible()`。

但這條路目前走不到:該 filter 只作用於「不在 `recentTopics()` 結果裡」的 Topic,
而 `recentTopics()` 會收下常青、趨勢、以及任何有日期 observance 的 Topic ——
實測目前**沒有任何 Topic** 落在它之外。而且 `export-data.mjs` 本來就只輸出
`NOT IN ('candidate','merged')`,所以新判準對 index 內的資料恆為真。

查法(算出真正會走到那條路的 Topic 數;為 0 就代表這段仍是死路):

```bash
python3 - <<'EOF'
import json, os
idx = json.load(open('data/topics/index/zh-TW.json'))
items = idx if isinstance(idx, list) else idx.get('topics', [])
n = 0
for t in items:
    if t.get('is_perennial') or str(t.get('topic_id','')).startswith('top_tr_'): continue
    f = f"data/topics/{t['topic_id']}/facts.json"
    if not os.path.exists(f): continue
    obs = json.load(open(f)).get('observances') or []
    if not [o for o in obs if o.get('next_occurrence') or o.get('observed_date')]: n += 1
print(n)
EOF
```

### 🟡 0.2 `api/src/index.js` 多處散裝列舉 post 狀態

> **✅ 已修(`68521b2`):抽出 `TOPIC_HIDDEN`/`POST_OPEN`/`isPostOpen`/`SQL_POST_OPEN`,呼叫點不再列舉字串。**
> 以下內文描述的是 2026-08-19 診斷當下的狀態,**不是現況** —— 保留是為了記錄問題長什麼樣。

`post_status !== "active" && post_status !== "cooling"` 這組判斷在檔內重複出現,
feed 的 SQL 也各寫一次。語意是「這則 Post 還能不能回覆」,應該有名字。

> 2026-08-19 已在同一支檔案修過一次同類問題:`topicGate` 一度被改成「只放行
> active/cooling」,而 `cooling` 這個 **topic** status 從未存在於資料中,
> 效果是把所有 `archived` Topic 鎖死不能發文,牴觸紅線。
> **那一版未曾上線**(`git log -S` 查證從未進過任何 commit,Worker 最後部署是 08-15),
> 是靠人工讀碼攔下的 —— 問題不在於它造成了損害,而在於當時沒有任何自動化會攔它。

查法:

```bash
grep -n 'post_status' api/src/index.js
```

---

## 一、`api/` Worker

### 🟡 1.1 整個 Worker 是單一檔案

> **✅ 已修(`d65e6ae`):拆成多個模組,行為由 tests/api 保護。**
> 以下內文描述的是 2026-08-19 診斷當下的狀態,**不是現況** —— 保留是為了記錄問題長什麼樣。

單檔內依序是:基礎工具 → 入口限流 → 同步認證 → 共用 gate → 公開端點 →
每日世界一問 → 內部端點 → 路由。分界只靠註解橫線,沒有模組邊界。

查法:`wc -l api/src/index.js`;`grep -n '^// ----------' api/src/index.js`

拆分不需要動 API 契約——契約是 URL 與 JSON 形狀,不是檔案結構。

### 🔴 1.2 Worker 沒有任何測試

> **✅ 已修(`e581297`):補上 Worker 行為測試,CI `test` job 擋在七站部署前,並以突變測試驗過攔截力。**
> 以下內文描述的是 2026-08-19 診斷當下的狀態,**不是現況** —— 保留是為了記錄問題長什麼樣。

整個專案只有一支測試檔,測的是趨勢 RSS 解析。限流、認證、發文閘門、
投票去重這些「錯了會靜默出事」的邏輯,一行測試都沒有。

查法:`find tests -name '*.test.mjs'`

這一項的嚴重性不在於「品質不好」,而在於**它讓前面每一項重構都變得危險**。
1.1 的拆分若沒有測試護欄,就是在沒有安全網的情況下動唯一一段直接面對外部寫入的碼——
限流一鬆就是被灌爆,發文閘門一錯就是該擋的沒擋。

---

## 二、`scripts/` 資料管線

### 🔴 2.1 `export-data.mjs` 含 NUL 位元組,搜尋會靜默失效

> **✅ 已修(`1b37d3e`):複合鍵改巢狀 Map,NUL 歸零,`data/` 輸出 byte-identical。**
> 以下內文描述的是 2026-08-19 診斷當下的狀態,**不是現況** —— 保留是為了記錄問題長什麼樣。

檔案裡混進了 NUL 位元組(當複合鍵分隔符用)。後果:

- `git` 視為二進位 → **這支檔案的任何改動,diff 與 PR 上都看不見**
- `grep` 視為二進位 → **搜尋直接回空,不報錯**

第二點在 2026-08-19 診斷過程中實際踩到:`grep -n "trendOutputMetadata" scripts/export-data.mjs`
回空,但該符號確實在檔內。若不是剛好用 `sed` 覆核,會得出完全錯誤的結論。

查法:

```bash
python3 -c "b=open('scripts/export-data.mjs','rb').read(); print('NUL:', b.count(b'\x00'))"
grep -c "trendOutputMetadata" scripts/export-data.mjs    # 靜默回 0
grep -ac "trendOutputMetadata" scripts/export-data.mjs   # 加 -a 才是真的
```

修法是不要用控制字元當分隔符——改用不會出現在 ID 裡的可見字元,或直接用陣列/Map 當複合鍵。改動本身不大,
但**在改之前,這支檔案的所有 code review 都是無效的**——看不見 diff。

### 🟡 2.2 目錄裡看不出哪些是常態、哪些是一次性

> **✅ 已修(`39581e4` `acfde00`):零引用產生器與兩支 migrate 移入 `scripts/oneoff/`,常態管線不再 spawn 它們。**
> 以下內文描述的是 2026-08-19 診斷當下的狀態,**不是現況** —— 保留是為了記錄問題長什麼樣。

同一個扁平目錄裡混著三種東西,命名沒有區別:

| 種類 | 例子 | 問題 |
|---|---|---|
| cron 常態跑 | `export-data` `import-topics` `translate-posts` | — |
| 一次性遷移 | `migrate-questions` `migrate-topic-observances` | 卻被常態腳本呼叫,等於每小時重跑遷移邏輯 |
| 無人呼叫 | `generate-final-topic-content` `generate-local-data-expansion` | 死碼 |

查法:

```bash
# cron 真正會跑的
grep -ohE 'scripts/[a-z0-9-]+\.mjs' scripts/cron-15min.sh scripts/hourly-export.sh | sort -u
# 某支有沒有人呼叫
grep -rl '<basename>' scripts .github docs | grep -v "scripts/<basename>.mjs"
```

遷移腳本已經被常態腳本呼叫,長進了每小時的管線,從檔名分不出來哪些跑完可以退場。
數量用上面的查法數,不寫在這裡。

### 🟢 2.3 `sources` 表的 upsert 是純時間戳寫入

> **✅ 已修(`f45b7b4`):改成 `DO NOTHING`。**
> 以下內文描述的是 2026-08-19 診斷當下的狀態,**不是現況** —— 保留是為了記錄問題長什麼樣。

`import-topics.mjs` 的 `ON CONFLICT(url) DO UPDATE SET updated_at = excluded.updated_at`——
整個 DO UPDATE 只做這件事。與已修好的 `topics` 是同一個反模式,但沒有可觀測後果
(沒有東西讀 `sources.updated_at`),所以沒有一起改。

> 同類問題的已修版本:`topics` 的 upsert 曾讓每小時 cron 推新所有 Topic 的時間戳,
> 破壞 export 的「hash 沒變不寫檔」,導致 `data/` 每小時產生數百行純時間戳 diff
> → commit → CI → **七站全部重建重新部署**,而整個 `site/` 沒有一處讀 `updated_at`。
> 2026-08-19 已加 `WHERE` 子句修正。

查法:`git log --oneline --grep='chore(data)' -5` 之後看 diff 是不是只有時間戳。

---

## 三、`site/` 前端

### 🟡 3.1 `data.mjs` 是前端的資料層 god module

> **✅ 已修(`19396ac`):依內聚拆成多支,原檔留成 re-export barrel,dist 輸出 byte-identical。**
> 以下內文描述的是 2026-08-19 診斷當下的狀態,**不是現況** —— 保留是為了記錄問題長什麼樣。

前端所有取數邏輯都在這一支:讀 JSON、排序、季節判斷、熱度、趨勢判定。
它的行數與 `site/src/lib/` 其餘所有檔案加起來相當。

查法:`wc -l site/src/lib/*.mjs | sort -rn`

### 🟡 3.2 新增一個分類要手動改多處

正典清單一處 + 每個語系各一處標籤。少改任何一處,前端 `tOr()` 會**退回顯示英文原始 slug**。

> 這不是假設:**2026-08-19 事故** —— 分類長出來的速度超過 i18n 標籤補上的速度,
> 七站首頁(含中文站、日文站)直接露出 `family`、`civic`、`seasonal` 等英文原始 slug。
> 已補齊並加守門;缺標籤現在會被 `check-data-completeness.mjs` 擋下。

查法:

```bash
node scripts/check-data-completeness.mjs     # 缺標籤會被擋下
```

守門擋得住漏改,但流程仍是手動的。

### 🟢 3.3 pages 與 components 相對健康

page 與 component 數量相當、職責清楚,沒有明顯的巨檔。這一層**不是**重構的優先對象。

查法:

```bash
find site/src/pages -name '*.astro' | wc -l; ls site/src/components/ | wc -l
wc -l site/src/components/*.astro | sort -rn | head -3
```

> ⚠ 真要動這一層之前,必須先打開產品草案本體讀過(CLAUDE.md 紅線)。
> 引用章節編號不等於讀過那份文件——2026-08-11 因此做出雜誌文章網站而非主題頁論壇。

---

## 四、`db/` 資料模型

### 🟡 4.1 schema 註解與實際值脫節

> **✅ 已修(`31d523e`):`category` 與 `access_source` 註解均已更正為實際取值。**
> 以下內文描述的是 2026-08-19 診斷當下的狀態,**不是現況** —— 保留是為了記錄問題長什麼樣。

已知並已修:

- `category` 註解原寫「草案 §4.1 的 N 類」,與實際完全不符——草案那組
  (`holiday/culture/travel/shopping/technology/weather/business/…`)與實作那組
  只有 `festival`/`food`/`education` 三個重疊。2026-08-19 更正為實際正典清單。
- `access_source` 註解原寫 `category|manual|moderation`,實際是
  `category|manual|trend`(`moderation` 從未出現)。已更正。

仍未處理:

- `jobs.status` 註解列舉六種,但實際使用的 `dlq` 不在其中。這不是意外漂移——
  `scripts/lib/aeiou-lib.mjs` 檔頭明文記錄了這個契約矛盾與採用 `dlq` 的理由,
  只是 schema 註解沒同步。

查法(逐表比對,不要用一次抓全部的偷懶寫法,會抓錯行):

```bash
sed -n '<該表行號範圍>p' db/schema-host.sql | grep status
sqlite3 db/aeiou.sqlite "SELECT DISTINCT status FROM <表名>"
```

### 🟢 4.2 `candidate` 與 `cooling` 是設計好但未實作的狀態

兩者都在產品草案與 `docs/02-data-model.md` 有定義,但從未出現在資料中——
會推動狀態轉換的排名 job 屬 M2 延後範圍。**不是死語彙,不要刪。**

查法:`sqlite3 db/aeiou.sqlite "SELECT DISTINCT status FROM topics"`

---

## 執行結果(2026-08-19 當日全部完成)

| 項 | 狀態 | commit | 怎麼確認 |
|---|---|---|---|
| 2.1 NUL 位元組 | ✅ | `1b37d3e` | `python3 -c "print(open('scripts/export-data.mjs','rb').read().count(b'\x00'))"` 應為 0;`grep -c` 不加 `-a` 也要有命中 |
| 1.2 Worker 測試 | ✅ | `e581297` | `node --test 'tests/**/*.test.mjs'`;CI 關卡 `yq '.jobs["build-deploy"].needs' .github/workflows/build.yml` |
| 0.1 / 0.2 語彙 | ✅ | `68521b2` | `grep -crE 'post_status !== .active.\|topic_status === .candidate.' api/src/**/*.js` 應無命中 |
| 1.1 Worker 拆模組 | ✅ | `d65e6ae` | `wc -l api/src/index.js api/src/lib/*.js api/src/routes/*.js`;`cd api && npx wrangler deploy --dry-run` |
| 2.2 scripts 分層 | ✅ | `39581e4` `acfde00` | `ls scripts/oneoff/`;`grep -ohE 'scripts/[a-z0-9-]+\.mjs' scripts/cron-15min.sh scripts/hourly-export.sh \| sort -u` |
| 2.3 sources upsert | ✅ | `f45b7b4` | `grep -A1 'ON CONFLICT(url)' scripts/import-topics.mjs` 應為 `DO NOTHING` |
| 3.1 data.mjs 拆分 | ✅ | `19396ac` | `wc -l site/src/lib/*.mjs`;七語 `pnpm build` 後比對 dist 指紋 |
| 4.1 schema 註解 | ✅ | `31d523e` | 逐表比對(見 §4.1 的查法) |

**仍然成立、沒有 ✅ 橫幅的三項**:3.2(新增分類要手動改多處)、3.3(前端相對健康)、
4.2(candidate/cooling 設計好但未實作)。

**未解、已記錄在案**:`retire-merged-topics` 留在管線裡是**對的**(它是內容匯入步驟,
不是遷移,原 §2.2 把它與 migrate-* 並列是誤判)。

## 原建議順序

排序理由是**依賴關係**,不是嚴重性:

1. **2.1 NUL 位元組** — 在這之前,`export-data.mjs` 的 review 與搜尋都不可信。
   它是其他工作的前置條件,不是因為它最嚴重。
2. **1.2 Worker 測試** — 1.1 的拆分需要它當安全網。先寫測試再拆,不要反過來。
3. **0.1 / 0.2 語彙推到 site 與 api** — 修掉一個潛在的線上 bug,並讓後續改動有共同判準。
4. **1.1 Worker 拆模組** — 有了 2 的護欄才做。
5. **2.2 scripts 分層與清死碼** — 獨立,隨時可做。
6. **3.1 data.mjs 拆分** — 收益最低,最後做。

3.3(前端版面)不在此列。動它之前先讀產品草案本體,且範圍要由用戶決定。
