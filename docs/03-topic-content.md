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
- source: https://www.maff.go.jp/j/seisan/kaki/flower/attach/pdf/index-113.pdf     ← 佐證來源,**至少一個,可重複多行**
- source: https://www.britannica.com/topic/Valentines-Day

## observance TW qixi
- local_name: 七夕情人節
- date_rule: 農曆七月初七           ← 非固定日期用 date_rule
- source: https://nit.immigration.gov.tw/Multicultural/Detail/1000013

## observance JP tanabata
- local_name: 七夕(たなばた)
- date: 07-07
- source: https://www.ndl.go.jp/koyomi/chapter3/

## observance JP white-day
- local_name: ホワイトデー
- date: 03-14
- source: https://www.maff.go.jp/j/seisan/kaki/flower/attach/pdf/index-113.pdf

## locale zh-TW                    ← 七語各一段,**缺一個匯入就報錯**
### title
人們如何表達愛意？
### summary
情人節、七夕和白色情人節不在同一天,也不遵守同一套送禮規矩。有人送巧克力,有人交換卡片,有人把它當成商業檔期,這些差別就是比較的起點。
### keywords
表達愛意, 親密關係, 禮物, 回禮  ← 逗號分隔
### customs TW valentines       ← 每個 observance 都要有七語 customs
### date_rule TW valentines     ← 有 `- date_rule:` 的 observance,zh-TW 以外六語都要有
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

## 新增一個 Topic 需要三樣東西(缺一不可;2026-08-20 補)

| 要件 | 路徑 | 缺了會怎樣 |
|---|---|---|
| Topic 內容 | `content/topics/<slug>.md` | 匯入器擋下該檔 |
| 年度日期 | `content/observance-occurrences.json` | `import-topic-occurrences.mjs` **exit 1** |
| **封面圖 1200×675 PNG** | `site/public/covers/<slug>.png` | `check-topic-calendar.mjs` **exit 1** |
| taxonomy 白名單 | `scripts/check-final-topic-taxonomy.mjs` 的 `FINAL_SLUGS`(硬編碼) | 該閘門擋下 |

**封面圖怎麼產**(2026-08-20 起自動化):

```bash
node scripts/generate-topic-cover.mjs --slug <slug> --prompt "……場景描述……"
```

走 `codex exec` 的內建 `image_gen`(ChatGPT 訂閱 CLI,`/root/.local/bin/codex`),
**不需要 OPENAI_API_KEY,也不准借用 `/root/folk.tw-api` 那把——那是別站的帳**
(紅線見 `/root/CLAUDE.md`「共用服務帳號的爆炸半徑」)。
風格約束寫死在腳本裡以維持全站一致,**場景描述是人給的,腳本不代寫**。
硬性:畫面不得出現任何文字(AI 生成的文字必是亂碼;宗教主題的亂碼經文會冒犯讀者)。
腳本直接讀 PNG 檔頭驗尺寸,不採信 codex 回報的 DONE;既有檔案不預設覆蓋,要換帶 `--force`。

⚠️ **後三項的失敗都是整條管線停擺,不是「這個 Topic 不上線」**——
`hourly-export.sh` 是 fail-closed 的,任一步非 0 就中止,線上**所有**資料跟著停更。
所以四樣東西要嘛一起進,要嘛一起不進;寫好但還缺 cover 的 Topic 放
`content/topics-pending/`(該目錄不在任何管線的掃描路徑上),別放 `content/topics/`。

⚠️ **`import-topics.mjs` 無視 `AEIOU_DB_PATH`**——它沒走 `lib/aeiou-lib.mjs` 的
`CONFIG.dbPath`,而是自己 `const DB_PATH = join(ROOT,"db","aeiou.sqlite")` 寫死。
想拿測試庫試跑會直接寫進正式庫(2026-08-20 踩過,清乾淨要手動 DELETE 六張表:
`topic_observance_i18n`、`topic_observance_occurrences`、`topic_observances`、
`topic_cycles`、`topic_i18n`、`topics`)。驗「清乾淨了沒」的方法是跑 `export-data.mjs`
再看 `git status --porcelain data/` 是不是空的。

## 硬規則(匯入器會擋,錯誤訊息會講清楚缺什麼)

1. **七語都要有**(`zh-TW` `en` `ja` `zh-CN` `hi` `id` `pt-BR`),每語至少要 `### title`。
2. **每個 observance 至少一個 `source`**——`source_ids_json` 是必填。每一條文化事實都要能點回原始來源,
   這是內容品質,也是對 Google「scaled content abuse」政策的正面抗辯(草案 §44 註)。
3. **每個 `## observance XX key` 在七語都要有對應的 `### customs XX key`**——事實一份、七語各自呈現。
3b. **有 `- date_rule:` 的 observance,在 zh-TW 以外的六語都要有 `### date_rule XX key`**
   (2026-08-21 起,匯入會擋)。zh-TW 不用寫——`- date_rule:` 那一行本身就是中文原文,
   再抄一次只會製造兩份會漂移的同一句話。
   **為什麼要六語**:這段字會出現在七個站的「快速回答」表的「日期怎麼定」欄,
   而原文 100% 是中文;沒有本地語言版本就等於對五個非漢字站漏中文。
   補譯不用手打:`node scripts/translate-date-rules.mjs`(冪等,只補缺的;
   `--dry-run` 先看要補什麼)。
4. `date` 格式 `MM-DD`;非固定日期(農曆、第 N 個星期日…)寫 `date_rule`,跨日區間用 `date_end`。
5. Topic slug 與 observance key 只准 `a-z0-9-`。
6. **每個 Topic 都要填 `commonality`**——它是分類依據；日期是 observance 的觸發資料，不是 Topic 的主鍵。

### 來源怎麼找(2026-08-19 用戶指示;每次都要這樣做)

**一律先用當地語言查該國官方網域,英文頁只當補充。** 只用英文搜尋會系統性地把來源拉向
觀光推廣站與英文百科,那些頁面在該國不具權威、也常年久失修。

| 國家 | 先搜的語言 | 官方網域 |
|---|---|---|
| 台灣 | 繁體中文 | `*.gov.tw`(法規查 `law.moj.gov.tw`) |
| 日本 | 日本語 | `*.go.jp`(法令查 `laws.e-gov.go.jp`) |
| 中國 | 简体中文 | `*.gov.cn` |
| 印度 | हिन्दी／English | `*.gov.in`、`*.nic.in` |
| 印尼 | Bahasa Indonesia | `*.go.id` |
| 巴西 | Português | `planalto.gov.br`、`*.gov.br` |
| 美國 | English | `*.gov`(國會查 `congress.gov`、`history.house.gov`) |

⚠️ `japan.travel` 是 `.travel` 頂級網域,**不是**日本政府網域;`*.travel`、`*.org` 的觀光
或推廣站一律不算該國官方來源。閘門 R6 會擋:`node scripts/check-content-depth.mjs --report`。

⚠️ **驗連結不能只看狀態碼**,要看跟完 redirect 之後落在哪裡;而且同一個網址從不同網路
可能拿到不同狀態碼,判死前要複驗。兩個坑的緣由見 `docs/TODO.md` §「事故:兩種
『狀態碼騙人』的來源」(2026-08-20)。改完來源一定要跑:

```bash
node scripts/check-source-urls.mjs
```

它讀 `data/`(不吃 SQLite,所以 CI 也跑得動),判準**不是狀態碼**:
只有 404/410、以及**跟完 redirect 落在錯誤頁或登入牆**才 ERROR 並 exit 1;
403/412/429/5xx/連線失敗一律 WARN —— 那是對方擋機器人或暫時故障,
不該因為別人的 WAF 就擋下自己的部署。它**刻意不掛進 hourly-export**
(那會把別人的網站狀態綁進本站的發佈路徑)。

### 年度日期(上線排序的權威資料)

`date_rule` 只給讀者看文化規則，不能拿來在前端推算公曆日期。每個 active observance 都必須在
`content/observance-occurrences.json` 有目前年度與下一年度的 occurrence；每筆包含 `starts_on`、
`ends_on`、`calendar_system`、IANA `timezone`、`date_status` 與該年度日期來源。日期未確認時填
`estimated` 或 `local-variant`，不能省略，也不能自行捏造固定日。

在地地點與活動不是 Topic markdown 的欄位。第一批人工採集樣本放在
`content/local-sample-data.json`，由 `node scripts/update-local-data.mjs` 驗證來源、清理過期活動後匯入；
`content/local-data-sources.json` 保存七市場的搜尋候選詞與官方頁面核對規則；
每筆地點／活動以 `topic_slugs` 明確指定它直接對應的 Topic，匯入後分別寫入
`place_topics`／`event_topics`，不能再使用一個全域 Topic 欄位；
每筆都要有官方或主辦方來源。`places` 只收可持續到訪、且與該 Topic 直接相關的常設地點
（`place_type: "permanent"`、`topic_relevance: "direct"`），`events` 只收有明確日期、
場地與來源的活動；活動場地不能因為辦過一場活動就直接變成 `places`。替換錯誤地點時，
舊列可列在 `retired_place_ids` 供一次性清理，但不會再被發布。

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
