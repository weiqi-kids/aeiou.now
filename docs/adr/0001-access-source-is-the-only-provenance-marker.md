---
status: accepted
---

# access_source 是 Topic 來源的唯一標記，category 只承載主題分類

Topic 有兩個彼此獨立的軸：**從哪來**（人工編輯／分類推導／外部趨勢）與**在講什麼**（產品草案的主題分類）。
趨勢管線上線時把 `'trend'` 同時寫進 `access_source` 與 `category`，等於用兩個欄位記同一件事，
並且把「來源」這個值塞進了「分類」這條軸——趨勢不是一種主題。

我們決定：**`access_source` 是判斷 Topic 來源的唯一正典標記**，`category` 回歸純粹的主題分類，
任何 Topic（含趨勢 Topic）都必須有真實的主題分類。

## Considered Options

- **另開 `topics.owner = human | machine`**：語意最直白，但 `access_source` 本來就是為這件事設的
  （schema 註解寫「誰設定的，供稽核與覆寫判斷」），再加一欄是重複建模，且要改 schema 與所有寫入點。
- **維持雙欄位現狀**：改動最小，但分類軸永久被汙染，且任何要「列出所有美食 Topic」的查詢都得記得排除 `'trend'`。

## Consequences

- **(2026-08-19 已處理)** 本 ADR 寫成時，`scripts/export-data.mjs` 的 `isMachineTrendTopic()`
  嗅探了一整排欄位名（`topic_kind`/`topic_type`/`kind`/`owner`/`ownership`/`topic_owner`/
  `origin`/`provenance`…），其中多數在 `topics` 表根本不存在。那種防禦性嗅探正是
  「沒有共同語彙」的病徵。已簡化為 `scripts/lib/topics.mjs` 的單一判準。
- 趨勢管線必須為它產生的每個 Topic 指派真實的主題分類。**如何指派尚未決定**——這是本 ADR
  留下的待解問題，不是已完成的事。
- `db/schema-host.sql` 與 `docs/02-data-model.md` 的 `access_source` 註解都還寫著
  `category|manual|moderation`，與實際值不符（實際有 `trend`、沒有 `moderation`），需一併更正。
