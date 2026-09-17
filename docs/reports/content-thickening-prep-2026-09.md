# 內容加厚備料(2026-09-17)

> **這是備料,不是上線清單。** 站級降權期間(`docs/seo-current-state.md` 第一段的 90 天凍結,至 2026-12-16)
> 內容加厚只備料不上線。
>
> **動手條件(兩個都要成立)**:
> 1. `node scripts/crawl-freshness.mjs` 的重爬比例 ≥ 70%(配額緊加 `--sample 20`);
> 2. 斷崖路徑已確認 —— `node scripts/seo-health.mjs --no-inspect --days 28` 的逐日曝光,
>    舊 Topic 主頁(08-26 前就存在的 55 個路徑)每日曝光回到約 150–200 的基線。
>
> 動手時一律只改 `content/topics/<slug>.md`、`content/regional-notes/<slug>.json`、
> `content/topic-regional-notes.json`、`content/questions.json`;凍結範圍①(共用 title/description/h3 規則)不動。
>
> 本檔所有數字都附日期與查法。GSC 數字取自主機庫 `gsc_query_metrics`(唯讀),**幾乎全部落在 2026-08-27 ~ 09-02
> 這個斷崖前的窗**(09-03 起全站每日曝光只剩 16–54,格子級的數字沒有判別力);Bing 數字取自
> `/mnt/customers/seo-ops/bin/keyword-demand.mjs`,窗 2026-06-19 ~ 09-16。
> 官方來源候選都在 2026-09-17 從主機做過 robots.txt 與可達性檢查(附錄 A);
> **robots 401/403 或連不上的網域可以放 `source_urls` 給讀者點,但不能當守門核對頁**,每格都另掛一個可抓的官方頁。

---

## (a) zh-TW 制度數字格子(8 格)

查法(2026-09-17 實跑,近 60 天、不含年份、名次 5–12、限制度型 Topic):

```bash
sqlite3 -header -column db/aeiou.sqlite "SELECT query, page_url, SUM(impressions) imp, SUM(clicks) clk,
  ROUND(SUM(position_sum)/SUM(impressions),1) pos, MIN(metric_date) d0, MAX(metric_date) d1
  FROM gsc_query_metrics WHERE locale='zh-TW' AND metric_date >= date('now','-60 days')
  AND query NOT GLOB '*20[0-9][0-9]*' AND query NOT GLOB '*[0-9][0-9]年*'
  AND (page_url LIKE '%/topic/minimum-wage%' OR page_url LIKE '%/topic/paid-leave-and-overtime%'
   OR page_url LIKE '%/topic/parental-leave%' OR page_url LIKE '%/topic/health-coverage%'
   OR page_url LIKE '%/topic/renting-a-home%' OR page_url LIKE '%/topic/residency-and-visas%'
   OR page_url LIKE '%/topic/compulsory-education%' OR page_url LIKE '%/topic/voting-and-elections%'
   OR page_url LIKE '%/topic/coming-of-age%' OR page_url LIKE '%/topic/military-service%')
  GROUP BY query, page_url HAVING pos BETWEEN 5 AND 12 ORDER BY imp DESC"
```

同一頁的變體查詢(「日本特休」「日本 特休」「日本特休計算」…)合併成一格看。`parental-leave`、`renting-a-home`、
`voting-and-elections` 在這個窗**沒有**任何名次 5–12 的無年份查詢,所以不在清單裡。

### 總表

| # | 查詢(合併變體) | 頁面 | 曝光 | 名次 | 資料窗 | 現況內容在哪 |
|---|---|---|---|---|---|---|
| 1 | 義務教育 | `/topic/compulsory-education/tw/` | 26 | 10.3 | 08-31~09-01 | `content/topic-regional-notes.json` › `compulsory-education.notes.TW` |
| 2 | 日本特休 / 日本 特休 / 日本特休計算 / 日本特休天數 / 日本 特休天數 / 日本特休幾天 | `/topic/paid-leave-and-overtime/jp/` | 25+10+5+2+2+2 = 46 | 7.8–11.0(主字 7.9) | 08-30~09-01 | `content/regional-notes/paid-leave-and-overtime.json` › `JP.zh-TW` |
| 3 | 美國特休 / 美國 特休 | `/topic/paid-leave-and-overtime/us/` | 13+5 = 18 | 9.8 / 11.0 | 08-30~09-01 | 同上 › `US.zh-TW` |
| 4 | 中國成年幾歲 / 大陸成年是幾歲 / 中國成年 / 大陸成年 / 中國成人禮 … | `/topic/coming-of-age/cn/`(另 4+1 次落在 Topic 主頁) | 11+6+1+1+1+1+1 = 22 | 6.8–10.0(主字 8.6) | 08-30~09-01 | `content/topic-regional-notes.json` › `coming-of-age.notes.CN` |
| 5 | 印尼居留證 / 印尼居留證申請 | `/topic/residency-and-visas/id/` | 10+1 = 11 | 10.3 / 12.0 | 08-30~09-01 | `content/regional-notes/residency-and-visas.json` › `ID.zh-TW` |
| 6 | bpjs是什麼 | `/topic/health-coverage/id/` | 4 | 9.3 | 08-30~09-01 | `content/regional-notes/health-coverage.json` › `ID.zh-TW` |
| 7 | 大陸特休 / 中國特休天數 / 大陸特休天數 / 大陸加班費計算 | `/topic/paid-leave-and-overtime/cn/` | 4+2+1+1 = 8 | 9.0–11.0 | 08-30~08-31 | `content/regional-notes/paid-leave-and-overtime.json` › `CN.zh-TW` |
| 8 | 美國基本工資月薪 / 美國最低工資月薪 | `/topic/minimum-wage/us/` | 2+1 = 3 | 7.5 / 10.0 | 08-29~09-01 | `content/regional-notes/minimum-wage.json` › `US.zh-TW` |

八格 2026-08-27~09-02 合計 138 次曝光、1 次點擊(格 2)。

### 逐格

#### 格 1 · 義務教育 → compulsory-education / TW

- **現況那一段寫了什麼**:《國民教育法》第三條「六歲至十五歲之國民,應受國民教育;其強迫入學,另以法律定之」;
  第四條前六年國小、後三年國中;第五、六條政府辦理為原則與實驗教育。全段是**法條結構的解讀**,一個可查驗的數字都沒有
  (除了「九年」與「6–15 歲」)。
- **缺的具體數字**:
  1. 「義務教育」在台灣是 **9 年**,不是 12 年 —— 十二年國民基本教育自 2014 年 8 月(民國 103 年)起分兩段:
     前九年「普及、義務、強迫入學、免學費」,後三年 15 歲以上「普及、**自願非強迫入學**、免學費」(高級中等教育法)。
     讀者搜「義務教育」很可能是在問「到底幾年」,這一段現在沒回答。
  2. 強迫的實際力道:《強迫入學條例》第 9 條 —— 經書面警告限期入學仍不入學者,由鄉(鎮、市、區)公所處
     **一百元以下罰鍰**並限期入學,不遵行得**繼續處罰至入學為止**;第 2 條「六歲至十五歲」;最後修正 2019-04-17。
  3. 免罰/緩讀的門檻:第 12、13 條,身心障礙或重大傷病經公立醫療機構證明可緩讀,**每次不超過一年**。
- **官方來源候選**(當地語言、官方網域):
  - `https://edu.law.moe.gov.tw/LawContent.aspx?id=FL008928`(強迫入學條例;教育部主管法規共用系統;**無 robots.txt(404),可抓**,2026-09-17 抓到第 2/6/9/12/13 條全文)
  - `https://edu.law.moe.gov.tw/LawContent.aspx?id=FL008927`(國民教育法,同系統)
  - `https://www.edu.tw/News_Content.aspx?n=D33B55D537402BAA&s=37E2FF8B7ACFC28B`(教育部「十二年國民基本教育相關業務」;robots 只擋 `/search` 等,可抓;2026-09-17 抓到「前九年/後三年」兩段原文)
  - `https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=H0070002`(強迫入學條例,全國法規資料庫;**整站 Disallow,只能放 `source_urls`,不能當核對頁**)
  - 現有 `source_urls` 只有 `law.moj.gov.tw/...H0070001`(國民教育法,同樣 Disallow) —— 目前這格**沒有任何一個可抓的核對頁**,補上面前兩條即修。

#### 格 2 · 日本特休 → paid-leave-and-overtime / JP

- **現況那一段寫了什麼**:第 39 條 6 個月 10 天到 6.5 年 20 天的逐級表、2019 年起年 5 日確實取得義務(第 39 條第 7 項)、
  第 115 條兩年時效、36 協定月 45/年 360/特別條款年 720/單月 100/2–6 月平均 80、加班 25% 與月 60 小時以上 50%。
  **已經很厚**,但變體查詢「特休計算」「特休天數」問的是**算法**,現況只有正職的表。
- **缺的具體數字**:
  1. **比例付與表**(週所定労働日數 4 日以下、或年 216 日以下、週 30 小時未滿):
     週 4 日 7/8/9/10/12/13/15、週 3 日 5/6/6/8/9/10/11、週 2 日 3/4/4/5/6/6/7、週 1 日 1/2/2/2/3/3/3
     (依 0.5/1.5/2.5/3.5/4.5/5.5/6.5 年)。台灣讀者問「日本打工特休怎麼算」就是這張表。
  2. **時間單位年休**:勞資協定後可在**年 5 日**範圍內按小時休,但這部分**不能抵**「年 5 日確實取得」。
  3. **取得率**:令和 7(2025)年就労条件総合調査 —— 2024 年一年間平均付與 **18.1 日**、取得 **12.1 日**、
     取得率 **66.9%**(前一年 65.3%),1984 年以來最高;產業別最高「電気・ガス・熱供給・水道業」75.2%、最低「宿泊業,飲食サービス業」50.7%。
     與台灣「沒休完發工資」對照時,這個「三分之一沒休」的數字是制度差異的證據。
- **官方來源候選**:
  - `https://work-holiday.mhlw.go.jp/kyuuka-sokushin/roudousya.html`(厚労省「年次有給休暇取得促進特設サイト」;robots 對 `*` 全開、只擋 GPTBot;2026-09-17 抓到正職表與比例付與表全表)
  - `https://work-holiday.mhlw.go.jp/kyuuka-sokushin/pdf/all.pdf?v=202311`(同站 leaflet:年 5 日、時間單位年休,2026-09-17 pdftotext 核過)
  - `https://www.mhlw.go.jp/toukei/itiran/roudou/jikan/syurou/25/dl/gaikyou.pdf`(令和 7 年就労条件総合調査の概況;`www.mhlw.go.jp` robots 只擋 `/cgi-bin/`、`/images/` 與一頁,可抓;第 5 表在 PDF 第 435–451 行,2026-09-17 pdftotext 核過)
  - `https://www.mhlw.go.jp/toukei/itiran/roudou/jikan/syurou/25/index.html`(同調查 HTML 入口)
  - 既有:`https://laws.e-gov.go.jp/law/322AC0000000049`(労働基準法本文;robots 無 Disallow)

#### 格 3 · 美國特休 → paid-leave-and-overtime / US

- **現況那一段寫了什麼**:FLSA 不要求為未工作時間付錢、SCA/Davis-Bacon 例外、週 40 小時 1.5 倍、無每日規定、16 歲以上無工時上限。
  全段講的是「法律不管」,**沒有任何「實際上美國人有幾天假」的數字** —— 而讀者問「美國特休」要的正是那個。
- **缺的具體數字**(BLS National Compensation Survey,2025 年 3 月):
  1. 民間部門有給假(paid vacation)**可及率 80%**;全職 93%、兼職 40%;薪資最低四分位 55%。
  2. 平均天數依年資:滿 1 年 **11 天**、5 年 15 天、10 年 18 天、20 年 20 天;病假(paid sick leave)各年資一律 7 天。
  3. 有給病假可及率 80%、有給假日 81%。
  4. 分布:滿 1 年 31% 的人拿 10–14 天;滿 20 年 33% 的人超過 24 天。
- **官方來源候選**:
  - `https://www.bls.gov/news.release/ebs2.t06.htm`(Employee Benefits in the United States, March 2025, Table 6;`www.bls.gov` robots 對 `*` 只擋 `/scripts` `/crs` 等內部路徑,可抓;2026-09-17 抓到 80/93/40/55 四個數)
  - `https://www.bls.gov/charts/employee-benefits/paid-leave-sick-vacation-days-by-service-requirement.htm`(11/15/18/20 天與病假 7 天)
  - `https://www.bls.gov/ebs/factsheets/paid-vacations.htm`(分布)
  - `https://www.dol.gov/general/topic/workhours/vacation_leave`(FLSA 不管休假的原句;`www.dol.gov` robots 只擋 `/core/` `/profiles/`,可抓;2026-09-17 核過)

#### 格 4 · 中國成年幾歲 → coming-of-age / CN

- **現況那一段寫了什麼**:《民法典》第十七條「十八周歲以上的自然人為成年人」、沒有全國性成年儀式、結婚男 22 女 20。
  只有一個數字(18)加一個結婚年齡;讀者問「幾歲算成年」時,答案其實**依用途不同**,這一段沒展開。
- **缺的具體數字**(全部有官方全文可核):
  1. 《民法典》第十八條第二款:**十六周歲以上**以自己勞動收入為主要生活來源的未成年人,**視為**完全民事行為能力人。
  2. 刑事責任年齡(《刑法》第十七條,2021 年刑法修正案(十一)後):一般 **16 歲**;**14–16 歲**對八種重罪負責;
     **12–14 歲**犯故意殺人、故意傷害致死或以特別殘忍手段致重傷造成嚴重殘疾、情節惡劣,經最高人民檢察院核准追訴才負責。
  3. 選舉權:《憲法》第三十四條,**年滿十八周歲**的公民有選舉權和被選舉權(2018 年修正版原文核過)。
  4. 現有結婚年齡 22/20 可保留,補上法源《民法典》第一千零四十七條。
- **官方來源候選**:
  - `https://www.gov.cn/guoqing/2018-03/22/content_5276318.htm`(憲法全文;`www.gov.cn` robots 對 `*` 只擋 `/2016*/`、`/premier/` 等舊路徑,`/guoqing/` 可抓;2026-09-17 抓到第三十四條原文)
  - `https://www.gov.cn/xinwen/2020-06/01/content_5516649.htm`(民法典全文,gov.cn `/xinwen/` 可抓)
  - `https://www.moj.gov.cn/pub/sfbgw/jgsz/jgszzsdw/zsdwflyzzx/flyzzxzcxx/zcxxzcfg/zcfgfl/202012/t20201227_188562.html`(司法部刊的刑法修正案(十一)全文;`www.moj.gov.cn` robots 302,需再確認落點)
  - `http://www.npc.gov.cn/npc/c2/c30834/202012/t20201226_309472.html`(中國人大網,刑事責任年齡調整說明;**主機連不上 npc.gov.cn(robots 逾時)**,只能放 `source_urls`)
  - 既有:`https://www.court.gov.cn/zixun/xiangqing/233181.html`(robots 無 Disallow)

#### 格 5 · 印尼居留證 → residency-and-visas / ID

- **現況那一段寫了什麼**:ITAS/ITAP 與 KITAS/KITAP、ITAP 5 年可無限延展、ITAS 每次 2 年累計 6 年、移民法第 48/71/63 條、
  地址變更 14 日、RPTKA 每人每月 100 美元、黃金簽證 35 萬/70 萬美元。**已經厚**,但「申請」變體問的是**要花多少錢、多久**。
- **缺的具體數字**:
  1. **規費(PNBP,PP 45/2024,2024-12-17 生效)**:ITAS 最長 1 年 **Rp 3,000,000**、最長 2 年 **Rp 5,000,000**;
     ITAP 最長 5 年 **Rp 7,000,000**、最長 10 年 Rp 12,000,000、無期限 Rp 15,000,000。舊制(PP 28/2019)ITAS 1 年是 Rp 1,500,000 —— 漲一倍,這是 2024 年底之後每個申請者都會撞到的數字。
  2. 「30 日內申辦」與「逾期每日罰款」的金額(移民法第 78 條的 overstay 罰則,現行 Rp 1,000,000/日)—— 需核對現行條文,本次未抓到官方頁。
- **官方來源候選**:
  - `https://jogja.kemenkum.go.id/layanan-2/standar-layanan/adm-hukum-umum-2/tarif-pnbp-peraturan-pemerintah-nomor-45-tahun-2024`(法務部日惹辦公室的 PP 45/2024 費率表;**主機連不上(逾時)**,需從別的網路複驗)
  - `https://peraturan.bpk.go.id/Details/305293/pp-no-45-tahun-2024`(PP 45/2024 本文;**robots 回 403,不准抓**,只放 `source_urls`)
  - `https://www.imigrasi.go.id/`、`https://evisa.imigrasi.go.id/`(移民總局;**robots 回 403,不准抓**)
  - `https://jdih.kemnaker.go.id/`(勞動部法規庫,robots `Allow: /`,可抓 —— RPTKA 那一半的核對頁)
  - ⚠ 這格四個候選裡**三個本機抓不到**;上線前要另找一個可抓的官方費率頁(例如各地 Kantor Imigrasi 的 `kemenkumham.go.id` 子站,`kanimnunukan.kemenkumham.go.id` 本機亦逾時)。抓不到就照紅線:放 `source_urls`、標 SKIP、不假裝核對過。

#### 格 6 · bpjs是什麼 → health-coverage / ID

- **現況那一段寫了什麼**:SJSN 法第四條 g 款強制、BPJS 法、外國人六個月、受雇者雇主 4% 本人 1% 上限 Rp 12,000,000、五名家屬、95% 目標「邁向」、KRIS 病房改革。
  講的是**制度**,但「bpjs是什麼」是入門查詢,缺的是**一個人自己要付多少、多少人在裡面**。
- **缺的具體數字**:
  1. 自繳(PBPU/BP)月費:Kelas I **Rp 150,000**、Kelas II **Rp 100,000**、Kelas III **Rp 42,000**(政府補 Rp 7,000,本人付 **Rp 35,000**);
     2020-07-01 起適用(Perpres 64/2020),Perpres 59/2024(KRIS)明文**金額不變**、最晚 2025-06-30 實施 KRIS。
  2. 參保人數:**284,316,178 人**(BPJS Kesehatan 管理報告,截至 2026-07-31)—— 對照現況那句「95% 目標是邁向不是已達成」,要同時給分母(BPS 人口)才成句;本次未抓分母。
- **官方來源候選**:
  - `https://bpjs-kesehatan.go.id/`(robots `Allow: /`,可抓;參保人數在首頁「Laporan Pengelolaan Program」區塊)
  - `https://bpjs-kesehatan.go.id/bpjs/post/read/2020/1586/Di-Era-Pandemi-Pemerintah-Bantu-Iuran-Peserta-Mandiri-Kelas-3-dan-Tingkatkan-Kualitas-Layanan-JKN`(2020 年官方公告三級月費)
  - `https://data.bpjs-kesehatan.go.id/bpjs-portal/action/dash-publik-detail.cbi?id=22f081ce-419d-11eb-a5e7-b5beb99935c0`(Cakupan Kepesertaan 公開儀表板)
  - `https://djsn.go.id/berita/press-release-djsn-terkait-perpres-nomor-59-tahun-2024-...`(DJSN 對 Perpres 59/2024 的新聞稿:金額不變;robots 未查)
  - Perpres 64/2020、59/2024 本文在 `peraturan.bpk.go.id`(**403,只放 `source_urls`**)

#### 格 7 · 大陸特休/加班費計算 → paid-leave-and-overtime / CN

- **現況那一段寫了什麼**:12 個月資格、累計工齡 5/10/15 天、300% 折算、8 小時/44 小時、加班 1/3 小時與月 36 小時、150/200/300%。
  **加班費三檔有了,但「加班費計算」缺分母** —— 日工資怎麼從月薪算出來。
- **缺的具體數字**:
  1. **月計薪天數 21.75 天**:日工資 = 月工資 ÷ 21.75;小時工資 = 月工資 ÷ (21.75 × 8)。
  2. 2025-01-01 起改依**人社部發〔2025〕2 號**:法定節假日 11 天 → **13 天**,年工作日 250 → **248**、月工作日 20.83 → **20.67**,
     月計薪天數 **維持 21.75**;舊的劳社部发〔2008〕3 号同時廢止。零售/百科上大量還在寫 20.83,這一格用新數字就是差異點。
  3. 年假折算 300% 裡包含正常工資,即**額外**付 200%(條例第 5 條與《企業職工帶薪年休假實施辦法》第 10 條)。
- **官方來源候選**:
  - `https://www.gov.cn/zhengce/zhengceku/202501/content_6995777.htm`(人社部發〔2025〕2 號全文;gov.cn `/zhengce/zhengceku/` 可抓;2026-09-17 抓到 248/20.67/21.75 與廢止句)
  - 既有:`https://www.gov.cn/flfg/2007-12/16/content_835527.htm`(職工帶薪年休假條例)
  - `https://rsj.beijing.gov.cn/xxgk/2024zcwj/202409/t20240906_3791491.html`(北京人社局轉發文,補地方執行面;robots 未查)

#### 格 8 · 美國基本工資月薪 → minimum-wage / US

- **現況那一段寫了什麼**:7.25 美元、2009-07-24 起、國會修法才能動、州可訂更高、DC 18.40、喬治亞/懷俄明 5.15 但實際 7.25、「取最高者」規則。
  全是**時薪**;查詢問的是**月薪**,頁上沒有任何月/年換算。
- **缺的具體數字**:
  1. 月薪換算:7.25 × 2,080 小時 ÷ 12 = **1,256.67 美元/月**、年 **15,080 美元**(全職 40 小時週);這是算式不是引用,要在句子裡寫明假設。
  2. 小費工資:現金時薪 **2.13 美元**、tip credit 最高 **5.12**、月小費超過 30 美元才算 tipped employee(DOL WHD,2026-07-01 版)。
  3. 實際領這個數字的人:2024 年時薪制勞工 8,030 萬人,**82,000 人正好領 7.25、760,000 人低於 7.25**,合計 **1.0%**(1979 年 13.4%)。
     這個數字解釋了為什麼「聯邦最低工資月薪」在美國幾乎沒有人真的領。
- **官方來源候選**:
  - `https://www.dol.gov/agencies/whd/minimum-wage`(7.25 與 2009-07-24;可抓,2026-09-17 核過)
  - `https://www.dol.gov/agencies/whd/state/minimum-wage/tipped`(2.13 / 5.12 / 30 美元;可抓,核過)
  - `https://www.bls.gov/opub/reports/minimum-wage/2024/home.htm`(Characteristics of minimum wage workers, 2024;可抓)
  - `https://www.bls.gov/cps/cpsaat44.htm`(同資料的年度表)
  - 既有:`https://www.dol.gov/agencies/whd/minimum-wage/state`

---

## (b) 印度缺漏 observance

### 現況清單怎麼查

```bash
grep -l '^## observance IN' content/topics/*.md | while read f; do slug=$(basename $f .md);
  grep -A3 '^## observance IN' $f | grep -E '^## observance IN|local_name|^- date' | sed "s|^|$slug: |"; done
```

2026-09-17 實跑:37 個 Topic 檔有 IN observance,節日面涵蓋 Diwali(含 Dhanteras/Bhai Dooj/Govardhan)、Pongal、Makar Sankranti、
Ugadi、Independence Day、Gandhi Jayanti、Ambedkar Jayanti、Muharram、Milad-un-Nabi、Bakrid、Id-ul-Fitr、Good Friday/Easter、
Christmas、Durga Puja(長假機制)、Children's/Teachers'/Women's Day、Kargil Vijay Diwas、Valentine Week、Big Billion Days。

⚠ **假日總表那一層沒有缺**:`content/national-holiday-calendars.json` 的 IN 已經有 Republic Day、Holi、Raksha Bandhan、Janmashtami、
Ganesh Chaturthi、Dussehra、Onam、Guru Nanak Jayanti、Chhath、Karwa Chauth 等 50 格,2027 日期齊全,來源是 `cag.gov.in` 的 2026 表與
`dfe.gov.in` 的 gazetted/restricted PDF。**缺的是 Topic 層** —— 所以下面每一項的「2027 日期」直接取自那份檔,不必再查。

### 需求量(Bing,en-IN,2026-06-19 ~ 09-16;2026-09-17 實跑)

```bash
cd /mnt/customers/seo-ops && node bin/keyword-demand.mjs --country in --language en-IN \
  --words "holi 2027,holi,raksha bandhan 2027,raksha bandhan,republic day 2027,republic day,janmashtami 2027,ganesh chaturthi 2027,dussehra 2027,navratri 2027,onam 2027,guru nanak jayanti 2027,mahashivratri 2027,ram navami 2027,baisakhi 2027,chhath puja 2027,karva chauth 2027,independence day india,diwali 2027,gazetted holidays 2027"
```

| 字 | broad | exact |
|---|---|---|
| raksha bandhan | 19,531 | 2,674 |
| holi | 1,987 | 565 |
| republic day | 695 | 174 |
| holi 2027 | 324 | 228 |
| independence day india(對照組,已有) | 268 | 75 |
| diwali 2027(對照組,已有) | 121 | 85 |
| raksha bandhan 2027 | 53 | 27 |
| janmashtami 2027 | 49 | 30 |
| ganesh chaturthi 2027 | 44 | 42 |
| onam 2027 | 21 | 19 |
| navratri 2027 | 19 | 16 |
| mahashivratri 2027 | 16 | 16 |
| dussehra 2027 | 15 | 15 |
| ram navami 2027 | 7 | 7 |
| republic day 2027 | 1 | 1 |
| guru nanak jayanti 2027 / baisakhi 2027 / chhath puja 2027 / karva chauth 2027 / gazetted holidays 2027 | 0 | 0 |

判讀邊界(照 `keyword-demand.mjs` 檔頭):① 這是 Bing 不是 Google,只看相對大小與是不是 0;② 量測窗落在 8 月 Raksha Bandhan 與
9 月 Onam/Ganesh 的季節裡,**Holi(3 月)被窗低估、Raksha Bandhan 被窗高估**;③ 0 不等於沒人搜,只有 GSC 同期也沒曝光才能推「大概沒需求」;
④ 印地文形狀幾乎全 0,不拿它下結論(任務交辦已明示)。

GSC 例外證據(2026-09-17 查 `gsc_query_metrics`,所有 locale):對 holi / raksha / rakhi / republic / janmashtami / ganesh / dussehra / navratri / onam
**一次曝光都沒有** —— 因為站上沒有這些頁,Google 沒有東西可以給曝光;這不是「沒需求」的證據。有的是 zh-TW 的「印度國定假日2026」6 次(名次 11)、
「印度假期2026」5 次、「印度假日」4+4 次,全落在 `/holidays/in/2026/`、`/2027/`,說明中文市場的印度查詢入口是假日總表,不是 Topic。

### 清單(依需求排序;每項:掛哪個 Topic、2027 日期、官方來源候選)

| # | 節日 | 掛哪個 Topic(現有) | 2027(來自 holiday calendar) | 中央地位 | 需求 |
|---|---|---|---|---|---|
| 1 | **Raksha Bandhan** | `affection-and-reciprocity`(IN 現只有 Valentine Week;兄妹繫線+回禮正好是 reciprocity 的軸) | 2027-08-17 | 中央 **restricted**(可選假);Maharashtra 等邦列公假 | Bing 19,531/2,674(季節高估) |
| 2 | **Holi** | 沒有現成的「春季/色彩」Topic。最近的是 `equinox-and-seasonal-turns`(IN 已有 Makar Sankranti,但 Holi 是陰陽曆不是太陽定日,軸不合)或 `carnival`(IN 已有 Goa Carnaval;「放縱一天」的軸合,但 commonality 寫死「四旬期前」)。**建議:先掛 `carnival` 並改寬 commonality,或走 new-territory B 段開新 Topic** —— 兩者都碰凍結範圍④,要用戶決定 | 2027-03-23(Holika Dahan 03-22) | 中央 **gazetted** | Bing 1,987/565;holi 2027 324/228(季節低估) |
| 3 | **Republic Day** | `national-days`(IN 現只有 Independence Day —— 一個國家有兩個國定紀念日、Topic 只寫一個,這是最明確的缺) | 2027-01-26 | 三個全國假日之一(公私一律放) | Bing 695/174;「republic day 2027」只有 1 —— 讀者不帶年份搜 |
| 4 | Janmashtami | 沒有「印度教曆法日」Topic(`islamic-/jewish-/christian-calendar-days` 都有,**Hindu 沒有**);這是結構缺口,不是單一 observance | 2027-08-24 | gazetted | 49/30 |
| 5 | Ganesh Chaturthi | 同上;若只掛一處,`long-holiday-weeks`(Maharashtra 邦假)或等 Hindu-calendar Topic | 2027-09-04 | restricted;Maharashtra 公假 | 44/42 |
| 6 | Onam | `harvest-and-gratitude`(IN 現只有 Pongal;Onam 是 Kerala 的收穫節,同軸第二格) | 2027-09-13 | restricted;Kerala 邦假 | 21/19 |
| 7 | Navratri / Dussehra | `long-holiday-weeks` 已有 Durga Puja 長假;Dussehra 本身可補進 `ghosts-ancestors-and-remembrance`?不合。**留給 Hindu-calendar Topic** | 2027-10-09(Dussehra) | gazetted | 19/16、15/15 |
| 8 | Maha Shivratri、Ram Navami | 同 Hindu-calendar 缺口 | 2027-03-06、04-15 | restricted / gazetted | 16/16、7/7 |
| — | Guru Nanak Jayanti、Baisakhi、Chhath、Karva Chauth | Bing 0 且 GSC 0 → 這一輪不做 | — | — | 0 |

**結論**:立刻能做、不碰新 Topic 的只有三項 —— Raksha Bandhan(#1)、Republic Day(#3)、Onam(#6);
Holi(#2)要用戶決定掛哪裡;#4/#5/#7/#8 共同指向「沒有 hindu-calendar-days 這個 Topic」,屬凍結範圍④(新 Topic 走 new-territory B 段),本檔不提案。

### 官方來源候選(逐項)

- **中央 gazetted/restricted 清單**(Holi、Republic Day、Janmashtami、Dussehra 是 gazetted;Raksha Bandhan、Ganesh、Onam 是 restricted):
  - `https://dopt.gov.in/sites/default/files/Holiday%20list%202027.PDF`(DoPT O.M. No. 12/2/2023-JCA,2026-07-16;**主機連不上 dopt.gov.in(robots 與 PDF 都逾時)**,只放 `source_urls`)
  - `https://dfe.gov.in/uploads/documents/list-of-gazetted-holidays-2026.pdf`、`.../list-of-restricted-holiidays-2026.pdf`(林業教育局轉載的同一份 DoPT 表;`dfe.gov.in` robots 只擋 `/hpanel/` 等三路徑,**可抓**;但 PDF 是掃描影像,pdftotext 無字,守門核對只能比檔案指紋不能比文字)
  - `https://dfe.gov.in/list-of-holidays`(同站 HTML 入口,2027 版出來會掛在這)
  - `https://cag.gov.in/defence/new-delhi/en/page-defence-new-delhi-holidaylist`(審計署國防部門的 HTML 假日表,2026-09-17 抓到 2026 全表:Republic Day 01-26、Holi 03-04、Janmashtami 09-04、Dussehra 10-20、Diwali 11-08、Raksha Bandhan 08-28 restricted;`cag.gov.in/robots.txt` 302→`/en/robots.txt` 404,等於沒有 robots,可抓)—— 這是目前**唯一可抓且有文字**的中央清單,已在 holiday calendar 的 `source_urls` 裡
- **Republic Day 的制度說明**(1950-01-26 憲法生效、Purna Swaraj 1930):
  - `https://www.pib.gov.in/PressReleasePage.aspx?PRID=2218369&reg=3&lang=2`(PIB「The Journey of India as a Republic」;**pib.gov.in robots 回 403,不准抓**,只放 `source_urls`)
  - `https://www.pib.gov.in/FactsheetDetails.aspx?Id=148584&reg=3&lang=2`(同上)
  - 可抓的核對頁:上面 `cag.gov.in` 表(證「gazetted、放假」那一半)
- **Raksha Bandhan 邦級公假**(中央只是 restricted,「哪裡放假」要靠邦):
  - `https://raigad.gov.in/en/service/public-holidays-2024/`(Maharashtra Raigad 縣府頁,連到 GAD 2026 公假 PDF;robots 204 空檔,可抓;PDF 本次未讀)
  - `https://maharashtra.gov.in/`(GAD 依 Negotiable Instruments Act §25 的 2026 公告,2025-12-08 憲報;robots 對 `*` 無 Disallow,可抓;具體 PDF 路徑本次未定位)
  - `https://mmrda.maharashtra.gov.in/en/public-holidays`(2026 表;**TLS 憑證鏈不完整,WebFetch 失敗**,不可當核對頁)
- **Onam**:Kerala 邦政府假日公告(`kerala.gov.in`,本次未查 robots);中央 restricted 清單同上。
- **Holi**:中央 gazetted 清單同上;邦級(UP/Delhi/Maharashtra 的 Dhulivandan 03-03 vs 中央 Holi 03-04,2026 年就分兩天)是 date_rule 要說清楚的點。

---

## (c) 零題 Topic

查法(2026-09-17 實跑):

```bash
sqlite3 -header -column db/aeiou.sqlite "SELECT t.slug, t.category,
  (SELECT COUNT(*) FROM questions q WHERE q.topic_id=t.topic_id) n
  FROM topics t WHERE t.status='active' AND n=0 ORDER BY t.category, t.slug"
sqlite3 db/aeiou.sqlite "SELECT kind,COUNT(*),MIN(qdate),MAX(qdate) FROM questions GROUP BY kind"
```

結果:**16 個 active Topic 零題**;題庫 poll 244 + guess 244,涵蓋 2026-08-15 ~ 2027-04-14。
出題規格在 `docs/briefs/daily-question.md`(社群 = 語言 = 站台;guess 題 option id 用 locale 代碼、七語 explain)。
下面只給**方向與事實出處**,文案是用戶的。事實出處欄指的是現有 `content/` 裡已經寫好、有 source 的段落 ——
出題不需要新查證,只需要把已有的七國事實變成問句。

| Topic | 方向 1(poll:問各社群自己怎麼做) | 方向 2(guess:七國裡哪一國) | 事實出處 |
|---|---|---|---|
| **health-coverage**(civic) | 「你看一次門診自己付多少?」—— 台灣部分負擔 / 日本 3 成 / 巴西 SUS 免費 / 美國看保單,七社群答案天然分歧 | 「七國裡哪一國**法律不強制**納保?」答案 US(2019 起聯邦罰款 0);干擾項 IN(無全民強制但有 PM-JAY) | `content/regional-notes/health-coverage.json`(7 國)、md zh-TW summary |
| **minimum-wage**(civic) | 「你們那裡最低工資是全國一個數字,還是分地區?」—— TW/BR 單一、JP 47 種、CN 省內分檔、ID 省+縣市、US 州、IN 邦 | 「哪一國的聯邦/全國最低工資 **17 年沒調**?」答案 US(7.25,2009-07-24 起) | `content/regional-notes/minimum-wage.json` |
| **paid-leave-and-overtime**(civic) | 「特休沒休完會怎樣?」—— TW 發工資 / JP 兩年後消滅 / CN 300% / US 沒有法定特休 / BR 可折現 1/3 | 「哪一國**聯邦法完全不規定**帶薪年假?」答案 US;干擾項 IN(只有工廠法) | `content/regional-notes/paid-leave-and-overtime.json` |
| **renting-a-home**(civic) | 「你租房押金付了幾個月?」—— TW 上限 2 個月 / 加州 1 個月 / CN 無上限 / JP 敷金+禮金 / ID 無上限 | 「哪一國有付給房東、**通常不退**的『禮金』?」答案 JP | `content/regional-notes/renting-a-home.json` |
| **residency-and-visas**(civic) | 「入境後幾天內要去登記住址?」—— TW 30 / JP 14 / CN 10(借宿 24 小時)/ ID 14 / BR 90 / US 10(僅變更) | 「哪一國的**綠卡本身就是工作許可**,不用第二張證?」答案 US;干擾項 JP(就労資格寫在在留資格裡) | `content/regional-notes/residency-and-visas.json` |
| **entrance-exams**(education) | 「你們的大學入學考一年考幾次?」—— CN 高考 1 次 / JP 共通テスト 1 次 / IN JEE Main 2 次 / US SAT 多次 / TW 學測+分科 | 「哪一國**沒有全國統一**的大學入學考試?」答案 US;干擾項 BR(ENEM 是全國考但州立大學另辦 vestibular) | `content/regional-notes/entrance-exams.json` |
| **jewish-calendar-days**(faith) | 「你們那裡學校會為少數宗教節日停課或准假嗎?」—— NYC 贖罪日停課 / NJ 立法准假 / BR 全國補考法 / 其餘無 | 「哪一國有**全國性法律**讓學生因宗教戒守日改期補考?」答案 BR | md observances(US 4 筆)+ `topic-regional-notes.json`(BR/CN/ID/IN/JP/TW) |
| **pet-preparedness**(family) | 「你有為寵物準備避難包嗎?」(有/部分/沒有/沒養) | 「哪一國的官方防災指引把『寵物同行避難』寫成原則?」答案 JP(環境省「同行避難」);干擾項 TW/US 也有指引 —— **出題前要回頭核 regional note 的 source,確認 JP 那句是原文** | `topic-regional-notes.json › pet-preparedness`(7 國) |
| **pets-and-family**(family) | 「你家養的動物在法律上算『寵物』嗎?」—— TW 犬貓+其他伴侶動物 / CN 城市養犬登記 / 各國定義不同 | 「哪一國把『終生飼養』寫成飼主義務?」答案 JP(動物愛護管理法);干擾項 TW(要求提供必要醫療) | `topic-regional-notes.json › pets-and-family` |
| **beer-festivals**(festival) | 「你們那裡的啤酒節是政府辦、民間辦,還是辦不成?」 | 「哪一國的啤酒節**市政府主辦**、主場館登記在市府機關表?」答案 BR(Blumenau);干擾項 CN(青島也是市政府主辦 —— 兩個都對,題目要問「七月辦的那個」→ CN) | md observances(BR/CN/US/JP)+ notes(ID/IN/TW) |
| **halloween**(festival) | 「你們那裡萬聖節有人來討糖嗎?」 | 「哪一國在同一天用**州法立了一個對抗它的節日**?」答案 BR(Dia do Saci 10-31);干擾項 JP(澀谷條例) | md observances(US/JP/TW/BR×2)+ notes(CN/ID/IN) |
| **shopping-festivals**(festival) | 「你去年在哪個購物節花最多?」—— 雙十一 / Black Friday / Harbolnas / Big Billion Days | 「哪一國把折扣基準寫死成『促銷前七日內最低成交價』?」答案 CN(市場監管總局) | md observances(8 筆,七國齊) |
| **tanabata-and-qixi**(festival) | 「七夕在你們那裡是情人節、祈願節,還是沒人過?」 | 「哪一國把七夕**整個搬到國曆 7 月 7 日**?」答案 JP;進階:「仙台七夕在哪一個月?」8 月 | md observances(TW×2/CN/JP×3)+ notes(BR/ID/IN/US) |
| **newborn-and-full-moon**(life-stage) | 「你們那裡新生兒要在幾天內登記出生?」—— JP 14 / IN 21 / CN 1 個月 / BR 15 / TW、ID 60 / US 各州 | 「哪一國嬰兒**第七天**有命名與參拜?」答案 JP(お七夜);干擾項 ID(第七天 aqiqah —— 兩個都對,題目要問「參拜」) | `topic-regional-notes.json › newborn-and-full-moon` |
| **proposals-and-engagements**(relationship) | 「你們那裡訂婚有法律效力嗎?」 | 「哪一國訂婚年齡(17)**比結婚年齡(18)低**?」答案 TW;干擾項 ID(2019 後男女皆 19) | `topic-regional-notes.json › proposals-and-engagements` |
| **war-dead-and-veterans**(remembrance) | 「你們那裡紀念戰爭的日子放假嗎?」 | 「哪一國把『陣亡者』與『生還退伍軍人』**拆成兩個聯邦假日**?」答案 US;干擾項 JP(8-15 只是內閣決定、無法律) | md observances(8 筆,七國齊) |

出題順序建議:先做 observance 七國齊的四個(shopping-festivals、war-dead-and-veterans、tanabata-and-qixi、halloween)——
guess 題的七個選項可以直接對到七個 observance;civic 五個的 regional notes 也是七國齊,但數字型答案要在 explain 裡附法條號。
兩個「兩個都對」的干擾項(beer-festivals 的 BR/CN、newborn 的 JP/ID)出題時要靠題幹限定,否則 guess 沒有唯一答案 —— import 不會擋這種錯。

---

## 附錄 A · 官方網域 robots/可達性檢查(2026-09-17,從主機,UA 表明身分)

| 網域 | robots.txt | 對本用途 | 備註 |
|---|---|---|---|
| `www.mhlw.go.jp` | 200,擋 `/cgi-bin/` `/images/` +1 頁 | 可抓 | |
| `work-holiday.mhlw.go.jp` | 200,`*` 全開、GPTBot 全擋 | 可抓 | |
| `laws.e-gov.go.jp` | 200,無 Disallow | 可抓 | |
| `www.bls.gov` | 200,擋內部路徑 | 可抓 | `/*.PDF$` 只對 archive.org_bot 擋 |
| `www.dol.gov` | 200,擋 `/core/` `/profiles/` | 可抓 | |
| `www.gov.cn` | 200,擋 `/2016*/` 等舊路徑 | `/guoqing/` `/zhengce/` `/xinwen/` `/flfg/` 可抓 | |
| `www.court.gov.cn` | 200,無 Disallow | 可抓 | |
| `www.npc.gov.cn` | 連不上(逾時) | 只放 `source_urls` | |
| `www.moj.gov.cn` | 302 | 需確認落點 | |
| `www.spp.gov.cn` | 403 | **不准抓** | |
| `edu.law.moe.gov.tw` | 404(無 robots) | 可抓 | |
| `www.edu.tw` | 200,擋 `/search` 等 | 可抓 | |
| `www.k12ea.gov.tw` | 200,`Crawl-delay: 120`,擋 `/files` | 可抓但要守 120 秒間隔;`/files/` 下的 PDF 不准抓 | |
| `www.mol.gov.tw` | 200,擋 `/bin/` 等 | 可抓 | |
| `law.moj.gov.tw` | 200,`Disallow: /` | **整站不准抓**,只放 `source_urls` | 現有 TW 法條來源大半在這 |
| `bpjs-kesehatan.go.id` | 200,`Allow: /` | 可抓 | |
| `jdih.kemnaker.go.id` | 200,`Allow: /` | 可抓 | |
| `www.imigrasi.go.id`、`evisa.imigrasi.go.id` | 403 | **不准抓** | |
| `peraturan.bpk.go.id` | 403 | **不准抓** | 印尼法規本文大多在這 |
| `jogja.kemenkum.go.id`、`kanimnunukan.kemenkumham.go.id` | 連不上(逾時) | 需別的網路複驗 | |
| `dfe.gov.in` | 200,擋 `/hpanel/` 等 3 路徑 | 可抓 | PDF 是掃描影像 |
| `dopt.gov.in` | 連不上(逾時) | 只放 `source_urls` | |
| `cag.gov.in` | 302→`/en/robots.txt` 404 | 等於無 robots,可抓 | |
| `pib.gov.in`、`www.mha.gov.in`、`www.india.gov.in`、`www.mohfw.gov.in` | 403 | **不准抓** | |
| `maharashtra.gov.in` | 200,`*` 無 Disallow | 可抓 | |
| `raigad.gov.in` | 204(空) | 可抓 | |
| `mmrda.maharashtra.gov.in` | 連不上;HTML 端 TLS 憑證鏈不完整 | 不可當核對頁 | |
| `www.stat.go.jp`、`www.mospi.gov.in` | 200 | 可抓 | 本次未用 |

重跑:`for d in <網域…>; do curl -s -A 'aeiou-research/1.0 (+https://aeiou.now)' -o /tmp/r_$d.txt -w "$d %{http_code}\n" -m 20 -L https://$d/robots.txt; done`
