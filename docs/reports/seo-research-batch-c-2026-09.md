# SEO Research — Plan 2 Batch C（2026-09）

研究日期：2026-09-04 UTC。研究範圍只包含 Plan 2 Batch C 的三個需求主題國：

1. ja / long-holiday-weeks → Taiwan（GSC 18/21 impressions）
2. zh-TW / elders-day → Japan（10/10）
3. zh-TW / diwali → India（14/14）

本輪只新增這份 Markdown 研究筆記；沒有修改 content/topics、content/observance-occurrences.json、content/topic-regional-notes.json、data 或程式。日期與制度判讀以研究截點前查到的官方政府、法律及行政來源為準。

## 1. 既有 repo 內容與重複檢查

|需求|既有 topic／country block|occurrences／source 狀態|本輪結論|
|---|---|---|---|
|ja / long-holiday-weeks → Taiwan|[content/topics/long-holiday-weeks.md](../../content/topics/long-holiday-weeks.md) 已有 observance TW chunjie-lianjia：local_name 是「春節連假」，並有 locale ja 的 date_rule TW chunjie-lianjia 與 customs TW chunjie-lianjia。|2026：2026-02-14 至 2026-02-22，confirmed；2027：2027-02-04 至 2027-02-10，confirmed；2028：2028-01-22 至 2028-01-30，estimated。既有 source 是《紀念日及節日實施條例》及 DGPA 辦公日曆表。|已有 country block，不重複建立；補強「政府行政機關日曆」與民間雇主／學校範圍的界線。|
|zh-TW / elders-day → Japan|同一 topic 已有 observance JP keiro-no-hi：local_name 是「敬老の日」、date_rule 是 9 月第三個星期一；locale zh-TW 已有 customs JP keiro-no-hi。|2026-09-21、2027-09-20、2028-09-18，均為 confirmed；occurrence source 是 e-Gov 的國民祝日法。|已有 country block，不重複建立；補上「敬老の日」與「老人の日／老人週間」的區別，以及國民祝日不等於每家公司停業。|
|zh-TW / diwali → India|[content/topics/diwali.md](../../content/topics/diwali.md) 已有 observance IN diwali：local_name 是 Diwali / Deepavali、date_rule 是 Kartika 月新月日及五天節期第三天；locale zh-TW 已有 customs IN diwali。|Diwali 2026-11-08，confirmed；2027-10-29，estimated。Dhanteras、Govardhan Puja、Bhai Dooj 的 2026 occurrences 也都是 estimated。主 occurrence 目前只帶 Utsav source；topic-level source 另有 Incredible India 與 PIB。|已有 country block，不重複建立；補強中央政府假日清單與文化五天節期的差異，並標出 Bhai Dooj 2026 的日期衝突。|

[content/topic-regional-notes.json](../../content/topic-regional-notes.json) 沒有這三個 target country 的 regional note；因此目前 country route 的 fallback 不是缺席說明，而是既有 observance、date_rule、customs 與 source。研究結果只供後續修正文案與來源，不在本輪直接改寫。

## 2. ja / long-holiday-weeks → Taiwan

### 2.1 官方規則、2026／2027 日期與當地叫法

- 台灣法律中的正式制度名稱是「除夕及春節」。[《紀念日及節日實施條例》](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0020095) 第 5 條列出春節為農曆一月一日、除夕為農曆十二月末日；第 6 條明定除夕及春節自農曆十二月末日之前一日至翌年正月初三，放假五日。這是五個法定放假日的日期規則，不是每年固定的公曆日期。

- 同一條例第 8 條規定，放假日遇例假日應予補假；調整放假及補行上班日期，除其他法令另有規定外，由目的事業主管機關調移並公告。[法規原文第 8 條](https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0020095) 因此不能把「五日」直接寫成每年都只有五個連續曆日，也不能把台灣所有工作場所都套用同一種補假表。

- 行政院人事行政總處公布的 2026 政府行政機關辦公日曆表，將農曆春節列為 2 月 14 日至 2 月 22 日、共 9 日；法定五日從 2 月 15 日開始，2 月 15 日星期日的補假排在 2 月 20 日星期五。[DGPA 2026 辦公日曆表公告](https://www.dgpa.gov.tw/information?pid=12574&uid=41)；[2026 春節連續假期附表](https://www.dgpa.gov.tw/FileConversion?filename=dgpa%2Ffiles%2F202506%2F105f965b-c3e3-49e8-9e67-dadedccb2052.pdf&name=%E9%99%84%E8%A1%A83.pdf&nfix=)。

- 2027 的官方政府行政機關日曆表列春節假期為 2 月 4 日至 2 月 10 日、共 7 日；農曆初一與初二落在週末，補假排在 2 月 9 日與 10 日。[DGPA 2027 辦公日曆表新聞稿](https://www.dgpa.gov.tw/information?fr=ev22548C0701M03&pid=12983&uid=82)；[2027 連續假期附表](https://www.dgpa.gov.tw/FileConversion?filename=dgpa%2Ffiles%2F202605%2Fb3f2c62b-8de9-4e29-b8ea-64069be0cc2b.pdf&name=%E9%99%84%E8%A1%A81.pdf&nfix=)。

- 台灣日常與行政用語可分三層：法律用「除夕及春節」；DGPA 常用「農曆春節假期」與「連續假期」；搜尋及一般中文最自然的是「春節連假」或「連假」。日文 country answer 可保留「春節連假（春節の連休）」並說明是台灣的農曆新年假期，不要把它命名為日本的ゴールデンウィーク。

### 2.2 假日適用範圍

- DGPA 明確說明，政府行政機關辦公日曆表僅適用於政府行政機關公務人員；公營事業原則上比照，警察、消防、海巡、軍事等特殊機關及各級學校可由主管機關依需要調移，民間企業則依勞動基準法及其他法令辦理。[DGPA 2026 說明](https://www.dgpa.gov.tw/information?pid=12574&uid=41)

- 2025 年修正後，DGPA 的政府機關處理要點刪除了以週末換取平日、再補行上班的政府日曆安排，所以 2026 與 2027 的政府行政機關春節日曆沒有「借週末後再補班」的安排；但這不是台灣全體雇主永遠不得調移工作日的法律結論。條例第 8 條仍保留調整放假與補行上班由主管機關公告的制度；勞動部也說勞資雙方可以協商把國定假日與工作日對調，且不得減損應有的國定休假日數。[勞動部國定假日 Q&A](https://www.mol.gov.tw/1607/28690/2282/2284/2292/7239/?cprint=pt)

- 因此「連假」在 country answer 中應先指明層級：2026 的 9 日是政府行政機關辦公日曆表的結果；不能直接推導每一間私人公司、輪班單位或學校都在同一日放假。

### 2.3 現有 ja block 的過度概括

現有 locale ja 的整體 summary 寫「台灣 2025 年改法之後只補假、不再借週末」，現有 customs TW 又寫 2026 年 2 月 14 日至 22 日「中間沒有任何一天要補上班」。這些句子作為政府行政機關 2026／2027 日曆的描述大致正確，但作為台灣全國性規則過度絕對：

1. 「只補假、不再借週末」應收窄為「2026／2027 政府行政機關辦公日曆未採借週末補班」；法條仍有主管機關調整與補行上班的文字，民間勞資也可能依法協商調移。
2. 「沒有任何一天要補上班」應加上「在政府行政機關 2026 辦公日曆中」；特殊機關、學校及民間雇主不由這張日曆統一決定。
3. observance 的 date_rule 寫「逢星期六、星期日者再補假」適合描述政府日曆的週末處理，但法律核心用語是「遇例假日」；對勞工而言應看實際例假／休息日，而不是把所有週六、週日一律當成同一法律狀態。
4. 2028 occurrence 目前標為 estimated，且只以法條為 source；截至研究日尚未有 2028 政府行政機關年度辦公日曆，不能把 2028 的連假長度當成已公告的政府安排。

**後續 country answer 的最小事實骨架：**

> 台灣法律把除夕及春節定為五日假期；2026 年政府行政機關辦公日曆因此形成 2 月 14 日至 22 日的 9 日春節連假。這個 9 日安排是政府行政機關日曆的結果，私人雇主、輪班單位與學校可能依各自適用規則安排。

## 3. zh-TW / elders-day → Japan

### 3.1 日期規則、當地名稱與相關觀察日

- 日本正式名稱是「敬老の日」（Keirō no Hi）。《國民の祝日に関する法律》第 2 條規定為每年 9 月第三個星期一，法定趣旨是「多年にわたり社会につくしてきた老人を敬愛し、長寿を祝う」。[內閣府：國民の祝日、法律與年度表](https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html)；[e-Gov：國民の祝日に関する法律](https://laws.e-gov.go.jp/law/323AC1000000178)

- 內閣府年度表列出 2026 年敬老の日為 9 月 21 日、2027 年為 9 月 20 日；2028 年依固定規則為 9 月 18 日。2028 年的日期可由法律規則直接推得，但內閣府表示 2028 年完整國民祝日表會在 2027 年 2 月刊載，因此應把「法規推算已確定」和「年度官方表尚未發布」分開註記。[內閣府 2026／2027 年度表](https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html)

- 不要把「敬老の日」和「老人の日」混為同一個日期。內閣府說明，9 月 15 日是《老人福祉法》下的「老人の日」，9 月 15 日至 21 日是「老人週間」；2003 年起，國民祝日「敬老の日」改為 9 月第三個星期一。[內閣府：敬老の日說明](https://www8.cao.go.jp/chosei/shukujitsu/gaiyou/kaku.html)；[內閣府：老人の日・老人週間](https://www8.cao.go.jp/kourei/kou-kei/elderly.html)

### 3.2 假日與觀察範圍

- 「敬老の日」是全國層級的「国民の祝日」；祝日法第 3 條明定「国民の祝日」は休日，所以它不是地方政府自行選定的紀念日，也不只是民間宣導活動。[內閣府列出的祝日法第 2、3 條](https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html)

- 但「國民祝日」不等於每間私人公司都依法必須停業。厚生勞動省東京勞動局的勞動基準法 Q&A 明確說，國民祝日法不對公司課以給員工休日的義務，且該休日和勞動基準法的法定休日不同。[東京勞動局：会社が従業員に与える休日](https://jsite.mhlw.go.jp/tokyo-roudoukyoku/content/contents/002093680.pdf) 因此 country answer 應寫「日本全國法定的國民祝日」，不要寫成每個私人雇主、商店或學校都必然關閉。

- 2026 年 9 月 22 日另因敬老の日與秋分の日夾住平日而成為祝日法第 3 條第 3 項的「休日」；它不是另一個名為敬老の日的日期，也不是敬老日固定延長的法定節期。內閣府把這種日期列為「国民の祝日」之間形成的休日，並稱其為數年一度、不定期出現。[內閣府：休日規則說明](https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html)

### 3.3 現有 zh-TW block 的過度概括

現有 customs JP keiro-no-hi 的日期、改為第三個星期一及法定祝日方向正確，但以下文字應在後續實作時收窄：

1. 「這是七個市場裡唯一放假」若意指唯一一個被法律列為全國國民祝日的敬老／老人主題日，可以保留比較語境；若意指日本所有人都休假，則與厚生勞動省對私人公司的說明不一致。
2. 「因為有三天，回鄉探望長輩才可行」以及「商場、地方自治體都圍著這幾天排」是未由上述法規來源支持的社會／商業概括；應改為「常見相關活動」或刪除，不要和法定範圍放在同一句。
3. 若提到 2026 年 9 月 22 日，應維持「祝日法第 3 條第 3 項的休日」的精確稱呼，不要把它改稱第二個敬老日或另一個國民祝日。
4. 既有 e-Gov 法律 source 足以支持日期規則；後續若要做可讀的 country answer，應並列內閣府年度表與「老人の日／老人週間」頁，避免只引用法條而漏掉當地名稱辨識。

**後續 country answer 的最小事實骨架：**

> 日本的敬老の日每年在 9 月第三個星期一；2026 年是 9 月 21 日。它是日本全國的国民の祝日，但國民祝日法不代表每間私人公司都必須停業。9 月 15 日的老人の日與 9 月 15 日至 21 日的老人週間是另外的高齡者福利觀察安排。

## 4. zh-TW / diwali → India

### 4.1 當地名稱、日期規則與 2026 日期

- 印度官方英文資料並列使用 **Diwali** 與 **Deepavali**。印度新聞局（PIB）的文化背景資料寫作「Deepavali, also known as Diwali」；印度政府的 Hindi 假日資料則寫作「दिवाली (दीपावली)」。[PIB：Deepavali／Diwali 文化背景](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2201375&lang=1&reg=6)；[UIDAI 2026 官方年曆](https://uidai.gov.in/images/WallCalender2026.pdf)

- 日期不是固定公曆日。PIB 說 Deepavali 在 Kartik Amaavasya（Kartika 月新月）慶祝，通常落在 10 月或 11 月；印度觀光部的 Utsav 頁面也說日期依月亮運行而每年變動。[PIB 文化背景](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2201375&lang=1&reg=6)；[Ministry of Tourism Utsav：Diwali](https://utsav.gov.in/major-festival/diwali)

- 官方觀光資料把 Diwali 描述為五天節期：Dhanteras 開始，主 Diwali 是第三天，Bhai Dooj 在節期末；這是文化／宗教節期的結構，不代表五天都是全國統一的公假。[Utsav：Diwali](https://utsav.gov.in/major-festival/diwali)；[Incredible India：Diwali](https://www.incredibleindia.gov.in/en/festivals-and-events/diwali)

- 2026 年主 Diwali／Deepavali 是 **11 月 8 日星期日**。這個日期同時出現在印度觀光部官方 Incredible India、印度郵政的 2026 All India Holidays，以及中央政府假日行政資料中。[Incredible India 2026 Diwali](https://www.incredibleindia.gov.in/en/festivals-and-events/diwali)；[India Post：Holidays List 2026](https://www.indiapost.gov.in/holidays-list)；[DoPT 原始 2026 假日通知 PDF](https://dopt.gov.in/sites/default/files/Holidays%20to%20be%20observed%20in%20Central%20Government%20Offices%20during%20the%20year%202026.pdf)

- 中央政府行政資料還顯示，2026 年 Diwali 落在星期日，節慶假日若碰到 weekly off 或其他 non-working day，不當然產生 substitute holiday；某些邦若把前一天 Naraka Chaturdasi 定為該邦的 compulsory holiday，中央政府在該邦的辦公室可依該邦安排改觀察日。[NHAI 所載中央政府 2026 假日行政文件](https://nhai.gov.in/assets/pdf/List_of_holidays-2026.pdf)

### 4.2 假日、學校與文化觀察的範圍

- 不能把 Diwali 簡化成「印度法律下全國所有人都放假的 national holiday」。DoPT 的 2026 文件是「Central Government Offices」的假日通知：Delhi／New Delhi 的中央行政辦公室清單列 Diwali 11 月 8 日；Delhi／New Delhi 以外的中央政府辦公室也把 Diwali 列入 compulsory holidays，但其餘可選假日由各州／地區的 coordination committee 決定。文件另說中央政府組織最多 16 日、Union Territories 另定、銀行依財政服務部規則處理。[DoPT 2026 假日通知原始 PDF](https://dopt.gov.in/sites/default/files/Holidays%20to%20be%20observed%20in%20Central%20Government%20Offices%20during%20the%20year%202026.pdf)；[NHAI 官方副本](https://nhai.gov.in/assets/pdf/List_of_holidays-2026.pdf)

- 同一中央政府文件把 Republic Day、Independence Day、Mahatma Gandhi’s Birthday 稱為三個 national holidays，並把 Diwali 另外列為中央政府假日。這是「Diwali 廣泛列入政府／州／機構日曆」與「嚴格意義的全國法定假日」之間的關鍵差別；後續文案宜用「widely observed festival and a holiday in many official calendars」或直接限定為「central-government holiday list」，不要單獨寫「India’s national holiday」。

- 學校、私人雇主、銀行與州政府的實際安排不能由中央政府辦公室清單一律推導。這是由 DoPT 文件的適用對象與它對州、Union Territories、銀行的分流規定所作的範圍判讀；若要回答特定邦、城市或學校，仍需查該層級的年度日曆。

- 文化觀察方面，官方 PIB 與 Incredible India 都強調 Deepavali 是由不同社群共同延續的活文化傳統，並有 regional variations；官方觀光頁也指出 Jain、Sikh、Buddhist 社群對節期有不同意義。[PIB 文化背景](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2201375&lang=1&reg=6)；[Incredible India：Diwali 的多元觀察](https://www.incredibleindia.gov.in/en/festivals-and-events/diwali) 因此「五天文化節期」可寫，「五天全國公假」不可寫。

### 4.3 occurrences 衝突與現有 zh-TW block 的過度概括

1. 主 Diwali occurrence 的 2026-11-08 與官方日期一致；但 occurrence 的 source_urls 目前只有 Utsav，未直接帶 DoPT／India Post 的行政假日證據。若日後實作「是否放假」答案，應把 DoPT 或官方 India Post／Incredible India 日曆作為制度層級 source；本輪不改 occurrence。
2. repo 目前把 Dhanteras 2026 記為 11 月 6 日、Govardhan Puja 記為 11 月 9 日、Bhai Dooj 記為 11 月 10 日，且這三筆均 estimated。官方 Incredible India 的 Bhai Dooj 專頁與多份中央政府／政府機構 2026 日曆列 Bhai Dooj／Bhai Duj 為 **11 月 11 日星期三**；[Incredible India：Bhai Dooj 2026](https://www.incredibleindia.gov.in/en/festivals-and-events/bhai-dooj)；[PIB：Central Government Offices in Kerala 2026](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2187285&lang=2&reg=48)。因此現有 zh-TW summary 的「約從 11 月 6 日到 11 月 10 日」不能當作官方全印度日期範圍；需以地區曆法／行政清單重新決定，至少應保留 estimated 與來源差異。
3. 現有 summary 的「印度排燈節主日是 11 月 8 日」中，「主日」可能被理解成星期日；若後續修改，宜改成「主節日／主日（main Diwali）」並同時標出 11 月 8 日是星期日。
4. 現有 meta commonality 與 zh-TW summary 使用「印度的全國假日」；這把文化節期、中央政府假日及各邦／機構實際休假混成一層，應改為有範圍限定的行政描述。
5. 現有 customs IN diwali 把主日寫成家戶都祭拜 Ganesha 與 Lakshmi，並說幾個地點是節期「最具規模」的地方。官方來源支持 Lakshmi puja 是主日的重要傳統，也同時強調跨宗教與 regional variations；較安全的 country answer 是「主日常見 Lakshmi／Ganesha puja，但儀式、神祇、煙火與地方安排會因社群與地區而異」。2025 年列入 UNESCO 非物質文化遺產是文化認可，不是全國統一放假證據。
6. 同一 topic 的美國 diwali-school-holiday occurrence 是另一個 country block；2026 年 11 月 8 日本身是星期日，不能把紐約市公立學校的城市／學校安排帶入印度的假日答案。

**後續 country answer 的最小事實骨架：**

> India’s Diwali, also called Deepavali, follows Kartik Amavasya and changes date each year; the main Diwali in 2026 is 8 November. It is a five-day cultural and religious sequence, but that does not mean five nationwide public holidays. Diwali appears in the 2026 Central Government holiday list, while state, school, bank and employer arrangements can differ.

## 5. Batch C 最小交付規格

|頁面|首句應回答|法定／觀察界線|不可直接概括|
|---|---|---|---|
|/topic/long-holiday-weeks/tw/（ja）|台灣春節法律定五日；2026 政府行政機關連成 2/14–2/22 九日。|日曆適用政府行政機關；民間雇主、學校、輪班機關可能另依規則安排。|台灣所有人「只補假、永不補班」；所有公司都放 9 日。|
|/topic/elders-day/jp/（zh-TW）|正式名「敬老の日」，每年 9 月第三個星期一；2026 是 9/21。|全國性的国民の祝日；私人公司是否停業不由祝日法一律決定；9/15 的老人の日另計。|把敬老の日寫成老人の日；把每家公司、商店、學校都說成必然休假。|
|/topic/diwali/in/（zh-TW）|Diwali／Deepavali 依 Kartik Amavasya 變動；2026 主節日是 11/8。|五天是文化節期；行政假日要限定中央政府、州、機構或學校層級。|「印度全國五天公假」；把 11/6–11/10 當作無爭議的全印度日期。|

## 6. 資料日期、不確定性與來源層級

- 研究截點是 **2026-09-04 UTC**。官方年度日曆可能在之後更新，尤其是印度州／機構假日、學校行事曆與部分依曆法計算的節期日期。
- 台灣 2026 與 2027 的政府行政機關春節日曆已有 DGPA 公告；2028 occurrence 仍是法規推算／estimated，未有 2028 政府行政機關年度表可作為同等層級的 source。
- 日本敬老の日的第三個星期一是現行法律規則；2026／2027 已在內閣府年度表，2028 的 9 月 18 日是規則推算，完整年度表依內閣府說明要到 2027 年 2 月公布。另有「老人の日」與「老人週間」的獨立法律／行政觀察範圍。
- 印度 2026 主 Diwali 11 月 8 日已由官方觀光與政府假日資料交叉支持；但 Diwali 的行政休假不是一個可涵蓋所有邦、學校、銀行與私人雇主的單一全國清單。repo 的 Bhai Dooj 2026 occurrence 11 月 10 日與官方 11 月 11 日資料衝突，應在後續資料修訂前保持 estimated，不要把現有五天公曆範圍當成 confirmed。
- 來源使用原則：日期／法定名稱優先法律或主管機關；政府實際放假優先年度行政通知；文化節期優先印度觀光部、PIB 等官方文化來源。官方觀光頁的「official holiday」等概括性描述，不能取代 DoPT 對適用機關與州／機構差異的細分。
