# content/topics-pending/ — 寫好了但還不能上線的 Topic

**這個目錄不在任何管線的掃描路徑上**(`import-topics.mjs`、`review-topic-content.mjs`、
`check-topic-calendar.mjs` 都只讀 `content/topics/`),所以放在這裡不會影響每小時匯出。

## 為什麼會有這個目錄

新增一個 Topic 需要三樣東西,其中一樣我做不出來:

| 要件 | 誰能做 |
|---|---|
| `content/topics/<slug>.md`(七語 × 各國 observance × 官方來源) | Claude |
| `content/observance-occurrences.json` 的年度日期 | Claude |
| **`site/public/covers/<slug>.png`(1200×675)** | **只有用戶**——現有 38 張都是寫實風格的 AI 生成照片,風格是產品決定 |

**沒有 cover 就不能把 `.md` 放進 `content/topics/`**——`check-topic-calendar.mjs` 是
`hourly-export.sh` 的第 4 步且 fail-closed,缺 cover 會讓**整條每小時匯出停擺**,
線上所有資料跟著停更(不只是這個 Topic 不上線)。同理,`observance-occurrences.json` 裡
如果有對不到 active observance 的列,`import-topic-occurrences.mjs` 會 exit 1,一樣擋住管線。
所以 md 與 occurrence 兩份要一起搬,不能只搬一份。

## cover 補上之後怎麼上線

```bash
# 1. 把 cover 放好(1200×675 PNG)
#    site/public/covers/womens-day.png
# 2. 搬 md
mv content/topics-pending/womens-day.md content/topics/womens-day.md
# 3. 把 occurrence 併回主檔(附的是 JSON 陣列片段,併進 .occurrences)
python3 - <<'PY'
import json
main='content/observance-occurrences.json'
d=json.load(open(main,encoding='utf8'))
add=json.load(open('content/topics-pending/womens-day.occurrences.json',encoding='utf8'))
have={(o['topic_slug'],o['country_code'],o['observance_key'],o['occurrence_year']) for o in d['occurrences']}
d['occurrences'] += [o for o in add if (o['topic_slug'],o['country_code'],o['observance_key'],o['occurrence_year']) not in have]
d['occurrences'].sort(key=lambda o:(o['topic_slug'],o['country_code'],o['observance_key'],o['occurrence_year']))
json.dump(d,open(main,'w',encoding='utf8'),ensure_ascii=False,indent=2); open(main,'a').write('\n')
PY
# 4. 把 slug 加進 scripts/check-final-topic-taxonomy.mjs 的 FINAL_SLUGS(硬編碼清單,不加會被擋)
# 5. 依序驗(全部要 exit 0,任一支非 0 就不要 commit):
for s in import-topics import-topic-occurrences check-topic-calendar review-topic-content \
         check-data-completeness check-content-depth check-final-topic-taxonomy; do
  node scripts/$s.mjs >/dev/null 2>&1; echo "$s exit=$?"
done
node scripts/check-source-urls.mjs      # 來源存活;exit 1 代表有死連結
rm content/topics-pending/womens-day.occurrences.json
```

⚠️ **不要用 `AEIOU_DB_PATH` 想把 `import-topics.mjs` 導到測試用 DB**——那支**沒有**走
`lib/aeiou-lib.mjs` 的 `CONFIG.dbPath`,而是自己 `const DB_PATH = join(ROOT,"db","aeiou.sqlite")`
寫死,環境變數會被無視、直接寫進正式庫(2026-08-20 踩過,得手動 DELETE 六張表才清乾淨)。
要試就接受它會寫正式庫,並準備好回滾。
