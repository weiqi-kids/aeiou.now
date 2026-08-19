// 把 node:sqlite 包成 D1 的形狀,讓 Worker 可以在 node --test 底下原封不動地跑。
//
// 為什麼不用 @cloudflare/vitest-pool-workers:本專案的既有慣例是零 npm 依賴 + node --test
// (見 scripts/lib/aeiou-lib.mjs 檔頭與 tests/trends/)。Worker 只用到 D1 的六個方法,
// 蓋一層 shim 比引進一整套 runtime 便宜太多,也不必為了測試改動 Worker 的碼。
//
// 覆蓋的 D1 介面:prepare / bind / first / all / run / batch。
// **沒有覆蓋的**:D1 的 meta 統計、exec()、raw()。用到那些的碼測不到,要記得。

import { DatabaseSync } from "node:sqlite";
import { timingSafeEqual as require$crypto_tse } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** D1 的 prepared statement:bind() 回傳新的一份,不改動原件(與 D1 行為一致)。 */
class Stmt {
  #db; #sql; #args;
  constructor(db, sql, args = []) { this.#db = db; this.#sql = sql; this.#args = args; }
  bind(...args) { return new Stmt(this.#db, this.#sql, args); }

  #prep() { return this.#db.prepare(this.#sql); }

  async first(column) {
    const row = this.#prep().get(...this.#args);
    if (row === undefined) return null;
    return column === undefined ? row : (row[column] ?? null);
  }
  async all() {
    return { results: this.#prep().all(...this.#args), success: true };
  }
  async run() {
    const info = this.#prep().run(...this.#args);
    return { success: true, meta: { changes: Number(info.changes ?? 0), last_row_id: Number(info.lastInsertRowid ?? 0) } };
  }
  /**
   * batch 專用:回傳 D1Result 的完整形狀 `{ success, meta, results }`。
   * **不能拿 run() 頂替** —— D1 的 batch 可以混 SELECT,呼叫端會讀 .results
   * (api/src/index.js 的 rateLimit 就是這樣算視窗內事件數的)。
   * node:sqlite 的 all() 對 INSERT/DELETE 一樣會執行,只是回空陣列,所以統一用它。
   */
  async _batchExec() {
    return { success: true, meta: {}, results: this.#prep().all(...this.#args) };
  }
}

class D1 {
  #db;
  constructor(db) { this.#db = db; }
  prepare(sql) { return new Stmt(this.#db, sql); }
  /** D1 的 batch 是單一 transaction;這裡照做,任一句失敗整批回滾。 */
  async batch(stmts) {
    this.#db.exec("BEGIN");
    try {
      const out = [];
      for (const s of stmts) out.push(await s._batchExec());
      this.#db.exec("COMMIT");
      return out;
    } catch (e) {
      this.#db.exec("ROLLBACK");
      throw e;
    }
  }
}

/**
 * 建一個空的記憶體 D1,schema 與線上同源:schema-common + schema-d1
 * (與 scripts/init-db.mjs 的 --d1-only 同一組,改了那邊這裡自動跟上)。
 */
export function makeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (const f of ["schema-common.sql", "schema-d1.sql"]) {
    db.exec(readFileSync(join(ROOT, "db", f), "utf8"));
  }
  return { DB: new D1(db), raw: db };
}

/** Worker 期待的 ctx。waitUntil 同步跑完,測試才看得到副作用(例如限流計數)。 */
export function makeCtx() {
  const pending = [];
  return {
    ctx: { waitUntil: (p) => { pending.push(p); } },
    settle: () => Promise.all(pending),
  };
}

/**
 * Workers 的 crypto.subtle 有 timingSafeEqual,Node 沒有(Node 放在 node:crypto)。
 * 這是 runtime 差異,不是 Worker 的問題 —— 補上去,Worker 的碼才不必為了測試改。
 */
export function installWorkerCryptoShim() {
  if (typeof crypto.subtle.timingSafeEqual === "function") return;
  const timingSafeEqual = require$crypto_tse;
  crypto.subtle.timingSafeEqual = (a, b) => {
    const ua = new Uint8Array(a instanceof ArrayBuffer ? a : a.buffer ?? a);
    const ub = new Uint8Array(b instanceof ArrayBuffer ? b : b.buffer ?? b);
    if (ua.length !== ub.length) return false;
    return timingSafeEqual(ua, ub);
  };
}

/** 組一個帶 anon cookie 的 Request。 */
export function req(path, { method = "GET", body, anonId, origin = "https://aeiou.now", headers = {} } = {}) {
  const h = new Headers({ origin, ...headers });
  if (anonId) h.set("cookie", `anon_id=${anonId}`);   // 名稱必須與 getAnonId 一致
  if (body !== undefined) h.set("content-type", "application/json");
  return new Request(`https://aeiou-api.test${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
