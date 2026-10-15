// AEIOU_DB_PATH 必須讓 Topic 匯入只寫指定的庫(2026-10-15)。
// scripts/topic-gate.mjs 靠這一點把 seo-ops 大腦的閘門關在暫存庫裡;
// 若某支腳本又寫死 db/aeiou.sqlite,閘門失敗時正式庫會留下孤兒 Topic,
// hourly-export 的 check-topic-calendar 就會擋下整條匯出(docs/03-topic-content.md)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("Topic 閘門鏈上的腳本都吃 AEIOU_DB_PATH", () => {
  for (const f of ["import-topics.mjs", "retire-merged-topics.mjs", "check-topic-calendar.mjs", "import-topic-occurrences.mjs", "export-data.mjs"]) {
    const src = readFileSync(join(ROOT, "scripts", f), "utf8");
    assert.match(src, /process\.env\.AEIOU_DB_PATH \|\|/, `${f} 必須以 AEIOU_DB_PATH 覆寫 DB_PATH`);
  }
});

test("import-topics 寫進 AEIOU_DB_PATH 指定的庫", () => {
  // 先靜態確認再實跑:若覆寫被拿掉,實跑會直接寫進本機正式庫。
  for (const f of ["import-topics.mjs", "retire-merged-topics.mjs"]) {
    assert.match(readFileSync(join(ROOT, "scripts", f), "utf8"), /process\.env\.AEIOU_DB_PATH \|\|/, `${f} 不吃 AEIOU_DB_PATH,不實跑`);
  }
  const dir = mkdtempSync(join(tmpdir(), "aeiou-dbpath-test-"));
  try {
    const dbPath = join(dir, "aeiou.sqlite");
    const db = new DatabaseSync(dbPath);
    for (const f of ["schema-common.sql", "schema-host.sql"]) db.exec(readFileSync(join(ROOT, "db", f), "utf8"));
    db.close();

    const r = spawnSync(process.execPath, [join(ROOT, "scripts", "import-topics.mjs")], {
      cwd: ROOT,
      env: { ...process.env, AEIOU_DB_PATH: dbPath },
      encoding: "utf8",
    });
    const check = new DatabaseSync(dbPath, { readOnly: true });
    const n = check.prepare("SELECT COUNT(*) AS n FROM topics").get().n;
    check.close();
    const mdCount = readdirSync(join(ROOT, "content", "topics")).filter((f) => f.endsWith(".md")).length;
    assert.ok(n >= mdCount, `暫存庫應有 ≥${mdCount} 個 Topic,實際 ${n}(stderr: ${r.stderr.slice(-400)})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
