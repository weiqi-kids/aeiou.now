#!/usr/bin/env node
// aeiou.now — Topic 內容閘門(暫存庫版;2026-10-15 新增)
//
//   node scripts/topic-gate.mjs
//
// 為什麼要有這支:自動層(seo-ops 大腦)改/新增 content/topics/<slug>.md 之後,
// 要先跑 import-topics → check-topic-calendar → import-topic-occurrences → export-data
// 確認能過,才可以 commit。以前這幾支直接寫主機正式庫 db/aeiou.sqlite:
// 閘門後段任一步失敗、md 被撤回,正式庫卻已多出一個沒封面的 active Topic(import 不會
// 因為 md 消失而刪 row),下一輪 hourly-export 的 check-topic-calendar(fail-closed)
// 就擋下整條匯出,七站資料全停(docs/03-topic-content.md「四樣東西要嘛一起進」)。
//
// 做法:把正式庫 VACUUM INTO 一份到暫存檔,用 AEIOU_DB_PATH 讓四支腳本只碰那份,
// 跑完(不論成敗)刪掉。**正式庫只被唯讀開過一次**。export-data 仍會寫工作樹的 data/
// —— 後面的 build 要吃它;data/ 是 hourly-export 的受管產物,呼叫端不得 commit(seo-ops
// 把 data/ 列在 cleanupPaths)。
//
// 與 hourly-export 的差異:這裡 import-topics 任一檔失敗就算閘門不過(hourly 容忍單檔失敗,
// 因為它面對的是已上線的整批;閘門面對的是這一次的改動)。
//
// 環境變數:
//   AEIOU_GATE_SOURCE_DB  要複製的來源庫(預設 db/aeiou.sqlite;測試用)
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DB = process.env.AEIOU_GATE_SOURCE_DB || join(ROOT, "db", "aeiou.sqlite");
const STEPS = [
  "import-topics.mjs",
  "check-topic-calendar.mjs",
  "import-topic-occurrences.mjs",
  "export-data.mjs",
];

if (!existsSync(SOURCE_DB)) {
  console.error(`✗ 找不到來源庫 ${SOURCE_DB}(先跑 node scripts/init-db.mjs --host-only)`);
  process.exit(2);
}

const tmpDir = mkdtempSync(join(tmpdir(), "aeiou-topic-gate-"));
const tmpDb = join(tmpDir, "aeiou.sqlite");
let code = 0;
try {
  const src = new DatabaseSync(SOURCE_DB, { readOnly: true });
  src.exec("PRAGMA busy_timeout = 15000;");
  src.exec(`VACUUM INTO '${tmpDb.replace(/'/g, "''")}'`);
  src.close();
  console.log(`暫存庫:${tmpDb}(來源 ${SOURCE_DB},正式庫不寫入)`);

  const env = { ...process.env, AEIOU_DB_PATH: tmpDb };
  for (const step of STEPS) {
    console.log(`\n── ${step}`);
    const r = spawnSync(process.execPath, [join(ROOT, "scripts", step)], { cwd: ROOT, env, stdio: "inherit" });
    if (r.status !== 0) {
      console.error(`\n✗ Topic 閘門未過:${step} exit ${r.status ?? r.signal}`);
      code = 1;
      break;
    }
  }
  if (!code) console.log("\nTopic 閘門通過(暫存庫)。");
} finally {
  rmSync(tmpDir, { recursive: true, force: true });
}
process.exit(code);
