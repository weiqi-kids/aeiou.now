# aeiou.now — API 契約(M1 最小版)

> **這是 W2(Astro 前端)與 W3(Worker)平行開發的唯一契約。** 兩邊都以本檔為準,不得自行加減欄位名。
> Worker 名 `aeiou-api`,base URL = 部署後的 workers.dev 網址(前端以環境變數 `PUBLIC_API_URL` 注入,結尾不帶斜線)。
> 定案日期:2026-08-11。

---

## 0. 通則

| 項目 | 規定 |
|---|---|
| 內容型別 | request / response 一律 `application/json; charset=utf-8` |
| 時間欄位 | 一律 `INTEGER`(Unix epoch **秒**) |
| ID | `<prefix>_<ULID>`:`top_` / `pst_` / `cmt_` / `cyc_` |
| **路徑參數 `:id`** | `/v1/topics/:id/...` 的 `:id` = **topic_id(ULID 主鍵)**,**不是 slug**。前端從靜態 JSON 的 `topic_id` 取值 |
| locale 合法值 | `zh-TW` `en` `ja` `zh-CN` `hi` `id` `pt-BR` |
| CORS | 白名單 `https://weiqi-kids.github.io`(**不得用 `*`**)、`Access-Control-Allow-Credentials: true`、允許 `Content-Type`、方法 `GET, POST, OPTIONS` |
| 前端 fetch | **一律帶 `credentials: 'include'`**(anon_id cookie 是跨站 cookie) |
| geo | Worker 端從 `request.cf` 取:`country_code = request.cf.country`、`city_code = lowercase-slugify(request.cf.city)`(無 city 則 NULL)。**前端不得傳 geo,傳了也忽略** |
| 錯誤格式 | `{ "error": { "code": "<機器碼>", "message": "<英文說明>" } }` |

### anon_id cookie

首次寫入類請求(`POST /v1/posts`、`/v1/comments`、`/v1/reactions`)若 request 沒帶 `anon_id`,Worker 產生一個新的 ULID 並在 response 設 cookie:

```
Set-Cookie: anon_id=<ULID>; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=None
```

同一匿名者的 posts / reactions 都用它;`reactions` 的 PK 依賴其穩定性。
已知缺口:Safari ITP 擋第三方 cookie,該類瀏覽器 anon_id 不穩定(M1 不解,無頭驗證一律用 Chromium)。

### 錯誤碼表

| HTTP | code | 意思 |
|---|---|---|
| 400 | `invalid_body` | JSON 解析失敗或必填欄位缺漏 |
| 400 | `invalid_kind` | reaction 的 `kind` 不在 `REACTION_SET` |
| 400 | `content_too_long` | post > 5000 字元 / comment > 2000 字元 |
| 401 | `login_required` | Topic `access_level` = 1 或 2(M1 一律回這個,不做 OAuth) |
| 403 | `topic_locked` | Topic `status` = `candidate` 或 `merged` |
| 403 | `post_locked` | Post `status` 非 `active` / `cooling`(archived 是永久鎖定) |
| 404 | `not_found` | topic_id / post_id 不存在 |
| 401 | `unauthorized` | 內部端點 Bearer token 不符 |
| 405 | `method_not_allowed` | — |
| 429 | `rate_limited` | 入口限流(2026-08-15):寫入端點依 anon_id 與 IP(sha256 雜湊)雙鍵計數,任一超限即擋。上限見 Worker `RATE_LIMITS`(post 3/5min、20/24h;comment 10/5min、200/24h;reaction 60/5min;vote 30/5min、300/24h) |

> `access_level` **只 gate 討論室,不 gate 靜態頁**。M1 的兩個示範 Topic 都是 level 0。

### `REACTION_SET`(兩端同一常數,不含 👍)

```json
["❤️","😂","😮","😢","🤔","🎉","👏"]
```

---

## 1. `GET /v1/topics/:id/feed` —— 8H 即時 feed(唯一即時層)

### Query

| 參數 | 型別 | 預設 | 說明 |
|---|---|---|---|
| `sort` | `hot` \| `new` | `hot` | 見下 |
| `limit` | 1–50 | `20` | 回傳 post 數 |
| `comments` | 0–10 | `3` | 每則 post 內嵌的最新留言數(N) |

**時間窗**:只回 `created_at >= now - 8*3600` 且 `status IN ('active','cooling')` 的 post。

**`sort=hot` 的 M1 定義(明訂,不得用 `hot_score`)**:即時聚合排序 =
`COUNT(DISTINCT reactions.actor_id) + posts.comments`,tie-break `created_at DESC`。
M1 沒有 hot_score job,`posts.hot_score` 恆 0,**不得用來排序**。

**`sort=new`**:`created_at DESC`。

### Response 200

```json
{
  "topic_id": "top_01J...",
  "window_hours": 8,
  "sort": "hot",
  "server_time": 1770000000,
  "posts": [
    {
      "post_id": "pst_01J...",
      "topic_id": "top_01J...",
      "cycle_id": "cyc_01J...",
      "original_locale": "ja",
      "content": "原文(Markdown 安全子集;M1 前端一律純文字轉義顯示)",
      "translations": { "zh-TW": "譯文", "en": "..." },
      "translation_status": "done",
      "target_country": "TW",
      "country_code": "JP",
      "city_code": "tokyo",
      "created_at": 1769999000,
      "comment_count": 12,
      "reactions": { "❤️": 5, "😂": 2 },
      "reaction_actors": 6,
      "mine": ["❤️"],
      "comments": [
        {
          "comment_id": "cmt_01J...",
          "post_id": "pst_01J...",
          "locale": "ja",
          "content": "留言原文(不翻譯)",
          "country_code": "JP",
          "city_code": "tokyo",
          "created_at": 1769999500
        }
      ]
    }
  ]
}
```

**欄位語意的三個硬規定:**

1. `translations` 只包含**已翻好的** locale;沒翻完就是缺 key(不是空字串)。前端在 `translations[LOCALE]` 缺席時顯示原文 + i18n 的「翻譯中」字串。`original_locale === LOCALE` 時直接顯示 `content`,不查 `translations`。
2. `reactions` 是 `{emoji: 計數}` 的物件,**只列計數 > 0 的 emoji**;前端仍照 `REACTION_SET` 渲染全部七顆按鈕,缺席的顯示 0。
3. `comment_count` 是該 post 的**留言總數**;`comments` 陣列是**最新 N 則**(`created_at DESC`,由 query 的 `comments` 參數決定 N)。兩者不同,不可互相推導。
4. `mine`(2026-08-21 追加)= **當前 anon_id** 對這則 post 按過的 emoji 清單。**一律是陣列**:沒 cookie、沒按過都是 `[]`,不是缺 key —— 缺席會讓前端要為「沒按過」與「端點不給」寫兩套判斷。加這一欄之前,讀者每重新整理一次,自己按過的 emoji 就全部變回未按狀態(看起來像沒送出去)。本端點**不發 cookie**,只讀既有的。
5. `target_country`(2026-08-21 追加)是 Ask the World 的提問對象:ISO 3166-1 alpha-2 大寫兩碼,或 `null`(不指定)。**不是發文者所在地** —— 發文者在 `country_code`。前端拿它標「這則是問哪一國的」,國名與國旗由前端依本站語系自行組,Worker 不回國名。

`server_time` 供前端算相對時間,避免依賴使用者時鐘。

---

## 2. `POST /v1/posts` —— 發文

### Request

```json
{ "topic_id": "top_01J...", "content": "文字", "locale": "zh-TW", "target_country": null }
```

| 欄位 | 必填 | 說明 |
|---|---|---|
| `topic_id` | ✅ | ULID |
| `content` | ✅ | 1–5000 字元。**無標題欄**。Markdown 安全子集,**禁 raw HTML**;M1 儲存原字串,前端純文字轉義顯示 |
| `locale` | ✅ | 寫入 `posts.original_locale` |
| `target_country` | ❌ | Ask the World 指定提問對象。**ISO 3166-1 alpha-2 大寫兩碼**或 `null`/不帶(= 不指定);格式不符回 400 `invalid_body`。2026-08-21 起加驗 —— 這個值會進 DB 也會回給所有讀者,不接受自由字串 |

Worker 端補齊:`post_id`(新 ULID)、`anon_id`(cookie 或新發)、`cycle_id`(取 topics 副本的 `current_cycle_id`)、`country_code`/`city_code`(`request.cf`)、`status='active'`、`translation_status='pending'`、`created_at`/`last_activity_at`、`media_json=NULL`(圖片 M2)。

### Response 201

回傳與 feed 中同構的單一 post 物件(`comments: []`、`reactions: {}`、`comment_count: 0`、`reaction_actors: 0`),並在首次發放時帶 `Set-Cookie: anon_id=...`。

---

## 3. `POST /v1/comments` —— 留言(不翻譯)

### Request

```json
{ "post_id": "pst_01J...", "content": "文字", "locale": "zh-TW" }
```

`content` 1–2000 字元。Worker 補 `comment_id`、`topic_id`(由 post 反查,反正規化)、`anon_id`、geo、`status='active'`、`created_at`,並把 `posts.comments` +1、`posts.last_activity_at` 更新。

### Response 201

```json
{ "comment_id": "cmt_01J...", "post_id": "pst_01J...", "topic_id": "top_01J...",
  "locale": "zh-TW", "content": "文字", "country_code": "TW", "city_code": "taichung",
  "created_at": 1770000000, "comment_count": 13 }
```

`comment_count` = 該 post 更新後的留言總數,讓前端不必重抓 feed。

---

## 4. `POST /v1/reactions` —— emoji reaction

### Request

```json
{ "target_type": "post", "target_id": "pst_01J...", "kind": "❤️", "op": "add" }
```

| 欄位 | 值 |
|---|---|
| `target_type` | `post` \| `comment` \| `place` \| `event` |
| | `place`/`event` 的權威在主機 SQLite(不同步進 D1),Worker **不做存在性驗證**;`target_id` 來自靜態站的 `data/`。兩者都不受 `access_level` gate(那只 gate 討論室) |
| `kind` | 必須在 `REACTION_SET` 內,否則 400 `invalid_kind` |
| `op` | `add`(預設)\| `remove`。`add` 為冪等 upsert(PK 已允許同一 actor 按多個不同 emoji) |

### Response 200

```json
{ "target_type": "post", "target_id": "pst_01J...",
  "reactions": { "❤️": 6, "😂": 2 }, "reaction_actors": 7, "mine": ["❤️"] }
```

`mine` = 當前 anon_id 對此目標按過的 emoji 清單,供前端渲染按鈕的已選狀態。

#### `GET /v1/reactions/summary?target_type=…&ids=a,b,c`(靜態層補計數用)

`target_type` ∈ post/comment/place/event;`ids` 逗號分隔,一次最多 100 個。

```json
{ "target_type": "place",
  "items": { "plc_01J...": { "reactions": { "❤️": 3 }, "reaction_actors": 3, "mine": ["❤️"] } } }
```

- **每一個被問到的 id 都會有一格**(2026-08-21 起),沒人按過的目標是 `{reactions:{}, reaction_actors:0, mine:[]}`。在此之前沒人按過的 id 直接缺席,前端得為缺席另寫一條路徑。
- `mine` 語意同 §1:沒 cookie = `[]`。本端點不發 cookie。

> **share 不進資料庫**(純前端複製連結);**無獨立 like 端點**,`posts.likes` 欄位 M1 不使用。

---

## 5. 內部端點(主機 cron ↔ Worker)

三個端點皆須 `Authorization: Bearer <SYNC_SECRET>`;不符回 401 `unauthorized`。
主機側 secret 讀 `~/.config/aeiou/sync-secret`;Worker 側為 `env.SYNC_SECRET`。

### 5.1 `POST /internal/sync/topics` —— 主機 → D1(覆蓋兩張副本表)

```json
{
  "topics": [
    { "topic_id": "top_01J...", "slug": "affection-and-reciprocity", "status": "active",
      "access_level": 0, "is_perennial": 0, "global_score": 87.5,
      "current_cycle_id": "cyc_01J..." }
  ],
  "topic_i18n": [
    { "topic_id": "top_01J...", "locale": "zh-TW", "title": "情人節" }
  ]
}
```

語意 = **upsert 覆蓋**(以 PK 為準)。M1 不刪除 D1 上多出來的列(W3.5 的測試 topic 會被 sync 覆蓋而非刪除)。

Response 200:`{ "topics_upserted": 2, "topic_i18n_upserted": 14 }`

### 5.2 `GET /internal/ugc/pending-translation` —— D1 → 主機

Query:`limit`(預設 50,上限 50)。

回傳 `translation_status IN ('pending','translating')` 的 post,**欄位必須完整到可以原樣 upsert 進主機 `posts` 表**——即主機 `posts` 的全部 NOT NULL 欄位,加上 `cycle_id` / `anon_id` / `city_code`:

```json
{
  "posts": [
    { "post_id": "pst_01J...", "topic_id": "top_01J...", "cycle_id": "cyc_01J...",
      "user_id": null, "anon_id": "01J...", "original_locale": "ja",
      "content": "原文", "media_json": null, "target_country": null,
      "country_code": "JP", "city_code": "tokyo",
      "views": 0, "unique_views": 0, "comments": 0, "likes": 0, "shares": 0,
      "cross_country_engagements": 0, "hot_score": 0,
      "status": "active", "translation_status": "pending",
      "created_at": 1769999000, "last_activity_at": 1769999000, "archived_at": null }
  ]
}
```

呼叫時 Worker 把回傳的 post 標記為 `translating`(避免下一輪重複取)。

### 5.3 `POST /internal/translations` —— 翻譯結果寫回 D1

```json
{
  "translations": [
    { "post_id": "pst_01J...", "locale": "en", "content": "譯文",
      "translated_at": 1770000000, "translator": "claude" }
  ],
  "done_post_ids": ["pst_01J..."],
  "rejected_post_ids": ["pst_01K..."]
}
```

- `translations` upsert 進 `post_i18n`(PK = post_id + locale)。
- `done_post_ids` 內的 post 設 `translation_status='done'`。
- `rejected_post_ids`(2026-08-15 價值閘門):設 `status='moderation'` + `translation_status='skipped'`
  ——feed 的 `status IN ('active','cooling')` 過濾使其自動下架,且退出待翻佇列。判定在翻譯管線
  (`scripts/translate-posts.mjs`)的同一次 claude 呼叫內完成,判斷從寬(只擋廣告/亂碼/灌水/詐騙)。
- **六語不是七語**:不翻 `original_locale` 那一語(原文即該語),所以一則 post 正常產出 6 筆 `post_i18n`。

Response 200:`{ "i18n_upserted": 6, "posts_done": 1, "posts_rejected": 0 }`

---

## 6. 前端對本契約的最小使用(W2 必讀)

1. 討論室容器初始 HTML **一定**帶 `data-room-state="loading"` 與該 locale 的 `room.loading` 文案(靜態渲染,不靠 JS)。
   (2026-08-20 變更:舊值是 `closed` 並印「討論室暫時關閉」——討論室從未關閉,那是錯的狀態名。沒有 JS 的讀者由 `<noscript>` 顯示 `room.noscript`。)
2. JS 以 `fetch(`${PUBLIC_API_URL}/v1/topics/${topicId}/feed?sort=hot&limit=20&comments=8`, { credentials: 'include' })`。
   `comments=8`(2026-08-11 定版時由 3 調高):討論室的留言預設只露 2 則、其餘收合,拿 3 則的話收合永遠只收得起 1 則,那個展開鈕形同虛設。上限是契約允許的 10。
3. **只有 fetch 成功且解析出 `posts` 陣列**才把容器改成 `data-room-state="open"` 並替換內容;任何失敗(網路錯誤、非 2xx、JSON 壞掉、未設 API 位址)一律切 `data-room-state="unavailable"`,**不顯示過期資料、不做 fallback 快照**。
4. `PUBLIC_API_URL` 未設時,**完全不發 fetch**,永遠 `closed`。

---

## 7. 每日世界一問(2026-08-15 新增;完整功能規格見 `docs/briefs/daily-question.md`,兩處同步)

**社群 = 語言 = 站台**:投票者的社群由前端送的 `locale`(該站 build 時的 LOCALE)決定,**不做國家判定**、不讀 `request.cf.country`。

**猜謎的答案與解說 2026-08-21 起由 API 揭曉**(在那之前放在靜態 JSON 裡,view-source 就先看得到答案,猜謎的猜字失去意義)。揭曉判準只有一條:**`mine` 非 null**——投過票就給,不是「投對才給」也不是「過了某時間才給」。靜態層只留 `has_answer` 布林,讓前端知道這題有正解可揭曉。

### 7.1 `GET /v1/questions/:id/results` —— 聚合結果(公開,CORS;**不發 cookie**)

`:id` = question_id(題庫字串 id,非 ULID)。不存在回 404 `not_found`。

```json
{ "question_id": "q-20260815-bubble-tea", "server_time": 1770000000,
  "total": 57,
  "by_locale": { "zh-TW": { "total": 30, "options": { "daily": 12, "weekly": 10, "sometimes": 8 } } },
  "mine": "daily" }
```

Query 可帶 `locale`(∈ LOCALES);只影響揭曉時回哪一語的 `explain`,不影響票數。

- `by_locale` 只含**有票的** locale;每個 locale 的 `options` 只含**計數 > 0** 的 option(比照 feed 的 reactions 慣例)。整體選項合計由前端自行加總。
- `mine` = 當前 anon_id 對此題投過的 option_id;沒 cookie 或沒投過 = `null`。
- **`answer` / `explain` 只在 `kind='guess'` 且 `mine` 非 null 時出現**,否則連 key 都沒有(不是 null)。`answer` = 正解的 option_id;`explain` = 該 `locale` 的解說句。**缺該語系的解說就不給句子,不退回別的語言**(CLAUDE.md「只有一種語言看得懂的欄位不准上畫面」)。

### 7.2 `POST /v1/votes` —— 投票(公開,CORS;限流 kind=`vote`)

```json
{ "question_id": "q-20260815-bubble-tea", "option_id": "daily", "locale": "zh-TW" }
```

- 驗證:`locale` ∈ LOCALES;question 存在且 `status='active'`(否則 404 `not_found` / 403 `topic_locked` 語意沿用:非 active 回 403);`option_id` ∈ 該題 `options_json`(否則 400 `invalid_body`)。
- anon_id 三段式(cookie 或新發,回應帶 `Set-Cookie`)。
- **一人一題一票**:`INSERT ... ON CONFLICT (question_id, anon_id) DO UPDATE SET option_id=excluded.option_id, locale=excluded.locale, updated_at=…`(重投=改票;`created_at` 保留首次值,參與統計以它計日)。
- Response 200 = 與 7.1 同構(投完票後的最新聚合,`mine` 為剛投的 option)。**guess 在這一支就揭曉**:回應直接帶 `answer` 與 `explain`(解說用 request 裡的 `locale`),前端不必為「剛投完」另走一條路徑。

### 7.3 `GET /v1/questions/participation?date=YYYY-MM-DD` —— 當日各社群參與數(公開,CORS;不發 cookie)

`date` 格式不合回 400 `invalid_body`。計 `created_at` 落在該 UTC 日 [00:00, 24:00) 的票,依 locale 分組:

```json
{ "date": "2026-08-15", "server_time": 1770000000, "total": 123,
  "by_locale": { "zh-TW": 41, "ja": 30 } }
```

### 7.4 `POST /internal/sync/questions` —— 主機 → D1 題目精簡副本(Bearer,比照 §5.1)

```json
{ "questions": [ { "question_id": "q-20260815-bubble-tea", "qdate": "2026-08-15", "kind": "poll",
    "topic_id": "top_01J...", "options": ["daily","weekly","sometimes","rarely"], "status": "active",
    "answer": null, "explain": null } ] }
```

語意 = upsert 覆蓋(以 question_id 為準);Worker 端把 `options` 存成 `options_json`。Response 200:`{ "questions_upserted": N }`。

- `answer`(2026-08-21 追加)= guess 的正解 option_id,poll 一律 `null`。**必須是該題 `options` 之一**,否則整批回 400 —— 揭曉時印出一個讀者從沒看過的 id 是無聲的錯。
- `explain`(2026-08-21 追加)= `{locale: 解說句}`,只放有值的語系;poll 一律 `null`。
