// UI 字串:src/i18n/<LOCALE>.json(扁平 key)。缺 key 直接 throw,讓 build 紅掉而不是悄悄漏字。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCALE } from './config.mjs';

const dict = JSON.parse(
  readFileSync(join(process.cwd(), 'src', 'i18n', `${LOCALE}.json`), 'utf8')
);

export function t(key) {
  if (!(key in dict)) throw new Error(`i18n key 缺漏:${LOCALE} 缺 "${key}"`);
  return dict[key];
}

// 資料驅動的 key(如 category.<資料裡的分類代碼>)才用這支:
// 生產端隨時可能出現前端沒見過的分類,那不該把 build 打紅,退回顯示原始代碼即可。
// UI 固定文案一律用 t(),缺 key 就要紅。
export function tOr(key, fallback) {
  return key in dict ? dict[key] : fallback;
}
export { dict };
