# Topic 內容維護:content/topics/*.md(格式規格)

> **這是撰寫 Topic(節日/議題)的唯一人工入口。** 一個 Topic 一個檔:`content/topics/<slug>.md`。
> 匯入鏈:`content/topics/*.md` → `node scripts/import-topics.mjs` → 主機 SQLite →
> `node scripts/export-data.mjs` → `data/*.json` → 靜態站 build。
> 每小時的 cron(`scripts/hourly-export.sh`)會自動跑匯入、年度日期驗證+匯出,所以**存檔後最慢一小時上線**;
> 要立即看結果就手動跑上面兩支再 build。

## 完整範例(可直接複製當模板)

```markdown
# Valentine's Day, Qixi, and White Day ← H1 給人看的,解析時忽略

## meta
- slug: expressing-affection       ← 小寫英數與連字號;URL 與檔名都用它
- canonical: Valentine's Day, Qixi, and White Day ← 語言中立的正規名稱(英文為主)
- category: festival               ← 草案 §4.1 的分類
- perennial: no                    ← yes = 長青(如 ask-the-world,永不退熱)
- commonality: expressing affection through local gift, attention, and return-gift customs ← 先寫清楚跨國共通性,不要用單一日期命名

## observance TW valentines         ← ISO 國碼 + 該國在 Topic 內唯一 key;同一國可有多筆
- local_name: 情人節               ← 該地方表現的在地名稱
- date: 02-14                      ← 固定日期,MM-DD
- rank: 1                          ← 該地方表現在該國的排序(可省略)
- source: https://www.japan.travel/en/us/blog/valentines-day-white-day-in-japan/     ← 佐證來源,**至少一個,可重複多行**
- source: https://www.britannica.com/topic/Valentines-Day

## observance TW qixi
- local_name: 七夕情人節
- date_rule: 農曆七月初七           ← 非固定日期用 date_rule
- source: https://nit.immigration.gov.tw/Multicultural/Detail/1000013

## observance JP tanabata
- local_name: 七夕(たなばた)
- date: 07-07
- source: https://www.japan.travel/en/see-and-do/festivals-and-events/

## observance JP white-day
- local_name: ホワイトデー
- date: 03-14
- source: https://www.japan.travel/en/us/blog/valentines-day-white-day-in-japan/

## locale zh-TW                    ← 七語各一段,**缺一個匯入就報錯**
### title
人們如何表達愛意？
### summary
情人節、七夕和白色情人節不在同一天,也不遵守同一套送禮規矩。有人送巧克力,有人交換卡片,有人把它當成商業檔期,這些差別就是比較的起點。
### keywords
表達愛意, 親密關係, 禮物, 回禮  ← 逗號分隔
### customs TW valentines       ← 每個 observance 都要有七語 customs
台灣常把農曆七月初七稱為七夕情人節,商場和餐廳會推出約會活動,但它不是全台一致的法定節日。
### customs TW qixi
台灣的七夕情人節,常見約會、送禮和商業企劃,但不同家庭與年齡層不一定參與。
### customs JP tanabata
日本七夕以短冊祈願、竹飾和地方活動為主,不能直接當成情人節的另一個日期。
### customs JP white-day
日本白色情人節在 3 月 14 日,送什麼或要不要回禮,要看人際關係和個人選擇。

## locale en
### title
How do people express affection?
### summary
其餘六語必須由熟悉該語言與文化的編輯分別撰寫,不可直接機翻或套用同一個句型。
### customs TW valentines
...
### customs TW qixi
...
### customs JP tanabata
...
### customs JP white-day
...

(ja / zh-CN / hi / id / pt-BR 同上)
```

## 硬規則(匯入器會擋,錯誤訊息會講清楚缺什麼)

1. **七語都要有**(`zh-TW` `en` `ja` `zh-CN` `hi` `id` `pt-BR`),每語至少要 `### title`。
2. **每個 observance 至少一個 `source`**——`source_ids_json` 是必填。每一條文化事實都要能點回原始來源,
   這是內容品質,也是對 Google「scaled content abuse」政策的正面抗辯(草案 §44 註)。
3. **每個 `## observance XX key` 在七語都要有對應的 `### customs XX key`**——事實一份、七語各自呈現。
4. `date` 格式 `MM-DD`;非固定日期(農曆、第 N 個星期日…)寫 `date_rule`,跨日區間用 `date_end`。
5. Topic slug 與 observance key 只准 `a-z0-9-`。
6. **每個 Topic 都要填 `commonality`**——它是分類依據；日期是 observance 的觸發資料，不是 Topic 的主鍵。

### 年度日期(上線排序的權威資料)

`date_rule` 只給讀者看文化規則，不能拿來在前端推算公曆日期。每個 active observance 都必須在
`content/observance-occurrences.json` 有目前年度與下一年度的 occurrence；每筆包含 `starts_on`、
`ends_on`、`calendar_system`、IANA `timezone`、`date_status` 與該年度日期來源。日期未確認時填
`estimated` 或 `local-variant`，不能省略，也不能自行捏造固定日。

在地地點與活動不是 Topic markdown 的欄位。第一批人工採集樣本放在
`content/local-sample-data.json`，由 `node scripts/update-local-data.mjs` 驗證來源、清理過期活動後匯入；
`content/local-data-sources.json` 保存七市場的搜尋候選詞與官方頁面核對規則；
每筆都要有官方或主辦方來源，未查到可核對日期的活動不建立 `events` 資料列。

```bash
node scripts/import-topics.mjs
node scripts/import-topic-occurrences.mjs
node scripts/update-local-data.mjs
node scripts/export-data.mjs
```

## 匯入語意(重跑安全)

- 以 `slug` 對應既有 Topic:已存在就**沿用 topic_id 與 status**(URL 與討論串不受影響),不存在發新 ULID。
- `topic_i18n` / `topic_observances` / `topic_observance_i18n` **整組替換**——md 是這三張表的權威;
  改了 md 就以 md 為準,直接 UPDATE 資料庫的這三張表下次匯入會被蓋掉。
- `sources`:URL upsert,source_id 由 URL 的 hash 決定(URL 不變 ID 就不變)。
- 沒有進行中的 cycle 會自動開一個(貼文寫入需要 `current_cycle_id`)。
- **不碰 `topic_scores`**——熱度分數屬排程/演算法,不是內容。新 Topic 沒有分數,
  級距會顯示最低階,這是誠實狀態;分數等排名 job(M2)或手動塞。

## 常見流程

```bash
# 新增一個共通性 Topic
cp content/topics/affection-and-reciprocity.md content/topics/expressing-affection.md # 當模板改
vim content/topics/expressing-affection.md
node scripts/import-topics.mjs          # 匯入(會逐檔報錯,失敗不影響其他檔)
node scripts/export-data.mjs            # 產 data/*.json
cd site && LOCALE=zh-TW pnpm build      # 本地看結果(或等 cron + CI)

# 語系撰寫順序
#   可先完成 zh-TW 的事實底稿,再交給其餘六語的母語編輯各自重寫;
#   不可直接機翻,也不可只把中文句子逐句搬過去。匯入器會擋「缺語系」,
#   但語意、語氣與文化自然度仍須由語言專家審核。
```
