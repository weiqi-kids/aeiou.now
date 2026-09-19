# SEO Research — Plan 2 Batch A（2026-09）

研究截點：2026-09-04 UTC。Plan 2 的工作清單基準日是 2026-09-03 UTC；本筆記只處理 Batch A 的兩個需求主題國：`zh-TW / ramadan-and-eid → Indonesia` 與 `en / childrens-day → India`。

研究階段只新增這份研究筆記，沒有修改 `content/topics`、`content/observance-occurrences.json`、`data` 或程式；研究結果完成後，再由主流程依最小答案規格實作。所有日期與制度判讀都以研究截點前查到的官方來源為準。

## 1. 既有 repo 內容與重複檢查

|需求|已存在的 topic／country block|現有資料狀態|本輪處理|
|---|---|---|---|
|`zh-TW / ramadan-and-eid → ID`|[`content/topics/ramadan-and-eid.md`](../../content/topics/ramadan-and-eid.md) 已有 `observance ID ramadan`、`observance ID eid-al-fitr`，以及 `locale zh-TW` 下的 `customs ID ramadan`、`customs ID eid-al-fitr`。|[`content/observance-occurrences.json`](../../content/observance-occurrences.json) 已有印尼 2026 日期（confirmed）與 2027 日期（estimated）。|不新增或重寫 country block；只整理官方證據及指出現有文字的精確化方向。|
|`en / childrens-day → IN`|[`content/topics/childrens-day.md`](../../content/topics/childrens-day.md) 已有 `observance IN childrens-day`（固定 `11-14`）與 `locale en` 下的 `customs IN childrens-day`。|印度 2026–2028 occurrences 都是固定 11 月 14 日、`confirmed`；現有 source 是 President of India。|不新增或重寫 country block；補充適合作為 country answer 的官方來源層級與假日範圍限制。|

兩頁的國家頁由現有 topic／observance／`customs` 資料生成；`content/topic-regional-notes.json` 沒有這兩個 target 的缺席說明（`childrens-day` 的現有印度 observance 不是 absence case）。因此實作時應在既有 locale block 上做小幅校正與 source 補強，不另造平行資料。

Plan 2 Batch A 的需求數字是：`ramadan-and-eid → Indonesia` 為 `128/128 impressions`，`childrens-day → India` 為 `64/71 impressions`；數字引用自 [`docs/seo-work-plans-next.md`](../seo-work-plans-next.md)。

## 2. `zh-TW / ramadan-and-eid → Indonesia`

### 2.1 日期規則：Ramadan 與 Eid 不是先寫死的公曆日期

1. 印尼現行官方規則以 `sidang isbat`（月相／曆法確認會議）決定 Ramadan、Syawal、Zulhijah 月初。宗教事務部（Kemenag）的 **PMA No. 1 Tahun 2026** 規定，在 29 Syakban、29 Ramadan、29 Zulkaidah 分別處理 Ramadan、Syawal、Zulhijah 的月初判定；判定綜合 `hisab`（天文計算）與 `rukyatulhilal`（新月觀測）。官方規則頁：[`PMA No. 1 Tahun 2026 — JDIH Kemenag`](https://jdih.kemenag.go.id/regulation/peraturan-menteri-agama-nomor-1-tahun-2026-tentang-penyelenggaraan-sidang-isbat)；法規 PDF：[`PMA 1/2026 PDF`](https://jdih.kemenag.go.id/yzxkthpo/regulation/peraturan-menteri-agama-1-2026_260427.pdf)。

2. PMA 1/2026 採用 MABIMS 的最低條件：topocentric hilal 高度至少 3°、geocentric elongation 至少 6.4°；若條件未達成，當月補足 30 日。這是「怎麼決定日期」的規則，不是可以提前多年確認的固定公曆日期。來源同上面的 [`PMA 1/2026 PDF`](https://jdih.kemenag.go.id/yzxkthpo/regulation/peraturan-menteri-agama-1-2026_260427.pdf)。

3. 2026 年可作為已核實範例：Kemenag 在 2026-02-17 的 sidang isbat 後宣布 1 Ramadan 1447 H 為 2026-02-19。官方公告：[`Pemerintah Tetapkan 1 Ramadan 1447 H Jatuh pada 19 Februari 2026`](https://kemenag.go.id/pers-rilis/pemerintah-tetapkan-1-ramadan-1447-h-jatuh-pada-19-februari-2026-ELDWq)。這個日期是 2026 年的政府確認，不應被改寫成每年的固定日期。

4. 同一制度也適用 1 Syawal（Eid al-Fitr 的第一天）。2026 年 Kemenag 宣布 1 Syawal 1447 H 為 2026-03-21；官方說明指出當次以觀測／計算結果採 istikmal（補足 Ramadan 30 日）。來源：[`Kemenag Sulsel：1 Syawal 1447 H jatuh pada 21 Maret 2026`](https://sulsel.kemenag.go.id/post/pemerintah-tetapkan-1-syawal-1447-h-jatuh-pada-21-maret-2026-kakanwil-kemenag-sulsel-sidang-isbat-jadi-rujukan-bersama)。

### 2.2 官方假期與 `cuti bersama` 必須分開寫

2026 年三部會 SKB 是最適合作為 country answer 的行政來源。它同時列出 `libur nasional`（國定／全國假日）與 `cuti bersama`（共同休假），並明確把 1 Ramadan、Idulfitri 等宗教日期的確認交由宗教事務部決定。來源：[`Sekretariat Negara：SKB 3 Menteri 2026`](https://www.setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2026)；可讀性較高的同一官方政策摘要：[`Kemenko PMK：17 hari libur nasional dan 8 hari cuti bersama 2026`](https://www.kemenkopmk.go.id/pemerintah-tetapkan-17-hari-libur-nasional-dan-8-hari-cuti-bersama-tahun-2026)。

|官方分類|2026 印尼日期|可回答的意思|來源|
|---|---|---|---|
|`libur nasional` — Hari Raya Idulfitri 1447 H|3 月 21–22 日|Eid 的兩天國定假日；這是官方假日安排，不等於提前固定了未來每年的 1 Syawal 公曆日。|[`SKB 3 Menteri 2026`](https://www.setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2026)|
|`cuti bersama` — Idulfitri|3 月 20 日、23 日、24 日|與週末相連的共同休假日，和兩天 `libur nasional` 是不同欄位；2026 年 SKB 所列 3 月 20–24 日合計是五個連續曆日。|[`SKB 3 Menteri 2026`](https://www.setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2026)|
|私營機構的 `cuti bersama`|由公司／機構主管依規定執行|不能把 SKB 的 `cuti bersama` 直接說成每一位私營員工都自動放假；官方 SKB 說私營機構由其領導安排，實施時一般依規定扣年度休假。|[`SKB 3 Menteri 2026`](https://www.setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2026)|
|ASN 的 `cuti bersama`|同樣為 3 月 20 日、23 日、24 日|ASN 另受 Keppres 42/2025 規範；該令明定共同休假不扣 ASN 年度休假，且未被給予共同休假者有相應補充規則。|[`Keppres 42/2025 PDF`](https://data-jdih.menpan.go.id/dokumen/2025keppres042.pdf)|

保守而重要的判讀：2026 SKB 的國定假日清單列有 Idulfitri，但沒有把整個 Ramadan 月列為 `libur nasional`；這是從官方清單反查出的範圍結論，不能延伸成「Ramadan 期間所有工作／學校都照常」或「所有人都沒有任何作息調整」。來源仍是 [`SKB 3 Menteri 2026`](https://www.setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2026)。國定宗教假日的法源背景也可對照 [`Keppres No. 8 Tahun 2024 — JDIH BPK`](https://peraturan.bpk.go.id/Details/276688/keppres-no-8-tahun-2024.html)。

### 2.3 當地叫法與 country-answer 用語

- 官方制度用語應保留 `Ramadan`、`awal Ramadan`／`1 Ramadan`、`1 Syawal`、`Hari Raya Idulfitri`、`sidang isbat`、`libur nasional`、`cuti bersama`。Kemenag 的 Ramadan 與 Syawal 公告可直接支持這組詞：[`2026 Ramadan 公告`](https://kemenag.go.id/pers-rilis/pemerintah-tetapkan-1-ramadan-1447-h-jatuh-pada-19-februari-2026-ELDWq)、[`2026 Syawal 公告`](https://sulsel.kemenag.go.id/post/pemerintah-tetapkan-1-syawal-1447-h-jatuh-pada-21-maret-2026-kakanwil-kemenag-sulsel-sidang-isbat-jadi-rujukan-bersama)。
- `Lebaran` 是 Idulfitri 的常見別稱；印尼政府教育資料的語言教材明列「Nama lain hari raya Idulfitri adalah Lebaran」。來源：[`Kemendikdasmen 官方語言教材 PDF`](https://repositori.kemendikdasmen.go.id/15934/1/Mari%20Berbahasa%20Indonesia%20-%20Antologi%20Bahan%20Siaran%20Bahasa%20Indonesia%20Bagi%20Penutur%20Asing%20Untuk%20Luar%20Negeri%20-%203.pdf)。
- 因此中文 country answer 可用「印尼的 Ramadan／Idulfitri（Lebaran）」；制度段落則保留原文 `sidang isbat` 與 `cuti bersama`，不要把 `Lebaran` 誤寫成另一個不同節日。

### 2.4 與現有 zh-TW block 的對照與實作結果

現有 block 已正確抓到兩個核心：Ramadan 初一要等 Kemenag 公告、Idulfitri 的宗教日期與行政連假不是同一件事。本輪只做以下精確化，不另造段落：

1. 把「1 Ramadan／1 Syawal 何時成立」與「SKB 排了哪些 `libur nasional`／`cuti bersama`」分成兩句；三部會提前排的是行政休假日，不是提前一年替下一年的月相日期做最終確認。
2. 現有文字的「將近一週連假」應改用年份及官方欄位說明。2026 SKB 實際列出的 Idulfitri 安排是 3 月 20 日、21–22 日、23–24 日；不要把未列在 SKB 的日期算進官方連假。
3. repo 目前把 2027 Ramadan／Eid occurrences 標為 `estimated`，這與日期規則相符；截至本研究截點，官方網域檢索未找到 2027 三部會 SKB，因此不能把 2027 的公曆日或放假日寫成已確認。應等 Kemenag 的 sidang isbat／公告與 2027 SKB 更新後再定稿。

**本輪採用的事實骨架：**

> 印尼的 Ramadan 初一與 1 Syawal 不是固定公曆日期；Kemenag 依 PMA 1/2026 透過 `sidang isbat`，綜合 `hisab` 與 `rukyatulhilal` 後公告。2026 年 1 Ramadan 是 2 月 19 日、1 Syawal 是 3 月 21 日。放假要另看行政安排：2026 年 Idulfitri 國定假日是 3 月 21–22 日，`cuti bersama` 是 3 月 20 日、23–24 日；私營機構與 ASN 的休假執行規則不同。

## 3. `en / childrens-day → India`

### 3.1 日期與當地叫法

1. 印度 Children's Day 的固定日期是每年 **11 月 14 日**。印度總統府官方頁面直接寫明：11 月 14 日是 `Chacha Nehru`（尼赫魯叔叔）的生日，並以此日慶祝 Children's Day。來源：[`President of India：14th November … celebrated as Children's Day`](https://www.presidentofindia.gov.in/dr-apj-abdul-kalam/children-corner/today-14th-november-birthday-chacha-nehru-celebrated-childrens)。

2. 印度政府 PIB 的官方資料使用 `Bal Diwas`，並把 11 月 14 日描述為第一任總理 Pandit Jawaharlal Nehru 的生日紀念日。來源：[`PIB：Children’s Day / Bal Diwas`](https://www.pib.gov.in/newsite/erelcontent.aspx?relid=69154)。

3. 因此適合 country answer 的原文組合是 **Children’s Day（बाल दिवस，Bal Diwas）**；`Chacha Nehru` 可作當地稱呼與背景，不要把它當成另一個日期。Hindi 官方學校資料也把 11 月 14 日的活動直接稱為 `बाल दिवस`：[`Kendriya Vidyalaya Sangathan：14 November school activity`](https://roagra.kvs.gov.in/%E0%A4%96%E0%A5%87%E0%A4%B2/)。

### 3.2 法定假日、學校活動與文化觀察的界線

- **可確認的最窄假日結論：** 14 November／Children’s Day 沒有列入印度 DoPT 發布的 **2026 Central Government Offices** gazetted holiday list。這支持「不是中央政府統一的 gazetted day off」，但不應擴大成「每一所學校、每一州、每個雇主都必定開門」。官方原始 PDF：[`DoPT：Holidays to be observed in Central Government Offices during 2026`](https://dopt.gov.in/sites/default/files/Holidays%20to%20be%20observed%20in%20Central%20Government%20Offices%20during%20the%20year%202026.pdf)；政府機關保留副本：[`NHAI：List of holidays 2026`](https://nhai.gov.in/assets/pdf/List_of_holidays-2026.pdf)。

- **學校／文化觀察是有官方證據的：** KVS（教育部轄下自治機構）的官方頁面記錄，學校每年 11 月 14 日為小學生舉辦以 `बाल दिवस` 名義的 mini sports meet；NITI Aayog 的 Atal Innovation Mission 也記錄 2022-11-14 有 5,000 所 ATL schools、約 150,000 名學生參與 Children's Day 活動。來源：[`KVS school activity`](https://roagra.kvs.gov.in/%E0%A4%96%E0%A5%87%E0%A4%B2/)、[`Atal Innovation Mission：Children’s Day event`](https://aim.gov.in/events.php)。

- **不要混淆 11 月 20 日：** PIB 的官方資料把 India 的 Children’s Day（11 月 14 日）與 International Child Rights Day（11 月 20 日）分開列出。來源：[`PIB：Children’s Day and International Child Rights Day`](https://www.pib.gov.in/PressReleasePage.aspx?PRID=1509088&lang=2&reg=48)。

### 3.3 與現有 en block 的對照與實作結果

現有 `en` block 已有正確日期、Nehru／`Chacha Nehru` 背景，也已寫到學校表演與競賽。需要注意的是，原本「It is not a day off」比官方證據能支持的範圍更絕對；本輪已改成以下界線：

> India observes Children’s Day on 14 November, known locally as `Bal Diwas`, marking Jawaharlal Nehru’s birthday. It is primarily a school and cultural observance, and it is not listed in the 2026 Central Government Offices gazetted holiday list; an individual school or local calendar may make a different operational choice.

這樣既回答「日期／叫法／是否放假」，又不把中央政府辦公室清單誤當成所有學校的統一課表。現有 `observance IN childrens-day` 的固定 `11-14` 已足以表達日期規則；不需要另加一個印度 regional note。

## 4. 本輪採用的最小答案規格

|頁面|首要回答|必須保留的官方詞|應避免的過度說法|
|---|---|---|---|
|`/topic/ramadan-and-eid/id/`（zh-TW）|先說 1 Ramadan／1 Syawal 由 sidang isbat 確認，再列 `libur nasional` 與 `cuti bersama` 的差異。|`sidang isbat`、`hisab`、`rukyatulhilal`、`Idulfitri`、`Lebaran`、`cuti bersama`。|把預估公曆日期當成官方確認；把行政連假當成宗教日期本身；把 Ramadan 整月寫成全國放假。|
|`/topic/childrens-day/in/`（en）|先說 14 November／Bal Diwas，再說這是學校／文化觀察，而非中央政府統一 gazetted holiday。|`Children’s Day`、`बाल दिवस`／`Bal Diwas`、`Chacha Nehru`。|說成印度每所學校都放假或都不放假；把 20 November International Child Rights Day 當成印度 Children's Day。|

## 5. 資料日期與不確定性

- 研究資料日期：2026-09-04 UTC；2026 的印尼官方假期與 2026 的印度中央政府假期清單是已查到的年度文件。
- 印尼的跨年核心規則是穩定的 PMA／sidang isbat 制度，但每年最終 1 Ramadan、1 Syawal 仍要等當年官方公告。repo 中 2027 的印尼 occurrences 目前是 `estimated`；本筆記不把它升級成 confirmed。
- 印尼 2027 三部會 `SKB` 在本次官方網域檢索中尚未找到；未來 country answer 若顯示 2027 放假日，必須以新 SKB 更新。
- 印度 11 月 14 日的日期規則有多個官方來源支持；假日判讀則受 DoPT 文件範圍限制。能確定的是「不在 2026 中央政府辦公室 gazetted holiday list」，不能由此斷言所有州、學校或私人機構的實際安排。

## 6. 本輪實作與驗證

主流程依上述規格修改了兩個來源檔：

- `content/topics/ramadan-and-eid.md` 的 `zh-TW` 印尼 block：補上 2027 仍屬估計、2026 `libur nasional` 與 `cuti bersama` 的日期分欄，以及私營機構執行範圍；保留 `Idulfitri`／`Lebaran`、`sidang isbat` 與月相確認的在地用語。
- `content/topics/childrens-day.md` 的印度 observance source 與 `en` block：加入 DoPT 2026 Central Government Offices 假期表，將 `Bal Diwas` 與「中央 gazetted holiday 清單」的範圍寫清楚，不再把所有學校或地方日曆一概而論。

`import-topics.mjs`、`export-data.mjs`、資料完整性、內容厚度、內容守門與 `git diff --check` 均通過。`LOCALE=zh-TW pnpm build`（552 頁）與 `LOCALE=en pnpm build`（571 頁）均通過 SEO／GEO／AEO、sitemap、內鏈、rendered depth 與 local scope；兩個 Topic root 仍各自連到 `/id/` country page。本批只完成 working tree，本輪未發布。
