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
export { dict };
