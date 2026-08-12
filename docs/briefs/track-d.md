# Track D(= W4)交辦:主機 cron 管線

**先讀**(缺一不可,順序如下):
1. `/root/aeiou.now/docs/briefs/_shared-context.md`(決策帳、介面常數、明確延後、工作紀律)
2. `/root/aeiou.now/docs/briefs/api-contract.md` §5(三個內部端點的 request/response 形狀)
3. **Track C 已落地的 Worker 原始碼**(路徑由派工訊息給你)——**同步契約以 C 的實作為準**,契約文件與實作衝突時信實作,並回報矛盾
4. `/root/aeiou.now/docs/02-data-model.md` §5、§7
5. `/root/aeiou.now/db/schema-common.sql`、`schema-host.sql`

**你的工作目錄**:`/root/aeiou.now/`
**你不 commit、不 push 到 GitHub。**(W4.3 的腳本**內容**要寫 git push 邏輯,但你自己不要真的推 source repo——見 W4.3 的驗收說明。)
主機 SQLite 已建好並灌過 seed:`/root/aeiou.now/db/aeiou.sqlite`。
Worker 已上線(網址由派工訊息給你),`SYNC_SECRET` 已設,主機側值在 `~/.config/aeiou/sync-secret`。

---

## 工作項目

### W4.1 同步腳本 → `scripts/sync-topics-to-d1.mjs`

主機 SQLite → `POST /internal/sync/topics`。

- secret 讀 `~/.config/aeiou/sync-secret`(**絕不寫死在碼裡、絕不進 git**)。
- Worker 網址走環境變數(預設值 = 派工訊息給你的 workers.dev 網址),讓日後切自訂網域只改設定。
- payload:`topics` 精簡副本(`topic_id` / `slug` / `status` / `access_level` / `is_perennial` / `global_score` / `current_cycle_id`)+ `topic_i18n`(`topic_id` / `locale` / `title`)。
  **`current_cycle_id` 取自主機 `topic_cycles` 裡 `ended_at IS NULL` 的那一筆**(進行中的 cycle);沒有進行中的就給 NULL。
- 寫一筆 `jobs` 紀錄(`job_name='sync-topics'`)。
- 用 node 內建 `node:sqlite`,**不要裝 npm 套件**。

**驗收**:實跑一次,再用 `npx wrangler d1 execute aeiou-ugc --remote --command "SELECT * FROM topics"` 抽查,證明 D1 副本表與主機一致(附兩邊輸出對照)。

---

### W4.2 翻譯腳本 → `scripts/translate-posts.mjs`

這是**整條管線最重要的一支**,也是 **UGC 回流主機的唯一通道**。

流程:

1. `GET /internal/ugc/pending-translation?limit=50` 撈待翻 post。
2. 對每則 post 翻**六語**(七語系扣掉 `original_locale` 那一語——原文即該語,不重複翻)。
   - **用 `claude -p`(訂閱 CLI,在 `/root/.local/bin/claude`),不是 Anthropic API。**
   - 批次:一次呼叫處理多則 × 六語,批次上限 50 則。要求 `claude -p` 回結構化 JSON 並嚴格解析,解析失敗算該批失敗。
   - 翻譯提示詞要說明:這是社群貼文,保持語氣與換行,不要加解釋、不要改寫、不要輸出 JSON 以外的東西。
3. 譯文 `POST /internal/translations`(含 `done_post_ids`)寫回 D1。
4. **同時把原文 + 譯文 upsert 進主機 SQLite 的 `posts` / `post_i18n`**。
   **這是 UGC 回流主機的唯一通道**——沒有它,主機端 `post_highlights` 與靜態 `highlights.json` 永遠拿不到資料。
   `/internal/ugc/pending-translation` 回傳的欄位已經足夠原樣 upsert 進主機 `posts`;若發現缺欄位,回報並標 ⛔(那是 Track C 的契約缺口)。
5. **失敗處理**:記 `jobs` 表,`status='failed'`、`attempt` 累加、`next_retry_at` = 失敗 **+5 分**、再失敗 **+10 分**、**第三次進 DLQ 狀態**(不再自動重試,`error_message` 寫清楚)。成功記 `status='success'` 與 `records_read` / `records_created` / `records_updated` / `records_failed`。
6. 用 `job_locks` 防重入(同一 `scope` + `job_name` + `scheduled_at` 只跑一次),避免 15 分鐘的 cron 撞上跑很久的前一輪。

**驗收**:對 Track C 在 W3.5 建的測試貼文**實跑一輪**,附:
- D1 `post_i18n` 查詢輸出(**六語齊全**)
- 主機 SQLite `posts` / `post_i18n` 查詢輸出(證明回流成功)
- `jobs` 表該筆紀錄

---

### W4.3 匯出推送 → `scripts/hourly-export.sh`

1. 跑 `node scripts/export-data.mjs`(Track A 產出的腳本)。
2. **只 commit 受管理的 `data/` 與活動快照**(`git add data/ content/local-sample-data.json` —— 不要 `git add -A`,site/api/db 的變動不歸這支)。
3. push 到 source repo。
   - 走 gh 的 HTTPS credential helper(主機已 `gh auth login` 為 `LightChang`)。
   - author 用 **repo local git config**(`/root/aeiou.now` 已設 `weiqi-kids <lightman.chang@gmail.com>`)。
   - **絕不動 `git config --global`**(這是主機紅線:曾有 session 用 `--global` 設假身分污染全機 cron 的 commit 作者)。
4. **無變更則 skip**(不產生空 commit)。
5. 寫 `jobs` 紀錄(`job_name='hourly-export'`)。

**驗收**:實跑一次。注意 **source repo 可能尚未建立**(主對話那邊被權限擋著)——若 `git push` 因 remote 不存在而失敗,請:
- 證明 commit 這一段有效(`git log --stat -1` 顯示**只含 `data/`**),
- push 失敗標 ⛔ 附卡點,
- 腳本要能容忍「無 remote」的情況(skip push 並記進 jobs,不要整支噴掉)。

---

### W4.4 排程安裝 → `/etc/cron.d/aeiou`

```
*/15 * * * *   翻譯 + 同步
0   * * * *   export + push
```

- **PATH 必須含 `/root/.local/bin`**(`claude` CLI 在那裡),也要含 node 的路徑。
- cron 檔內要有註解說明每一行在做什麼、失敗看哪裡(log 路徑)。
- log 導向到一個明確位置(例:`/root/aeiou.now/logs/`,記得 `.gitignore` 已忽略 `*.log`;若寫到別處請講明)。

**同一回合必須更新三處文件(這是主機紅線,不做等於沒做完)**:
1. repo 內的文件(`/root/aeiou.now/docs/01-architecture.md` §12 已有排程表,如與你實作不符請更新)
2. cron 檔內的註解
3. **主機 `/root/.claude/ops/directory-map.md` 新增 `/root/aeiou.now` 條目**(照該檔既有格式寫:這是什麼專案、哪些目錄做什麼、哪些不是線上來源)

**驗收**:
- `cat /etc/cron.d/aeiou` 輸出
- **一筆由 cron 真實觸發的 `jobs` 紀錄**(不是你手動跑的那筆——等一個 `*/15` 的整點區間過去,再查 jobs 表證明 cron 有跑起來;若時間不夠等,明講你等了多久、目前狀態)
- 三處文件已更新的證據

---

## 主機紀律(紅線,違反等於事故)

- **絕不動 `git config --global`**。
- **自己起的背景 server / 長跑程序一定要收**。
- 改動系統狀態(裝 cron)的**同一回合**更新對應文件。
- secret 只從 `~/.config/aeiou/sync-secret` 讀,不寫進碼、不寫進 log。

## 回報格式

逐項(W4.1–W4.4)給:做了什麼 → 驗收指令 → **實際輸出貼上**。
沒跑過的不准說跑過。有卡住的標 ⛔ 附卡點與解鎖條件。
