import { LOCALE } from './config.mjs';

export const SITE_NAME = 'aeiou.now';
// Non-Topic pages still need a representative large image for social previews
// and Discover. Topic pages should pass their own cover instead.
export const SITE_OVERVIEW_IMAGE_PATH = '/covers/about.png';

// 七站正式網域(2026-08-15 切換;映射表=CLAUDE.md 介面常數,ja→jp、zh-CN→cn、pt-BR→br 不同名)。
// hreflang/canonical 的跨站網址一律從這裡拼,不要讓每個頁面自行組。
export const LOCALE_ORIGINS = {
  'zh-TW': 'https://aeiou.now',
  en: 'https://en.aeiou.now',
  ja: 'https://jp.aeiou.now',
  'zh-CN': 'https://cn.aeiou.now',
  hi: 'https://hi.aeiou.now',
  id: 'https://id.aeiou.now',
  'pt-BR': 'https://br.aeiou.now',
};

export const OG_LOCALES = {
  'zh-TW': 'zh_TW',
  en: 'en_US',
  ja: 'ja_JP',
  'zh-CN': 'zh_CN',
  hi: 'hi_IN',
  id: 'id_ID',
  'pt-BR': 'pt_BR',
};

export const SITE_DESCRIPTIONS = {
  'zh-TW': '看見同一個生活主題在不同國家、城市與家庭怎麼過；有日期、有來源，也保留彼此不一樣的地方。',
  en: 'See how the same everyday topic is lived across countries, cities, and households—with dates, sources, and differences kept visible.',
  ja: '同じ生活のテーマが国、都市、家庭ごとにどう過ごされるかを見る。日付と出典を示し、違いも残します。',
  'zh-CN': '看见同一个生活主题在不同国家、城市与家庭如何被实践；有日期、有来源，也保留彼此的不同。',
  hi: 'देखें कि एक ही रोज़मर्रा का विषय अलग देशों, शहरों और परिवारों में कैसे जिया जाता है—तारीख़, स्रोत और अंतर साफ़ रखें।',
  id: 'Lihat bagaimana topik sehari-hari yang sama dijalani di berbagai negara, kota, dan keluarga—dengan tanggal, sumber, dan perbedaan yang tetap terlihat.',
  'pt-BR': 'Veja como o mesmo tema cotidiano é vivido em países, cidades e famílias diferentes, com datas, fontes e diferenças visíveis.',
};

export const SEO_COPY = {
  'zh-TW': {
    answers: '快速回答', what: '這個主題是什麼？', when: '什麼時候？', where: '各地怎麼過？', differences: '各地有什麼不同？',
    sources: '來源與日期', sourceNote: '日期依地方時區、曆法與官方公告；若標示估計或地方變體，請以來源為準。',
    related: '相關主題', updated: '更新於', noDate: '目前沒有可驗證的固定日期；時間會依地區、家庭或個人選擇而不同。',
    sourceLink: '查看來源', home: '首頁', topic: '主題',
    metaSuffix: '日期、習俗與各地差異', coveragePrefix: '涵蓋', sourceMeta: '附日期與來源。',
    compareSuffix: '{count} 國怎麼過、哪裡放假',
    // 標點是語系的一部分:英文站不該印出「、」「。」「｜」。
    colon: '：',
    listSep: '、', itemSep: '；', endMark: '。', titleSep: '｜',
  },
  en: {
    answers: 'Quick answers', what: 'What is this topic?', when: 'When is it?', where: 'How do places mark it?', differences: 'What differs by place?',
    sources: 'Sources and dates', sourceNote: 'Dates follow local time zones, calendars, and official notices. Check the source when a date is estimated or locally variable.',
    related: 'Related topics', updated: 'Updated', noDate: 'There is no single verified fixed date here; timing varies by place, household, or personal choice.',
    sourceLink: 'View source', home: 'Home', topic: 'Topic',
    metaSuffix: 'Dates, customs, and local differences', coveragePrefix: 'Covers', sourceMeta: 'Includes dates and sources.',
    compareSuffix: 'How {count} countries mark it',
    colon: ': ',
    listSep: ', ', itemSep: '; ', endMark: '.', titleSep: ' | ',
  },
  ja: {
    answers: '要点', what: 'このテーマは何？', when: 'いつ？', where: '各地ではどう過ごす？', differences: '地域ごとに何が違う？',
    sources: '出典と日付', sourceNote: '日付は現地の時間帯、暦、公式発表に基づきます。推定または地域差の表示がある場合は出典を確認してください。',
    related: '関連テーマ', updated: '更新', noDate: '確認できる一つの固定日はありません。時期は地域、家庭、個人の選択で変わります。',
    sourceLink: '出典を見る', home: 'ホーム', topic: 'テーマ',
    metaSuffix: '日付・習慣・地域差', coveragePrefix: '対象地域', sourceMeta: '日付と出典を掲載。',
    compareSuffix: '{count}か国の過ごし方と祝日の有無',
    colon: '：',
    listSep: '、', itemSep: '／', endMark: '。', titleSep: '｜',
  },
  'zh-CN': {
    answers: '快速回答', what: '这个主题是什么？', when: '什么时候？', where: '各地怎么过？', differences: '各地有什么不同？',
    sources: '来源与日期', sourceNote: '日期依据当地时区、历法与官方公告；标注估计或地区差异时，请以来源为准。',
    related: '相关主题', updated: '更新于', noDate: '目前没有一个可以验证的固定日期；时间会因地区、家庭或个人选择而不同。',
    sourceLink: '查看来源', home: '首页', topic: '主题',
    metaSuffix: '日期、习俗与地区差异', coveragePrefix: '涵盖', sourceMeta: '附有日期和来源。',
    compareSuffix: '{count} 国怎么过、哪里放假',
    colon: '：',
    listSep: '、', itemSep: '；', endMark: '。', titleSep: '｜',
  },
  hi: {
    answers: 'त्वरित उत्तर', what: 'यह विषय क्या है?', when: 'यह कब होता है?', where: 'अलग जगहों पर इसे कैसे मनाते हैं?', differences: 'अलग जगहों पर क्या अलग है?',
    sources: 'स्रोत और तारीख़ें', sourceNote: 'तारीख़ें स्थानीय समय, कैलेंडर और आधिकारिक सूचनाओं पर आधारित हैं। अनुमानित या स्थानीय तारीख़ के लिए स्रोत देखें।',
    related: 'संबंधित विषय', updated: 'अपडेट', noDate: 'यहाँ कोई एक सत्यापित निश्चित तारीख़ नहीं है; समय स्थान, परिवार या व्यक्तिगत चुनाव से बदलता है।',
    sourceLink: 'स्रोत देखें', home: 'होम', topic: 'विषय',
    metaSuffix: 'तारीख़, रीति और स्थानीय अंतर', coveragePrefix: 'क्षेत्र', sourceMeta: 'तारीख़ों और स्रोतों सहित।',
    compareSuffix: '{count} देशों में इसे कैसे मनाया जाता है',
    colon: ': ',
    listSep: ', ', itemSep: '; ', endMark: '।', titleSep: ' | ',
  },
  id: {
    answers: 'Jawaban singkat', what: 'Apa tema ini?', when: 'Kapan?', where: 'Bagaimana tempat berbeda menjalaninya?', differences: 'Apa yang berbeda di tiap tempat?',
    sources: 'Sumber dan tanggal', sourceNote: 'Tanggal mengikuti zona waktu, kalender, dan pengumuman resmi setempat. Periksa sumber jika tanggal diperkirakan atau berbeda menurut daerah.',
    related: 'Tema terkait', updated: 'Diperbarui', noDate: 'Belum ada satu tanggal tetap yang dapat diverifikasi; waktunya bergantung pada tempat, keluarga, atau pilihan pribadi.',
    sourceLink: 'Lihat sumber', home: 'Beranda', topic: 'topik',
    metaSuffix: 'Tanggal, kebiasaan, dan perbedaan setempat', coveragePrefix: 'Mencakup', sourceMeta: 'Dilengkapi tanggal dan sumber.',
    compareSuffix: 'Bagaimana {count} negara menjalaninya',
    colon: ': ',
    listSep: ', ', itemSep: '; ', endMark: '.', titleSep: ' | ',
  },
  'pt-BR': {
    answers: 'Respostas rápidas', what: 'O que é este tema?', when: 'Quando acontece?', where: 'Como lugares diferentes o vivenciam?', differences: 'O que muda de um lugar para outro?',
    sources: 'Fontes e datas', sourceNote: 'As datas seguem fusos locais, calendários e comunicados oficiais. Consulte a fonte quando a data for estimada ou variar por região.',
    related: 'Temas relacionados', updated: 'Atualizado em', noDate: 'Não há uma única data fixa verificável aqui; o momento varia conforme o lugar, a família ou a escolha pessoal.',
    sourceLink: 'Ver fonte', home: 'Início', topic: 'tema',
    metaSuffix: 'Datas, costumes e diferenças locais', coveragePrefix: 'Abrange', sourceMeta: 'Com datas e fontes.',
    compareSuffix: 'Como {count} países vivenciam',
    colon: ': ',
    listSep: ', ', itemSep: '; ', endMark: '.', titleSep: ' | ',
  },
};

export function siteDescription(locale = LOCALE) {
  return SITE_DESCRIPTIONS[locale] || SITE_DESCRIPTIONS.en;
}

export function seoCopy(locale = LOCALE) {
  return SEO_COPY[locale] || SEO_COPY.en;
}

// 樣板填值:{count} / {country} / {topic}。與 DiscussionRoom 客戶端那支 fill() 同一種寫法
// —— 模板不寫死任何語言的字,語序由各語系自己的字串決定(hi/id/pt-BR 的語序與中文不同)。
export function fillTemplate(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole);
}

// Meta descriptions need to be useful in search results without leaking a raw URL.
// Keep the start of the sentence intact, because it carries the topic's main intent.
export function compactDescription(value, max = 170) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

export function sourceLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return String(url || 'source');
  }
}

export function localeRoutePath(pathname, currentBase) {
  const base = String(currentBase || '').replace(/\/$/, '');
  const path = String(pathname || '/');
  if (!base || !path.startsWith(base)) return path.startsWith('/') ? path : `/${path}`;
  const route = path.slice(base.length);
  return route.startsWith('/') ? route : `/${route}`;
}

// site 參數保留簽名相容,但跨站網址以 LOCALE_ORIGINS 為準(各站各自的網域,無共用 base)
export function localeUrl(site, locale, routePath) {
  const origin = LOCALE_ORIGINS[locale] || LOCALE_ORIGINS.en;
  const route = String(routePath || '/').replace(/^\/+/, '');
  return new URL(`/${route}`, origin);
}
