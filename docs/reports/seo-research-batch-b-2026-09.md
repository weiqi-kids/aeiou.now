# SEO Research — Plan 2 Batch B（2026-09）

研究日期：2026-09-04 UTC。研究範圍只包含 Plan 2 Batch B 的三個需求主題國：

1. `en / teachers-day → China`
2. `zh-TW / labour-day → United States`
3. `zh-TW / national-days → Japan`

本輪只新增這份 Markdown；沒有修改 `content/topics`、`content/observance-occurrences.json`、`content/topic-regional-notes.json`、`data` 或程式。每個關鍵判讀都優先附上擁有該事實的政府一手來源。

## 1. 既有 repo 內容與重複檢查

|需求|既有 source／locale block|既有年度資料|本輪結論|
|---|---|---|---|
|`en / teachers-day → CN`|[`content/topics/teachers-day.md`](../../content/topics/teachers-day.md) 已有 `observance CN teachers-day`：`local_name: 教师节`、`date: 09-10`；`locale en` 已有 `customs CN teachers-day`。`content/topic-regional-notes.json` 沒有中國缺席說明。|`content/observance-occurrences.json` 已有 CN 2026、2027、2028 的 `2026-09-10`、`2027-09-10`、`2028-09-10`，均標為 `confirmed`。|已有 country block；只補強法定假日範圍的證據，並標記「照常上課」的過度概括。|
|`zh-TW / labour-day → US`|同一 topic 已有 `observance US labor-day`：`local_name: Labor Day`、`date_rule: 9 月第一個星期一（不是 5 月 1 日）`，以及 `locale zh-TW` 的 `customs US labor-day`。|既有 US occurrences：2026-09-07、2027-09-06、2028-09-04，均 `confirmed`；資料目前把 `calendar_system` 記為 `local`。|已有 country block；日期規則正確，但要把「聯邦假日」與州／地方／私人雇主的實際休假拆開。資料欄位本輪不改。|
|`zh-TW / national-days → JP`|[`content/topics/national-days.md`](../../content/topics/national-days.md) 已有 `observance JP national-foundation-day`：`local_name: 建國記念の日`、`date: 02-11`，以及 `locale zh-TW` 的 `customs JP national-foundation-day`。沒有日本缺席說明。|occurrence 檔中的同一組日本資料目前以 `topic_slug: national-belonging`、`observance_key: national-foundation-day` 儲存，而不是 `topic_slug: national-days`；2026–2028 均為 2 月 11 日、`confirmed`。|不另造 block；把這個既有 slug 差異留作後續資料對照事項，並指出「神話即位日」應用歷史／傳承語氣，不應寫成無爭議的法律事實。|

網站的 country route 會從 topic 的 observance、`customs`、`date_rule` 與來源生成國家頁；因此本研究不再複製一段平行 country answer。Plan 2 Batch B 的清單數字是：Teachers’ Day→China `33/42 impressions`、Labour Day→US `51/51`、National Days→Japan `44/62`，來源為 [`docs/seo-work-plans-next.md`](../seo-work-plans-next.md)。

## 2. `en / teachers-day → China`

### 2.1 日期與當地叫法

- 中國大陸官方名稱是 **教师节**；日期是每年 **9 月 10 日**。教育部 2026 年最新通知明確寫作「2026 年 9 月 10 日是我国第 42 个教师节」，並要求各省、自治區、直轄市教育部門及各級學校辦理相關宣傳慶祝工作。來源：[`教育部辦公廳：慶祝第42個教師節通知（2026）`](https://www.moe.gov.cn/srcsite/A10/s7002/202608/t20260821_1447456.html)。

- 日期的法定依據可用《中华人民共和国教师法》第六條：`每年九月十日为教师节`。教育部對全國人大建議的正式答覆也重述，1985 年第六屆全國人大常委會決定每年 9 月 10 日為教師節，1993 年《教師法》再次寫入同一日期。來源：[`教育部：對全國人大第4540號建議的答覆摘要`](https://www.moe.gov.cn/jyb_xxgk/xxgk_jyta/jyta_jiaoshisi/201803/t20180329_331636.html)。

- 日期不是孔子誕辰；中國官方歷史說明是 1985 年第六屆全國人大常委會第九次會議決定 9 月 10 日為教師節，並解釋選在新學年開始、方便展開尊師重教活動。來源：[`教育部：教师节的由来`](https://www.moe.gov.cn/jyb_xwfb/xw_zt/moe_357/s3580/moe_2390/moe_2391/tnull_38105.html)。

適合作為英文 country answer 的本地詞是 `教师节`（可在英文中保留 `Jiaoshi Jie` 作補充，但不必取代正式漢字）；不要把中國這一格寫成 `孔子誕辰`，那是 repo 內台灣 block 的日期背景。

### 2.2 公眾假日／觀察範圍

- **不是全體公民的法定放假日。** 國務院 2024 年修訂的《全国年节及纪念日放假办法》把 `教师节` 列在其他紀念節日中，明定這類日期不放假。官方國務院公報 PDF：[`全国年节及纪念日放假办法（2024 修订）`](https://www.gov.cn/gongbao/2024/issue_11726/material/gwygb202433.pdf)；人力資源和社會保障部的法規頁：[`全国年节及纪念日放假办法`](https://www.mohrss.gov.cn/xxgk2020/fdzdgknr/zcfg/fg/202011/t20201103_394937.html)。

- **是全國性的教育／文化觀察日。** 教育部 2026 通知的收文對象包括各地教育廳（教委）、新疆生產建設兵團教育局及部屬／部省合建高校，並要求各地各校組織宣傳慶祝工作。這支持「全國教育系統會以表彰、宣傳、尊師活動來觀察」；不支持「每一間學校都用完全相同的儀式或課表」。來源仍為 [`教育部 2026 教師節通知`](https://www.moe.gov.cn/srcsite/A10/s7002/202608/t20260821_1447456.html)。

- 最精確的英文制度表述是：`China’s Teachers’ Day is a nationally designated commemorative day, but it is not a general public holiday/day off under the national holiday rules; schools and education authorities commonly organize recognition and appreciation activities.` 「not a general public holiday」比單獨寫 `classes run as usual everywhere` 更符合官方來源的範圍。

### 2.3 現有 en block 的過度概括與建議

現有 `customs CN teachers-day` 的日期、1985 年沿革與「不是放假日」方向正確，但以下句子要收窄：

1. `It is a commemorative day rather than a holiday, and classes run as usual`：前半可保留，但後半把「沒有法定放假」推成每校每年都照常上課；教育部同時要求學校辦慶祝活動，活動形式可能影響當日安排。建議改成「not a statutory day off; schools commonly hold ceremonies, commendations or appreciation activities」。
2. `the first act of the new term` 是教育部說明選日考量的修辭性解釋，不是每校實際課表。可保留為由來背景，但不要當成普遍現況。
3. 舊 observance source 是 `http://www.moe.gov.cn/.../tnull_38105.html`，目前可遇到 redirect loop；後續實作應以最新的 [`教育部 2026 通知`](https://www.moe.gov.cn/srcsite/A10/s7002/202608/t20260821_1447456.html)、[`教師法／教育部答覆`](https://www.moe.gov.cn/jyb_xxgk/xxgk_jyta/jyta_jiaoshisi/201803/t20180329_331636.html) 與現行放假辦法補強來源。本輪不改 topic source。

**可供後續英文文案使用的最小答案：**

> In China, Teachers’ Day (`教师节`) is observed every year on 10 September. It is a nationally designated commemorative day, not a general day off under China’s national holiday rules. Education authorities and schools commonly mark it with recognition, appreciation and other Teachers’ Day activities.

## 3. `zh-TW / labour-day → United States`

### 3.1 官方日期規則與當地用語

- 美國法定用語是 **Labor Day**（美式拼法，不是 `Labour Day`），規則是 **September 的第一個星期一**。5 U.S.C. §6103(a) 將 `Labor Day, the first Monday in September` 列為 legal public holiday；法條頁也說明該章是聯邦政府人員的假日規則。來源：[`5 U.S.C. §6103 — Holidays`](https://uscode.house.gov/view.xhtml?req=granuleid%3AUSC-prelim-title5-section6103&num=0&edition=prelim)。

- 2026 年的實際日期是 **9 月 7 日**；OPM 的聯邦假日表同時列出 2027 年 9 月 6 日、2028 年 9 月 4 日。來源：[`OPM Federal Holidays`](https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/)。

- 美國勞工部把 Labor Day 定義為每年 9 月第一個星期一、紀念美國勞工的社會與經濟成就；歷史頁記錄 1894 年國會把這一天定為 legal holiday。來源：[`U.S. Department of Labor：History of Labor Day`](https://www.dol.gov/general/laborday/history)。

- `Labor Day weekend` 是常見的連假說法；但 **May Day／International Workers’ Day（5 月 1 日）不是美國的 Labor Day**。美國國會圖書館的官方歷史資料明確把兩者分開：美國的 Labor Day 在 9 月第一個星期一，May Day 是 5 月 1 日的另一種勞工觀察。來源：[`Library of Congress：May Day as Workers’ Day`](https://www.loc.gov/item/today-in-history/may-01/)。

### 3.2 聯邦、州／地方與私人雇主的範圍

- **聯邦層級：** Labor Day 是 federal holiday，核心效果是聯邦政府假日與聯邦人員 pay／leave 規則；OPM 的年度表是最適合回答日期的行政來源。OPM 也明確提醒，州／地方政府與私人企業可能採用不同名稱或安排。來源：[`OPM Federal Holidays`](https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/)。

- **不是全國所有工作場所的強制休假：** USAGov 說許多政府辦公室及部分私人企業會在聯邦假日關閉，並另列 states and the District of Columbia 可以自行承認的州級假日；這個表述本身就不是「所有私人公司都關門」。來源：[`USAGov：American holidays`](https://www.usa.gov/holidays)。

- **私人雇主／州地方雇員的薪資界線：** U.S. Department of Labor 說 FLSA 不要求未工作的假日時間給薪，也不要求 holiday off 或 holiday premium；這些福利通常由雇主與員工／代表約定。來源：[`DOL：FLSA FAQ`](https://www.dol.gov/agencies/whd/flsa/faq)、[`DOL：Handy Reference Guide to the FLSA`](https://www.dol.gov/agencies/whd/compliance-assistance/handy-reference-guide-flsa)。因此「聯邦假日」不能直接翻成「所有州、地方政府、學校與私人雇主都放假」。

### 3.3 現有 zh-TW block 的過度概括與建議

現有 `customs US labor-day` 的「不是 5 月 1 日、是 9 月第一個星期一、是聯邦假日」三個核心方向正確；建議注意：

1. `實務上九月的那個週一被當成夏天的結束、開學前的最後一個長週末` 是文化／商業敘事，不是所有州、學區或工作場所的制度事實。若保留，應標成「常見文化說法」，不要放在回答「是否放假」的法規句中。
2. `五月一日的國際勞動節源自美國的八小時工時運動` 可以用 LOC／DOL 的歷史資料作背景，但必須和「美國 Labor Day」分段，避免讀者把 5 月 1 日理解成美國聯邦假日。
3. `date_rule US labor-day` 的規則正確；後續 source 可由現有 USAGov 擴充為 [`5 U.S.C. §6103`](https://uscode.house.gov/view.xhtml?req=granuleid%3AUSC-prelim-title5-section6103&num=0&edition=prelim) 與 [`OPM`](https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/)。本輪不改 source 或 occurrences。
4. 既有 occurrences 雖標為 `confirmed`，但 `calendar_system` 為 `local`；官方規則其實是聯邦法定的 Gregorian 日期。這是後續資料一致性檢查事項，不在本輪修改範圍。

**可供後續 zh-TW country answer 使用的最小答案：**

> 美國的 Labor Day 不是 5 月 1 日，而是每年 9 月第一個星期一；2026 年是 9 月 7 日。它是聯邦假日，但主要代表聯邦政府與聯邦人員的假日安排，不表示所有州／地方機關或私人雇主都必須關閉或給有薪假。5 月 1 日的 May Day／International Workers’ Day 是另一個勞工觀察日。

## 4. `zh-TW / national-days → Japan`

### 4.1 官方日期、規則與當地叫法

- 日本的正式名稱是 **建国記念の日**（注意正式名稱有 `の`），日期是每年 **2 月 11 日**。日本《国民の祝日に関する法律》把它列為「政令で定める日」，而內閣府列出的 2026、2027 年國民祝日表都給出 2 月 11 日。來源：[`內閣府：國民の祝日總表、法律與政令`](https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html)。

- 具體日期由 **建国記念の日となる日を定める政令（昭和41年政令第376号）** 固定為 2 月 11 日；因此它不是像春分日那樣每年依天文公告變動的日期。官方法令頁：[`e-Gov：建国記念の日となる日を定める政令`](https://laws.e-gov.go.jp/document?lawid=341CO0000000376)；內閣府說明：[`各「国民の祝日」について：建国記念の日`](https://www8.cao.go.jp/chosei/shukujitsu/gaiyou/kaku.html)。

- 法定趣旨是 **「建国をしのび、国を愛する心を養う」**。內閣府說明它由昭和 41 年（1966 年）的祝日法修法設立，經審議後在同年 12 月以政令定為 2 月 11 日。來源：[`內閣府：建国記念の日說明`](https://www8.cao.go.jp/chosei/shukujitsu/gaiyou/kaku.html)。

- 當地 answer 應優先使用 `建国記念の日`、`国民の祝日`、`休日`。`建国記念日` 可作一般讀者可能使用的簡稱，但不是目前祝日法／政令中的正式名稱；標題和首句應採官方的 `建国記念の日`。

### 4.2 假日範圍

- **全國層級的法定國民祝日：** 祝日法第 3 條明定「国民の祝日」は休日；因此建国記念の日不是都道府縣或城市自訂的地方紀念日，而是日本全國的 `国民の祝日`。內閣府總表同時列出法定分類、2026／2027 日期及「休日」規則。來源：[`內閣府：國民の祝日について`](https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html)。

- **不要把國民祝日等同於每間公司必然停業：** 厚生勞動省東京勞動局的勞動基準法 Q&A 明確說，《国民の祝日に関する法律》不對公司課以必須給員工休日的義務，且它和《労働基準法》的法定休日不同。對 country answer，應寫「national statutory holiday／national holiday」，不要寫「every private employer must close」。來源：[`東京勞動局：公司給員工的休日 Q&A`](https://jsite.mhlw.go.jp/tokyo-roudoukyoku/content/contents/001772772.pdf)。

### 4.3 現有 zh-TW block 的過度概括與建議

現有 `customs JP national-foundation-day` 已抓到 2 月 11 日、1966 年設立及官方趣旨，但以下兩點應收窄：

1. `它紀念的不是一個有記載日期的歷史事件，而是傳說中神武天皇即位的日子`：2 月 11 日的歷史背景確實和舊 `紀元節`／神武天皇即位傳承有關，但現行官方法律把日期交由政令指定，法定趣旨是「緬懷建國、培養愛國之心」，並沒有把一個可驗證的建國事件寫進法條。若保留神武天皇背景，應標為「傳承／歷史背景」而非當代法律事實。可對照內閣府的歷史說明與官方調查中「神武天皇即位の日と伝えられている日」的措辭：[`內閣府：祝日法制定經緯`](https://www8.cao.go.jp/chosei/shukujitsu/gaiyou/kaku/keii.html)、[`內閣府：建国記念の日調查`](https://survey.gov-online.go.jp/s41/S41-09-41-18.html)。
2. `日期存在，事件不存在` 是過度絕對的評論句；建議改成「日期由政令固定，官方現行趣旨是緬懷建國；其歷史來源涉及舊紀元節與傳承，不能當成有共識的實證建國日期」。
3. `summary` 或 answer 若使用「日本國慶日」作中文概括，應立即補上官方名 `建国記念の日`，避免讀者以為日本有一個叫 `National Day` 的法律名稱，或把它與天皇誕生日、文化の日混為一談。
4. occurrence 檔以 `national-belonging` 儲存日本這筆資料，而手動 topic 檔是 `national-days`；後續 targeted content gate／資料匯出前應確認 alias 對應，但本輪不改 data。

**可供後續 zh-TW country answer 使用的最小答案：**

> 日本的建國紀念日正式名稱是「建国記念の日」，每年 2 月 11 日。它是《国民の祝日に関する法律》下的全國性國民祝日，法定趣旨是「緬懷建國、培養愛國之心」；日期由 1966 年的政令固定。這是全國法定節日，但個別私人公司是否停業仍看公司行事曆。

## 5. 後續實作的最小答案規格

|頁面|首句應回答|法定／觀察界線|必保留的官方詞|
|---|---|---|---|
|`/topic/teachers-day/cn/`（en）|10 September；`教师节`。|全國指定的紀念日，但不是《全国年节及纪念日放假办法》下的普遍放假日；學校與教育部門會辦活動。|`教师节`、`10 September`、`commemorative day`、`not a general day off`。|
|`/topic/labour-day/us/`（zh-TW）|Labor Day 是 September 第一個星期一；2026 為 9 月 7 日。|聯邦假日不等於所有州／地方／私人雇主必須停業或給有薪假；5 月 1 日 May Day 是另一件事。|`Labor Day`、`first Monday in September`、`federal holiday`、`May Day`。|
|`/topic/national-days/jp/`（zh-TW）|正式名 `建国記念の日`，2 月 11 日。|全國 `国民の祝日`；但國民祝日法本身不等於私人公司一定停業。|`建国記念の日`、`国民の祝日`、`休日`、法定趣旨。|

## 6. 來源與資料日期備註

- 研究截點固定為 **2026-09-04 UTC**。
- 中國 2026 教師節的最新官方教育部通知已在 2026-08 發布，足以核實當年日期與全國教育系統的觀察安排；假日範圍以 2024 修訂後的國務院放假辦法為準。
- 美國 OPM 已列出 2026–2028 的 Labor Day 日期；法定規則以 5 U.S.C. §6103 為準。私人雇主的 paid holiday／day-off 不能從聯邦假日名稱直接推導，須依雇傭約定與適用的州／地方規則。
- 日本內閣府截至研究截點已列 2026、2027 的國民祝日，兩年建国記念の日都是 2 月 11 日；內閣府說 2028 年清單會在 2027 年 2 月刊載。不過固定日期的政令未變更前，2 月 11 日的規則本身沒有年度公告不確定性。
- 本報告中的「官方來源未支持更廣泛說法」是範圍判讀，不是對每一所學校、公司或地方政府的逐一稽核；若日後文案要回答具體城市、州、學區或雇主，需再查該層級的 calendar／規章。

