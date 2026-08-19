// 靜態資料的唯一讀取入口:src/data/(結構照 docs/02-data-model.md §9)。
// **檔案缺席一律回退為預設值** —— 不能依賴任何檔存在。

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const DATA_ROOT = join(process.cwd(), 'src', 'data');

export function readJson(rel, fallback = null) {
  const p = join(DATA_ROOT, rel);
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** Topic 的地方表現。新資料使用 observances；舊 fixture/data 可用 countries 讀取。 */