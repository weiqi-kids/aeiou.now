# aeiou.now

全球議題平台(World → Topic → People → Place → Action),七語系市場:`zh-TW` `en` `ja` `zh-CN` `hi` `id` `pt-BR`。

一個議題,七種語言,七個市場怎麼看它——這個 repo 是它的全部原始碼。

## 這個 repo 裝什麼

```
docs/       架構(01)、資料模型(02,權威文件)、API 契約與交辦書(briefs/)
db/         三份 schema(common / host / d1)+ seed
data/       匯出的靜態 JSON(cron 產出並 commit,靜態站 build 時讀它)
scripts/    建庫、匯出、同步、翻譯、每小時推送
site/       Astro 靜態站(單一碼庫,LOCALE 決定 build 哪一語系)
api/        Cloudflare Worker(討論室 + 8H 即時 feed)
```

## 三方分工

| 層 | 跑在哪 | 做什麼 |
|---|---|---|
| 生產者 | 主機 cron + SQLite | 爬搜、Topic 生產、翻譯、匯出、同步 |
| 動態互動層 | Cloudflare Worker + D1 | 討論室(發文/留言/emoji reaction)、8H 即時 feed |
| 靜態閱讀層 | GitHub Pages ×7 | 七語系靜態站,每小時重建 |

靜態層與動態層**刻意解耦**:Cloudflare 掛掉時,主題內容、文化比較、排行、歷史精華照樣看得到,只有討論室顯示「暫時關閉」——**不做 fallback 快照,不顯示過期資料**。

## 快速上手

```bash
node scripts/init-db.mjs --host-only --seed   # 建主機庫並灌示範資料
node scripts/export-data.mjs                   # 匯出靜態 JSON 到 data/
cd site && LOCALE=zh-TW pnpm build             # build 一個語系(cwd 一律 site/)
```

開發約定、介面常數、守門七條與紅線見 **[CLAUDE.md](./CLAUDE.md)**;
資料結構以 **[docs/02-data-model.md](./docs/02-data-model.md)** 為準。

## 授權與現況

私人專案,尚未註冊網域。開發期靜態站掛在 `weiqi-kids.github.io/aeiou-pages-<locale>/`,
Worker 掛在 workers.dev。**API 尚未加 bot 防護,網址不對外宣傳。**
