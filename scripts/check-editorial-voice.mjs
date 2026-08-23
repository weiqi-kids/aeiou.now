#!/usr/bin/env node
// aeiou.now — 讀者文案守門
//
// 這支只檢查產品介面文案，不碰 Topic 的事實內容。目的不是把每個語系翻成同一種
// 句型，而是防止首頁又退回產品簡報口吻：空泛的「平台」定位、引擎名詞、以及
// 把自動整理說成讀者價值。真正的內容仍由 content/topics/*.md 和來源守門負責。

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const I18N_DIR = join(ROOT, 'site', 'src', 'i18n');
const LOCALES = ['zh-TW', 'en', 'ja', 'zh-CN', 'hi', 'id', 'pt-BR'];
const REQUIRED = [
  'home.recent_topics', 'home.h1', 'home.intro', 'home.rankings_cta',
  'about.one_liner', 'about.not_a', 'about.it_is',
  ...Array.from({ length: 5 }, (_, i) => `about.position_${i + 1}`),
  'about.flow_title', ...Array.from({ length: 10 }, (_, i) => `about.flow_${i + 1}`),
];

const errors = [];
const warn = (message) => errors.push(message);
const fileFor = (locale) => join(I18N_DIR, `${locale}.json`);

for (const locale of LOCALES) {
  let copy;
  try {
    copy = JSON.parse(readFileSync(fileFor(locale), 'utf8'));
  } catch (error) {
    warn(`${locale}: 無法讀取或解析 i18n JSON（${error.message}）`);
    continue;
  }

  for (const key of REQUIRED) {
    if (typeof copy[key] !== 'string' || copy[key].trim().length === 0) {
      warn(`${locale}: 缺少讀者文案 ${key}`);
    }
  }

  const aboutValues = [
    copy['about.not_a'],
    ...Array.from({ length: 5 }, (_, i) => copy[`about.position_${i + 1}`]),
  ].filter(Boolean).join('\n');
  if (/\bplatform\b|平台|プラットフォーム|मंच|platforma|plataforma/i.test(aboutValues)) {
    warn(`${locale}: about 仍有產品簡報式「平台」定位，請改成讀者能做的事`);
  }
  const flowValues = Array.from({ length: 10 }, (_, i) => copy[`about.flow_${i + 1}`])
    .filter(Boolean).join('\n');
  if (/Topic Engine|AI\s*[\/・]|人工智能|कृत्रिम बुद्धिमत्ता|inteligência artificial/i.test(flowValues)) {
    warn(`${locale}: about.flow 仍把 AI／引擎名詞當成內容說明`);
  }
  const positions = Array.from({ length: 5 }, (_, i) => copy[`about.position_${i + 1}`]);
  if (new Set(positions).size !== positions.length) warn(`${locale}: about.position 有重複句子`);
  if ((copy['home.intro'] || '').length < 45) warn(`${locale}: home.intro 太短，沒有交代讀者會得到什麼`);
}

const files = readdirSync(I18N_DIR).filter((name) => name.endsWith('.json'));
const expected = new Set(LOCALES.map((locale) => `${locale}.json`));
for (const file of files) {
  if (!expected.has(file)) console.log(`ℹ️ 額外語系檔未納入守門：${file}`);
}

if (errors.length) {
  console.error(`✗ 讀者文案守門未通過（${errors.length} 項）：`);
  for (const error of errors) console.error(`  ${error}`);
  process.exit(1);
}

console.log(`✓ 讀者文案守門通過：${LOCALES.length} 個語系，首頁／關於頁無產品簡報式 AI 文案`);
