# Track E(= W5)交辦:CI/CD 與七站上線

**先讀**(缺一不可):
1. `/mnt/customers/aeiou.now/docs/briefs/_shared-context.md`(決策帳、介面常數、守門七條、明確延後、工作紀律)
2. `/mnt/customers/aeiou.now/site/package.json`(Track B 落地的 build 鏈——**CI 必須跑同一條**)
3. `/mnt/customers/aeiou.now/docs/briefs/track-b.md` W2.6(build 鏈定義)

**你的工作目錄**:`/mnt/customers/aeiou.now/`
**你不 commit、不 push。** 完成後回報,由主對話統一 commit 並觸發。

---

## 背景:三個必踩的坑(先講,免得你重踩)

1. **GitHub Pages deploy-from-branch 會走 Jekyll**,`_astro/` 這種底線開頭的目錄**會被丟棄**。所以推 `dist/` 到 publish repo 時**必須一併寫入 `.nojekyll`**。這不是選配。
2. **deploy key 是 SSH 機制,走 HTTPS 是死路**。CI 推 publish repo 一律用 `git@github.com:weiqi-kids/aeiou-pages-<x>.git` + ssh-agent(或 `GIT_SSH_COMMAND`)+ github.com known_hosts。(主機端 cron 才是 gh HTTPS credential helper,兩者不同機制,別混。)
3. **Pages 部署在 publish repo 非同步發生**,push 完立刻 curl 必 404。要**帶重試輪詢**。且**不要**用 `gh api repos/<publish>/pages/builds` 輪詢——CI 的 `GITHUB_TOKEN` 沒有他 repo 的權限,必 403。**只能打站台 URL 本身。**

---

## 工作項目

### W5.1 workflow → `.github/workflows/build.yml`

必須全部滿足:

| 條款 | 規定 |
|---|---|
| 觸發 | `schedule: '17 * * * *'`(**刻意錯開整點**,避免與主機整點 push 互踩)+ `push`(main)+ `workflow_dispatch` |
| matrix | 七語系,每筆含 `locale`、`repo`、`base_path`、**`secret_suffix`** |
| deploy key 取用 | `secrets[format('DEPLOY_KEY_{0}', matrix.secret_suffix)]` (GitHub secrets 只准 `[A-Z0-9_]`,故 locale 轉大寫底線) |
| build | cwd = `site/`,跑 **Track B 在 `package.json` 定義的完整 build 鏈(含 `copy-data`)**,不要在 CI 裡另寫一條 |
| `PUBLIC_API_URL` | 用派工訊息給你的 workers.dev 網址(workflow env) |
| 推送 | **SSH remote** + `.nojekyll` + dist 無變更則 skip |
| **不放 indexnow job** | 網域未註冊,IndexNow/GSC/sitemap 提交全部延後 |

matrix 對照表(唯一映射,照抄):

| locale | repo | secret_suffix | base_path |
|---|---|---|---|
| `zh-TW` | `weiqi-kids/aeiou-pages-zh-tw` | `ZH_TW` | `/aeiou-pages-zh-tw` |
| `en` | `weiqi-kids/aeiou-pages-en` | `EN` | `/aeiou-pages-en` |
| `ja` | `weiqi-kids/aeiou-pages-ja` | `JA` | `/aeiou-pages-ja` |
| `zh-CN` | `weiqi-kids/aeiou-pages-zh-cn` | `ZH_CN` | `/aeiou-pages-zh-cn` |
| `hi` | `weiqi-kids/aeiou-pages-hi` | `HI` | `/aeiou-pages-hi` |
| `id` | `weiqi-kids/aeiou-pages-id` | `ID` | `/aeiou-pages-id` |
| `pt-BR` | `weiqi-kids/aeiou-pages-pt-br` | `PT_BR` | `/aeiou-pages-pt-br` |

node 用 v22、pnpm 用 v10(對齊主機的 node v22.22.0 / pnpm 10.32.1)。

**驗收**:貼出 `build.yml` 全文,逐條對照上表說明滿足在哪一行。

---

### W5.2 Pages 開通

7 個 publish repo 設 Pages:**deploy from branch,`main` / `root`**,用 `gh api`。

**驗收**:各 repo 的 Pages 設定查得到(`gh api repos/weiqi-kids/aeiou-pages-<x>/pages`)。

---

### W5.3 verify + 告警

在 `build.yml` 內加 verify job(或同 job 的後段步驟):

- 對站台 URL **輪詢**:間隔 15s、上限 5 分鐘,直到首頁 200。
- 首頁 200 後,**再驗任一 `_astro/` 資產 200**(這是 Jekyll 有沒有吃掉底線目錄的唯一證據)。
- **不打他 repo 的 Pages API**(必 403)。
- 失敗發 Slack(secret 名 `SLACK_WEBHOOK_URL`);**secret 不存在時 gracefully skip**,不要讓沒設 Slack 就整條紅掉。

**驗收**:workflow 內含輪詢邏輯與 skip 邏輯,指出在哪幾行。

---

### W5.4 實跑

觸發一次(`push` 或 `workflow_dispatch`),等它跑完。

**驗收**:
- Actions **全綠** run 連結
- **七站首頁 curl 200**
- **七站各任一 `_astro/` 資產 curl 200**

---

## ⛔ 可能的卡點(先講清楚)

主對話那邊 **`gh repo create` 與 `gh api -X POST .../repos` 都被權限分類器擋下**,所以:

- **8 個 repo(source + 7 publish)可能尚未存在**
- **7 對 deploy key 可能尚未布署**(W0.5)

派工訊息會告訴你當下的實際狀態。若 repo 不存在:

1. **W5.1 照樣完整寫出 `build.yml`**(這不需要 repo 存在)。
2. **W5.2 / W5.4 標 ⛔**,附卡點與解鎖條件(需要的確切指令列出來,讓用戶一次核准)。
3. 你**可以嘗試一次** `gh repo create`;若同樣被擋,不要反覆重試,標 ⛔ 即可。

## 回報格式

逐項(W5.1–W5.4)給:做了什麼 → 驗收指令 → **實際輸出貼上**。
沒跑過的不准說跑過,沒綠的不准說綠。⛔ 項目附卡點與解鎖條件。
