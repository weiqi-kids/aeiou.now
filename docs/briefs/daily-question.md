# 每日世界一問(Daily World Question)— 實作規格

> 定案日期:2026-08-15(用戶拍板:今天完成全部;**只有語言社群判定,沒有國家判定**)。
> 本檔是本功能的單一真實來源。API 細節同步收錄於 `docs/briefs/api-contract.md` §7(兩處同步)。
> 產品動機:給讀者一個「今天回來做一件事」的固定循環——看題→投票→看各語言社群差異→進 Topic 討論→下一題。

## 0. 核心設計決策(不可自行更改)

1. **社群 = 語言 = 站台**。投票者屬於哪個社群,由「他在哪個語系站」決定(前端送 build 時的 `LOCALE`),
   **不做國家判定**、不讀 `request.cf.country`、不讓使用者手選。七社群 = 七 locale。
2. 題庫是內容,走既有管線:`content/questions.json`(人工編輯唯一入口)→ `import-questions.mjs`
   → 主機 SQLite → `export-data.mjs` 產 `data/questions/<locale>.json` → 靜態站 build 吃;
   另由 `sync-questions-to-d1.mjs` 推精簡副本進 D1 供 Worker 驗票。
3. 票(votes)是 UGC,權威在 D1;一個 anon_id 對一題**一票**,重投=改票(覆蓋)。
4. 猜謎答案(`answer`/`explain`)**2026-08-21 起進 D1、由 API 揭曉**(契約 §7.1)。
   原設計放在靜態 `data/questions/<locale>.json`,view-source 就先看到答案,猜謎的猜字失去意義。
   揭曉判準只有一條:**這個 anon_id 投過票了**,而那件事只有 D1 知道 —— 所以答案得跟著搬過去。
   靜態層只留 `has_answer` 布林。**題面文案仍然不進 D1**(那是靜態層的事)。
5. 降級紅線:投票區塊靜態預設 `data-q-state="loading"`(2026-08-20 起;舊值 `closed` 已廢);fetch 失敗切 `unavailable`;
   不顯示過期票數、不做 fallback 快照。`PUBLIC_API_URL` 未設→完全不 fetch。
6. 熱度紅線不適用於票數:**投票的百分比與人數可以上畫面**(它不是 hot_score)。
7. 顯示社群一律「旗幟 emoji + 語言自稱(endonym)」,七語站都一樣,不翻譯(見 §5 communities.mjs)。

## 1. 題庫格式:`content/questions.json`

見檔內 `$comment`。要點:
- `id` 全域唯一(慣例 `q-YYYYMMDD-slug`);`date`=`YYYY-MM-DD`(UTC 當日);`kind`=`poll`|`guess`。
- `topic` 必須是 `content/topics/` 既有且非 merged/candidate 的 slug。
- `asker`/`target`:語言社群 locale 或 null(null=本站發問/問所有人)。
- `text`、每個 option 的 `label`:七語缺一 import 即報錯。
- `kind=guess` 必填 `answer`(= options 之一的 id)與七語 `explain`;`kind=poll` 兩者必為 null。
- option `id` 在題內唯一;guess 題的 option id 慣例用社群 locale 代碼。

## 2. 主機 SQLite(加進 `db/schema-host.sql`;另寫 `scripts/migrate-questions.mjs` 供舊庫補表)

```sql
CREATE TABLE IF NOT EXISTS questions (
  question_id   TEXT PRIMARY KEY,          -- content id(非 ULID,人工可讀)
  qdate         TEXT NOT NULL,             -- YYYY-MM-DD(UTC)
  kind          TEXT NOT NULL CHECK (kind IN ('poll','guess')),
  topic_id      TEXT NOT NULL,             -- import 時由 slug 解析
  asker_locale  TEXT,
  target_locale TEXT,
  answer_option TEXT,                      -- kind=guess 才有(2026-08-21 起也同步進 D1,見上方第 4 點)
  status        TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS question_i18n (
  question_id TEXT NOT NULL, locale TEXT NOT NULL,
  text TEXT NOT NULL, explain TEXT,
  PRIMARY KEY (question_id, locale)
);
CREATE TABLE IF NOT EXISTS question_options (
  question_id TEXT NOT NULL, option_id TEXT NOT NULL,
  ord INTEGER NOT NULL, emoji TEXT,
  PRIMARY KEY (question_id, option_id)
);
CREATE TABLE IF NOT EXISTS question_option_i18n (
  question_id TEXT NOT NULL, option_id TEXT NOT NULL, locale TEXT NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (question_id, option_id, locale)
);
```
不放時間戳(維持 export 決定論)。import 語意 = content 是權威,四張表**整組刪除重建**(單一 transaction)。

## 3. D1(加進 `db/schema-d1.sql`;與主機版故意不同構,比照 topics 精簡副本慣例)

```sql
-- questions 精簡副本(主機 → /internal/sync/questions 覆蓋;文案與答案不進 D1,D1 只驗票)
CREATE TABLE IF NOT EXISTS questions (
  question_id  TEXT PRIMARY KEY,
  qdate        TEXT NOT NULL,
  kind         TEXT NOT NULL,
  topic_id     TEXT NOT NULL,
  options_json TEXT NOT NULL,              -- JSON 陣列:合法 option_id 清單
  status       TEXT NOT NULL DEFAULT 'active'
);
-- 一人一題一票;重投 = 覆蓋 option_id(created_at 保留首次投票時間,參與統計以它計日)
CREATE TABLE IF NOT EXISTS question_votes (
  question_id TEXT NOT NULL,
  anon_id     TEXT NOT NULL,
  option_id   TEXT NOT NULL,
  locale      TEXT NOT NULL,               -- 投票者所在站的語系(=社群)
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (question_id, anon_id)
);
CREATE INDEX IF NOT EXISTS idx_question_votes_q   ON question_votes (question_id, locale, option_id);
CREATE INDEX IF NOT EXISTS idx_question_votes_day ON question_votes (created_at);
```
`rate_events` 註解的 kind 清單同步補上 `vote`。

## 4. Worker 端點(全文契約見 api-contract.md §7;端點行為以契約檔為準)

- `GET /v1/questions/:id/results`(公開,CORS,不發 cookie)
- `POST /v1/votes`(公開,CORS;限流 kind=`vote`:30/5min、300/24h;anon_id 三段式發放)
- `GET /v1/questions/participation?date=YYYY-MM-DD`(公開,CORS;當日各社群投票數)
- `POST /internal/sync/questions`(Bearer;upsert 覆蓋 D1 `questions` 副本)

## 5. 匯出:`data/questions/<locale>.json`(七檔,export-data.mjs 的 `emit()` 慣例)

```json
{ "questions": [ {
  "question_id": "q-20260815-bubble-tea",
  "date": "2026-08-15", "kind": "poll",
  "topic_id": "top_…", "topic_slug": "ask-the-world",
  "asker_locale": "ja", "target_locale": "zh-TW",
  "text": "只含本 locale 的一段字串",
  "options": [ { "id": "daily", "emoji": "🧋", "label": "本 locale 字串" } ],
  "answer": null, "explain": null
} ] }
```
排序:`date` ASC、同日 poll 在 guess 前、再依 `question_id`。查詢一律 ORDER BY,鍵序固定。

## 6. 前端規格(site/)

### 6.1 `site/src/lib/communities.mjs`(新,常數,七語站相同,不進 i18n)

```js
export const COMMUNITIES = {
  'zh-TW': { flag: '🇹🇼', name: '中文(台灣)' },
  'en':    { flag: '🇺🇸', name: 'English' },
  'ja':    { flag: '🇯🇵', name: '日本語' },
  'zh-CN': { flag: '🇨🇳', name: '中文(简体)' },
  'hi':    { flag: '🇮🇳', name: 'हिन्दी' },
  'id':    { flag: '🇮🇩', name: 'Bahasa Indonesia' },
  'pt-BR': { flag: '🇧🇷', name: 'Português' },
};
```

### 6.2 data.mjs 新增(build-time,readJson 慣例,檔缺回空)

- `getQuestions()` → 讀 `questions/<LOCALE>.json`,回陣列。
- `questionsForDate(now)` → `{ poll, guess }`:各取 `date <= 今日(UTC)` 中**最新一筆**該 kind
  (今天沒有就退到最近一題,不會開天窗);題庫空回 null。
- `pastQuestions(now)` → `date <= 今日` 全部,date DESC。
- `todayWorld(now)` → 用既有 `topics/index` + 各 topic `facts.json` 的 `occurrences`
  (starts_on/ends_on)組出:進行中或 14 天內開始的 observance,依國家分組
  `[{ country_code, items: [{ topic_id, slug, title, local_name, starts_on, ends_on }] }]`,
  依「距今天數」排序,最多 8 國、每國最多 3 項。國名用 `meta/countries.json`,旗幟用 format.mjs `countryFlag()`
  (這是**內容**裡的國家,與投票的社群判定無關,允許出現)。

### 6.3 元件(全部走 DiscussionRoom 同款四態與 fetch 慣例;JS 動態節點 createElement+textContent,禁 innerHTML)

- **`QuestionCard.astro`**(poll 與 guess 共用,props: `question`, `heading`, `nextHref`, `nextLabel`):
  - 靜態 HTML:區塊標題、`q.asked_by`/`q.asked_to` 行(有 asker/target 才顯示,社群用 COMMUNITIES)、
    題目文字、選項按鈕列(`disabled`,靜態內容要留著給爬蟲與無 JS 讀者)、`q.loading` 文案
    (失敗才換成 `q.closed`)、`q.tell_us` 連結(`withBase('/topic/<topic_slug>/')`,
    純靜態永遠可用)。容器 `data-q-state="loading"`。
  - JS 啟動:切 `loading` → `GET {api}/v1/questions/{id}/results`(credentials include)→ 成功切 `open`:
    啟用按鈕、顯示 `q.answered_count`(`{n}` 置換 `total`)、`mine` 非 null 時直接進結果視圖。
  - 點選項 → 按鈕全 disable → `POST {api}/v1/votes` `{question_id, option_id, locale: LOCALE}` →
    以回應重繪結果視圖(伺服器為準,不做樂觀 UI;429/失敗顯示 `q.error_retry` 並恢復按鈕)。
  - 結果視圖(poll):每選項一列:emoji+label+整體百分比長條(寬度 style width%,色用 var(--color-*),
    自己投的那項標 `q.your_vote`);其下「`q.community_top`」列出**有票的社群**:旗+endonym+該社群最多人選的
    label 與其社群內百分比。總數行 `q.answered_count`。
  - 結果視圖(guess):先同上顯示分佈,再加:`q.answer_label` + 正解選項(**API 回應的 `answer`**,
    拿不到就什麼都不印 —— 那代表還沒投票,不要退回任何靜態值)、
    自己對錯(`q.correct`/`q.incorrect`)、`q.correct_rate`(答對票/總票)、`explain` 一段。
  - 底部:`nextHref` 連結(`q.next` 或 `q.all_questions`)。
  - 0 票時 open 狀態顯示 `q.no_votes`。百分比一律四捨五入整數,分母 0 不除。
- **`TodayWorld.astro`**:純靜態,無 JS。`todayWorld()` 分組列表:旗+國名,底下每項
  「<a Topic 標題> · local_name · 日期(format.mjs 既有函式,timeZone UTC 慣例)」。空陣列顯示 `q.today_world_empty`。
- **`Participation.astro`**:容器 `data-q-state="loading"`(失敗態文案 `q.closed`)。JS:
  `GET {api}/v1/questions/participation?date=<客戶端 UTC 今日>` → open:依票數 DESC 列社群
  (旗+endonym+數字+長條,條長=count/max),`LOCALE` 那列標 `q.your_community`;total 0 顯示 `q.no_votes`。
- **首頁 `index.astro`**:在既有 `#trending` 區塊**之前**插入四區塊,順序:
  ① QuestionCard(poll,heading=`q.daily_title`,next=錨點 `#guess`)
  ② QuestionCard(guess,id="guess",heading=`q.guess_title`,next=`withBase('/questions/')`+`q.all_questions`)
  ③ TodayWorld(`q.today_world_title`) ④ Participation(`q.participation_title`)。
  poll/guess 為 null(題庫空)時整塊不渲染。既有近期話題區塊原樣保留在後。
- **`pages/questions/index.astro`**(新頁 `/questions/`,仿 about.astro 靜態單頁):
  標題 `q.archive_title`;`pastQuestions()` 依日期 DESC,每題一張 QuestionCard(可投可看結果);
  導覽列**不加**新項(導覽是契約)。

### 6.4 i18n 新 key(七檔一次加齊,值照抄下表,不留 [TODO];`{n}`/`{pct}`/`{community}` 為前端置換佔位)

| key | zh-TW | en | ja | zh-CN | hi | id | pt-BR |
|---|---|---|---|---|---|---|---|
| q.daily_title | 🌎 今日世界一問 | 🌎 Today's World Question | 🌎 きょうの世界への一問 | 🌎 今日世界一问 | 🌎 आज दुनिया का सवाल | 🌎 Pertanyaan Dunia Hari Ini | 🌎 Pergunta do Mundo de Hoje |
| q.guess_title | 🆚 世界差異猜一猜 | 🆚 Guess the World Difference | 🆚 世界のちがいクイズ | 🆚 世界差异猜一猜 | 🆚 दुनिया का अंतर बूझो | 🆚 Tebak Beda Dunia | 🆚 Adivinhe a Diferença no Mundo |
| q.today_world_title | 🌍 今天的世界 | 🌍 Today in the World | 🌍 きょうの世界 | 🌍 今天的世界 | 🌍 आज की दुनिया | 🌍 Dunia Hari Ini | 🌍 O Mundo Hoje |
| q.participation_title | 🏆 今日世界公民 | 🏆 Today's World Citizens | 🏆 きょうの世界市民 | 🏆 今日世界公民 | 🏆 आज के विश्व नागरिक | 🏆 Warga Dunia Hari Ini | 🏆 Cidadãos do Mundo de Hoje |
| q.closed(失敗態,2026-08-20 起不再當靜態預設) | 投票暫時關閉 | Voting is temporarily closed | 投票は現在休止中です | 投票暂时关闭 | वोटिंग अभी बंद है | Pemungutan suara sedang ditutup | A votação está temporariamente fechada |
| q.loading | 載入中…… | Loading… | 読み込み中…… | 加载中…… | लोड हो रहा है… | Memuat… | Carregando… |
| q.vote_hint | 選一個答案,看看世界怎麼說 | Pick an answer and see what the world says | 答えを選んで、世界の声を見てみよう | 选一个答案,看看世界怎么说 | एक जवाब चुनें और देखें दुनिया क्या कहती है | Pilih jawaban dan lihat kata dunia | Escolha uma resposta e veja o que o mundo diz |
| q.answered_count | 已有 {n} 人回答 | {n} people have answered | これまでに{n}人が回答 | 已有 {n} 人回答 | {n} लोगों ने जवाब दिया है | {n} orang sudah menjawab | {n} pessoas já responderam |
| q.your_vote | 你的答案 | Your answer | あなたの回答 | 你的答案 | आपका जवाब | Jawabanmu | Sua resposta |
| q.community_top | 各社群最多人選 | Top pick in each community | 各コミュニティの最多回答 | 各社群最多人选 | हर समुदाय की सबसे लोकप्रिय पसंद | Pilihan terbanyak tiap komunitas | Mais votada em cada comunidade |
| q.correct | 猜對了! | You got it! | 正解! | 猜对了! | सही जवाब! | Tebakanmu benar! | Acertou! |
| q.incorrect | 猜錯了 | Not quite | 残念、はずれ | 猜错了 | सही नहीं | Belum tepat | Não foi dessa vez |
| q.correct_rate | {pct}% 的人猜對了 | {pct}% guessed right | {pct}%の人が正解 | {pct}% 的人猜对了 | {pct}% लोगों ने सही अंदाज़ा लगाया | {pct}% menebak benar | {pct}% acertaram |
| q.answer_label | 答案 | Answer | 答え | 答案 | जवाब | Jawaban | Resposta |
| q.tell_us | ＋ 說說你的情況 | + Tell us how it is for you | ＋ あなたの場合を教えて | ＋ 说说你的情况 | + अपनी बात बताइए | + Ceritakan pengalamanmu | + Conte como é para você |
| q.next | 下一題 → | Next question → | 次の一問 → | 下一题 → | अगला सवाल → | Pertanyaan berikutnya → | Próxima pergunta → |
| q.all_questions | 看所有世界問題 → | See all world questions → | 世界への質問をすべて見る → | 看所有世界问题 → | सभी विश्व प्रश्न देखें → | Lihat semua pertanyaan dunia → | Ver todas as perguntas do mundo → |
| q.archive_title | 世界問題集 | World Questions | 世界への質問集 | 世界问题集 | विश्व प्रश्न संग्रह | Kumpulan Pertanyaan Dunia | Perguntas do Mundo |
| q.asked_by | {community} 的朋友在問 | Asked by the {community} community | {community}のみんなが聞いています | {community} 的朋友在问 | {community} समुदाय पूछ रहा है | Ditanyakan komunitas {community} | Pergunta da comunidade {community} |
| q.asked_to | 問 {community} 的朋友 | For the {community} community | {community}のみんなへ | 问 {community} 的朋友 | {community} समुदाय से | Untuk komunitas {community} | Para a comunidade {community} |
| q.no_votes | 還沒有人投票,當第一個! | No votes yet — be the first! | まだ投票なし。一番乗りしよう! | 还没有人投票,当第一个! | अभी कोई वोट नहीं — पहले बनिए! | Belum ada suara — jadilah yang pertama! | Ainda sem votos — seja o primeiro! |
| q.error_retry | 出了點問題,請再試一次 | Something went wrong, try again | エラーが発生しました。もう一度お試しください | 出了点问题,请再试一次 | कुछ गड़बड़ हुई, फिर कोशिश करें | Ada masalah, coba lagi | Algo deu errado, tente de novo |
| q.today_world_empty | 今天世界很安靜 | The world is quiet today | きょうの世界は静かです | 今天世界很安静 | आज दुनिया शांत है | Dunia sedang tenang hari ini | O mundo está quieto hoje |
| q.your_community | 你的社群 | Your community | あなたのコミュニティ | 你的社群 | आपका समुदाय | Komunitasmu | Sua comunidade |

## 7. 管線掛載(只改 repo 內腳本,**絕不動 /etc/cron.d/aeiou**)

- `hourly-export.sh`:`import-topics.mjs` 之後、`check-topic-calendar.mjs` 之前插入
  `import-questions.mjs`,**失敗即中止**(比照 import-topic-occurrences:壞題庫不准上線)。
- `cron-15min.sh`:`sync-topics-to-d1.mjs` 之後插入 `sync-questions-to-d1.mjs`,
  rc 併入最終 exit 判斷;jobs 記錄 `job_name='sync-questions'`。
- `init-db.mjs` 不用改(schema-host.sql 已含新表;舊庫由 migrate-questions.mjs 補,
  import-questions.mjs 開頭 execFileSync 呼叫它,比照 import-topics 對 migrate-topic-observances 的做法)。

## 8. 已知取捨(記錄在案)

- 「個人」世界公民排行榜需要穩定身分與顯示名稱 → 被 OAuth(M2)擋住;本次交付**社群層級**參與榜。
- 首發題庫 2026-08-15 定稿,涵蓋至 2026-08-24(每日 poll+guess 各一;歷史事實,帶日期)。
  現況一律用指令查:`sqlite3 db/aeiou.sqlite "SELECT kind,COUNT(*),MIN(qdate),MAX(qdate) FROM questions GROUP BY kind"`。
  涵蓋日過後未補題會停在最後一題(`questionsForDate` 退最近一題,不開天窗)。
  補題=編輯 `content/questions.json`;之後可排每週用 claude 批次產題(額度回復後再議,不在本次範圍)。
- Safari ITP 下 anon_id 不穩 → 同人可能重複計票,已知缺口,與 posts/reactions 同因,驗證用 Chromium。
