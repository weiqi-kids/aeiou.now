# Track B(= W2)交辦:Astro 七語系靜態站

**先讀**(缺一不可,順序如下):
1. `/root/aeiou.now/docs/briefs/_shared-context.md`(決策帳、介面常數、**守門七條**、明確延後、工作紀律)
2. `/root/aeiou.now/docs/briefs/api-contract.md`(**你與 Track C 平行開發的唯一契約**;前端該怎麼打 API、feed 回什麼形狀,全在裡面。特別看 §6「前端對本契約的最小使用」)
3. `/root/aeiou.now/docs/02-data-model.md` §9(靜態 JSON 目錄結構)

**你的工作目錄**:`/root/aeiou.now/site/`(目前是空目錄)
**你不 commit、不 push。** 完成後回報,由主對話統一 commit。
**Track A 正在平行產 `data/`,你不能依賴它存在**——自備 fixture(見 W2.3)。

---

## 守門七條(逐字遵守,這是團隊紅線)

1. **禁 px 字級**——一律 `var(--text-*)` 階梯,最小 18px,內文 ≥ `--text-base`
2. **顏色只准出現在 `src/styles/variables.css`**(oklch 為準 + hex fallback)
3. **禁 `!important`**
4. **禁外部 CDN**(fonts.googleapis / fonts.gstatic / cdnjs / unpkg / jsdelivr)——字型自託管。**唯一例外:`googletagmanager.com` 的 GA4 gtag**
5. **CSS 檔白名單**:只准 `src/styles/{variables,global}.css`,元件樣式寫 scoped `<style>`
6. **`--text-*` token 值一律 ≥18px**(`clamp()` 以最小值計)
7. **`build` 指令必須串 `check-design.mjs` 與 `check-content.mjs`**

**加嚴一條**:元件內連 `oklch(...)` 字面值也禁止(`check-design.mjs` 只攔 hex/rgb/hsl,攔不到 oklch——機械守門弱於紅線,靠你自律),一律 `var(--color-*)`。

---

## 工作項目

### W2.1 模板複製(原樣,不改)

從 `/root/.claude/skills/new-astro-site/templates/` 複製:

| 來源 | 目的地 |
|---|---|
| `variables.css` | `site/src/styles/variables.css` |
| `global.css` | `site/src/styles/global.css` |
| `BaseLayout.astro` | `site/src/layouts/BaseLayout.astro` |
| `robots.txt` | `site/public/robots.txt` |
| `check-design.mjs` | `site/scripts/check-design.mjs` |
| `check-content.mjs` | `site/scripts/check-content.mjs` |

**`check-design.mjs` 與 `check-content.mjs` 一個字都不准改。** 其餘檔案可在保持守門合規的前提下增修(BaseLayout 必須改:見 W2.5)。

**驗收**:`diff` 兩個守門腳本與模板,證明完全一致。

---

### W2.2 UI 字串 → `site/src/i18n/<locale>.json` ×7

七檔:`zh-TW.json` `en.json` `ja.json` `zh-CN.json` `hi.json` `id.json` `pt-BR.json`。
**zh-TW 為準源**,其餘六語由你翻譯產出(不是機翻佔位,要是該語系讀得懂的自然說法)。

必含的 key(至少):
- `room.closed`:「討論室暫時關閉」的該語版本
- `room.closed_hint`:一句說明(例:稍後再試,靜態內容不受影響)
- `post.translating`:「翻譯中」
- `post.original`:「原文」
- `post.show_original` / `post.hide_original`
- `nav.home` / `nav.rankings` / `nav.about`
- `home.trending`:「全球熱門」
- `topic.how_world_celebrates`:「全世界怎麼過」
- `topic.heat`:「熱度」
- `topic.room`:「討論室」
- `topic.highlights`:「歷史精華」
- `topic.places`:「相關店家」
- `topic.events`:「相關活動」
- `rankings.window.24h` / `72h` / `7d` / `1m` / `3m` / `1y`
- `room.compose_placeholder`、`room.submit`、`room.empty`
- `common.loading`、`common.error`

**驗收**:七檔存在,且 **key 集合完全一致**(附一個比對七檔 key 集合的指令輸出)。

---

### W2.3 頁面

單一碼庫,`LOCALE` 環境變數決定 build 哪一語系。全部走 env:

| env | 說明 |
|---|---|
| `LOCALE` | 七個之一,預設 `zh-TW` |
| `SITE_URL` | 預設 `https://weiqi-kids.github.io` |
| `BASE_PATH` | 預設 `/aeiou-pages-<locale 小寫>`;要正確設進 astro config 的 `base` |
| `PUBLIC_API_URL` | Worker 網址,**未設時前端完全不發 fetch**(見降級模型) |
| `PUBLIC_GA4_ID` | 未設則 BaseLayout 完全不輸出 gtag |

頁面:

- **首頁 `/`**:Global Trending(靜態,讀 `topics/index/<locale>.json`),列出 Topic 卡片連到 topic 頁。
- **`/topic/[slug]/`**:照草案 §44 版面,六個區塊都要有:
  1. **全世界怎麼過**(`topic_observances` + `topic_observance_i18n` 的 customs;同一國可有多個地方表現)
  2. **熱度七窗**(靜態只有六窗:24h/72h/7d/1m/3m/1y;**8h 屬動態,不出靜態**)
  3. **討論室**(W2.4,動態)
  4. **歷史精華**(`highlights.json`,M1 可為空陣列 → 顯示空狀態)
  5. **店家**(`places/<city>.json`,含導航連結)
  6. **活動**(`events/<city>.json`)
- **`/rankings/[window]/`**:六個 window 各一頁(24h/72h/7d/1m/3m/1y)。
- **`/about/`**:佔位頁即可。

**資料讀取**:讀 `site/src/data/`(結構照 `docs/02-data-model.md` §9)。
**fixture 直接預置在 `site/src/data/`**(該目錄本來就在根 `.gitignore` 裡,不會進 git)。fixture 要涵蓋兩個 topic(`affection-and-reciprocity`、`ask-the-world`)、≥4 國 customs、六窗 rankings、places/events 各一城市,好讓每個區塊都渲染得出東西。
**`topic_id` 必須從資料帶到討論室元件**——API 路徑參數是 topic_id,不是 slug。

**`copy-data` 腳本**(`site/scripts/copy-data.mjs`):從根層 `data/` 鏡像到 `site/src/data/`,但**只在根層 `data/` 非空時才覆蓋**;為空時**不動作**(保住你的 fixture)。本地與 CI 同一條鏈。

**驗收**:頁面存在且渲染出 fixture 內容(附 build 後 `dist/` 裡的 HTML 片段佐證)。

---

### W2.4 討論室元件(降級模型的落點)

- **靜態 HTML 預設就渲染 fallback**:該 locale 的 `room.closed` 文案,容器帶 **`data-room-state="closed"`**。
- JS `fetch(`${PUBLIC_API_URL}/v1/topics/${topicId}/feed?sort=hot&limit=20&comments=3`, { credentials: 'include' })`。
- **只有 fetch 成功且解析出 `posts` 陣列**才把容器改成 `data-room-state="open"`,替換成:feed 列表 + 發文框 + emoji reaction 列。
- 任何失敗(網路錯誤、非 2xx、JSON 壞掉)一律**保持 `closed`**,不顯示過期資料、不做 fallback 快照。
- `PUBLIC_API_URL` 未設時**完全不發 fetch**,永遠 `closed`。
- **emoji reaction 列固定七顆**,照 `REACTION_SET` = `["❤️","😂","😮","😢","🤔","🎉","👏"]`(**不含 👍**)。缺席的 emoji 顯示 0。
- **貼文內容 M1 一律純文字轉義顯示**(不做 Markdown 渲染,那是 M2)。用 `textContent` 之類的安全寫法,絕不 `innerHTML` 塞使用者內容。
- 譯文顯示:`translations[LOCALE]` 有值就顯示譯文並可展開原文;缺席時顯示原文 + `post.translating` 字串;`original_locale === LOCALE` 時直接顯示 `content`。

**驗收**:原始碼含兩態;`pnpm build` 產物 grep 得到 `data-room-state="closed"`。

---

### W2.5 GA4 tag

BaseLayout:`PUBLIC_GA4_ID` **有值才輸出** gtag snippet(`googletagmanager.com` 是守門的唯一外部例外);未設則完全不輸出。

**驗收**:無 env build 的 `dist/` **不含** gtag;有 env build 的**含**。附兩次 grep 輸出。

---

### W2.6 七語 build

`package.json` 的 `build` = `node scripts/copy-data.mjs && node scripts/check-design.mjs && node scripts/check-content.mjs && astro build`(cwd = `site/`,**本地與 CI 同一條鏈**)。

**驗收**:七個 locale **各 build 一次全綠**,列出 `dist/` 結構。
`check-content.mjs` 掃 `.md(x)`,M1 內容多為 `.astro`,掃描數可能為 0 ——**如實回報「已串進 build、本輪掃描 0 檔」**,不得宣稱「內容守門通過」以外的意思。

---

## 技術選擇

- Astro 最新穩定版,`output: 'static'`,`pnpm` 管理(主機已有 pnpm 10.32.1、node v22.22.0)。
- **不要裝 UI 框架**(React/Vue/Svelte 都不要),討論室用原生 `<script>`。
- 字型自託管或純系統堆疊(禁 Google Fonts)。
- **背景 dev/preview server 用完必 kill**(主機紅線)。驗收請用 `pnpm build` + 讀 `dist/`,不要留著 server。

## 回報格式

逐項(W2.1–W2.6)給:做了什麼 → 驗收指令 → **實際輸出貼上**。
沒跑過的不准說跑過,沒綠的不准說綠。有卡住的標 ⛔ 附卡點與解鎖條件。
