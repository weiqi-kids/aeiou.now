// fixture 種子(dev 輔助,不在 build 鏈):寫進 site/src/data/(gitignored)。
// 用途:根層 data/ 為空(Track A 尚未產出)時,讓每個頁面區塊都渲染得出東西。
// 形狀對齊 Track A 生產者 2026-08-11 的實際輸出(topics/index=裸陣列、customs 在 i18n.json
// 的 countries 區塊、places/events 用 topics:[{topic_id,relevance}]、meta 為 map、highlights 用 items)。
// ⚠ 根層 data/ 非空時,pnpm build 的 copy-data 會鏡像覆蓋本 fixture——這是規格內行為。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ROOT = join(process.cwd(), 'src', 'data');
const LOCALES = ['zh-TW', 'en', 'ja', 'zh-CN', 'hi', 'id', 'pt-BR'];
const WINDOWS = ['24h', '72h', '7d', '1m', '3m', '1y'];
const NOW = 1781136000;

const VD = 'top_01JVDAY0000000000000000001';
const ATW = 'top_01JASKW0000000000000000001';

function w(rel, obj) {
  const p = join(ROOT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
  console.log('fixture:', rel);
}

const vdTitle = {
  'zh-TW': '情人節', en: "Valentine's Day", ja: 'バレンタインデー', 'zh-CN': '情人节',
  hi: 'वैलेंटाइन डे', id: 'Hari Valentine', 'pt-BR': 'Dia dos Namorados',
};
const vdSummary = {
  'zh-TW': '2 月 14 日前後,全球用巧克力、鮮花與約會表達心意的節日;巴西則在 6 月 12 日過。',
  en: 'Around February 14, people worldwide mark the day with chocolate, flowers and dates; Brazil celebrates on June 12.',
  ja: '2月14日前後、チョコレートや花、デートで気持ちを伝える日。ブラジルでは6月12日に祝われます。',
  'zh-CN': '2 月 14 日前后,全球用巧克力、鲜花与约会表达心意的节日;巴西则在 6 月 12 日过。',
  hi: '14 फ़रवरी के आसपास दुनिया भर में चॉकलेट, फूल और डेट के साथ मनाया जाने वाला दिन; ब्राज़ील में यह 12 जून को होता है।',
  id: 'Sekitar 14 Februari, orang di seluruh dunia merayakannya dengan cokelat, bunga, dan kencan; Brasil merayakannya pada 12 Juni.',
  'pt-BR': 'Perto de 14 de fevereiro, o mundo comemora com chocolate, flores e encontros; no Brasil a data é 12 de junho.',
};
const atwTitle = {
  'zh-TW': '問世界', en: 'Ask the World', ja: '世界に聞く', 'zh-CN': '问世界',
  hi: 'दुनिया से पूछो', id: 'Tanya Dunia', 'pt-BR': 'Pergunte ao Mundo',
};
const atwSummary = {
  'zh-TW': '長青問答主題:把你的問題丟給全世界,看各國怎麼回答。',
  en: 'An evergreen Q&A topic: throw your question to the world and see how each country answers.',
  ja: '常設のQ&Aトピック。あなたの質問を世界に投げかけ、各国の答えを見てみましょう。',
  'zh-CN': '长青问答主题:把你的问题抛给全世界,看各国怎么回答。',
  hi: 'सदाबहार सवाल-जवाब विषय: अपना सवाल दुनिया के सामने रखें और देखें कि हर देश क्या जवाब देता है।',
  id: 'Topik tanya-jawab abadi: lempar pertanyaanmu ke dunia dan lihat jawaban tiap negara.',
  'pt-BR': 'Tema perene de perguntas e respostas: faça sua pergunta ao mundo e veja como cada país responde.',
};
const vdScores = { '24h': 91.4, '72h': 88.2, '7d': 74.6, '1m': 52.3, '3m': 38.9, '1y': 81.7 };
const atwScores = { '24h': 63.8, '72h': 66.1, '7d': 68.4, '1m': 70.2, '3m': 69.5, '1y': 72.9 };

// topics/index/<locale>.json(裸陣列,形狀同生產者)
for (const loc of LOCALES) {
  w(`topics/index/${loc}.json`, [
    { topic_id: VD, slug: 'valentines-day', title: vdTitle[loc], category: 'festival',
      status: 'active', is_perennial: 0, scores: vdScores },
    { topic_id: ATW, slug: 'ask-the-world', title: atwTitle[loc], category: 'community',
      status: 'active', is_perennial: 1, scores: atwScores },
  ]);
}

// valentines-day facts
w(`topics/${VD}/facts.json`, {
  topic_id: VD, slug: 'valentines-day', canonical_name: "Valentine's Day",
  category: 'festival', status: 'active', is_perennial: 0, access_level: 0,
  countries: [
    { country_code: 'JP', local_name: 'バレンタインデー', observed_date: '02-14', date_rule: null,
      date_range_end: null, popularity_rank: 1, source_ids: ['src_fixture_jp_01'] },
    { country_code: 'TW', local_name: '情人節', observed_date: '02-14', date_rule: '另有農曆七月初七的七夕情人節',
      date_range_end: null, popularity_rank: 2, source_ids: ['src_fixture_tw_01'] },
    { country_code: 'US', local_name: "Valentine's Day", observed_date: '02-14', date_rule: null,
      date_range_end: null, popularity_rank: 1, source_ids: ['src_fixture_us_01'] },
    { country_code: 'BR', local_name: 'Dia dos Namorados', observed_date: '06-12', date_rule: null,
      date_range_end: null, popularity_rank: 1, source_ids: ['src_fixture_br_01'] },
    { country_code: 'ID', local_name: 'Hari Valentine', observed_date: '02-14', date_rule: null,
      date_range_end: null, popularity_rank: 3, source_ids: ['src_fixture_id_01'] },
  ],
  relations: [],
  source_ids: ['src_fixture_global_01'],
});

// valentines-day i18n(customs 在 countries 區塊:國 × 語)
const customs = {
  JP: {
    'zh-TW': '女生送巧克力給男生,還分「本命巧克力」與「義理巧克力」;3 月 14 日白色情人節男生回禮。',
    en: 'Women give chocolate to men, split into "honmei" (true feelings) and "giri" (obligation); men return the favor on White Day, March 14.',
    ja: '女性から男性へチョコレートを贈り、本命チョコと義理チョコを使い分けます。3月14日のホワイトデーに男性がお返しをします。',
    'zh-CN': '女生送巧克力给男生,还分「本命巧克力」与「义理巧克力」;3 月 14 日白色情人节男生回礼。',
    hi: 'महिलाएँ पुरुषों को चॉकलेट देती हैं — "होनमेई" (सच्चा प्यार) और "गिरि" (औपचारिक) अलग-अलग; 14 मार्च के व्हाइट डे पर पुरुष जवाब में उपहार देते हैं।',
    id: 'Perempuan memberi cokelat kepada laki-laki, dibedakan antara "honmei" (cinta sungguhan) dan "giri" (formalitas); laki-laki membalasnya pada White Day, 14 Maret.',
    'pt-BR': 'As mulheres dão chocolate aos homens, divididos em "honmei" (sentimento verdadeiro) e "giri" (cortesia); os homens retribuem no White Day, 14 de março.',
  },
  TW: {
    'zh-TW': '除了 2 月 14 日,還有農曆七夕情人節;情侶吃大餐、送花,巧克力品牌檔期一年兩次。',
    en: 'Besides February 14, couples also celebrate Qixi on the seventh day of the seventh lunar month — dinner dates, flowers, and two chocolate seasons a year.',
    ja: '2月14日のほかに旧暦七夕の「七夕情人節」もあり、カップルはディナーや花を楽しみます。チョコ商戦は年に2回です。',
    'zh-CN': '除了 2 月 14 日,还有农历七夕情人节;情侣吃大餐、送花,巧克力品牌档期一年两次。',
    hi: '14 फ़रवरी के अलावा चंद्र कैलेंडर के अनुसार "चीशी" भी मनाया जाता है — डिनर, फूल, और साल में दो बार चॉकलेट का मौसम।',
    id: 'Selain 14 Februari, ada juga Qixi menurut kalender lunar — makan malam romantis, bunga, dan dua musim cokelat setiap tahun.',
    'pt-BR': 'Além de 14 de fevereiro, casais também celebram o Qixi no calendário lunar — jantares, flores e duas temporadas de chocolate por ano.',
  },
  US: {
    'zh-TW': '互送卡片、鮮花與糖果,小學生會在班上發情人節卡片給每個同學。',
    en: 'Cards, flowers and candy all around; grade-schoolers hand out valentines to every classmate.',
    ja: 'カードや花、キャンディを贈り合います。小学生はクラス全員にバレンタインカードを配る習慣があります。',
    'zh-CN': '互送卡片、鲜花与糖果,小学生会在班上给每个同学发情人节卡片。',
    hi: 'कार्ड, फूल और मिठाइयों का आदान-प्रदान होता है; स्कूली बच्चे पूरी कक्षा को वैलेंटाइन कार्ड बाँटते हैं।',
    id: 'Saling memberi kartu, bunga, dan permen; anak SD membagikan kartu valentine ke semua teman sekelas.',
    'pt-BR': 'Troca de cartões, flores e doces; crianças do primário distribuem cartõezinhos para toda a turma.',
  },
  BR: {
    'zh-TW': '不過 2 月 14 日,改在 6 月 12 日「戀人節」,隔天是聖安東尼日——傳說中的婚姻守護者。',
    en: "Skips February 14 entirely: Dia dos Namorados falls on June 12, the eve of St. Anthony's Day, the legendary matchmaker saint.",
    ja: '2月14日ではなく6月12日に「恋人の日」を祝います。翌日は縁結びの聖人、聖アントニオの日です。',
    'zh-CN': '不过 2 月 14 日,改在 6 月 12 日「恋人节」,隔天是圣安东尼日——传说中的婚姻守护者。',
    hi: 'ब्राज़ील 14 फ़रवरी नहीं मनाता: "दिया दोस नामोरादोस" 12 जून को होता है, विवाह के संत सेंट एंटोनियो के दिन से एक दिन पहले।',
    id: 'Tidak merayakan 14 Februari: Dia dos Namorados jatuh pada 12 Juni, sehari sebelum hari Santo Antonius, santo pelindung jodoh.',
    'pt-BR': 'Nada de 14 de fevereiro: o Dia dos Namorados é 12 de junho, véspera do dia de Santo Antônio, o santo casamenteiro.',
  },
  ID: {
    'zh-TW': '大城市年輕人會慶祝,送巧克力與玫瑰;部分地區出於宗教考量不鼓勵過節。',
    en: 'Young people in big cities celebrate with chocolate and roses; some regions discourage it on religious grounds.',
    ja: '大都市の若者はチョコレートやバラで祝いますが、宗教上の理由で祝わない地域もあります。',
    'zh-CN': '大城市年轻人会庆祝,送巧克力与玫瑰;部分地区出于宗教考量不鼓励过节。',
    hi: 'बड़े शहरों के युवा चॉकलेट और गुलाब के साथ मनाते हैं; कुछ क्षेत्रों में धार्मिक कारणों से इसे हतोत्साहित किया जाता है।',
    id: 'Anak muda di kota besar merayakannya dengan cokelat dan mawar; sebagian daerah tidak menganjurkannya karena alasan agama.',
    'pt-BR': 'Jovens das grandes cidades comemoram com chocolate e rosas; algumas regiões desencorajam a data por motivos religiosos.',
  },
};
w(`topics/${VD}/i18n.json`, {
  topic_id: VD,
  locales: Object.fromEntries(LOCALES.map((loc) => [loc, {
    title: vdTitle[loc], summary: vdSummary[loc], keywords: [vdTitle[loc]],
  }])),
  countries: customs,
});

// valentines-day highlights(1 則凍結貼文:原文 ja + 六語譯文)
w(`topics/${VD}/highlights.json`, {
  topic_id: VD,
  items: [
    { post_id: 'pst_01JVDAYP000000000000000001', cycle_label: '2026-02',
      original_locale: 'ja',
      content: '今年は友チョコを50個手作りしました。放課後みんなで交換するのが一番楽しい瞬間です。',
      translations: {
        'zh-TW': '今年我手作了 50 顆友情巧克力。放學後大家交換的那一刻,是最開心的時光。',
        en: 'I hand-made 50 friendship chocolates this year. Swapping them after school is the best moment of all.',
        'zh-CN': '今年我手工做了 50 颗友情巧克力。放学后大家交换的那一刻,是最开心的时光。',
        hi: 'इस साल मैंने 50 फ्रेंडशिप चॉकलेट खुद बनाईं। स्कूल के बाद सबके साथ उन्हें बदलना सबसे मज़ेदार पल होता है।',
        id: 'Tahun ini aku membuat sendiri 50 cokelat persahabatan. Saling bertukar sepulang sekolah adalah momen paling seru.',
        'pt-BR': 'Este ano fiz à mão 50 chocolates da amizade. Trocá-los depois da aula é o melhor momento de todos.',
      },
      country_code: 'JP', city_code: 'tokyo', created_at: 1771050000,
      comment_count: 18, reaction_actors: 42 },
  ],
});

// ask-the-world
w(`topics/${ATW}/facts.json`, {
  topic_id: ATW, slug: 'ask-the-world', canonical_name: 'Ask the World',
  category: 'community', status: 'active', is_perennial: 1, access_level: 0,
  countries: [], relations: [], source_ids: [],
});
w(`topics/${ATW}/i18n.json`, {
  topic_id: ATW,
  locales: Object.fromEntries(LOCALES.map((loc) => [loc, {
    title: atwTitle[loc], summary: atwSummary[loc], keywords: [atwTitle[loc]],
  }])),
  countries: {},
});
w(`topics/${ATW}/highlights.json`, { topic_id: ATW, items: [] });

// places/taipei.json
w('places/taipei.json', {
  city_code: 'taipei',
  places: [
    { place_id: 'plc_01JTPECAKE0000000000000001', name: '可可巷手工巧克力', country_code: 'TW',
      address: '台北市大安區示例路 12 號',
      map_url: 'https://www.google.com/maps/search/?api=1&query=%E5%8F%AF%E5%8F%AF%E5%B7%B7%20%E5%8F%B0%E5%8C%97',
      nav_urls: { google: 'https://www.google.com/maps/dir/?api=1&destination=%E5%8F%AF%E5%8F%AF%E5%B7%B7%20%E5%8F%B0%E5%8C%97' },
      mention_count: 12, topics: [{ topic_id: VD, relevance: 0.9 }],
      descriptions: {
        'zh-TW': '討論串裡最常被點名的手工巧克力店,情人節前要排隊。',
        en: "The hand-made chocolate shop mentioned most in the threads; expect a line before Valentine's Day.",
        ja: 'スレッドで最も名前が挙がる手作りチョコレート店。バレンタイン前は行列必至です。',
        'zh-CN': '讨论串里最常被点名的手工巧克力店,情人节前要排队。',
        hi: 'चर्चाओं में सबसे ज़्यादा ज़िक्र होने वाली हस्तनिर्मित चॉकलेट की दुकान; वैलेंटाइन से पहले लाइन लगती है।',
        id: 'Toko cokelat buatan tangan yang paling sering disebut di diskusi; antre panjang menjelang Valentine.',
        'pt-BR': 'A loja de chocolate artesanal mais citada nas discussões; espere fila antes do Dia dos Namorados.',
      } },
    { place_id: 'plc_01JTPEBQT00000000000000001', name: '花間製作所', country_code: 'TW',
      address: '台北市中山區示例街 45 號',
      map_url: 'https://www.google.com/maps/search/?api=1&query=%E8%8A%B1%E9%96%93%E8%A3%BD%E4%BD%9C%E6%89%80%20%E5%8F%B0%E5%8C%97',
      nav_urls: { google: 'https://www.google.com/maps/dir/?api=1&destination=%E8%8A%B1%E9%96%93%E8%A3%BD%E4%BD%9C%E6%89%80%20%E5%8F%B0%E5%8C%97' },
      mention_count: 7, topics: [{ topic_id: VD, relevance: 0.7 }],
      descriptions: {
        'zh-TW': '社群推薦的花藝工作室,可以預約情人節花束。',
        en: "A community-recommended floral studio; Valentine's bouquets by reservation.",
        ja: 'コミュニティおすすめのフラワースタジオ。バレンタインの花束は予約制です。',
        'zh-CN': '社群推荐的花艺工作室,可以预约情人节花束。',
        hi: 'समुदाय द्वारा सुझाया गया फूलों का स्टूडियो; वैलेंटाइन गुलदस्ते बुकिंग पर मिलते हैं।',
        id: 'Studio bunga rekomendasi komunitas; buket Valentine bisa dipesan lebih dulu.',
        'pt-BR': 'Um ateliê floral recomendado pela comunidade; buquês de Dia dos Namorados sob reserva.',
      } },
  ],
});

// events/taipei.json
w('events/taipei.json', {
  city_code: 'taipei',
  events: [
    { event_id: 'evt_01JTPEFEST0000000000000001', name: '台北情人節巧克力市集', country_code: 'TW',
      venue: '松山文創園區', start_at: 1771027200, end_at: 1771200000,
      ticket_url: 'https://example.com/tickets/taipei-choco-fair',
      source_id: 'src_fixture_event_01',
      topics: [{ topic_id: VD, relevance: 0.8 }],
      descriptions: {
        'zh-TW': '五十家甜點與手作品牌齊聚的巧克力市集,情人節週末限定。',
        en: "A chocolate fair with fifty dessert and craft brands, Valentine's weekend only.",
        ja: 'スイーツとクラフトの50ブランドが集まるチョコレートマーケット。バレンタイン週末限定です。',
        'zh-CN': '五十家甜点与手作品牌齐聚的巧克力市集,情人节周末限定。',
        hi: 'पचास डेज़र्ट और हस्तशिल्प ब्रांडों वाला चॉकलेट मेला, सिर्फ़ वैलेंटाइन वीकेंड पर।',
        id: 'Pasar cokelat dengan lima puluh merek kue dan kerajinan, hanya pada akhir pekan Valentine.',
        'pt-BR': 'Uma feira de chocolate com cinquenta marcas de doces e artesanato, só no fim de semana do Dia dos Namorados.',
      } },
  ],
});

// rankings/global/<window>.json
const vdRow = (win) => ({ rank: 0, topic_id: VD, slug: 'valentines-day', score: vdScores[win] });
const atwRow = (win) => ({ rank: 0, topic_id: ATW, slug: 'ask-the-world', score: atwScores[win] });
for (const win of WINDOWS) {
  const pair = vdScores[win] >= atwScores[win] ? [vdRow(win), atwRow(win)] : [atwRow(win), vdRow(win)];
  pair[0].rank = 1; pair[1].rank = 2;
  w(`rankings/global/${win}.json`, { scope: 'global', window: win, taken_at: NOW, items: pair });
}

// meta(map 形狀,同生產者)
w('meta/countries.json', {
  JP: { 'zh-TW': '日本', en: 'Japan', ja: '日本', 'zh-CN': '日本', hi: 'जापान', id: 'Jepang', 'pt-BR': 'Japão' },
  TW: { 'zh-TW': '台灣', en: 'Taiwan', ja: '台湾', 'zh-CN': '台湾', hi: 'ताइवान', id: 'Taiwan', 'pt-BR': 'Taiwan' },
  US: { 'zh-TW': '美國', en: 'United States', ja: 'アメリカ', 'zh-CN': '美国', hi: 'अमेरिका', id: 'Amerika Serikat', 'pt-BR': 'Estados Unidos' },
  BR: { 'zh-TW': '巴西', en: 'Brazil', ja: 'ブラジル', 'zh-CN': '巴西', hi: 'ब्राज़ील', id: 'Brasil', 'pt-BR': 'Brasil' },
  ID: { 'zh-TW': '印尼', en: 'Indonesia', ja: 'インドネシア', 'zh-CN': '印尼', hi: 'इंडोनेशिया', id: 'Indonesia', 'pt-BR': 'Indonésia' },
});
w('meta/cities.json', { taipei: 'Taipei', tokyo: 'Tokyo' });
console.log('fixture seed 完成(根層 data/ 非空時會被 copy-data 鏡像覆蓋,屬規格內行為)。');
