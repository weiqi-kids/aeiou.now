// copy-data:從根層 data/ 鏡像到 site/src/data/(track-b.md W2.3)。
// 規則:只在根層 data/「非空」時才覆蓋;為空時不動作(保住 site/src/data/ 的 fixture)。
// 「非空」= 遞迴找得到至少一個實體檔(.gitkeep / 隱藏檔不算)。
// cwd 一律 = site/(與 check-design.mjs 同前提;本地與 CI 同一條鏈)。
import { cpSync, rmSync, mkdirSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SRC = resolve(process.cwd(), '..', 'data');
const DEST = resolve(process.cwd(), 'src', 'data');

function hasRealFile(dir) {
  if (!existsSync(dir)) return false;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue; // .gitkeep、隱藏檔不算內容
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (hasRealFile(p)) return true;
    } else {
      return true;
    }
  }
  return false;
}

if (!hasRealFile(SRC)) {
  console.log(`copy-data:根層 data/ 為空(或不存在),不動作,保留 ${DEST} 現有內容(fixture)。`);
  process.exit(0);
}

rmSync(DEST, { recursive: true, force: true });
mkdirSync(DEST, { recursive: true });
cpSync(SRC, DEST, { recursive: true });
console.log(`copy-data:已從 ${SRC} 鏡像到 ${DEST}。`);
