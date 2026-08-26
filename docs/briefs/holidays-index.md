# 假日總表頁型:國家 × 年份(設計提案,2026-08-26;**未實作,等用戶核准**)

## 為什麼要有這一層

Bing 實測 `feriados 2027` @br 精準量 **14,940** —— 是本輪 br 市場量到第二大的字
(僅次於 `carnaval 2027` 的 38,488),而站上**沒有任何頁面能回答它**。
同型的字在其他市場也有量:`祝日 2027` @jp 351、`public holidays 2027` @us 116、
`libur nasional 2027` @id 9。(`法定节假日 2027` @cn 與 `bank holidays 2027` @in 是 0。)

這是站上唯一贏得下來的查詢形狀「專有名詞 + 年份」的另一個變種:**國名(隱含)+ 年份**。

## 草案怎麼說(已讀本體,不是引編號)

`/root/.claude/uploads/.../e4a71c35-global_topic_platform_full_spec.md`

- **草案裡沒有這一層。** §30 的 sitemap 只列 topics / posts / places / events;
  §44 Topic Page、§46 全球排行榜、§47 國家熱度、§54 前台首頁都不是這個東西。
- 最接近的鉤子是 **§57 搜尋系統**:它把 `Country` 列為搜尋結果的型別之一
  (`Topic / Post / Country / Place / Event`),但沒有定義 Country 頁長什麼樣。
- 所以這與 2026-08-26 新增逐國頁 `/topic/<slug>/<cc>/` 是**同一種性質:刻意偏離草案的新增**,
  需要用戶核准,不能自己加。

## 這一頁不能是「把 Topic 換個軸再列一次」

紅線:**同一批資料在同一頁出現兩次,就是階層沒分清楚。**

逐國頁是「一個 Topic 在一個國家」;假日總表是「一個國家在一年裡的所有法定假日,依日期排」。
軸不同 —— 但**只有在資料真的完整時才成立**。

⚠ **關鍵限制:站上的 Topic 覆蓋不等於一國的法定假日清單。**
以巴西 2027 為例,法定假日有 Confraternização Universal、Carnaval(ponto facultativo)、
Sexta-feira Santa、Tiradentes、Dia do Trabalho、Corpus Christi、Independência、
Nossa Senhora Aparecida、Finados、Proclamação da República、Consciência Negra、Natal。
本輪 13 個 Topic 上線後涵蓋度會大幅提高,但仍會缺 Independência、Aparecida 這類。

**一份宣稱是「假日清單」卻漏掉國慶日的頁面,比沒有這一頁更糟。**

## 提案:新增一份權威資料,不從 Topic 反推

新增 `content/national-holiday-calendars.json`:每個國家、每一年,一份**完整**的法定假日清單,
每一筆有名稱(七語)、日期、法律位置(法定假日/彈性放假/紀念日不放假)與來源。
七個國家各只需要一個權威年度來源,全部都存在且已知可用:

| 國 | 年度權威來源 |
|---|---|
| BR | `gov.br/gestao` 每年的 feriados e pontos facultativos 法令 |
| ID | Keppres(2024 年那份已驗:setkab.go.id) + 三部會 SKB 的 cuti bersama |
| CN | 國務院辦公廳《關於 YYYY 年部分節假日安排的通知》(gov.cn) |
| TW | 行政院人事行政總處年度辦公日曆表(dgpa.gov.tw) |
| JP | 内閣府「国民の祝日について」(cao.go.jp) + 前一年 2 月官報的暦要項 |
| US | OPM 聯邦假日頁(opm.gov,已驗可用) |
| IN | DoPT 年度假日清單(dopt.gov.in) |

Topic 只是**掛進去**:某一天若對應到站上的 Topic,那一列就連過去。沒對應的照樣列出來。
這樣資料是完整的,而 Topic 是加值,不是來源。

## 頁型

```
/holidays/<國碼小寫>/<年>/     例:br 站 /holidays/br/2027/、zh-TW 站 /holidays/id/2027/
/holidays/<國碼小寫>/          最近一年,canonical 指向當年那一頁
```

- 七站 × 七國 × 三年(2026/2027/2028)。與逐國頁同一種做法(`getStaticPaths` + 單一判準檔)。
- title 形狀照各市場實際查詢:pt-BR `Feriados 2027 no Brasil｜…`、
  zh-TW `2027 台灣國定假日｜…`、ja `2027年の祝日｜…`。
- **description 第一句要給答案**(照 2026-08-26 的紅線):幾天、哪幾天是連假、與去年差在哪。
- 版面:一張依日期排的表(日期／星期／名稱／法律位置／連到 Topic),不加熱度、不加討論室。
- 薄頁不產出的判準沿用 `country-cells.mjs` 的做法:某國某年資料不完整就不產那一頁。

## 待用戶決定

1. 這一層要不要做(它偏離草案)。
2. 做的話,要不要連 `content/national-holiday-calendars.json` 這份新權威資料一起做 ——
   **不做這份就只能從 Topic 反推,而那會產出不完整的假日清單**,我不建議。
3. 七站 × 七國全開,還是只開「本市場那一國」(需求實測集中在本國:`feriados 2027` 是巴西人問巴西)。
