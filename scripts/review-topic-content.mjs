#!/usr/bin/env node
// 七個代表市場的 Topic 內容守門器。
// 這是可重跑的自動檢查，不冒充真人語言專家；它固定檢查內容結構、標題可辨識度、
// 未翻譯／舊模板殘留、跨國地方表現、日期規則、來源、七語 customs、主圖與 52 週覆蓋。
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = join(ROOT, 'db', 'aeiou.sqlite');
const CONTENT_DIR = join(ROOT, 'content', 'topics');
const COVER_DIR = join(ROOT, 'site', 'public', 'covers');
const CALENDAR_PATH = join(ROOT, 'content', 'topic-calendar.json');
const LOCALES = ['zh-TW', 'en', 'ja', 'zh-CN', 'hi', 'id', 'pt-BR'];
const personas = [
  ['台灣人格', '檢查在地日期、七夕與普渡不被誤寫成全球同一個節日。'],
  ['日本人格', '檢查本命巧克力、白色情人節、盂蘭盆等地方表現被分開，且不把日本經驗普遍化。'],
  ['中國人格', '檢查農曆／公曆與地方差異被標示，避免以單一習俗代表所有人。'],
  ['印度人格', '檢查區域、宗教、城市與家庭差異，不把都市流行寫成全國共識。'],
  ['印尼人格', '檢查開齋節與返鄉的日期不被硬編成固定日，也不假定人人都返鄉。'],
  ['巴西人格', '檢查 Dia dos Namorados 的 6 月 12 日、六月節與獨立日等在地時間。'],
  ['美國人格', '檢查 federal holiday、文化節日與家庭選擇不混為一談，避免使用無限上綱的全球化措辭。'],
];
const titleHints = {
  'affection-and-reciprocity': {
    'zh-TW': /情人節|七夕|白色情人節/, en: /Valentine|Qixi|White Day/i, ja: /バレンタイン|七夕|ホワイトデー/,
    'zh-CN': /情人节|七夕|白色情人节/, hi: /वैलेंटाइन|क़ीशी|व्हाइट डे/, id: /Valentine|Qixi|White Day/i, 'pt-BR': /Namorados|Valentine|White Day/i,
  },
  'ancestors-and-remembrance': {
    'zh-TW': /祭祖|追思|掃墓/, en: /Graves|ancestors|remembrance/i, ja: /墓参り|追悼/,
    'zh-CN': /祭祖|扫墓|追思/, hi: /पूर्वज|स्मरण|कब्र/, id: /Makam|Mengenang|leluhur/i, 'pt-BR': /cemitério|memória|mortos/i,
  },
  'harvest-and-shared-meals': {
    'zh-TW': /收成|節慶餐桌/, en: /Harvest|festival table/i, ja: /収穫|食卓/,
    'zh-CN': /收获|节庆餐桌/, hi: /फसल|साझा भोजन/, id: /Panen|Makan Bersama/i, 'pt-BR': /Colheita|mesas de festa/i,
  },
  'light-and-renewal': {
    'zh-TW': /元宵|排燈節|聖誕/, en: /Lantern|Diwali|Christmas/i, ja: /元宵|ディワリ|クリスマス/,
    'zh-CN': /元宵|排灯节|圣诞/, hi: /दीवाली|लालटेन|क्रिसमस/, id: /Lampion|Diwali|Natal/i, 'pt-BR': /Lanternas|Diwali|Natal/i,
  },
  'national-belonging': {
    'zh-TW': /國慶|國家/, en: /National|public memory/i, ja: /国民|国家/,
    'zh-CN': /国庆|国家/, hi: /राष्ट्रीय|देश/, id: /Nasional|Publik/i, 'pt-BR': /nacionais|memória pública/i,
  },
  'new-beginnings-and-fortune': {
    'zh-TW': /新年|排燈節|開齋節/, en: /New Year|Diwali|Eid/i, ja: /正月|ディワリ|イード/,
    'zh-CN': /新年|排灯节|开斋节/, hi: /नया साल|दिवाली|ईद/, id: /Tahun Baru|Diwali|Idulfitri/i, 'pt-BR': /Ano-Novo|Diwali|Eid/i,
  },
  'protection-and-play': {
    'zh-TW': /鬼月|中元|節分/, en: /Ghost|Setsubun|Halloween/i, ja: /鬼月|中元|節分|ハロウィン/,
    'zh-CN': /鬼节|鬼月|中元|节分|万圣节/, hi: /भूत|सेत्सुबुन|हैलोवीन/i, id: /Hantu|Setsubun|Halloween/i, 'pt-BR': /Fantasma|Setsubun|Halloween/i,
  },
  'reunion-and-homecoming': {
    'zh-TW': /中秋|開齋節|返鄉/, en: /Mid-Autumn|Eid|homecoming/i, ja: /中秋|イド|帰省/,
    'zh-CN': /中秋|开斋节|返乡/, hi: /मध्य-शरद|ईद|घर वापसी/, id: /Idulfitri|Pulang Kampung|Reuni/i, 'pt-BR': /família|casa/i,
  },
  'ask-the-world': {
    'zh-TW': /跨國問答/, en: /Cross-border/i, ja: /世界に聞く/, 'zh-CN': /跨国问答/, hi: /दुनिया से पूछें/, id: /Lintas Negara/i, 'pt-BR': /Perguntas entre países/i,
  },
};
const forbiddenProse = [
  ['未翻譯的 Topic 字樣', /\bTopic\b/],
  ['舊的抽象模板', /共同的情感語言|社會功能|公共敘事|製造共同時間|shared emotional language|social work of a common table|keep the dead present|This topic compares/i],
];
const errors = [];
const fail = (message) => errors.push(message);
const coverHashes = new Map();

const contentFiles = readdirSync(CONTENT_DIR).filter((file) => file.endsWith('.md')).sort();
const contentMeta = new Map();
const contentTitles = new Map();
const contentTextBySlug = new Map();
for (const file of contentFiles) {
  const text = readFileSync(join(CONTENT_DIR, file), 'utf8');
  const slug = /^- slug:\s*(\S+)$/m.exec(text)?.[1];
  const commonality = /^- commonality:\s*(.+)$/m.exec(text)?.[1]?.trim();
  if (!slug) fail(`${file}:缺 slug`);
  if (!commonality) fail(`${file}:缺 commonality(共通性分類依據)`);
  if (slug && file !== `${slug}.md`) fail(`${file}:檔名必須與 slug 相同`);
  contentMeta.set(slug, { file, commonality });
  contentTextBySlug.set(slug, text);
  const titles = new Map();
  let locale = null;
  let section = null;
  for (const line of text.split(/\r?\n/)) {
    const localeMatch = /^## locale (\S+)$/.exec(line);
    if (localeMatch) { locale = localeMatch[1]; section = null; continue; }
    const sectionMatch = /^### (title|summary|keywords|customs .+)$/.exec(line);
    if (sectionMatch) { section = sectionMatch[1]; continue; }
    if (locale && section === 'title' && line.trim()) {
      titles.set(locale, line.trim());
      section = null;
    }
  }
  contentTitles.set(slug, titles);
  for (const [label, pattern] of forbiddenProse) if (pattern.test(text)) fail(`${file}:包含${label}`);
}

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const activeTopics = db.prepare("SELECT * FROM topics WHERE status NOT IN ('candidate','merged') ORDER BY slug").all();
const activeTopicIds = new Set(activeTopics.map((topic) => topic.topic_id));
const allLocales = new Set(db.prepare('SELECT DISTINCT locale FROM topic_i18n').all().map((row) => row.locale));
for (const locale of LOCALES) if (!allLocales.has(locale)) fail(`資料庫缺全域 locale:${locale}`);

const obsRows = db.prepare('SELECT * FROM topic_observances ORDER BY topic_id, country_code, observance_key').all();
const obsByTopic = new Map();
for (const obs of obsRows) {
  if (!activeTopicIds.has(obs.topic_id)) continue;
  if (!obsByTopic.has(obs.topic_id)) obsByTopic.set(obs.topic_id, []);
  obsByTopic.get(obs.topic_id).push(obs);
  if (!obs.observed_date && !obs.date_rule) fail(`observance ${obs.observance_id}:缺 date/date_rule`);
  if (!obs.source_ids_json) fail(`observance ${obs.observance_id}:缺 source_ids_json`);
  let ids = [];
  try { ids = JSON.parse(obs.source_ids_json); } catch { fail(`observance ${obs.observance_id}:source_ids_json 不是 JSON`); }
  if (!Array.isArray(ids) || ids.length === 0) fail(`observance ${obs.observance_id}:來源陣列為空`);
  for (const id of ids) {
    const source = db.prepare('SELECT url FROM sources WHERE source_id = ?').get(id);
    if (!source?.url) fail(`observance ${obs.observance_id}:找不到來源 ${id}`);
  }
}

const i18nRows = db.prepare('SELECT * FROM topic_i18n ORDER BY topic_id, locale').all();
const i18nByTopic = new Map();
for (const row of i18nRows) {
  if (!i18nByTopic.has(row.topic_id)) i18nByTopic.set(row.topic_id, new Map());
  i18nByTopic.get(row.topic_id).set(row.locale, row);
}
const customsRows = db.prepare('SELECT * FROM topic_observance_i18n ORDER BY observance_id, locale').all();
const customsByObs = new Map();
for (const row of customsRows) {
  if (!customsByObs.has(row.observance_id)) customsByObs.set(row.observance_id, new Set());
  customsByObs.get(row.observance_id).add(row.locale);
}

for (const topic of activeTopics) {
  if (!contentMeta.has(topic.slug)) fail(`active Topic ${topic.slug}:沒有對應 content markdown`);
  const titles = contentTitles.get(topic.slug) || new Map();
  const hints = titleHints[topic.slug] || {};
  for (const locale of LOCALES) {
    const title = titles.get(locale);
    if (!title) fail(`${topic.slug}:locale ${locale} 缺可見標題`);
    else if (hints[locale] && !hints[locale].test(title)) fail(`${topic.slug}:locale ${locale} 標題沒有可辨識的節日／生活詞：${title}`);
  }
  const locales = i18nByTopic.get(topic.topic_id) || new Map();
  for (const locale of LOCALES) {
    const row = locales.get(locale);
    if (!row?.title || !row?.summary) fail(`${topic.slug}:locale ${locale} 缺 title/summary`);
  }
  for (const obs of obsByTopic.get(topic.topic_id) || []) {
    const got = customsByObs.get(obs.observance_id) || new Set();
    for (const locale of LOCALES) if (!got.has(locale)) fail(`${topic.slug}/${obs.country_code}:${obs.observance_key} 缺 customs ${locale}`);
  }
  const cover = join(COVER_DIR, `${topic.slug}.png`);
  if (!existsSync(cover)) fail(`${topic.slug}:缺 1200×675 PNG cover`);
  else {
    const bytes = readFileSync(cover);
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    if (!png || bytes.readUInt32BE(16) !== 1200 || bytes.readUInt32BE(20) !== 675) fail(`${topic.slug}:cover 不是 1200×675 PNG`);
    else {
      const hash = createHash('sha256').update(bytes).digest('hex');
      const previous = coverHashes.get(hash);
      if (previous) fail(`${topic.slug}:cover 與 ${previous} 相同；每個 active Topic 必須有獨立圖片`);
      else coverHashes.set(hash, topic.slug);
    }
  }
}

const personaFindings = new Map(personas.map(([name]) => [name, []]));
const personaChecks = [
  ['台灣人格', [
    ['七夕保留農曆日期', () => /農曆七月初七/.test(contentTextBySlug.get('affection-and-reciprocity') || '')],
    ['鬼月保留地方與家庭差異', () => /農曆七月/.test(contentTextBySlug.get('protection-and-play') || '') && /沒有同一張清單/.test(contentTextBySlug.get('protection-and-play') || '')],
    ['農曆新年保留家庭與地方節奏', () => /農曆新年/.test(contentTextBySlug.get('new-beginnings-and-fortune') || '') && /自己的節奏/.test(contentTextBySlug.get('new-beginnings-and-fortune') || '')],
  ]],
  ['日本人格', [
    ['本命／義理巧克力被分開', () => /本命巧克力.*義理巧克力/.test(contentTextBySlug.get('affection-and-reciprocity') || '')],
    ['白色情人節被寫成回禮日', () => /白色情人節是 3 月 14 日的回禮日/.test(contentTextBySlug.get('affection-and-reciprocity') || '')],
    ['節分保留撒豆驅邪', () => /節分會撒豆|節分、撒豆/.test(contentTextBySlug.get('protection-and-play') || '')],
  ]],
  ['中國人格', [
    ['中秋與中元保留中文節名', () => /中秋节|中元節|中元节/.test(contentTextBySlug.get('reunion-and-homecoming') || '') && /中元相關|中元相关/.test(contentTextBySlug.get('protection-and-play') || '')],
    ['農曆／地方差異仍可見', () => /農曆|农历/.test(contentTextBySlug.get('new-beginnings-and-fortune') || '') && /地方|地区/.test(contentTextBySlug.get('harvest-and-shared-meals') || '')],
  ]],
  ['印度人格', [
    ['Diwali 不被寫成全印度單一做法', () => /排燈節|Diwali/.test(contentTextBySlug.get('new-beginnings-and-fortune') || '') && /地區|region|regional|地區與宗教/.test(contentTextBySlug.get('new-beginnings-and-fortune') || '')],
    ['Pongal 保留南印度與農業脈絡', () => /Pongal|Pongal/.test(contentTextBySlug.get('harvest-and-shared-meals') || '') && /南印度|South India|India Sud/.test(contentTextBySlug.get('harvest-and-shared-meals') || '')],
    ['Valentine Week 標示都市流行', () => /都市|urban|शहरी|perkotaan|urbana/.test(contentTextBySlug.get('affection-and-reciprocity') || '')],
  ]],
  ['印尼人格', [
    ['mudik 與 Idul Fitri 同時出現', () => /mudik/.test(contentTextBySlug.get('reunion-and-homecoming') || '') && /Idul Fitri|開齋節|开斋节/.test(contentTextBySlug.get('reunion-and-homecoming') || '')],
    ['不返鄉的選擇被保留', () => /不是每個人|Not everyone|Tidak semua|Nem todos/.test(contentTextBySlug.get('reunion-and-homecoming') || '')],
    ['Idul Fitri 不被混寫成公曆新年', () => /不是公曆新年|not about the Gregorian calendar|bukan kalender|não ao calendário gregoriano/.test(contentTextBySlug.get('new-beginnings-and-fortune') || '')],
  ]],
  ['巴西人格', [
    ['Dia dos Namorados 保留 6 月 12 日', () => /Dia dos Namorados/.test(contentTextBySlug.get('affection-and-reciprocity') || '') && /6 月 12|June 12|12 de junho/.test(contentTextBySlug.get('affection-and-reciprocity') || '')],
    ['Festas Juninas 保留聖人與地方背景', () => /六月節|June festivals|festas juninas|Festa junina/.test(contentTextBySlug.get('harvest-and-shared-meals') || '') && /天主教|Catholic|católic|Católico/.test(contentTextBySlug.get('harvest-and-shared-meals') || '')],
    ['獨立日被寫成公共歷史節日', () => /獨立日|Independence Day|Independência/.test(contentTextBySlug.get('national-belonging') || '')],
  ]],
  ['美國人格', [
    ['Memorial Day 限定為軍人紀念', () => /服役中死亡的軍人|service members who died|軍務中に亡くなった兵士|militares que morreram em serviço/.test(contentTextBySlug.get('ancestors-and-remembrance') || '')],
    ['Halloween 寫出裝扮與要糖', () => /萬聖節|Halloween/.test(contentTextBySlug.get('protection-and-play') || '') && /要糖|trick-or-treat|討糖/.test(contentTextBySlug.get('protection-and-play') || '')],
    ['New Year 保留聯邦假日界線', () => /聯邦假日|federal holiday|feriado federal/.test(contentTextBySlug.get('new-beginnings-and-fortune') || '')],
  ]],
];
for (const [name, checks] of personaChecks) {
  const findings = personaFindings.get(name) || [];
  for (const [label, test] of checks) {
    if (!test()) {
      findings.push(label);
      fail(`${name}:${label}`);
    }
  }
}

const affection = activeTopics.find((topic) => topic.slug === 'affection-and-reciprocity');
const affectionObs = affection ? obsByTopic.get(affection.topic_id) || [] : [];
if (affectionObs.filter((obs) => obs.country_code === 'JP').length < 2) fail('共通性回歸測試:日本同一 Topic 必須至少有情人節與白色情人節兩筆');
if (!affectionObs.some((obs) => obs.country_code === 'JP' && obs.observance_key === 'white-day')) fail('共通性回歸測試:缺 JP white-day');
if (!affectionObs.some((obs) => obs.country_code === 'TW' && obs.date_rule)) fail('共通性回歸測試:TW 七夕必須保留非固定日期規則');

const calendar = JSON.parse(readFileSync(CALENDAR_PATH, 'utf8'));
if (!Array.isArray(calendar.weeks) || calendar.weeks.length !== 52) fail('年度排程不是 52 週');
const activeSlugs = new Set(activeTopics.map((topic) => topic.slug));
for (const row of calendar.weeks || []) {
  if (!row.topics?.length) fail(`第 ${row.week} 週沒有 Topic`);
  for (const slug of row.topics || []) if (!activeSlugs.has(slug)) fail(`第 ${row.week} 週引用非 active Topic:${slug}`);
}

db.close();
for (const [name, focus] of personas) {
  const findings = personaFindings.get(name) || [];
  if (findings.length) console.log(`[${name}] 自動守門發現問題：${findings.join('、')}；${focus}`);
  else console.log(`[${name}] 自動守門通過：${focus}`);
}
if (errors.length) {
  console.error(`\nTopic 內容自動守門未通過，共 ${errors.length} 項：`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('\nTopic 內容與結構自動守門通過；這不是真人語言專家簽核。');
