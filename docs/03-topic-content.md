# Topic 內容維護:content/topics/*.md(格式規格)

> **這是撰寫 Topic(節日/議題)的唯一人工入口。** 一個 Topic 一個檔:`content/topics/<slug>.md`。
> 匯入鏈:`content/topics/*.md` → `node scripts/import-topics.mjs` → 主機 SQLite →
> `node scripts/export-data.mjs` → `data/*.json` → 靜態站 build。
> 每小時的 cron(`scripts/hourly-export.sh`)會自動跑匯入+匯出,所以**存檔後最慢一小時上線**;
> 要立即看結果就手動跑上面兩支再 build。

## 完整範例(可直接複製當模板)

```markdown
# How do people express affection? ← H1 給人看的,解析時忽略

## meta
- slug: expressing-affection       ← 小寫英數與連字號;URL 與檔名都用它
- canonical: How People Express Affection ← 語言中立的正規名稱(英文為主)
- category: festival               ← 草案 §4.1 的分類
- perennial: no                    ← yes = 長青(如 ask-the-world,永不退熱)
- commonality: expressing affection through gifts, attention, and reciprocal gestures ← 先寫清楚跨國共通性,不要用單一日期命名

## observance TW valentines         ← ISO 國碼 + 該國在 Topic 內唯一 key;同一國可有多筆
- local_name: 情人節               ← 該地方表現的在地名稱
- date: 02-14                      ← 固定日期,MM-DD
- rank: 1                          ← 該地方表現在該國的排序(可省略)
- source: https://example.com/a     ← 佐證來源,**至少一個,可重複多行**
- source: https://example.com/b

## observance TW qixi
- local_name: 七夕情人節
- date_rule: 農曆七月初七           ← 非固定日期用 date_rule
- source: https://example.com/c

## observance JP tanabata
- local_name: 七夕(たなばた)
- date: 07-07
- source: https://example.com/d

## observance JP white-day
- local_name: ホワイトデー
- date: 03-14
- source: https://example.com/e

## locale zh-TW                    ← 七語各一段,**缺一個匯入就報錯**
### title
人們如何表達愛意？
### summary
不同社會用節日、禮物與回禮表達親密關係。這個 Topic 比較各地的共同情感與不同規則,不把任何一種節日當成全球唯一標準。
### keywords
表達愛意, 親密關係, 禮物, 回禮  ← 逗號分隔
### customs TW valentines       ← 每個 observance 都要有七語 customs
台灣的 2 月 14 日常被當作表達心意的節點,但參與方式會因年齡、關係與商業脈絡而異。
### customs TW qixi
台灣也有以農曆七月初七談論愛情與相會的語境,但「七夕情人節」不是所有人都以相同方式實踐。
### customs JP tanabata
日本的七夕以短冊祈願、竹飾與季節性公共活動為核心,其中也保留織姫與彦星相會的故事,不宜只翻成情人節。
### customs JP white-day
日本的白色情人節與 3 月 14 日回禮習慣相關,回禮內容與是否回禮會依人際關係和個人選擇而異。

## locale en
### title
How do people express affection?
### summary
...(其餘六語同構;可先寫好 zh-TW 後請 Claude 翻譯補齊,但檔案裡七語都要在)
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

# 只想先寫 zh-TW、讓 Claude 翻其餘六語
#   把 zh-TW 段寫好後,把檔案丟給 claude 補完其餘六個 locale 段即可;
#   匯入器會擋「缺語系」,所以不會有半成品進資料庫。
```
