# 開拓新的區塊(2026-08-27 用戶拍板「上面建議全部都要」)

> 這一份是**四塊新內容領域**的執行順序與各自的卡點。
> 現況一律用底下附的指令查,不要信本檔寫的數字。

## 為什麼要開新區塊(而不是優化既有頁面)

近 28 天 GSC:**159 個查詢、523 曝光、1 點擊**。攤開來看:

| 意圖類別 | 查詢 | 曝光 | 點擊 | 平均名次 |
|---|---|---|---|---|
| 純日期型(Google 答案框的標準品) | 56 | 306 | 1 | 17.2 |
| 國家×節日 | 27 | 105 | 0 | 15.2 |
| 名稱/翻譯型 | 8 | 21 | 0 | 70.1 |
| 跨國/比較/制度規則 | 10 | 12 | 0 | 63.0 |

🔴 **符合產品草案 §7「當地議題」那種查詢(禮物／餐廳／活動／約會／推薦)的:0 個查詢、0 曝光。
帶城市名的:0 個查詢、0 曝光。** 草案 §7 逐市場列的查詢長這樣 ——
台灣 `情人節 禮物`／`情人節 餐廳`／`情人節 台北`;日本 `本命チョコ`／`バレンタイン デート`;
巴西 `presente Dia dos Namorados`／`jantar romântico`。**每一個 Topic 的這半邊,站上一頁都沒有。**

蓋好的是「哪一天、什麼制度」那半邊,而那半邊排到第 5 名也 0 點擊。
所以 523 曝光就算 CTR 修到 5% 也只有約 26 次點擊/月 —— **優化既有頁面改變不了量級。**

查法:`node scripts/seo-health.mjs` 的 ③ 層。

---

## A. 在地與商圈(草案 §7)—— 先做這塊

**開什麼查詢空間**:`<Topic> 禮物`／`<Topic> 餐廳`／`<Topic> 活動`／`<Topic> <城市>`。
Google 不會用答案框吃掉,而且是唯一帶商業意圖的類別(草案 §60)。

**已經有的機器**:`scripts/update-local-data.mjs`(每小時、守 robots)、
`places` / `place_i18n` / `place_topics` / `events` / `event_i18n` / `event_topics` 六張表、
Topic 頁的 `#nearby` 與 `#events` 兩個版位(草案 §44 就有)。

**卡點是資料量,不是版位**:

```bash
sqlite3 -header -column db/aeiou.sqlite "SELECT city_code,COUNT(*) n FROM places GROUP BY city_code ORDER BY n DESC"
sqlite3 -header -column db/aeiou.sqlite "SELECT city_code,COUNT(*) n FROM events  GROUP BY city_code ORDER BY n DESC"
```

兩區在 Topic 頁上有幾頁是空的(先 `cd site && LOCALE=zh-TW pnpm build`):

```bash
python3 -c "import glob;h=[open(f,encoding='utf-8').read() for f in glob.glob('site/dist/topic/*/index.html')];print(sum(1 for x in h if '目前沒有資料' in x.split('id=\"nearby\"')[1][:1200] and '目前沒有資料' in x.split('id=\"events\"')[1][:1200]),'/',len(h))"
```

**⚠ 開頁之前先想清楚 URL 形狀**:`<Topic>×<城市>` 一格一頁 = 57 × 7 = 399 個新 URL,
與逐國頁同一個量級。逐國頁的下場是 186 頁 Discovered - currently not indexed。
所以**先把資料補厚,再決定要不要獨立 URL**;資料薄的階段先讓既有的 `#nearby`／`#events` 長出內容。

---

## B. 全新的 Topic 主題領域(2026-08-27 用戶拍板「全部增加」)

### 先量需求,再寫內容 —— 這是本專案既有的規矩

`scripts/check-final-topic-taxonomy.mjs` 的 `FINAL_SLUGS` 是白名單,而且每一個既有主題
的註解都附著 Bing 實測搜尋量當理由(`七夕` @tw 1,438、`ハロウィン` @jp 11,047…)。
所以新主題也照這條路走。工具:`node /root/seo-ops/bin/keyword-demand.mjs`。

**判讀邊界(工具檔頭寫得很清楚,照抄過來免得誤用)**:
這是 **Bing** 的量不是 Google;**有量 = 可信的下限,`0` 只代表「Bing 量不到」**
(2026-08-27 twdro.net 實測反例:GSC 有曝光的字本工具報 0)。
⚠ Bing **沒有 id-ID**,印尼那一欄是 `country=id language=ms-MY` 勉強配對,只能看有無、不能看大小;
印地文 `hi-IN` 幾乎全 0,印度改用英文量(那類查詢在印度本來就多半用英文)。

### 量到的結果(exact 比對,2026-05-29 ~ 2026-08-26)

| 領域 | 台灣 | 美國 | 日本 | 中國 | 巴西 | 印度(en) | 判斷 |
|---|---|---|---|---|---|---|---|
| **就醫與保險** | 健保 5,256 | health insurance 22,875 | 健康保険 9,408 | 医保 15,010 | SUS 12,745 | health insurance 1,513 | ✅ 七國全部有量,最強 |
| **職場慣例** | 特休 5,352 | paid time off 959 | 有給休暇 16,085 | 年假 13,732 | férias 4,386 | overtime 171 | ✅ 強 |
| **租屋與搬遷** | 租屋 3,743 | security deposit 1,318 | 賃貸 38,003 | 租房 42,701 | aluguel 5,153 | rent agreement 746 | ✅ 強 |
| **簽證與居留** | 居留證 2,359 | visa 26,071 | 在留カード 18,957 | 签证 6,752 | visto 3,351 | visa 511 | ✅ 強 |
| **生活成本** | 生活費 **21** | cost of living 1,553 | 生活費 687 | 生活成本 **76** | custo de vida **17** | cost of living 39 | ⚠ 詞選錯了,見下 |
| **學制與升學** | 學制 **0**、升學 **0** | school system 55 | 学費 339 | 高考 382,207 | vestibular 1,628 | education system 32 | ⚠ 詞選錯了,見下 |

### 兩個主題要改名 —— 不是砍掉,是改成人們真的會搜的那個詞

- **生活成本 → 最低工資**。「生活費／生活成本／custo de vida」在五個市場都是兩位數,
  但同一個議題的制度切面有量:**最低賃金 29,677、minimum wage 14,273、最低工資 1,082、
  salário mínimo 3,532**。讀者搜的不是抽象的「生活成本」,是「法定最低工資是多少」。
- **學制與升學 → 升學考試**。「學制／升學」在台灣是 **0**,但 **高考 382,207**(全表最大的一個字)、
  **vestibular 1,628**、`受験`/`college admissions` 都有量。軸是**升學考試**,不是學制本身。
  ⚠ 學制那一半已經有 `compulsory-education`(幾歲到幾歲)在管,不要重複。

**共同的發現**:六個領域裡真正有量的頭部字**全部是制度的專有名稱**——
健保、SUS、BPJS、在留カード、高考、vestibular、有給休暇。
這正好是站上目前排 63 名的那一類(跨國/比較/制度規則),因為根本沒有頁面在答。

### 待辦

- [ ] 六個 `content/topics/<slug>.md`,七語 × 七國 + 每國至少一個官方來源
      (格式 `docs/03-topic-content.md`;閘門 `check-content-depth.mjs`、`check-source-urls.mjs`)
- [ ] 六個 slug 加進 `check-final-topic-taxonomy.mjs` 的 `FINAL_SLUGS`,註解附上上表的實測量
- [ ] 這六個都**沒有 observance**(不是節日),title 後綴會走 `ruleSuffix`/`practiceSuffix`,
      分類要選對(`category` 決定走哪一個,見 `site/src/lib/seo.mjs` 的註解)

## C. 逐主題題集 `/questions/<topic-slug>/` —— ✅ 已上線,七站各 24 頁

**2026-08-27 用戶拍板「提前把存量放出來」。** 做法是:
**首頁維持每天一題的儀式(`questionsForDate()` 照樣依日期挑),題集改成吃整份題庫(`allQuestions()`)。**
`date` 是每日一問的**排程**,不是內容的發布狀態。投票不會壞 —— `sync-questions-to-d1.mjs`
本來就把整份題庫推進 D1(沒有日期過濾),Worker 驗得到每一題。

結果:sitemap 469 → 493,七站各 24 個新的可索引頁,渲染厚度最薄 357(守門下限 320)、
拉丁語系最薄 1135。

**門檻走過三版,兩次都量錯,記在這裡免得再犯**(判準一份:`questionTopicCells()`,
getStaticPaths / sitemap / Topic 頁入口三處共用):

| 版本 | 判準 | 為什麼錯 |
|---|---|---|
| 一 | 題數 >= 4 | 當時只有 26 題已發布,每頁 2–4 題,厚度幾乎全靠**借來的 Topic 摘要**。實測 `moving-home` 2 題 → 334 過、`ask-the-world` 4 題 → 291 沒過,**題數不相關** |
| 二 | 題目自己的唯一字數 >= 320 | **唯一字數跟著書寫系統走**。拉丁字母就那二十幾個,再多題也堆不出 320 個不同字元 → CJK 三站各開 27–28 頁,en/hi/id/pt-BR **各只開 1 頁**。與 `country-cells.mjs` 那條「字元門檻對 CJK 天生比較嚴」同一個坑,方向相反 |
| 三 ✅ | 題數 >= 5 | 存量放出來之後每頁 5–50 題,厚度由題目主導。zh-TW(字元密度最高 = 最壞情況)5 題 → 402,取 5 是為了在 320 之上留約 80 字餘裕 |

**不會變成 CI 炸彈**:題庫只增不減(`generate-questions.mjs` 往檔尾加),頁面只會愈來愈厚。

**順帶修掉的兩件**(都是同一種語系不對稱,中文短於門檻所以從沒觸發):
- 守門 D3 把**選項標籤**當成重複段落。選項是按鈕上的字不是散文,同一主題兩題共用一個選項
  (`Adjusted a clock for daylight saving time`)本來就會發生。已加進 `answerTableCells()`
  的排除清單(第四次同型修正,前三次是 answer-basis / q-asked / hol-*)。
- 題庫裡兩題在中文明明不同、翻成英文收斂成同一句 → 讀取層按問句去重。

**還沒做的**:`q.topic_questions` 這個 i18n key 只有 zh-TW 是定稿,其餘六語是 `[TODO] ` 佔位
(`grep -l '\[TODO\]' site/src/i18n/*.json`)。文案是用戶的東西,等定版一次補。

## D. 趨勢與年度變化(草案 §7 的 トレンド／tendências)

**開什麼查詢空間**:`<Topic> 2027 跟 2026 差在哪`／`2027 連假`／`2027年放假安排`／
`feriados prolongados 2027`／`大型連休 2027`。**這一類不是單一日期,答案框吃不掉。**

**資料已經在 repo 裡**:`content/national-holiday-calendars.json`(七國 × 三年的逐年公告抄錄,
含 `date_status`、`year_notes`、補假)、`topic_observances` 的逐年 occurrences。
連假、補班、跨年度差異全部**算得出來**,不必新寫內容。

**⚠ 不要另開一個 URL**:`/holidays/<cc>/<年>/` 已經是「一個國家一年的全部假日」,
再開一個「連假表」會是同一份資料的第二個視圖 = 近似重複。
正確做法是**把連假與逐年差異算進既有的假日總表**,讓那 21 頁變厚,
而不是再生一批頁(現況那 21 頁裡 16 頁是 Crawled/Discovered - currently not indexed)。

---

## 四塊的現況(2026-08-28)

**四塊都已上線。** 逐項的剩餘工作、卡點與「怎麼接下去做」寫在 `docs/TODO.md` 的
「交接:四個新區塊做到哪、還缺什麼」那一段 —— **要接手請看那裡,本檔只留當初的緣由與需求實測。**

## 順序與理由

1. **A**(機器齊、卡在資料量)—— 唯一帶商業意圖、且 Google 不吃的類別
2. **D**(資料齊、只要算)—— 把既有假日總表從「被拒收」變成「答得出連假」
3. ~~**C**~~ ✅ 已完成(2026-08-27 存量已放出,七站各 24 頁)
4. **B**(要人寫七語內容,且主題清單是用戶的)

⚠ 四塊都要守同一條:**別再大量產出薄頁**。379 個逐國頁的下場是 186 頁不進索引,
而且爬取預算被吃掉(2026-08-27 抽樣:逐國頁最後抓取日中位 08-27、Topic 主頁 08-19)。
新頁的判準一律「這一頁**自己**的內容量」,不是數量。
