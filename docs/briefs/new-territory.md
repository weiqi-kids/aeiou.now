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

## B. 全新的 Topic 主題領域

現在 57 個 Topic 全是節日與制度。要把涵蓋面從「日曆」擴到「跨國生活」。

**卡點**:新內容要人寫 —— `content/topics/<slug>.md`,七個語系 + 每國至少一個官方來源
(格式見 `docs/03-topic-content.md`,閘門 `node scripts/check-content-depth.mjs`)。
這是四塊裡最重的一塊,而且**主題清單是用戶的東西**,不該由 Claude 代定。

**要用戶給的**:新領域的清單。已知站上完全沒有的方向(僅供起頭,不是提案):
生活成本、租屋與搬遷、就醫與保險、簽證與居留、職場慣例、學制與升學。

---

## C. 逐主題題集 `/questions/<topic-slug>/` —— 機器已上線,**今天產出 0 頁**

**先更正一件事**:先前說「486 題 × 7 語被浪費在一個 URL」是錯的。
題庫 486 題裡**只有 26 題已發布**(2026-08-15 起一天兩題,排到 2027-04-14),其餘是排程中的未來內容。

```bash
python3 -c "import json,datetime;d=json.load(open('data/questions/zh-TW.json'))['questions'];t=datetime.date.today().isoformat();print('總數',len(d),'已發布',len([q for q in d if q['date']<=t]),'最後一題',max(q['date'] for q in d))"
```

**做了什麼**:`site/src/pages/questions/[topic].astro` + `questionTopicCells()`(判準一份,
getStaticPaths / sitemap / Topic 頁入口三處共用)+ `/questions/` 與 Topic 頁的雙向站內入口。

**門檻怎麼定的(實測,不是猜)**:第一版寫「題數 >= 4」,建出七頁、四頁沒過守門的 320 唯一字元。
攤開看才發現**題數不相關**:

```
moving-home     2 題 → 334 ✅      ask-the-world   4 題 → 291 ❌
back-to-school  2 題 → 343 ✅      mid-autumn      2 題 → 286 ❌
```

決定厚度的是**借來的 Topic 摘要**長短。靠題數開頁 = 開出一批內容主要來自母頁的近似重複頁,
正是逐國頁那個坑。所以改成量「題目自己的唯一字數 >= 320」——
不管外框借到多少字,產出的頁一定過得了守門,也不會變成幾週後才引爆的 CI 失敗。

**什麼時候會開始長**:

```bash
cd site && LOCALE=zh-TW node --input-type=module -e "
const {questionsByTopic,questionTextWeight,MIN_TOPIC_QUESTION_TEXT}=await import('./src/lib/questions-data.mjs');
const rows=[...questionsByTopic().entries()].map(([s,l])=>[s,l.length,questionTextWeight(l)]).sort((a,b)=>b[2]-a[2]);
console.log('門檻',MIN_TOPIC_QUESTION_TEXT);for(const r of rows.slice(0,8))console.log(r[0].padEnd(34),r[1],'題',r[2],'唯一字');"
```

**要用戶決定的**:題庫是**一天兩題的儀式**,還是可以提前把存量放出來?
維持儀式 → 這一塊要幾個月才長得出頁;提前放 → 這一塊馬上有內容,但每日一問就不是每日的了。
**這是產品決定,不是我能改的。**

---

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

## 順序與理由

1. **A**(機器齊、卡在資料量)—— 唯一帶商業意圖、且 Google 不吃的類別
2. **D**(資料齊、只要算)—— 把既有假日總表從「被拒收」變成「答得出連假」
3. **C**(機器已上線,等題目累積)—— 或由用戶決定提前放題
4. **B**(要人寫七語內容,且主題清單是用戶的)

⚠ 四塊都要守同一條:**別再大量產出薄頁**。379 個逐國頁的下場是 186 頁不進索引,
而且爬取預算被吃掉(2026-08-27 抽樣:逐國頁最後抓取日中位 08-27、Topic 主頁 08-19)。
新頁的判準一律「這一頁**自己**的內容量」,不是數量。
