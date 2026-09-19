# 上游開源假日函式庫：可貢獻的缺口清單（2026-09-19）

> **這份是給人送出去的工作清單，不是程式讀的。**
> 目的：這個站外部反向連結是 0，而拿到第一條最可信的方式不是寫信要連結，
> 是把我們有官方來源、上游缺漏或寫錯的資料以 PR／issue 回饋出去——署名與引用是被接受之後的自然結果。
> 🔴 **絕對不要在 PR／issue 裡提我們自己的網站、放我方網域、或開口要連結。**
> 那會被當成 SEO spam 退件，而且會讓底下每一則真材實料的缺口一起被貼標籤。

產生方式：七國各自盤點（我方 `content/national-holiday-calendars.json` vs 上游原始碼），
每個候選缺口再逐一回官方來源對抗式複核（預設立場「不成立」）。
74 個候選 → **40 個通過複核** → 收斂成下面 19 則。

## 總結

有，而且份量不小：18 則通過複核、全部有官方網域來源撐腰的缺口，分佈在 date-holidays（15 則）與 python-holidays（3 則）。品質最高的一批是印尼與中國——單一政府 PDF／公報就撐得起全部主張，而且上游自己已經接受過一模一樣的修法（date-holidays #555 的 disable/enable、spec 明載的 active 機制）。台灣那組最厚（2025 年《紀念日及節日實施條例》讓上游整批資料過時），但要接在既有 open issue #490 底下走 PR，不能另開新 issue。日本、美國是「歷史生效日界線」型的乾淨修正。印度是最大的覆蓋缺口（中央 17 個 gazetted 假日缺 12 個），但只能先開 issue 問結構，不可直接送資料——維護者在 #137 已公開徵求，但我方手上只有 2026 一年是 confirmed。巴西兩則偏小但乾淨。建議的出手順序是先送印尼 names.yaml 那一行（半天工作、零爭議）建立信用，再推印尼日期與中國法定天數，台灣三則合成一個 PR 系列。整批預估總工時約兩到三週；若只做前五則約四到五天，那五則的合併機率最高。

## 建議出手順序

先送第 1 則（印尼 names.yaml 一行、半天、零爭議）建立信用，再推第 2、3 則。台灣三則合成一個 PR 系列。
前五則約四到五天，合併機率最高。

### 1. ID: `27 Rajab` carries the Maulid name in Indonesian, colliding with `12 Rabi al-awwal`

- **上游**：date-holidays (commenthol/date-holidays) — PR against data/names.yaml
- **工作量**：低 — 一行改動，加更新受影響的 fixtures。半天內可送。
- **為什麼會被收**：單一字串、兩個官方 PDF 逐字對得上、同一筆的 en/ar/ms 都是對的，維護者不需要判斷任何曆法問題就能看出是筆誤。最沒有爭議的第一次接觸。

<details><summary>可直接貼出的內文（英文）</summary>

```markdown
Hi — we maintain a set of national holiday tables for seven countries, each cell transcribed from the issuing government's own announcement, and we cross-check them against this library. One small Indonesian naming issue came up.

In `data/names.yaml`, the `id:` string for `27 Rajab` is `Maulid Nabi Muhammad`, which is byte-for-byte the same as the `id:` string for `12 Rabi al-awwal`. Because `data/countries/ID.yaml` declares `langs: [id]` and refers to the rule as `_name: 27 Rajab`, both holidays print under the same Indonesian name. Running the published `date-holidays@3.36.1` for ID, these five days all come out as "Maulid Nabi Muhammad": 2026-01-16, 2027-01-05, 2027-12-25 (the `27 Rajab` rule) and 2026-08-25, 2027-08-14 (the `12 Rabi al-awwal` rule). The `en` (`Laylat al-Mi'raj`), `ar` and `ms` (`Israk dan Mikraj`) strings on the same entry are all correct, so this looks like a single-string slip rather than an intentional choice.

The Indonesian government names the two days separately in the joint ministerial decree (SKB 3 Menteri) that fixes the national holiday calendar:

- 2026 decree, Lampiran A item 2 (16 Januari) "Isra Mikraj Nabi Muhammad S.A.W." and item 15 (25 Agustus) "Maulid Nabi Muhammad S.A.W.": https://www.kemenkopmk.go.id/sites/default/files/pengumuman/2025-09/SKB%20Libur%20Nasional%20dan%20Cuti%20Bersama%20Tahun%202026.pdf
- 2027 decree (No. 1205/3/2 Tahun 2026), Lampiran A items 2 and 17 "Isra Mikraj Nabi Muhammad S.A.W.", item 14 "Maulid Nabi Muhammad S.A.W.": https://www.kemenkopmk.go.id/sites/default/files/pengumuman/2026-09/SKB%20Libur%20Nasional%20dan%20Cuti%20Bersama%20Tahun%202027.pdf

(Both PDFs are scans, so the wording is in the page images rather than a text layer.)

Suggested one-line change: `id: Isra Mikraj Nabi Muhammad S.A.W.` on the `27 Rajab` entry. Happy to open the PR if that looks right.

Separately, the computed dates for a few Indonesian Islamic holidays differ from the same decrees by one day — that's a different problem and we'll raise it on its own rather than mixing it in here.
```

</details>

### 2. ID: four 2026/2027 Islamic holidays land one day before the dates in the official SKB

- **上游**：date-holidays — PR against data/countries/ID.yaml
- **工作量**：中 — 五組 disable/enable，加重新產生 ID fixtures。一到兩天。
- **為什麼會被收**：上游自己在 #555 接受過一模一樣的修法，同一個檔案裡就有現成前例；來源是政府 PDF 不是聚合站，而且我方主動聲明 README 的觀月免責條款，不是去指控演算法錯。

<details><summary>可直接貼出的內文（英文）</summary>

```markdown
Following on from the naming fix — we keep Indonesian holiday dates transcribed from the joint ministerial decrees (SKB 3 Menteri) published by Kemenko PMK, and four dates produced by `date-holidays@3.36.1` sit one day before the decree.

| holiday | library output (3.36.1) | SKB |
|---|---|---|
| Idul Fitri 1447 H | 2026-03-20, 2026-03-21 | 21–22 Maret 2026 (Lampiran A item 5) |
| Idul Fitri 1448 H | 2027-03-09, 2027-03-10 | 10–11 Maret 2027 (Lampiran A item 5) |
| Idul Adha 1448 H | 2027-05-16 | 17 Mei 2027, Senin (Lampiran A item 10) |
| Maulid Nabi Muhammad S.A.W. | 2027-08-14 | 15 Agustus 2027, Minggu (Lampiran A item 14) |
| Isra Mikraj 1449 H | 2027-12-25 (collides with Natal) | 26 Desember 2027, Minggu (Lampiran A item 17) |

Sources (official, Kemenko PMK):
- 2026: https://www.kemenkopmk.go.id/sites/default/files/pengumuman/2025-09/SKB%20Libur%20Nasional%20dan%20Cuti%20Bersama%20Tahun%202026.pdf
- 2027 (SKB No. 1205 Tahun 2026 / No. 3 Tahun 2026 / No. 2 Tahun 2026, signed 2026-09-15): https://www.kemenkopmk.go.id/sites/default/files/pengumuman/2026-09/SKB%20Libur%20Nasional%20dan%20Cuti%20Bersama%20Tahun%202027.pdf

We understand the README's caveat that Islamic dates depend on moon sighting, so this isn't "the arithmetic is wrong" — Indonesia fixes these by government decree (and for Idul Fitri/Idul Adha by the Religious Affairs Minister's sidang isbat), which arithmetic conversion can't track. The pattern we'd follow is the one already in `ID.yaml` for `12 Rabi al-awwal` (`disable: 2025-09-04` / `enable: 2025-09-05`), added via #555 for exactly this situation.

Two caveats we'd rather state up front than have you find:
- The SKB's Diktum KEDUA reserves the final 1 Ramadan / Idul Fitri / Idul Adha dates for a separate ministerial decree, so those two are decree-scheduled rather than immovable. Isra Mikraj and Maulid are not covered by that reservation. If you'd prefer to pin only the unreserved ones first, that's fine by us.
- For Idul Fitri 1447 H the astronomy agrees with the decree independently: the Shawwal conjunction is 2026-03-19 01:23 UTC, leaving roughly 4.9° elongation at sunset on 29 Ramadan — below the MABIMS 6.4° criterion, so 1 Syawal necessarily falls on 3/21.

We've excluded the *cuti bersama* (collective leave) rows from all of the above — those are civil-service leave days, not the national holidays this library models.
```

</details>

### 3. CN: State Council Decree 795 (in force 2025-01-01) added a 4th Spring Festival day and a 2nd Labour Day

- **上游**：date-holidays — PR against data/countries/CN.yaml
- **工作量**：中 — 兩個條目加 active，重產 CN fixtures。一天。
- **為什麼會被收**：單一 gov.cn 公報 URL 就撐得起全部主張（實測 200、正文逐字），上游自己的 fixture 就是反證，而且修法用的是 spec 明載的 active 機制，不動任何既有年度。

<details><summary>可直接貼出的內文（英文）</summary>

```markdown
We keep Chinese holiday data transcribed from the State Council Gazette. The statutory day counts changed with State Council Decree No. 795 (published 2024-11-10, in force 2025-01-01), and `CN.yaml` still reflects the pre-2025 text.

The decree amends 《全国年节及纪念日放假办法》 Article 2:
- 「（二）春节，放假4天（农历除夕、正月初一至初三）」 — four days: Lunar New Year's Eve through the 3rd day of the first month. `CN.yaml` has `chinese 01-0-00`, `01-0-01`, `01-0-02` but no `01-0-03`.
- 「（四）劳动节，放假2天（5月1日、2日）」 — two days. `CN.yaml` has only `05-01`.

Official source (State Council Gazette): https://www.gov.cn/gongbao/2024/issue_11726/202411/content_6989774.html

Your own `test/fixtures/CN-2026.json` shows the effect: 2026 has no 2026-02-19 and no 2026-05-02.

Since the change has a clear commencement date, the least invasive fix looks like adding the two entries with `active: - from: '2025-01-01'`, which leaves the 2015–2024 fixtures untouched. Fixtures would need regenerating either way.

Scope note so this doesn't sprawl: we're only claiming the statutory day counts here, which Decree 795 supports on its own. China's year-by-year 调休 (the 9-day Spring Festival block, the swapped working Saturdays) comes from a separate State Council General Office circular each year and can't be derived by rule; whether to resume the per-year hardcoding this file used up to 2021 is your call, and we'd raise that separately rather than bundle it.

We have not cited the pre-2014 wording anywhere above — that would need Decree No. 644, whose official page we could not retrieve, so we've left that claim out entirely.
```

</details>

### 4. TW: three days became public holidays on 2025-05-28 and are still typed `observance`

- **上游**：date-holidays — PR on data/countries/TW.yaml, posted under existing open issue #490
- **工作量**：中高 — 四筆改 active 雙條目＋補 substitute＋naming，重產 TW-2024..2029 fixtures。二到三天。
- **為什麼會被收**：#490 已 open 且維護者明講歡迎 PR；法條有明確生效日、修法用上游既有的 active 機制、不動任何舊年度；python-holidays 已依同一道公布令改過，是強力的第三方佐證。

<details><summary>可直接貼出的內文（英文）</summary>

```markdown
(Posting under #490 rather than opening a new issue, since that thread is already about Taiwan and a 2025-06-14 comment there mentions the government adding holidays.)

We maintain Taiwan holiday data transcribed from the statute and the DGPA official calendars. `TW.yaml` was last touched in 2021 and predates the 紀念日及節日實施條例 (Act on Implementation of Memorial Days and Holidays), promulgated by Presidential Order 華總一義字第11400053171號 on 2025-05-28 and effective on promulgation (Art. 10). Four entries are now out of date:

- `09-28` 孔子誕辰紀念日／教師節 — Art. 3(14) + Art. 4(3), and Art. 5(22) + Art. 6(2) for 教師節: a full public holiday. Currently `type: observance`.
- `10-25` — Art. 3(17) renames it 臺灣光復暨金門古寧頭大捷紀念日 and Art. 4(5) makes it a public holiday. Currently `type: observance` under the old name 臺灣光復節.
- `12-25` 行憲紀念日 — Art. 3(19) + Art. 4(6): a public holiday. Currently `type: observance`.
- `05-01` 勞動節 — Art. 6 makes it a general day off; currently `type: observance` with `note: private sector`.

Art. 8 also provides that when such a day falls on a weekly rest day, a substitute day is granted; the specific substitute date is announced by the DGPA each year. Two concrete ones: 2026-10-25 is a Sunday, substituted on 2026-10-26; 2027-12-25 is a Saturday, substituted on 2027-12-24.

One thing that matters for the patch shape: these should **not** simply be flipped to `public`, because 2001–2024 would then become wrong — none of them was a day off under the old regulation. The correct boundary is `active: - from: '2025-05-28'`, keeping the existing `observance` entries with a matching `to:`. That is the same mechanism the file already uses elsewhere (and US.yaml uses for Columbus → Indigenous Peoples' Day).

Sources:
- Promulgation page with the full ten articles: https://law.moj.gov.tw/News/newsdetail.aspx?msgid=191745
- Consolidated text: https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0020095

Independent cross-check: python-holidays has already implemented the same change for these days from 2025 (and Labour Day from 2026), citing the same Presidential Order.

A small naming point in the same file while we're here: the `03-12` entry pairs `en: Arbor Day` with `zh: 國父逝世紀念日`, which are two different observances that share the date — Art. 3(3) lists 國父逝世紀念日 as a memorial day and Art. 5(6) lists 植樹節 as a festival, neither a day off. Following the file's own convention for shared dates (`01-01` is `中華民國開國紀念日 / 元旦`, `10-10` is `國慶日 / 雙十節`), `en: Sun Yat-sen Memorial Day / Arbor Day`, `zh: 國父逝世紀念日 / 植樹節` would fix it without splitting the key.

We have two more Taiwan findings (weekend-substitution branches, and the Lunar New Year range) that we'll post as siblings — happy to squash all three into one PR if you'd rather review them together.
```

</details>

### 5. IN: Govardhan Puja 2026 is 2026-11-09 in the government's Restricted Holidays list, not 11-10

- **上游**：python-holidays (vacanza/holidays) — PR against holidays/calendars/hindu.py
- **工作量**：低 — 一個表格值＋測試。若要處理各邦連動則中等。
- **為什麼會被收**：python-holidays 活躍、對「政府公告 vs 現值」的逐日修正接受度高；一個字元的改動、兩份 .gov.in 來源、鄰近值都已相符，落單性一眼可見。

<details><summary>可直接貼出的內文（英文）</summary>

```markdown
We keep national holiday tables transcribed from each country's own announcements, and one Indian date differs from this library.

`GOVARDHAN_PUJA_DATES` in `holidays/calendars/hindu.py` has `2026: (NOV, 10)`. The Government of India's 2026 Restricted Holidays list gives 9 November (Monday):

- https://cag.gov.in/defence/new-delhi/en/page-defence-new-delhi-holidaylist — "List of Restricted Holidays during the year 2026", item 29: Govardhan Puja / November 09 / Monday
- https://cag.gov.in/uploads/media/List-of-Gazetted-Holidays-and-Restricted-Holidays-2026-069492ddf80fa39-36385303.pdf — item 25: Govardhan Puja / 09th November / Monday

The surrounding entries in the same list (Naraka Chaturdashi 11-08, Chhath 11-15) already match this library, and 2024 (11-02) and 2025 (10-22) match as well, so 2026 looks like a single outlier. The current table cites a timeanddate.com archive rather than a government page.

The value reaches `India(categories=OPTIONAL)` through `_add_govardhan_puja` in `holidays/countries/india.py`. Heads-up on blast radius: the same constant also drives Maharashtra's "Diwali (Bali Pratipada)", Haryana/Punjab "Vishwakarma Day", the MP government list and the DH/MP/UP/RJ optional lists, so a change moves those too. We could only verify the central government list — Maharashtra's 2026 circular is a scanned PDF with no text layer — so we'd want your read on whether the state entries should track the same constant.

We're claiming 2026 only; we hold no authoritative 2027/2028 announcement for this day.
```

</details>

### 6. TW: substitution rules only handle Sunday, so the 2026 Saturday substitutes are missing

- **上游**：date-holidays — PR on data/countries/TW.yaml, sibling of the #490 post above
- **工作量**：中 — 六條規則補星期六分支＋補假順延邏輯（後者可能要上游改 parser），重產 fixtures。二天，其中順延那半有不確定性。
- **為什麼會被收**：可重現：裝 3.36.1 跑一次就看得到少三天、看得到兩個 public 疊在 2027-04-05；而且同一個檔案自己在 01-01/05-01 已經寫了星期六分支，是自家不一致而非設計取捨。

<details><summary>可直接貼出的內文（英文）</summary>

```markdown
Second Taiwan finding, same file. Taiwan grants a substitute day when a public holiday falls on either weekend day: on a Saturday the preceding working day, on a Sunday the following one (Act Art. 8; the specific dates are set by the DGPA's annual government office calendar).

In `TW.yaml`, three rules only carry the Sunday branch:
- `02-28 and if Sunday then next Monday` (Peace Memorial Day)
- `04-04 and if Sunday then next Monday` (Children's Day)
- `10-10 and if Sunday then next Monday` (National Day)

All three fall on a Saturday in 2026, and running `date-holidays@3.36.1` for TW 2026 produces none of the official substitutes 2026-02-27, 2026-04-03, 2026-10-09. The same file *does* carry `if Saturday then previous Friday` on `01-01` and `05-01`, so this reads as an internal inconsistency rather than a modelling choice; `substitute: true` only affects the name per the spec, so nothing else covers it. Qingming, Dragon Boat and Mid-Autumn have the same one-sided rule — they simply don't hit a Saturday in 2026 — and would be worth fixing in the same pass.

A second, independent bug in the Children's Day rule: in 2027, 04-04 is a Sunday, so the rule moves the substitute to 04-05 — but 04-05 is already Qingming that year (confirmed by the Central Weather Administration's 2027 calendar table, https://www.cwa.gov.tw/Data/astronomy/2027cal.pdf). `date-holidays@3.36.1` therefore emits two public holidays on 2027-04-05 and the year ends up one day short. The DGPA's 2027 calendar puts the substitute on 2027-04-06 (Tuesday). The general rule is that a substitute lands on the next *working* day, not merely the next day.

Sources:
- Statutory basis for substitution: https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0020095 (Art. 8)
- DGPA government office calendars (authoritative for the specific substitute dates): https://www.dgpa.gov.tw/information?uid=2&pid=12574 (2026) and https://www.dgpa.gov.tw/information?uid=82&pid=12983 (2027)

Cross-check: python-holidays computes 2026-02-27, 2026-04-03 and 2026-10-09 for Taiwan, matching the official calendar.

Note on sources: law.moj.gov.tw and dgpa.gov.tw both disallow crawling in robots.txt, so we cite them for readers rather than having fetched them; the statute text was verified through an archived copy of the promulgation page.
```

</details>

### 7. TW: the Lunar New Year block starts a day too late from 2026 (the statute counts from the day before New Year's Eve)

- **上游**：date-holidays — PR on data/countries/TW.yaml, sibling of the #490 post above
- **工作量**：中高 — 改整組區間規則＋補 substitute，重產多年 fixtures；是三則 TW 裡最容易產生回歸的一則。
- **為什麼會被收**：條文逐字給出區間定義，兩年的官方行事曆逐日對得上，而且我方主動指出上游那條被誤認為替代日的規則其實是常數偏移——顯示我們真的跑過而不是讀了 YAML 就下結論。

<details><summary>可直接貼出的內文（英文）</summary>

```markdown
Third Taiwan finding, same file, and the one with the largest effect on output.

The 2025 Act (紀念日及節日實施條例) Art. 6(1)(1) defines the Lunar New Year break as running 「自農曆十二月末日之前一日至翌年一月三日，放假五日」 — five days, starting the day *before* Lunar New Year's Eve and ending on the 3rd day of the first month. `TW.yaml` currently starts at `chinese 01-0-00` (New Year's Eve) and includes `chinese 01-0-04`, i.e. the same five-day length shifted one day later, plus an entry that resolves to the 5th day.

Running `date-holidays@3.36.1`:
- 2026: emits 02-16 … 02-21. The statutory block is 02-15 … 02-19, plus 02-20 as the Art. 8 substitute (02-15 is a Sunday). So 02-15 is missing. 2026-02-21 is not wrong in the sense of "people work that day" — it is a Saturday inside the 9-day block the DGPA announced — but it is a weekly rest day, not an Art. 6 holiday.
- 2027: emits 02-05 … 02-10. The statutory block is 02-04 … 02-08 plus substitutes on 02-09 and 02-10, matching the DGPA's "7 days". So 02-04 is missing, and 02-09/02-10 carry the wrong names (4th/5th day of the first month rather than substitute days).

One correction to something we nearly wrote and checked first: the `chinese 01-0-01 if Monday then next Friday …` entry is **not** a substitution rule. Evaluated over 2023–2030 it resolves to the 5th day of the first month every year regardless of weekday — it's a constant offset written in an unusual way. Worth knowing before touching it.

Also worth noting: none of the Lunar New Year entries has `substitute: true`, while every other Taiwanese holiday in the file does. In 2026 and 2027 the substitute dates happen to coincide with the 4th/5th-day entries, which hides the problem; in a year without that weekend overlap the whole block would shift.

Sources:
- Act Art. 6(1)(1) and Art. 8: https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0020095 ; promulgation page with the full text: https://law.moj.gov.tw/News/newsdetail.aspx?msgid=191745
- DGPA calendars: https://www.dgpa.gov.tw/information?uid=2&pid=12574 (2026), https://www.dgpa.gov.tw/information?uid=82&pid=12983 (2027, which states the 2/6–2/7 weekend is substituted on 2/9–2/10)
- Lunar dates, freely fetchable: https://www.cwa.gov.tw/Data/astronomy/2026cal.pdf and .../2027cal.pdf

Independent cross-check: python-holidays adds the day before New Year's Eve for Taiwan from 2026, citing the same Presidential Order.

Scope: we're claiming 2026 and 2027 only. Our 2028 Lunar New Year cells are our own projection, not a government announcement, so we're leaving 2028 out.
```

</details>

### 8. JP: 国民の休日 is hard-coded to one September combination and misses 2032/2049

- **上游**：date-holidays — new issue (no patch) on data/countries/JP.yaml
- **工作量**：低 — 只開 issue，附重現步驟與已試過的失敗修法。半天。
- **為什麼會被收**：附了可執行的重現、兩個 library 的對照、以及「我們試過的一行修法會讓你們 stack overflow」——是幫維護者省時間而不是丟工作給他；而且不裝懂 parser。

<details><summary>可直接貼出的內文（英文）</summary>

```markdown
We track Japanese holidays against the Holiday Act and the Cabinet Office's published list. One rule in `JP.yaml` looks too narrow, though the first year it actually bites is still ahead of us.

Article 3(3) of 国民の祝日に関する法律 (Act No. 178 of 1948) makes any weekday that is sandwiched between two 国民の祝日 a holiday — a general rule with no dates in it:

> その前日及び翌日が『国民の祝日』である日（『国民の祝日』でない日に限る。）は、休日とする。

`JP.yaml` expresses the September case as `09-22 if 09-21 and 09-23 is public holiday`, which only covers the combination 敬老の日 = 9/21 and 秋分の日 = 9/23. When the autumnal equinox falls on 9/22 (a Wednesday), 敬老の日 (3rd Monday of September) is 9/20 and the sandwiched day is **9/21**, which that rule cannot produce.

The National Astronomical Observatory's published table (which covers 2020–2050) gives the equinox as 9月22日(水) for 2032 and for 2049. Running `date-holidays@3.36.1`, September 2032 and September 2049 contain only 9/20 and 9/22 — no 9/21. (2060 shows the same shape, but that year rests on your own equinox computation rather than the NAOJ table, so we mention it only as a pointer.) python-holidays produces 9/21 in those years using a generic "is the day two ahead also a holiday" test.

This is a gap that hasn't fired yet rather than past wrong output: the September sandwich only became possible once 敬老の日 moved to the 3rd Monday in 2003, and no year from 2003 to 2031 hits it.

Sources:
- Act text, Art. 2 and Art. 3(3): https://laws.e-gov.go.jp/law/323AC1000000178 (the page is a JS app; the full text is reachable via the e-Gov API at /api/1/lawdata/323AC1000000178)
- Cabinet Office, incl. worked examples of the Art. 3(3) holiday: https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html

We are deliberately **not** proposing a patch, because the obvious one breaks. We tried adding `09-21 if 09-20 and 09-22 is public holiday` alongside the existing rule: 2026 still resolves, but 2032 throws `RangeError: Maximum call stack size exceeded` — `PostRule.bridge` recurses, since 09-21 needs to know whether 09-22 is a holiday while 09-22's rule asks back about 09-21. Replacing rather than adding fixes 2032/2049 but drops the correct 2026-09-22. A generic bridge rule seems like the right shape, but that's your call.

We did not find an existing issue covering this.
```

</details>

### 9. JP: 元日 / 憲法記念日 / こどもの日 have no commencement boundary, so they appear before the 1948 Act

- **上游**：date-holidays — PR against data/countries/JP.yaml
- **工作量**：低到中 — 三行 active，重產 JP fixtures。一天。
- **為什麼會被收**：同一個檔案裡同一部法設立的六個祝日都已經寫了 from: 1948-07-20，獨漏三個——內部不一致最難反駁；而且我方預先堵掉「元日自古就放假」這個唯一的反駁角度。

<details><summary>可直接貼出的內文（英文）</summary>

```markdown
A small historical-correctness gap in `JP.yaml`. 国民の祝日に関する法律 (Act No. 178 of 1948) was promulgated on 1948-07-20 and, per its Supplementary Provision 1, took effect on the day of promulgation:

> この法律は、公布の日からこれを施行する。

The promulgation date is confirmed by the official e-Gov law API — `/api/1/lawdata/323AC1000000178` returns `Era="Showa" Num="178" Year="23" PromulgateMonth="07" PromulgateDay="20"`, and the v2 JSON gives `"promulgation_date":"1948-07-20"`. Human-readable page: https://laws.e-gov.go.jp/law/323AC1000000178

Six holidays created by that same Act already carry `from: 1948-07-20` in this file — 成人の日, 天皇誕生日 (04-29), 春分の日, 秋分の日, 文化の日, 勤労感謝の日. Three do not: `01-01` 元日, `05-03` 憲法記念日, `05-05` こどもの日. As a result `getHolidays(1947)` and `getHolidays(1948)` both return those three as public holidays in `date-holidays@3.36.1`, for years in which the Act did not yet exist.

One likely objection, worth answering in advance: 元日 was not a statutory day off before this Act either. The Act's Supplementary Provision 2 repealed 昭和2年勅令第25号 (休日ニ關スル件), and that ordinance's list does not include 1 January — it lists 元始祭 (1/3), 新年宴會 (1/5), 紀元節, 神武天皇祭, 天長節, 神嘗祭, 明治節, 新嘗祭, 大正天皇祭 and the two 皇靈祭. 四方拝 was a court ceremony, not a legal day off.

Since the commencement date falls mid-year, all three dates had already passed in 1948, so `from: 1948-07-20` and `from: 1949-01-01` produce identical output; we'd suggest the former purely to match the six entries already in the file.

We searched open and closed issues for Japan/1948 and found nothing covering this.
```

</details>

### 10. US: the 5 U.S.C. §6103 Monday-holiday changes have no commencement gates

- **上游**：date-holidays — issue or PR against data/countries/US.yaml
- **工作量**：中 — 四條規則加閘門，需重產大量歷史 fixtures（回溯到 1970 以前）。二天。
- **為什麼會被收**：一頁 govinfo 就支撐全部四項，該 repo 已有 216 處 from: 年份閘門（低到 1892）所以歷史正確性明顯在範圍內，且 python-holidays 的 1971 界線是獨立佐證。

<details><summary>可直接貼出的內文（英文）</summary>

```markdown
We cross-check US federal holidays against 5 U.S.C. §6103 and its amendment notes. Several rules in `US.yaml` are written as if they had always existed.

- `2nd monday in October` (Columbus Day) has no `active:`/`since`. Columbus Day was inserted into §6103(a) by Pub. L. 90-363 §1(a), and §2 of that Act made the amendment effective 1971-01-01. So the "second Monday in October" rule did not exist before 1971. Running `date-holidays@3.36.1` yields 1960-10-10 (the traditional observance that year was 10-12, a Wednesday) and 1869-10-11.
- Same page records three more: Martin Luther King Jr.'s birthday (Pub. L. 98-144, from 1986), the Monday observances of Washington's Birthday and Memorial Day (from 1971), and Veterans Day, which was moved to the fourth Monday in October for 1971–1977 by Pub. L. 94-97 and returned to November 11 on 1978-01-01.

Source (all four, one page): https://www.govinfo.gov/content/pkg/USCODE-2023-title5/html/USCODE-2023-title5-partIII-subpartE-chap61-subchapI-sec6103.htm

The framing we'd suggest is "the rule needs a start year", not "the holiday shouldn't be there" — before 1971 Columbus Day was observed on October 12 in many states, and python-holidays models exactly that, gating the federal entry on `self._year >= 1971` while keeping a 10-12 state-level observance. That independent boundary matches the statute.

The file already has all the machinery for this — `since 2021` on Juneteenth, `every 4 years since 1848` on Election Day, and `active: from/to` on the state-level Columbus → Indigenous Peoples' Day transitions — so this is about the national entries specifically.

Honest disclosure on where this comes from: our own US table only covers 2026–2028, so this is a reading of the statute you already have in scope, not a comparison against historical data we hold. Happy to send it as four `active:` blocks if that framing works for you.
```

</details>

### 11. ID: Easter Sunday has been a national holiday in Indonesia since Keppres 8/2024 and isn't in the file

- **上游**：date-holidays — PR against data/countries/ID.yaml and data/names.yaml
- **工作量**：低到中 — 一個條目＋一個名稱＋active，重產 ID fixtures。一天。
- **為什麼會被收**：整個假日缺席而不是日期爭議，用的是格里曆導出（不碰觀月問題），兩年官方公告加一份總統令；而且我方主動指出裸加會弄壞 2023 以前。

<details><summary>可直接貼出的內文（英文）</summary>

```markdown
`ID.yaml` has `easter -2` (Wafat Yesus Kristus / Good Friday) and `easter 39` (Kenaikan Yesus Kristus / Ascension) but no entry for Easter Sunday itself. Indonesia added it as a national holiday with Presidential Decree (Keppres) No. 8 of 2024, under the name "Kebangkitan Yesus Kristus (Paskah)".

It appears in both recent joint ministerial decrees:
- 2026, Lampiran A item 7: 5 April, Minggu — https://www.kemenkopmk.go.id/sites/default/files/pengumuman/2025-09/SKB%20Libur%20Nasional%20dan%20Cuti%20Bersama%20Tahun%202026.pdf
- 2027, Lampiran A item 7: 28 Maret, Minggu — https://www.kemenkopmk.go.id/sites/default/files/pengumuman/2026-09/SKB%20Libur%20Nasional%20dan%20Cuti%20Bersama%20Tahun%202027.pdf
- Keppres 8/2024 contents, which list 31 Maret 2024 Kebangkitan Yesus Kristus (Paskah) among that year's 16 national holidays: https://setkab.go.id/inilah-isi-keppres-nomor-8-tahun-2024-tentang-hari-hari-libur/

Running `date-holidays@3.36.1`, neither 2026-04-05 nor 2027-03-28 appears in the ID output.

Two implementation notes:
- A bare `easter:` entry would retroactively create the holiday for 2023 and earlier, which would be a new error. It needs `active: [{from: 2024}]`.
- `data/names.yaml` has no `id` string for the plain `easter` key (both `easter -2` and `easter 39` do have one), so the PR would add "Kebangkitan Yesus Kristus (Paskah)".

On "it's a Sunday anyway": several other libraries do list Easter Sunday as public for DK/NO/IS/FI, and `ID.yaml` itself already carries holidays that land on Sundays (e.g. Waisak 2026-05-31), so we don't think the weekday is the reason it's absent.
```

</details>

### 12. BR: Dia do Servidor Público (10-28) is missing while every other federal ponto facultativo is present

- **上游**：date-holidays — PR against data/countries/BR.yaml
- **工作量**：低 — 一個條目，型別待維護者定案，重產 BR fixtures。半天到一天。
- **為什麼會被收**：同一份 Portaria 的其他每一項上游都收了，只缺這一項，是清單內部不一致；而且我方沒有自作主張選型別，把設計決定留給維護者。

<details><summary>可直接貼出的內文（英文）</summary>

```markdown
We keep Brazilian federal holiday and ponto facultativo data transcribed from the annual Portaria issued by the Ministry of Management (MGI). `BR.yaml` carries the rest of that list but not October 28.

The 2026 Portaria (MGI nº 11.460, de 29 de dezembro de 2025) lists "28 de outubro — Dia do Servidor Público federal (ponto facultativo)". Official source: https://www.gov.br/mre/pt-br/eresp/feriados-e-pontos-facultativos (the 2026 table; the underlying date is fixed by Lei 8.112/1990 Art. 236, "O Dia do Servidor Público será comemorado a vinte e oito de outubro" — note that the statute fixes the commemoration, while the day-off status comes from the annual Portaria).

`BR.yaml` already models the other items from the same Portaria: Carnaval Monday and Tuesday (`easter -50 PT48H`), Ash Wednesday (`easter -46 PT14H`), 12-24 and 12-31 as `type: optional`, and Corpus Christi as `type: bank`. 10-28 is the only one absent — no entry at the national level, none in any of the 27 state blocks, and nothing in the test fixtures.

One thing we'd rather decide with you than assume: the type. Your docs define `optional` as "majority of people take a day off" and `observance` as "no paid day off", and 10-28 is a paid day off only for federal civil servants, so neither is a clean fit. python-holidays places it in Brazil's OPTIONAL category (`_add_holiday_oct_28`), which is the closest precedent we can point to, but the call is yours.

We're claiming 2026 with an official citation; our 2027/2028 rows for this day are projections, so we're not offering them as evidence.
```

</details>

### 13. BR: the two unnamed 2026 pontos facultativos (04-20 and 06-05) aren't produced

- **上游**：python-holidays — PR against holidays/countries/brazil.py
- **工作量**：中 — 新增 StaticHolidays 類別＋兩筆＋測試。一到兩天。
- **為什麼會被收**：DOU 原始 Portaria 條號逐條可引，阿根廷已有同型機制與同性質資料（年度行政命令宣告的 bridge 假日），所以不是要求新設計，只是照既有前例補一個國家。

<details><summary>可直接貼出的內文（英文）</summary>

```markdown
Brazil's 2026 federal calendar, set by Portaria MGI nº 11.460 de 29 de dezembro de 2025, includes two bridge days that the Portaria lists without a name:

- Art. 1, VI — "20 de abril (ponto facultativo)", the Monday before Tiradentes (Tuesday 04-21)
- Art. 1, X — "5 de junho (ponto facultativo)", the Friday after Corpus Christi (Thursday 06-04)

Official sources: https://www.in.gov.br/web/dou/-/portaria-mgi-n-11.460-de-29-de-dezembro-de-2025-678388627 (DOU) and the PDF mirror https://legis.sigepe.gov.br/sigepe-bgp-ws-legis/legis-service/download/?id=0026440285-ALPDF%2F2025

Neither date can be produced by the current code: `_populate_optional_holidays()` has seven recurring rules (Carnaval ×2, Início da Quaresma, Corpus Christi, 10-28, 12-24, 12-31), `Brazil` doesn't inherit `StaticHolidays`, there's no `special_*` registration in the file, and the only observed shift (`TUE_WED_THU_TO_NEXT_FRI`) is scoped to Acre. With Easter 2026 on 04-05, none of the seven rules can land on either date.

These are one-off administrative declarations rather than a recurring rule, so the shape that seems to fit is a `BrazilStaticHolidays` class with `special_optional_holidays`, mirroring `ArgentinaStaticHolidays`, which already carries bridge days declared by annual resolution (including 2026 under Resolución 164/2025). Since the Portaria gives no name, a generic `tr("Ponto Facultativo")` would follow the Argentine precedent of `tr("Feriado con fines turísticos")`.

Happy to send the PR if the approach looks right, or to open it as a question first if you'd rather not take per-year Brazilian declarations into the library.
```

</details>

### 14. TW: 8 of the statute's 14 non-holiday memorial days are missing from the WORKDAY category

- **上游**：python-holidays — issue or PR against holidays/countries/taiwan.py
- **工作量**：中 — 8 筆 WORKDAY 條目＋七語 l10n 字串＋測試。二天。
- **為什麼會被收**：上游 docstring 已經引用同一道公布令、也已依該法改過 public 那一半，缺的正是同一份法的另一半；WORKDAY 這個 category 就是為這類日子設的，已有 6 個同類條目。

<details><summary>可直接貼出的內文（英文）</summary>

```markdown
The module's docstring already cites Decree No. 11400053171 — the Presidential Order promulgating Taiwan's 紀念日及節日實施條例 (2025-05-28) — and PR #2653 implemented that law's PUBLIC changes. The WORKDAY side hasn't caught up.

Article 3 of the Act lists 20 memorial days, of which Article 4 makes 6 days off; the other 14 are commemorated but worked. `_populate_workday_holidays()` currently carries 6 of those 14 (國父逝世紀念日, 反侵略日, 革命先烈紀念日, 解嚴紀念日, 臺灣聯合國日, 國父誕辰紀念日). The other 8 don't appear in any category — a repo-wide search including the l10n .po files returns nothing for them (a control search for 解嚴紀念日 returns hits, so the search is working):

- 民族平等紀念日 — 3/21
- 言論自由日 — 4/7
- 原住民族抵抗日 — 6/26
- 原住民族日 — 8/1
- 終戰紀念日 — 8/15
- 八二三紀念日 — 8/23
- 國家防災日 — 9/21
- 全國客家日 — 12/28

Source: https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0020095 (Art. 3 and Art. 4). Note that this domain disallows crawling in robots.txt, so we cite it for readers rather than having fetched it; we verified the article text against the full text of the promulgation.

Two things worth stating carefully:
- These are not all "new in 2025". Several existed earlier by administrative regulation (言論自由日 since 2016, 原住民族日 since 2005, 國家防災日 since 2000, 全國客家日 moved to 12/28 in 2022); the 2025 Act raised them from regulation to statute. The safe claim is "8 of the Act's 14 non-day-off memorial days are absent", not "the Act created them".
- Start years need care. The Act commenced 2025-05-28, after 3/21 and 4/7 had passed that year, so those two can only start from 2026 unless each day's earlier regulation is cited individually. Our own table covers 2026–2028 only, which is not enough to establish earlier start years, so we'd propose `>= 2026` uniformly unless you'd prefer per-day sourcing.

We're not claiming the PUBLIC category is complete — 原住民族歲時祭儀 (3 days chosen by each indigenous people) is in the Act and is not computable, which is a genuine scope question rather than a gap.
```

</details>

### 15. TW: 元宵節 / 中元節 / 重陽節 are listed in the 2025 Act but produced in no category

- **上游**：python-holidays — issue or PR against holidays/countries/taiwan.py
- **工作量**：中 — 三筆，其中兩筆需要新的農曆 helper；立春另案。二天。
- **為什麼會被收**：同一部法、同一個 category 裡已經有兩個一模一樣性質的條目；日期有氣象署天文年曆逐格佐證；而且我方主動撤掉了「你們自家不一致」這個站不住的指控，改成「舊法自洽、新法只跟進一半」。

<details><summary>可直接貼出的內文（英文）</summary>

```markdown
Related to the previous item but on the festivals side. `_populate_workday_holidays()` for Taiwan still reflects the 紀念日及節日實施辦法 (the regulation repealed on 2025-05-28) rather than the 紀念日及節日實施條例 that replaced it.

Article 5 of the Act names, among others, 「元宵節：農曆一月十五日」「中元節：農曆七月十五日」「重陽節：農曆九月九日」, and Article 6 ends with 「第一項以外之節日，均不放假」 — named festivals, not days off. That's exactly the same character as 佛陀誕辰紀念日 (4th month, 8th day) and 道教節 (1st month, 1st day), which the module already produces. None of the three appears in any category (PUBLIC/OPTIONAL/SCHOOL/GOVERNMENT/WORKDAY), and Taiwan has no subdivisions or static-holiday entries that could supply them.

Computed dates, cross-checked against the Central Weather Administration's astronomical calendar tables: 元宵 2026-03-03 / 2027-02-20; 中元 2026-08-27 / 2027-08-16; 重陽 2026-10-18 / 2027-10-08.

Sources:
- Act Arts. 5 and 6: https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0020095 ; full promulgated text (archived, because the domain disallows crawling): https://web.archive.org/web/20250602210918/https://law.moj.gov.tw/News/newsdetail.aspx?msgid=191745
- Date verification: https://www.cwa.gov.tw/Data/astronomy/2026cal.pdf and https://www.cwa.gov.tw/Data/astronomy/2027cal.pdf

One correction to a framing we considered and dropped: this is not an internal inconsistency in your WORKDAY list. Under the old regulation that list was self-consistent — the repealed text contained 佛陀誕辰紀念日 and 道教節 but none of these three. The gap is that the 2025 Act re-listed the festivals and only the day-off half has been implemented.

Implementation notes: 重陽 has a ready helper (`_add_double_ninth_festival`); 元宵 is the 15th of the 1st lunar month, where the only same-day helper is the Korean-named `_add_daeboreum_day`; 中元 (7th month, 15th day) has no helper at all.

**農民節 should be handled separately**, not in the same PR: Art. 5(4) defines it as "the day of 立春" (2026-02-04 and 2027-02-04, but 2025-02-03), and `holidays/calendars/chinese.py` currently has solar-term threshold tables only for Qingming and the winter solstice — adding 立春 is a different and larger change.

Context that may help: the same Act lists twenty-plus further named, non-day-off memorial days and festivals that are also absent (消防節, 國際醫師節, 母親節, 環境日, 國家海洋日, 警察節, 父親節, 祖父母節, 國民體育日, 人權日, 移民日, and others).
```

</details>

### 16. IN: 12 of the 17 central-government Gazetted Holidays for 2026 are absent — asking which list IN should track

- **上游**：date-holidays — issue referencing existing #137 / #534, on data/countries/IN.yaml
- **工作量**：低 — 只開 issue。半天。之後若要補資料是大工程。
- **為什麼會被收**：維護者在 #137 親口徵求「逐年手動維護的固定日期清單」與政府一級來源；我方提供的正是那個，而且先問結構再送資料，並誠實說明 Hijri 規則重現不了印度公告日期——不會被當成又一份 timeanddate 抄來的 PR。

<details><summary>可直接貼出的內文（英文）</summary>

```markdown
This is a question about scope rather than a bug report, posted against #137 and the work merged in #534 (whose commit message notes it covers holidays "as per Gregorian Calendar").

We hold the Government of India's 2026 holiday lists transcribed from a .gov.in source and compared them with `IN.yaml`. The national `days` block has 6 fixed/Easter-based entries; the central government's 2026 Gazetted (compulsory) list has 17. The 12 absent ones are all lunisolar or Hijri: Holi, Id-ul-Fitr (03-21), Ram Navami, Mahavir Jayanti (03-31), Buddha Purnima, Id-ul-Zuha/Bakrid (05-27), Muharram (06-26), Milad-un-Nabi (08-26), Janmashtami, Dussehra, Diwali (11-08) and Guru Nanak's Birthday. No state block covers any of them either.

Sources: https://cag.gov.in/defence/new-delhi/en/page-defence-new-delhi-holidaylist and the PDF https://cag.gov.in/uploads/media/List-of-Gazetted-Holidays-and-Restricted-Holidays-2026-069492ddf80fa39-36385303.pdf

Before proposing any data, three things we think you should decide, because we don't want to guess:

1. **Which list does the national layer represent?** India has only three holidays that are national by constitutional practice (Republic Day, Independence Day, Gandhi Jayanti); the 17-item Gazetted list is a central-government-office list, and each state publishes its own. The current national layer already mixes the two (it carries Ambedkar Jayanti 04-14, which is not on the 2026 central Gazetted list).
2. **Hijri rules will not reproduce the Indian dates.** The engine can express them — `10 Dhu al-Hijjah` evaluated for IN gives 2026-05-27, matching the official Bakrid date — but India announces these by local moon sighting, so the arithmetic drifts: `1 Shawwal` gives 2026-03-20 against the official 03-21 (`2 Shawwal` matches for 2026, but that's coincidence, not a rule), `1 Muharram` gives 06-16 and even `10 Muharram` gives 06-25 against the official 06-26, and `12 Rabi al-awwal` runs a day early for 2026–2028. Getting these right means per-year dates or `disable`/`enable` overrides, as `ID.yaml` already does.
3. **Hindu lunisolar days have no calendar in the spec at all**, so Mahavir Jayanti, Diwali, Dussehra and friends would have to be per-year dates, the way `ID.yaml` pins Nyepi. Your comment in #137 inviting "fix date lists which may need manual updates each year" is what we're taking as the opening.

We can only supply 2026 with official backing; our 2027/2028 Indian rows are projections and we won't submit them.

Three separate observations about entries that already exist, in case they're useful — we are *not* claiming the correct values, because we hold only the central list and no state gazette:
- `states.HP` has `10-07: Maharishi Valmiki Jayanti` as a fixed date, but the central lists put it on 2024-10-17, 2025-10-07 and 2026-10-26. 10-07 happens to be the 2025 date.
- `states.KL` has `04-21: Vaisakhi`; the central 2026 list has "Vaisakhadi/Visu/Meshadi (Tamil New Year's Day)" on April 14. (Also, Punjab has no Vaisakhi entry at all.)
- `states.WB` and `states.RJ` both have `05-08: Rabindra Jayanti` as a fixed date; the central 2026 list has Tagore's birthday on May 09. The `bengali-revised` calendar in the engine is the Bangladesh revision, where 25 Boishakh is always 5/8, so it can't express the West Bengal reckoning.
```

</details>

### 17. CN: the per-year holiday arrangements stop at 2021 — is resuming them in scope?

- **上游**：date-holidays — issue against data/countries/CN.yaml
- **工作量**：低（issue）／高（真的補 2022–2026 五年資料）。
- **為什麼會被收**：維護者自己在 PR #553 的 review 裡開口要過這個；我方帶著官方通知與精確差集去問「你要什麼形狀」，而不是丟一包 yaml 過去。

<details><summary>可直接貼出的內文（英文）</summary>

```markdown
Separate from the Decree 795 statutory change, and posted as a question because it's a maintenance-policy decision rather than a bug.

`CN.yaml`'s per-year overrides end at `"2021-10-07"` and the file hasn't changed since 2021-11-16. Running `date-holidays@3.36.1` for CN 2026 returns 15 entries against the State Council General Office's announced 33 days off; `test/fixtures/CN-2026.json` shows the same 15. Twenty-one announced days off are absent (1/2, 1/3, 2/15, 2/19–2/23, 4/4, 4/6, 5/2, 5/3, 5/5, 6/20, 6/21, 9/26, 9/27, 10/4–10/7), of which 9 are weekdays, and none of the six swapped working Saturdays/Sundays (1/4, 2/14, 2/28, 5/9, 9/20, 10/10) is represented. The 2021 block did represent them, in `note` text such as "Work on Sun February 7 and Sat February 20."

2026 announcement (国办发明电〔2025〕7号, 2025-11-04): https://www.gov.cn/gongbao/2025/issue_12406/202511/content_7048922.html

Why we're asking rather than sending a patch: Chinese 调休 is not derivable by rule. The statutory rule — 《全国年节及纪念日放假办法》Art. 6, "全体公民放假的假日，如果适逢周六、周日，应当在工作日补假" (https://www.gov.cn/gongbao/2024/issue_11726/202411/content_6989774.html) — explains a single substitute day such as 2026-04-06 for Qingming, but it cannot produce a 9-day Spring Festival block, a 7-day National Day block, or a working Saturday. Only the annual circular can. So the only faithful representation is per-year dates, which is exactly the maintenance burden the 2021 block implies.

We noticed your review comments on PR #553 ("Spring Festival is over a period of 7 days. Shouldn't we reflect this here?", "National Day … Should we add the other 7 days?"), which is why we think this is wanted rather than deliberately out of scope — but we'd rather hear the shape you want (per-year blocks? a separate data file? annotate working days at all?) before generating four years of entries.

One correction to something we almost wrote: 2026-05-04 *is* in your output, as Youth Day; it's not one of the missing days.
```

</details>

### 18. BR: Véspera do Natal / Véspera do Ano Novo start at 13:00 in the Portaria, not 14:00

- **上游**：date-holidays — PR against data/countries/BR.yaml (blocked on one check)
- **工作量**：中，且有前置條件 — 須先取得 2023–2025 的 Portaria 核對，才知道該直接改值還是加 active。
- **為什麼會被收**：同一份 Portaria 的聖灰星期三時間上游已經寫對，證明它確實在追這份部令；而且 14:00 這個值在上游沒有來源（自述來源是維基，維基沒寫時間），看起來是從 DE/AT 沿用的。

<details><summary>可直接貼出的內文（英文）</summary>

```markdown
`BR.yaml` encodes the two year-end half-days as `"12-24 14:00"` and `"12-31 14:00"` (`type: optional`). Portaria MGI nº 11.460, de 29 de dezembro de 2025, items XVII and XIX, both read "ponto facultativo após as 13 horas" — one hour earlier.

Sources: https://www.gov.br/mre/pt-br/eresp/feriados-e-pontos-facultativos (2026 table, citing the Portaria) and the Portaria's full text as published: https://legis.sigepe.gov.br/sigepe-bgp-ws-legis/legis-service/download/?id=0026440285-ALPDF%2F2025 — the same document's item IV gives "Quarta-Feira de Cinzas (ponto facultativo até as 14 horas)", which this file already models correctly as `easter -46 PT14H`, so the file is clearly tracking these Portaria times.

One note on provenance: the file's `@attrib` points at Wikipedia, and neither the English nor the Portuguese article states a time for these two days; the identical string `"12-24 14:00"` also appears in `AT.yaml` and `DE.yaml`, where 14:00 genuinely is the Austrian/German Christmas Eve convention.

We are holding this one back until we've checked earlier years' Portarias. The entries have no year bounds, and we have verified only the 2026 Portaria; if earlier years also said 13 horas the value can simply be corrected, but if the time changed at some point it needs `active: from:` instead of a blanket edit. We'll verify before opening anything. Fixtures from 2015 onward assert 14:00 and would need regenerating.
```

</details>

### 19. CN: 六一儿童节 is a full day off for the group it covers, but sits in HALF_DAY

- **上游**：python-holidays — low-severity issue against holidays/countries/china.py
- **工作量**：低 — 只開 issue。半天。
- **為什麼會被收**：把上游自己的 docs 定義與自己的實作放在一起，讓維護者自己看出張力；不指定要改成哪一類、不送 PR、明說是低嚴重度且日期沒錯——很難被當成噪音，也很難吵起來。

<details><summary>可直接貼出的內文（英文）</summary>

```markdown
A classification question, not a date problem — the date (June 1, every year) is correct.

`_populate_half_day_holidays()` for China contains four entries. Article 3 of 《全国年节及纪念日放假办法》 (as amended by State Council Decree No. 795) reads:

> （一）妇女节（3月8日），妇女放假半天；（二）青年节（5月4日），14周岁以上的青年放假半天；（三）儿童节（6月1日），不满14周岁的少年儿童放假1天；（四）中国人民解放军建军纪念日（8月1日），现役军人放假半天。

Three of the four are indeed half days; Children's Day is a full day (放假1天) for children under 14. Source: https://www.gov.cn/gongbao/2024/issue_11726/202411/content_6989774.html

We can see the reasoning for the current grouping — Article 3 is the "part of the population gets time off" article, and the `# No in lieus are given for this category.` comment maps neatly onto Article 6's rule that these days get no substitute when they fall on a weekend. But `docs/holiday_categories.md` defines HALF_DAY as "Holidays observed for only part of a day, typically resulting in reduced working hours rather than a full day off", with Christmas Eve and New Year's Eve as the examples, so the category as documented does say something about this day that isn't true.

We're raising it as a question, not a patch: moving it would remove an entry for anyone querying `half_day`, and neither SCHOOL ("educational institutions") nor OPTIONAL ("individuals or organizations may choose to observe") is an obvious home for "a segment of the population gets a full day off", so we'd rather not prescribe. The minimal ask would be that the category or its documentation stop implying this one is a half day. `tests/countries/test_china.py` asserts it in half_day across the full range, from `start_year = 1950`, with no year condition — so this isn't year-specific.

For transparency: our own table doesn't encode half-day versus full-day either (all four are stored the same way), so we're citing the decree text, not our data.
```

</details>

## 🔴 不要送（看起來像缺口，但送了會扣信用）

- 【ID cuti bersama（共同休假日）】SKB 附表 B 的 2026-03-20/23/24、2027-03-09/12/15 等日子是公務體系的集體休假，不是國定假日。date-holidays 收的是 public holiday，這是對象差異不是缺漏。混進 Idul Fitri 那則 PR 會讓整則失焦且不可驗證。
- 【IN 34 筆 Restricted Holidays 當成全國 `type: optional` 層】我方那份是新德里中央政府辦公室的名單；同年 Bhubaneswar 辦公室只有 29 筆，且 Rath Yatra 與 Maha Navami 在那裡是強制假日不是限制性假日。當成全印度統一層送出去，是把德里的名單冒充全國，一問就破。而且限制性假日是員工每年至多擇二，不等於 34 天假。
- 【IN 邦級日期（HP Valmiki、KL Vaisakhi、WB/RJ Rabindra）當成 PR 送】我方手上只有中央政府的 restricted 清單，沒有任何一份邦政府公報。中央 restricted ≠ 該邦的 public holiday。這三項只能當作「這幾筆寫成固定日期，而中央清單逐年不同」的觀察寫在 issue 裡，不得主張正確值、不得送改日期的 PR。
- 【python-holidays JP `start_year = 1949` → 要求收 1948】我方母表根本不涵蓋 1948；e-Gov 只提供 2017-04-01 以後的時點版本，拿現行條文冒充 1948 年的祝日清單會被一問就破（現行條文裡有 1966 年才有的建国記念の日）；1948-09-23 秋分更是完全沒有來源（法條只寫「秋分日」）。要送必須先拿到官報昭和23年7月20日或国立公文書館御署名原本＋国立天文台的 1948 推算。在那之前不是資料貢獻，是憑空提問。
- 【TW 2028 的農曆／推導格子】小年夜、除夕、春節、元宵、清明、端午、中元、中秋、重陽、道教節、農民節、佛誕、兒童節補假共 13 格，2028 全是 estimated（人事總處 117 年辦公日曆表尚未公告）。依硬性要求一律不得拿去貢獻。TW 固定國曆日（09-28、10-25、12-25、05-01）2028 是 confirmed，可以用。
- 【TW.yaml L27 的 `Saturdayif` 少一個空格】是明顯筆誤沒錯，但實測 parser 仍走對分支。宣稱這個拼字造成了錯誤輸出是假的，會直接毀掉整份 PR 的可信度。要提就只說「順手修一下可讀性」。
- 【宣稱 python-holidays 的 TW public 類「零缺口」】原住民族歲時祭儀（各族自擇 3 日）在條例裡，上游沒有、也無法計算——那是範圍差異。講太滿會被反打。
- 【只補 TW 春節的小年夜而不動初四／初五】上游現在是除夕＋初一~初四（外加一條算出初五的規則）。只加一天會變成六天，比現在更錯。這組必須整段一起改，不能拆單。
- 【把 CN 調休講成「應該加 substitutes 規則」】調休不可規則化：`if sunday then next monday` 生得出清明的 4/6，生不出 9 天春節、7 天國慶，更表達不了「週六上班」。上游對 CN 用的機制就是逐年寫死日期。照原診斷送過去會被維護者當場否掉。
- 【date-holidays IN 的 Ambedkar Jayanti（04-14）在全國層】它不在 2026 中央 Gazetted 清單上，看起來可疑，但我方沒有查證過它的依據。當成獨立主張要另案查，不得混進印度那則 issue 當「上游也錯了」的佐證。
- 【任何引用 dfe.gov.in 的印度 PDF，或 setneg.go.id 的印尼頁】前者 TLS 憑證已過期（curl 直接失敗），後者回 HTTP 200 但內文是「500 Internal Server Error」。貼進 PR 會被當成死連結，反而扣信用。印度改引 cag.gov.in，印尼改引 kemenkopmk.go.id。
- 【任何提到我們自己的網站、要求對方回連、或在 PR/issue 裡放我方網域】會被當成 SEO spam 退件，而且會讓上述所有真材實料的缺口一起被貼標籤。署名與引用是被接受之後的自然結果，不是可以開口要的東西。
- 【TW 09-28/10-25/12-25 直接改成 `type: public`】會讓 2001–2024 變錯（當時確實不放假）。必須用 `active: - from: '2025-05-28'` 加雙條目。這是「修法方式」層級的紅線，不是措辭問題。

## 我方自己該補的

> ⚠ **一條已由主對話複驗後推翻，見下方**。其餘照列。

- 印度來源要換掉：`content/national-holiday-calendars.json` 的 IN 仍列著兩個 dfe.gov.in PDF，該網域 TLS 憑證已過期、curl 直接失敗。cag.gov.in 的 HTML 頁與 PDF 都已在清單裡且實測 200，直接刪掉 dfe 那兩筆。
- 印尼來源要換掉：ID 仍列著 `setneg.go.id/baca/index/...2026`（連線逾時）與 `www.setneg.go.id/...2027`（回 200 但內文是 500 錯誤頁）。權威來源應以 kemenkopmk.go.id 的兩份 SKB PDF 為主，setneg 兩筆降級或移除。
- 台灣 65 個格子共用同一個 `law.moj.gov.tw/LawClass/LawAll.aspx?pcode=D0020095` 連結，而該網域 robots.txt 全站 Disallow，我方從來沒有、也不會去驗證它。應加上公布令頁 `law.moj.gov.tw/News/newsdetail.aspx?msgid=191745`（已有存檔可複驗），並請人在瀏覽器親自開一次確認 pcode 不是死連結——這是送出前的硬性前置。
- 台灣 2028：13 個農曆／推導格子仍是 estimated，人事總處 117 年辦公日曆表尚未公告。應確認 `content/announcement-watch.json` 有在盯它，公告一出就抄，否則這 13 格永遠不能拿去貢獻。
- 印度 2027/2028：50 格裡 40 格是 estimated，只有 2026 可用。若要持續對上游有貢獻能力，需要一條穩定的 DoPT 年度假日通函（母公告）來源——現在引的 cag.gov.in 只是單一機關轉載，上游 reviewer 可以質疑。
- 資料模型缺一個維度：中國的婦女節／青年節／兒童節／建軍節在母表裡一律是 `status: discretionary` + `scope: group`，「半天 vs 一天」「哪一群人」只寫在 `content/topic-regional-notes.json`。要對上游主張分類問題，這個區別得進權威檔，否則我方只能引法條、不能說「我方資料如此」。
- 印尼伊斯蘭節日缺事後確認：SKB 的 Diktum KEDUA 把 1 Ramadan／Idul Fitri／Idul Adha 的最終日期留給宗教部長決議（sidang isbat），而 2026-03 已經過去。應把 KMA（宗教部長決定書）加進 announcement-watch，補一則 1 Syawal 1447 H 的事後官方確認，封死送出後被翻盤的唯一缺口。
- 巴西 12-24／12-31 的「13 時起」目前只驗到 2026 那一份 Portaria。要送上游得先取得 2023–2025 的 Portaria MGI 核對，否則不知道該直接改值還是加 `active: from:`——這是排名 18 那則的前置條件，不做就不要送。
- 巴西 2027/2028：19 格裡 9 格是 estimated（Portaria 是逐年發的），與印度同樣的結構性限制，值得在 announcement-watch 標出每年 12 月底的 DOU。

### 複驗更正（2026-09-19，主對話）

**`dfe.gov.in` 不是死來源，不要刪。** 它的 TLS 憑證在 **2026-09-17 23:59:59 GMT**（兩天前）過期，
伺服器本身還活著——`curl -k` 對 PDF 與網域根目錄都回 200。依 CLAUDE.md 紅線
「403/412/429/5xx/連線失敗一律 WARN……判死前要複驗」，憑證過期是對方暫時故障，
不該因此把一個印度政府的一級來源從 `content/national-holiday-calendars.json` 移除（它被引用 53 次）。

要做的只有兩件：

1. **送上游 PR 時先不要引 dfe.gov.in**——reviewer 點進去會看到憑證警告。改引 `cag.gov.in`（實測 200）。
2. **盯它什麼時候修好**。憑證過期通常幾天內會補；若超過兩週仍未修，才重新評估這個來源。

`setneg.go.id` 的情況不同：`https://www.setneg.go.id/baca/index/...2028` 回 HTTP 200 但**內文是
「500 Internal Server Error」**（軟 500，實測）。那不是傳輸層問題。ID 的權威來源本來就該以
發布 SKB 的 `kemenkopmk.go.id` 為主，setneg 只是轉載。這一條的處方成立。
