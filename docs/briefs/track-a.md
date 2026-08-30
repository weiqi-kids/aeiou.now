# Track A(= W1)交辦:seed + export

**先讀**(缺一不可,順序如下):
1. `/mnt/customers/aeiou.now/docs/briefs/_shared-context.md`(決策帳、介面常數、守門七條、明確延後、工作紀律)
2. `/mnt/customers/aeiou.now/docs/02-data-model.md`(資料結構權威文件,§2–§9)
3. `/mnt/customers/aeiou.now/db/schema-common.sql`、`schema-host.sql`(欄位以這兩檔實際內容為準)

**你的工作目錄**:`/mnt/customers/aeiou.now/`
**你不 commit、不 push。** 完成後回報,由主對話統一 commit。
**你只跑 `node scripts/init-db.mjs --host-only`,絕不碰 D1**(D1 的 create 與灌 schema 歸 Track C,平行進行中,搶建會互踩)。

---

## 工作項目

### W1.1 基礎資料與在地樣本 → `db/seed/demo-topics.sql` / `content/local-sample-data.json`

兩個示範 Topic:

**① `affection-and-reciprocity`(週期性)**
- `topics`:`slug='affection-and-reciprocity'`、`status='active'`、`is_perennial=0`、`access_level=0`、`access_source='category'`、category 自選合理值、`global_score` 給個 demo 值。
- `topic_i18n` **七語全備**(`zh-TW` `en` `ja` `zh-CN` `hi` `id` `pt-BR`),含 `title`、`summary`、`keywords_json`。
- `topic_observances` **≥4 個地方表現**(建議涵蓋 JP / US / BR / IN,理由:文化差異明顯、對得上七語系市場),每筆含 `country_code`、`local_name`、`observed_date` 或 `date_rule`、`popularity_rank`、`source_ids_json`(**必填**,且必須是真實來源)。同一國可有多筆。
- `topic_observance_i18n`:**每個地方表現 × 七語** 的 `customs_text`。內容要是真的文化事實(日本本命/義理巧克力、巴西 Dia dos Namorados 在 6/12、印度 Valentine Week…),不要塞佔位字串。
- `sources`:只接受可追溯來源；Topic 事實來源由 markdown 匯入，在地地點/活動來源由人工樣本匯入，禁止假 URL。
- `topic_scores`:**七時窗(8h/24h/72h/7d/1m/3m/1y)demo 分數**,`scope='global'`,含 `rank`。
- `topic_cycles`:**1 個進行中**的 cycle(`ended_at IS NULL`),`label` 用 `'2026-02'` 格式。
- `topic_aliases` / `topic_relations`:各給 1–2 筆(讓 Topic Graph 有東西)。

**② `ask-the-world`(長青)**
- `is_perennial=1`、`access_level=0`、`status='active'`。
- `topic_i18n` 七語、`topic_scores` 七時窗、1 個進行中 cycle。
- 不需要 `topic_observances`(它不是節慶)。

**③ ranking**:1 份 `ranking_snapshots`(`scope='global'`、某個 window、`granularity`)+ 對應 `ranking_items`(把兩個 topic 都排進去)。

**④ 在地域**:第一批人工樣本由 `content/local-sample-data.json` 提供，透過 `scripts/update-local-data.mjs` 驗證 `content/local-data-sources.json` 的官方來源後匯入七個市場的真實地點；只有來源明確列出日期且每次重跑仍能找到日期 marker 的活動才進 `events`。過期活動會由受管理來源清除。每筆地點/活動都要保留可核對的官方或主辦方來源、七語描述與 `place_topics`/`event_topics` 關聯。

**注意**:`places.map_url` / `nav_urls_json` 是**純字串組裝**的 Google Maps 搜尋連結(cn 給百度/高德),**絕不呼叫 Places API**、不儲存任何 Places API 回傳資料(評分/評論數/營業狀態)——條款紅線。

**ID 格式**:`<prefix>_<ULID>`(`top_` / `cyc_` / `pst_` / `cmt_`)。ULID 可以自己在 SQL 裡寫死一個合法的 26 字元 Crockford Base32 字串。
**時間欄位**:一律 Unix epoch **秒**(整數)。今天是 2026-08-11。

**seed 必須可重跑**:用 `INSERT OR REPLACE`(或先 DELETE 再 INSERT)寫,連跑兩次不報錯。

**驗收**:`node scripts/init-db.mjs --host-only --seed` 實跑成功,再對**每一張有灌資料的表**跑 `SELECT COUNT(*)` 抽查,附輸出證明筆數非零。

---

### W1.2 匯出腳本 → `scripts/export-data.mjs`

主機 SQLite(`/mnt/customers/aeiou.now/db/aeiou.sqlite`)→ 根層 `data/` JSON。目錄結構**照 `docs/02-data-model.md` §9**:

```
data/
├── topics/
│   ├── index/<locale>.json          Topic 清單(id, slug, title, category, 各窗分數, status)
│   └── <topic-id>/
│       ├── facts.json               語言中立:topic_observances、relations、source ids
│       ├── i18n.json                七語一檔(title/summary/keywords + 各地方表現 customs_text)
│       └── highlights.json          歷史精華(凍結貼文原文 + 七語譯文)
├── places/<city_code>.json          語言中立事實 + 各語系描述
├── events/<city_code>.json
├── rankings/
│   ├── global/<window>.json
│   └── <country_code>/<window>.json
└── meta/
    ├── countries.json
    └── cities.json
```

**硬規定**:

1. **內容 hash 沒變就不寫檔**(比對既有檔內容的 hash,相同則 skip;這是每小時 commit diff 最小化的關鍵)。輸出要能看出「寫了幾檔、skip 幾檔」。
2. **rankings JSON 以 `topic_scores` 為源,靜態只出六窗**:`24h` `72h` `7d` `1m` `3m` `1y`。**`8h` 不出靜態**(那是 Worker 的即時層)。
3. `meta/countries.json` / `meta/cities.json` 由 `topic_observances` 與 `places` 的 distinct code 生成。**顯示名**:國家用 node 內建 `Intl.DisplayNames` 按七 locale 各生成一份;城市用 slug title-case(`tokyo` → `Tokyo`)。
4. M1 的 `highlights.json` **允許空陣列**(骨架期沒有貼文退場)——如實註明,不得假裝有資料。
5. JSON 一律 UTF-8、`JSON.stringify(x, null, 2)` + 結尾換行(讓 git diff 可讀)。
6. 用 node 內建 `node:sqlite`(v22.22 已內建,`import { DatabaseSync } from "node:sqlite"`),**不要裝任何 npm 套件**。

`topics/index/<locale>.json` 每筆至少要有:`topic_id`、`slug`、`title`、`category`、`status`、`is_perennial`、各窗分數(六窗)。
**前端要用 `topic_id` 打 API**(API 路徑參數是 topic_id 不是 slug),所以 `topic_id` 必須在 index 與 facts 兩處都有。

**驗收**:實跑一次,附產出檔案清單(`find data -type f | sort`)。

---

### W1.3 防空寫證明

**驗收**:`export-data.mjs` 連跑兩次,**第二次 0 檔變更**。附兩次輸出佐證(第二次要能看出全部 skip)。

---

## 回報格式

逐項(W1.1 / W1.2 / W1.3)給:做了什麼 → 驗收指令 → **實際輸出貼上**。
沒跑過的不准說跑過。有卡住的標 ⛔ 附卡點與解鎖條件。
