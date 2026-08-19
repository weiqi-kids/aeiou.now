#!/usr/bin/env node
// 由 final taxonomy 的小型目錄產生沒有日期型 observance 的 Topic 入口。
// 有日期與地方表現的既有內容仍由 content/topics/*.md + observance migration 維護；
// 這支只負責讓生命事件與長青分類也有完整的七語 metadata，不把日期猜進資料庫。
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');   // scripts/oneoff/ → repo 根
const OUT = join(ROOT, 'content', 'topics');
const LOCALES = ['zh-TW', 'en', 'ja', 'zh-CN', 'hi', 'id', 'pt-BR'];

const topics = [
  {
    slug: 'new-year', canonical: 'New Year', category: 'festival', perennial: 'no',
    commonality: 'marking a new calendar cycle through family rituals, visits, wishes, and rest',
    titles: { 'zh-TW': '新年', en: 'New Year', ja: '新年', 'zh-CN': '新年', hi: 'नया साल', id: 'Tahun Baru', 'pt-BR': 'Ano-Novo' },
  },
  {
    slug: 'lantern-festival', canonical: 'Lantern Festival', category: 'festival', perennial: 'no',
    commonality: 'using lanterns, night walks, and shared foods to close or extend a new-year season',
    titles: { 'zh-TW': '元宵', en: 'Lantern Festival', ja: '元宵節', 'zh-CN': '元宵节', hi: 'लालटेन उत्सव', id: 'Festival Lampion', 'pt-BR': 'Festival das Lanternas' },
  },
  {
    slug: 'diwali', canonical: 'Diwali', category: 'festival', perennial: 'no',
    commonality: 'welcoming light, renewal, and prosperity through regionally varied Diwali and Deepavali practices',
    titles: { 'zh-TW': '排燈節', en: 'Diwali', ja: 'ディワリ', 'zh-CN': '排灯节', hi: 'दिवाली', id: 'Diwali', 'pt-BR': 'Diwali' },
  },
  {
    slug: 'ramadan-and-eid', canonical: 'Ramadan and Eid al-Fitr', category: 'faith', perennial: 'no',
    commonality: 'following Ramadan and marking Eid al-Fitr through fasting, prayer, visits, generosity, and reconciliation',
    titles: { 'zh-TW': '齋戒月與開齋節', en: 'Ramadan and Eid al-Fitr', ja: 'ラマダンとイード', 'zh-CN': '斋月与开斋节', hi: 'रमज़ान और ईद-उल-फ़ित्र', id: 'Ramadan dan Idulfitri', 'pt-BR': 'Ramadã e Eid al-Fitr' },
  },
  {
    slug: 'eid-al-adha', canonical: 'Eid al-Adha', category: 'faith', perennial: 'no',
    commonality: 'understanding Eid al-Adha through prayer, sacrifice, sharing, pilgrimage, and local community practice',
    titles: { 'zh-TW': '古爾邦節', en: 'Eid al-Adha', ja: 'イード・アル＝アドハー', 'zh-CN': '宰牲节', hi: 'ईद-उल-अज़हा', id: 'Iduladha', 'pt-BR': 'Eid al-Adha' },
  },
  {
    slug: 'easter', canonical: 'Easter', category: 'faith', perennial: 'no',
    commonality: 'marking Easter through worship, family meals, spring symbols, and different local calendars',
    titles: { 'zh-TW': '復活節', en: 'Easter', ja: 'イースター', 'zh-CN': '复活节', hi: 'ईस्टर', id: 'Paskah', 'pt-BR': 'Páscoa' },
  },
  {
    slug: 'dragon-boat-festival', canonical: 'Dragon Boat Festival', category: 'festival', perennial: 'no',
    commonality: 'linking dragon-boat races, rice dumplings, seasonal health, and regional memory',
    titles: { 'zh-TW': '端午節', en: 'Dragon Boat Festival', ja: '端午節', 'zh-CN': '端午节', hi: 'ड्रैगन बोट उत्सव', id: 'Festival Duanwu', 'pt-BR': 'Festival do Barco-Dragão' },
  },
  {
    slug: 'ghosts-ancestors-and-remembrance', canonical: 'Ghosts, Ancestors, and Remembrance', category: 'remembrance', perennial: 'no',
    commonality: 'separating rites for ancestors, remembrance of the dead, protection customs, and Halloween play',
    titles: { 'zh-TW': '鬼節、祭祖與追思', en: 'Ghosts, Ancestors, and Remembrance', ja: '鬼・先祖・追悼', 'zh-CN': '鬼节、祭祖与追思', hi: 'भूत, पूर्वज और स्मरण', id: 'Hantu, Leluhur, dan Kenangan', 'pt-BR': 'Fantasmas, ancestrais e memória' },
  },
  {
    slug: 'mid-autumn-and-moon-viewing', canonical: 'Mid-Autumn and Moon Viewing', category: 'festival', perennial: 'no',
    commonality: 'comparing moon-viewing, seasonal food, reunion, and autumn harvest customs without flattening them into one festival',
    titles: { 'zh-TW': '中秋與月見', en: 'Mid-Autumn and Moon Viewing', ja: '中秋と月見', 'zh-CN': '中秋与赏月', hi: 'मध्य-शरद और चाँद देखना', id: 'Festival Pertengahan Musim Gugur dan Tsukimi', 'pt-BR': 'Meio do Outono e observação da lua' },
  },
  {
    slug: 'harvest-and-gratitude', canonical: 'Harvest and Gratitude', category: 'food', perennial: 'no',
    commonality: 'connecting harvest, gratitude, seasonal food, and shared tables across different religious and regional settings',
    titles: { 'zh-TW': '收成與感恩', en: 'Harvest and Gratitude', ja: '収穫と感謝', 'zh-CN': '收获与感恩', hi: 'फसल और कृतज्ञता', id: 'Panen dan Rasa Syukur', 'pt-BR': 'Colheita e gratidão' },
  },
  {
    slug: 'christmas', canonical: 'Christmas', category: 'festival', perennial: 'no',
    commonality: 'looking at Christmas through worship, family gatherings, gifts, food, public lights, and local choices',
    titles: { 'zh-TW': '聖誕節', en: 'Christmas', ja: 'クリスマス', 'zh-CN': '圣诞节', hi: 'क्रिसमस', id: 'Natal', 'pt-BR': 'Natal' },
  },
  {
    slug: 'national-days', canonical: 'National Days', category: 'civic', perennial: 'no',
    commonality: 'reading national days through public ceremonies, historical memory, symbols, and disagreement as well as celebration',
    titles: { 'zh-TW': '國慶日', en: 'National Days', ja: '国民の日', 'zh-CN': '国庆日', hi: 'राष्ट्रीय दिवस', id: 'Hari Nasional', 'pt-BR': 'Dias Nacionais' },
  },
  {
    slug: 'labour-day', canonical: 'Labour Day', category: 'work', perennial: 'no',
    commonality: 'understanding Labour Day through work, rest, organising, public history, and different national dates',
    titles: { 'zh-TW': '勞動節', en: 'Labour Day', ja: '労働の日', 'zh-CN': '劳动节', hi: 'मजदूर दिवस', id: 'Hari Buruh', 'pt-BR': 'Dia do Trabalho' },
  },
  {
    slug: 'mothers-day', canonical: "Mother's Day", category: 'family', perennial: 'no',
    commonality: 'showing appreciation for mothers and caregivers through gifts, meals, messages, and family-defined boundaries',
    titles: { 'zh-TW': '母親節', en: "Mother's Day", ja: '母の日', 'zh-CN': '母亲节', hi: 'मातृ दिवस', id: 'Hari Ibu', 'pt-BR': 'Dia das Mães' },
  },
  {
    slug: 'fathers-day', canonical: "Father's Day", category: 'family', perennial: 'no',
    commonality: 'showing appreciation for fathers and caregivers through gifts, time together, messages, and personal family practice',
    titles: { 'zh-TW': '父親節', en: "Father's Day", ja: '父の日', 'zh-CN': '父亲节', hi: 'पितृ दिवस', id: 'Hari Ayah', 'pt-BR': 'Dia dos Pais' },
  },
  {
    slug: 'childrens-day', canonical: "Children's Day", category: 'family', perennial: 'no',
    commonality: 'looking at children’s days through play, care, rights, school life, and the different dates chosen by each society',
    titles: { 'zh-TW': '兒童節', en: "Children's Day", ja: 'こどもの日', 'zh-CN': '儿童节', hi: 'बाल दिवस', id: 'Hari Anak', 'pt-BR': 'Dia das Crianças' },
  },
  {
    slug: 'teachers-day', canonical: "Teachers' Day", category: 'education', perennial: 'no',
    commonality: 'recognising teachers through classroom gratitude, public respect, gifts, and local education traditions',
    titles: { 'zh-TW': '教師節', en: "Teachers' Day", ja: '教師の日', 'zh-CN': '教师节', hi: 'शिक्षक दिवस', id: 'Hari Guru', 'pt-BR': 'Dia dos Professores' },
  },
  {
    slug: 'newborn-and-full-moon', canonical: 'Newborns and the First Month', category: 'life-stage', perennial: 'yes',
    commonality: 'welcoming a newborn and marking the first month through family visits, food, gifts, names, and care choices',
    titles: { 'zh-TW': '新生兒與滿月', en: 'Newborns and the First Month', ja: '新生児とお宮参り', 'zh-CN': '新生儿与满月', hi: 'नवजात शिशु और पहला महीना', id: 'Bayi Baru Lahir dan Selapanan', 'pt-BR': 'Recém-nascidos e o primeiro mês' },
  },
  {
    slug: 'back-to-school', canonical: 'Back-to-School Season', category: 'education', perennial: 'yes',
    commonality: 'preparing for a new school term through supplies, routines, transport, uniforms, and family transitions',
    titles: { 'zh-TW': '開學季', en: 'Back-to-School Season', ja: '新学期', 'zh-CN': '开学季', hi: 'स्कूल वापसी का मौसम', id: 'Musim Kembali ke Sekolah', 'pt-BR': 'Volta às Aulas' },
  },
  {
    slug: 'graduation-season', canonical: 'Graduation Season', category: 'education', perennial: 'yes',
    commonality: 'marking graduation through ceremonies, photographs, gifts, uncertainty, and the next stage of study or work',
    titles: { 'zh-TW': '畢業季', en: 'Graduation Season', ja: '卒業シーズン', 'zh-CN': '毕业季', hi: 'स्नातक मौसम', id: 'Musim Kelulusan', 'pt-BR': 'Temporada de Formaturas' },
  },
  {
    slug: 'coming-of-age', canonical: 'Coming-of-Age Rites', category: 'life-stage', perennial: 'yes',
    commonality: 'comparing coming-of-age ceremonies, legal thresholds, family expectations, and young people’s own choices',
    titles: { 'zh-TW': '成年禮', en: 'Coming-of-Age Rites', ja: '成人式と成年の節目', 'zh-CN': '成人礼', hi: 'वयस्कता संस्कार', id: 'Upacara Kedewasaan', 'pt-BR': 'Ritos de Maioridade' },
  },
  {
    slug: 'birthdays-and-blessings', canonical: 'Birthdays and Blessings', category: 'family', perennial: 'yes',
    commonality: 'marking birthdays and longevity with names, meals, candles, gifts, blessings, and family-specific rhythms',
    titles: { 'zh-TW': '生日與祝壽', en: 'Birthdays and Blessings', ja: '誕生日と長寿祝い', 'zh-CN': '生日与祝寿', hi: 'जन्मदिन और शुभकामनाएँ', id: 'Ulang Tahun dan Doa Baik', 'pt-BR': 'Aniversários e bênçãos' },
  },
  {
    slug: 'proposals-and-engagements', canonical: 'Proposals and Engagements', category: 'relationship', perennial: 'yes',
    commonality: 'looking at proposals and engagements through consent, family conversations, rings, gifts, and changing expectations',
    titles: { 'zh-TW': '求婚與訂婚', en: 'Proposals and Engagements', ja: 'プロポーズと婚約', 'zh-CN': '求婚与订婚', hi: 'प्रस्ताव और सगाई', id: 'Lamaran dan Pertunangan', 'pt-BR': 'Pedidos de Casamento e Noivados' },
  },
  {
    slug: 'weddings-and-customs', canonical: 'Weddings and Marriage Customs', category: 'relationship', perennial: 'yes',
    commonality: 'comparing wedding ceremonies, legal steps, kinship, clothing, food, and the boundaries of tradition',
    titles: { 'zh-TW': '婚禮與婚俗', en: 'Weddings and Marriage Customs', ja: '結婚式と婚礼習俗', 'zh-CN': '婚礼与婚俗', hi: 'विवाह और वैवाहिक रीति', id: 'Pernikahan dan Adat Perkawinan', 'pt-BR': 'Casamentos e costumes matrimoniais' },
  },
  {
    slug: 'farewells-and-funerals', canonical: 'Farewells and Funerals', category: 'remembrance', perennial: 'yes',
    commonality: 'making space for grief, farewell, funeral arrangements, mourning, and the wishes of the person and family involved',
    titles: { 'zh-TW': '告別與喪葬', en: 'Farewells and Funerals', ja: '別れと葬送', 'zh-CN': '告别与丧葬', hi: 'विदाई और अंतिम संस्कार', id: 'Perpisahan dan Pemakaman', 'pt-BR': 'Despedidas e funerais' },
  },
  {
    slug: 'moving-home', canonical: 'Moving Home and Housewarming', category: 'home', perennial: 'yes',
    commonality: 'understanding moving and housewarming through packing, thresholds, neighbours, gifts, and new daily routines',
    titles: { 'zh-TW': '搬家與入厝', en: 'Moving Home and Housewarming', ja: '引っ越しと新居祝い', 'zh-CN': '搬家与入宅', hi: 'घर बदलना और गृहप्रवेश', id: 'Pindah Rumah dan Selamatan Rumah', 'pt-BR': 'Mudança e inauguração da casa' },
  },
  {
    slug: 'homecoming-and-reunion', canonical: 'Homecoming and Reunion', category: 'community', perennial: 'yes',
    commonality: 'bringing people together through returning home, shared meals, visits, and the choice not to travel',
    titles: { 'zh-TW': '返鄉與團聚', en: 'Homecoming and Reunion', ja: '帰省と再会', 'zh-CN': '返乡与团聚', hi: 'घर वापसी और पुनर्मिलन', id: 'Mudik dan Reuni', 'pt-BR': 'Volta para Casa e Reencontros' },
  },
  {
    slug: 'caregiving-across-generations', canonical: 'Family Care and Generations', category: 'family', perennial: 'yes',
    commonality: 'talking about care between generations, practical support, boundaries, gratitude, and unequal family capacity',
    titles: { 'zh-TW': '家庭照護與代間', en: 'Family Care and Generations', ja: '家族介護と世代', 'zh-CN': '家庭照护与代际', hi: 'परिवार देखभाल और पीढ़ियाँ', id: 'Perawatan Keluarga dan Antargenerasi', 'pt-BR': 'Cuidado Familiar e Gerações' },
  },
];

const summary = {
  'zh-TW': (title) => `這一頁把「${title}」放在日期、關係與地方差異中比較；我們不預設每個家庭或社群都會用同一種方式參與。`,
  en: (title) => `This guide looks at ${title} through dates, relationships, and local differences. It does not assume that every household or community follows the same practice.`,
  ja: (title) => `ここでは「${title}」を、日付や人間関係、地域差とともに見ていきます。すべての家庭や地域が同じ形で参加するわけではありません。`,
  'zh-CN': (title) => `这一页把“${title}”放在时间、关系与地区差异中比较；我们不预设每个家庭或社群都会用同一种方式参与。`,
  hi: (title) => `यह पृष्ठ ${title} को तारीख़, रिश्तों और स्थानीय भिन्नताओं के साथ देखता है। हर परिवार या समुदाय इसे एक ही तरह से नहीं मनाता या निभाता।`,
  id: (title) => `Halaman ini melihat ${title} melalui tanggal, hubungan, dan perbedaan setempat. Tidak semua keluarga atau komunitas menjalaninya dengan cara yang sama.`,
  'pt-BR': (title) => `Esta página observa ${title} a partir das datas, dos vínculos e das diferenças locais. Nenhuma família ou comunidade precisa vivê-lo do mesmo modo.`,
};

function markdown(topic) {
  const lines = [
    `# ${topic.canonical}`,
    '',
    '## meta',
    `- slug: ${topic.slug}`,
    `- canonical: ${topic.canonical}`,
    `- category: ${topic.category}`,
    `- perennial: ${topic.perennial}`,
    `- commonality: ${topic.commonality}`,
    '',
  ];
  for (const locale of LOCALES) {
    const title = topic.titles[locale];
    lines.push(`## locale ${locale}`, '### title', title, '### summary', summary[locale](title, topic.commonality), '### keywords', title, '',);
  }
  return lines.join('\n');
}

mkdirSync(OUT, { recursive: true });
let written = 0;
const refresh = process.argv.includes('--refresh');
for (const topic of topics) {
  const path = join(OUT, `${topic.slug}.md`);
  if (existsSync(path) && !refresh) continue;
  writeFileSync(path, markdown(topic), 'utf8');
  written++;
  console.log(`${refresh && existsSync(path) ? '更新' : '新增'} ${path}`);
}
console.log(`完成：${refresh ? '更新' : '新增'} ${written} 個 final Topic content（既有檔案保留）。`);
