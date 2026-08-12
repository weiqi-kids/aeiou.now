# Topic 七人格審查記錄

審查對象是 `content/topics/*.md`、主機 SQLite 的 `topic_observances`／七語 customs、年度排程與每個 Topic 的主圖。七個人格代表七個市場的社會學閱讀位置，不把任何一國的節日經驗當成全球標準。

## 人格 prompt

| 人格 | 審查焦點 | 最終結果 |
| --- | --- | --- |
| 台灣 | 日期在地化、七夕與普渡的多樣實踐 | 0 修正、0 建議 |
| 日本 | 情人節／白色情人節、盂蘭盆與地方性 | 0 修正、0 建議 |
| 中國 | 農曆／公曆、地方差異、避免單一化 | 0 修正、0 建議 |
| 印度 | 區域、宗教、城市與家庭差異 | 0 修正、0 建議 |
| 印尼 | 開齋節日期變動、mudik 與個人選擇 | 0 修正、0 建議 |
| 巴西 | 6 月 12 日戀人節、六月節與獨立日 | 0 修正、0 建議 |
| 美國 | 聯邦假日、文化節日與家庭選擇的界線 | 0 修正、0 建議 |

實際 prompt 與可重跑檢查在 `scripts/review-topic-content.mjs`。它會確認每一個地方表現有來源、固定日期或日期規則、七語 customs、`commonality` 分類依據，以及 1200×675 PNG 主圖；也會回歸測試同一 Topic 的日本情人節／白色情人節與台灣七夕是否仍是多筆資料。

## 修正輪次

- Round 1：發現舊資料的 `(topic_id, country_code)` 單列模型、同名 observance key 的唯一鍵過窄、日期型 `valentines-day` 會把共通性誤當 Topic，以及 Topic 缺主圖。已分別改成 `topic_observances`、`(topic_id, country_code, observance_key)`、`affection-and-reciprocity` 合併入口、每 Topic 1200×675 PNG。
- Round 2：七人格依各自焦點複核；所有建議已納入日期規則、區域差異、同一國多觀察事件、來源與七語文字。
- Final：`node scripts/review-topic-content.mjs` 通過，七人格均為 0 修正、0 建議。
