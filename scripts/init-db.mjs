#!/usr/bin/env node
// aeiou.now — 建庫腳本
//   node scripts/init-db.mjs --host-only   主機 SQLite = schema-common + schema-host
//   node scripts/init-db.mjs --d1-only     Cloudflare D1 = schema-common + schema-d1
//   node scripts/init-db.mjs --host-only --seed   建完順便灌 db/seed/*.sql
//
// 權責:主機庫由 W1 建;D1 的 create 與灌 schema 歸 W3(避免平行波次搶建)。
import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DB_PATH = join(ROOT, "db", "aeiou.sqlite"); // 介面常數,不得改
const D1_NAME = "aeiou-ugc"; // 介面常數,不得改

const args = process.argv.slice(2);
const hostOnly = args.includes("--host-only");
const d1Only = args.includes("--d1-only");
const withSeed = args.includes("--seed");

if (hostOnly === d1Only) {
  console.error("用法:node scripts/init-db.mjs (--host-only | --d1-only) [--seed]");
  process.exit(2);
}

const sqlFile = (name) => join(ROOT, "db", name);

function initHost() {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const f of ["schema-common.sql", "schema-host.sql"]) {
    db.exec(readFileSync(sqlFile(f), "utf8"));
    console.log(`已套用 ${f}`);
  }
  db.close();
  execFileSync(process.execPath, [join(ROOT, "scripts", "migrate-topic-observances.mjs")], {
    cwd: ROOT,
    stdio: "inherit",
  });
  const migratedDb = new DatabaseSync(DB_PATH);
  migratedDb.exec("PRAGMA foreign_keys = ON;");
  if (withSeed) {
    const seedDir = join(ROOT, "db", "seed");
    if (existsSync(seedDir)) {
      for (const f of readdirSync(seedDir).filter((n) => n.endsWith(".sql")).sort()) {
        migratedDb.exec(readFileSync(join(seedDir, f), "utf8"));
        console.log(`已灌 seed/${f}`);
      }
    }
  }
  migratedDb.close();
  execFileSync(process.execPath, [join(ROOT, "scripts", "retire-merged-topics.mjs")], {
    cwd: ROOT,
    stdio: "inherit",
  });
  const finalDb = new DatabaseSync(DB_PATH);
  finalDb.exec("PRAGMA foreign_keys = ON;");
  const tables = finalDb
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  finalDb.close();
  console.log(`\n主機庫 ${DB_PATH}`);
  console.log(`表 ${tables.length} 張:\n  ${tables.join("\n  ")}`);
}

function initD1() {
  // 主機沒有全域 wrangler 指令,一律 npx wrangler
  for (const f of ["schema-common.sql", "schema-d1.sql"]) {
    console.log(`--- ${f} → D1 ${D1_NAME} ---`);
    execFileSync(
      "npx",
      ["wrangler", "d1", "execute", D1_NAME, "--remote", "--file", sqlFile(f)],
      { cwd: join(ROOT, "api"), stdio: "inherit" }
    );
  }
}

if (hostOnly) initHost();
else initD1();
