# Topic 內容維護:content/topics/*.md(格式規格)

> **這是撰寫 Topic(節日/議題)的唯一人工入口。** 一個 Topic 一個檔:`content/topics/<slug>.md`。
> 匯入鏈:`content/topics/*.md` → `node scripts/import-topics.mjs` → 主機 SQLite →
> `node scripts/export-data.mjs` → `data/*.json` → 靜態站 build。
> 每小時的 cron(`scripts/hourly-export.sh`)會自動跑匯入+匯出,所以**存檔後最慢一小時上線**;
> 要立即看結果就手動跑上面兩支再 build。

## 完整範例(可直接複製當模板)

```markdown
# Qixi Festival                ← H1 給人看的,解析時忽略

## meta
- slug: qixi-festival          ← 小寫英數與連字號;URL 與檔名都用它
- canonical: Qixi Festival     ← 語言中立的正規名稱(英文為主)
- category: festival           ← 草案 §4.1 的分類
- perennial: no                ← yes = 長青(如 ask-the-world,永不退熱)

## country TW                  ← ISO 3166-1 alpha-2,一國一段
- local_name: 七夕/情人節       ← 該國的在地稱呼(語言中立,寫當地文字)
- date_rule: 農曆七月初七        ← 非固定日期用 date_rule(擇一或並用)
- date: 08-29                  ← 固定/今年對應的日期,MM-DD
- rank: 1                      ← 該 Topic 在該國的熱度排名(可省略)
- source: https://example.com/a  ← 佐證來源,**至少一個,可重複多行**
- source: https://example.com/b

## country JP
- local_name: 七夕(たなばた)
- date: 07-07
- source: https://example.com/c

## locale zh-TW                ← 七語各一段,**缺一個匯入就報錯**
### title
七夕
### summary
農曆七月初七的七夕……(本站語系讀者看到的說明,2–3 句)
### keywords
七夕, 牛郎織女, 情人節         ← 逗號分隔
### customs TW                 ← 每個 ## country 都要有對應的 customs
台灣把七夕當第二個情人節過……
### customs JP
日本的七夕(たなばた)在國曆 7 月 7 日,寫短冊掛竹枝……

## locale en
### title
Qixi Festival
### summary
...(其餘六語同構;可先寫好 zh-TW 後請 Claude 翻譯補齊,但檔案裡七語都要在)
### customs TW
...
### customs JP
...

(ja / zh-CN / hi / id / pt-BR 同上)
```

## 硬規則(匯入器會擋,錯誤訊息會講清楚缺什麼)

1. **七語都要有**(`zh-TW` `en` `ja` `zh-CN` `hi` `id` `pt-BR`),每語至少要 `### title`。
2. **每個國家至少一個 `source`**——`source_ids_json` 是必填。每一條文化事實都要能點回原始來源,
   這是內容品質,也是對 Google「scaled content abuse」政策的正面抗辯(草案 §44 註)。
3. **每個 `## country XX` 在七語都要有對應的 `### customs XX`**——事實一份、七語各自呈現。
4. `date` 格式 `MM-DD`;非固定日期(農曆、第 N 個星期日…)寫 `date_rule`,跨日區間用 `date_end`。
5. slug 只准 `a-z0-9-`。

## 匯入語意(重跑安全)

- 以 `slug` 對應既有 Topic:已存在就**沿用 topic_id 與 status**(URL 與討論串不受影響),不存在發新 ULID。
- `topic_i18n` / `topic_countries` / `topic_country_i18n` **整組替換**——md 是這三張表的權威;
  改了 md 就以 md 為準,直接 UPDATE 資料庫的這三張表下次匯入會被蓋掉。
- `sources`:URL upsert,source_id 由 URL 的 hash 決定(URL 不變 ID 就不變)。
- 沒有進行中的 cycle 會自動開一個(貼文寫入需要 `current_cycle_id`)。
- **不碰 `topic_scores`**——熱度分數屬排程/演算法,不是內容。新 Topic 沒有分數,
  級距會顯示最低階,這是誠實狀態;分數等排名 job(M2)或手動塞。

## 常見流程

```bash
# 新增一個節日
cp content/topics/valentines-day.md content/topics/qixi-festival.md   # 當模板改
vim content/topics/qixi-festival.md
node scripts/import-topics.mjs          # 匯入(會逐檔報錯,失敗不影響其他檔)
node scripts/export-data.mjs            # 產 data/*.json
cd site && LOCALE=zh-TW pnpm build      # 本地看結果(或等 cron + CI)

# 只想先寫 zh-TW、讓 Claude 翻其餘六語
#   把 zh-TW 段寫好後,把檔案丟給 claude 補完其餘六個 locale 段即可;
#   匯入器會擋「缺語系」,所以不會有半成品進資料庫。
```
