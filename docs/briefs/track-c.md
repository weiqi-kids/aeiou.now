# Track C(= W3)交辦:Cloudflare Worker API

**先讀**(缺一不可,順序如下):
1. `/root/aeiou.now/docs/briefs/_shared-context.md`(決策帳、介面常數、明確延後、工作紀律)
2. `/root/aeiou.now/docs/briefs/api-contract.md`(**你與 Track B 平行開發的唯一契約**;每個端點的 request/response 形狀、錯誤碼、CORS、cookie 規定全在裡面。**照它實作,不得自行加減欄位名**)
3. `/root/aeiou.now/docs/02-data-model.md` §5–§6
4. `/root/aeiou.now/db/schema-common.sql`、`schema-d1.sql`(D1 要灌的就是這兩檔)

**你的工作目錄**:`/root/aeiou.now/api/`(目前是空目錄)
**你不 commit、不 push。** 完成後回報,由主對話統一 commit。
**D1 的 create 與灌 schema 是你的權責**(Track A 只跑主機庫,不會碰 D1)。

**強烈建議先載入 `workers-best-practices` skill**(這台機器有),照它的規範寫。

---

## 工作項目

### W3.1 專案骨架 → `api/wrangler.jsonc`

必須符合介面常數表:

| 項目 | 值 |
|---|---|
| `name` | `aeiou-api` |
| `account_id` | `9d9e58b5e0d1657b8f74bd2cbfc91ee3`(**必須 pin**;另一個 Gcmgcm 帳號不要用) |
| D1 binding | `DB` → database_name `aeiou-ugc` |
| `compatibility_date` | 近期日期 |

**保持 Workers Free(0 元)**:不用 Durable Objects / Queues / Workflows / Cron Triggers / Analytics Engine。
`observability` 可開(免費)。

**驗收**:貼出 `wrangler.jsonc` 內容,對照上表。

---

### W3.2 D1 初始化

```bash
cd /root/aeiou.now/api
npx wrangler d1 create aeiou-ugc
```

把回傳的 `database_id` 填進 `wrangler.jsonc`,然後灌 schema(**`--remote`**):

```bash
npx wrangler d1 execute aeiou-ugc --remote --file ../db/schema-common.sql
npx wrangler d1 execute aeiou-ugc --remote --file ../db/schema-d1.sql
```

(或直接跑 `node /root/aeiou.now/scripts/init-db.mjs --d1-only`,它就是做這兩件事。)

**驗收**:`npx wrangler d1 execute aeiou-ugc --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"` 列出全部表(common 7 張 + d1 3 張)。

---

### W3.3 公開端點

照 `api-contract.md` 實作,**四個**:

- `GET /v1/topics/:id/feed`(`:id` = **topic_id**,不是 slug)
- `POST /v1/posts`
- `POST /v1/comments`
- `POST /v1/reactions`

要點(細節以 api-contract.md 為準,這裡只重申最容易做錯的):

1. **feed 的 8H 窗**:只回 `created_at >= now - 8*3600` 且 `status IN ('active','cooling')`。
2. **`sort=hot` 的 M1 定義**:即時聚合排序 = `COUNT(DISTINCT reactions.actor_id) + posts.comments`,tie-break `created_at DESC`。**M1 沒有 hot_score job,`posts.hot_score` 恆 0,不得用來排序。**
3. **每則 post 內含最新 N 則留言 + 留言總數 + 各 emoji 計數**(留言有寫必有讀)。
4. **anon_id cookie**:首次寫入時發 ULID,`Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=None`。
5. **CORS**:白名單 `https://weiqi-kids.github.io`,**origin 不得用 `*`**(因為要 `Access-Control-Allow-Credentials: true`),要處理 `OPTIONS` preflight。
6. **geo**:`country_code = request.cf.country`、`city_code = lowercase-slugify(request.cf.city)`(無 city 則 NULL)。**前端傳的 geo 一律忽略。**
7. **access gate**:讀 topics 副本的 `access_level`,0 放行;1 或 2 回 401 `login_required`(M1 不做 OAuth)。**只 gate 討論室,不 gate 靜態頁。**
8. `posts.cycle_id` 直接取 topics 副本的 `current_cycle_id`。
9. `media_json` M1 恆 NULL(圖片上傳是 M2)。
10. `REACTION_SET` = `["❤️","😂","😮","😢","🤔","🎉","👏"]`(**不含 👍**),`kind` 不在集合內回 400 `invalid_kind`。
11. **不做 Turnstile / rate limit**(M1 刻意不做,是有意識的裸奔;不要自作主張加)。

**驗收**:端點齊全;**錯誤路徑要有測**(至少:壞 JSON → 400、不存在的 topic → 404、非法 emoji → 400)。附 curl 輸出。

---

### W3.4 內部端點

三個,皆驗 `Authorization: Bearer <SYNC_SECRET>`(`env.SYNC_SECRET`),不符回 401:

- `POST /internal/sync/topics` —— 覆蓋 D1 的兩張副本表(upsert 語意)
- `GET /internal/ugc/pending-translation` —— **回傳完整 post 列**:主機 `posts` 表的**全部 NOT NULL 欄位** + `cycle_id` / `anon_id` / `city_code`(Track D 要原樣 upsert 進主機 SQLite,少一個欄位它就寫不進去)。回傳後把該批標記為 `translating`。
- `POST /internal/translations` —— 譯文 upsert 進 `post_i18n`,`done_post_ids` 內的 post 設 `translation_status='done'`

設 secret:

```bash
cd /root/aeiou.now/api
npx wrangler secret put SYNC_SECRET   # 值 = cat ~/.config/aeiou/sync-secret
```

**驗收**:錯 token 回 401、對 token 回 200,兩者 curl 輸出都附。

---

### W3.5 部署與驗收

```bash
cd /root/aeiou.now/api && npx wrangler deploy
```

部署後:

1. **自行 INSERT 一筆測試 topic 到 D1**(整合階段會被主機 sync 覆蓋,所以用 seed 會用到的 slug 也沒關係;但請用一個明顯是測試的 topic_id,並在回報中講明)。記得同時給它 `current_cycle_id`,否則發文的 `cycle_id` 會是 NULL。
2. curl 走完:**發文 → feed 讀回 → reaction → 留言 → 再讀 feed**,證明留言與 reaction 計數有回到 feed。
3. cookie 流程要驗:第一次發文的 response 有 `Set-Cookie: anon_id=...`;帶著同一個 cookie 再打 reaction,`mine` 欄位回得出來。

**驗收**:上述 curl 輸出**全部附上**;並在回報最前面**明確寫出 workers.dev 完整網址**(格式 `https://aeiou-api.<subdomain>.workers.dev`)——Track E 的 CI 要用它當 `PUBLIC_API_URL`,這是本 Track 最重要的交付物之一。

---

## 回報格式

逐項(W3.1–W3.5)給:做了什麼 → 驗收指令 → **實際輸出貼上**。
**回報第一行 = workers.dev 完整網址。**
沒跑過的不准說跑過。有卡住的標 ⛔ 附卡點與解鎖條件。
