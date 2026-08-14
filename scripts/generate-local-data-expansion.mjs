#!/usr/bin/env node
// 補充七市場可實際拜訪的常設地點與有明確日期的活動。
// 這不是爬蟲：每筆資料都固定對應到 local-data-sources.json 的官方來源，
// 先寫入可審查的多語快照，再由 update-local-data.mjs 驗證與匯入 SQLite。
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLE_PATH = join(ROOT, 'content', 'local-sample-data.json');
const SOURCES_PATH = join(ROOT, 'content', 'local-data-sources.json');

const descriptions = (zhTW, en, ja, zhCN, hi, id, ptBR) => ({
  'zh-TW': zhTW,
  en,
  ja,
  'zh-CN': zhCN,
  hi,
  id,
  'pt-BR': ptBR,
});

const places = [
  {
    name: '國立故宮博物院',
    city_code: 'taipei',
    country_code: 'TW',
    place_type: 'permanent',
    topic_relevance: 'direct',
    topic_slugs: ['national-days'],
    address: '臺北市士林區至善路二段 221 號',
    map_query: '國立故宮博物院 臺北市士林區至善路二段221號',
    source_urls: ['https://www.npm.gov.tw/Articles.aspx?l=2&sno=02007001'],
    descriptions: descriptions(
      '臺北士林的國立故宮博物院保存大量東亞文物，適合從館藏與公共記憶認識臺灣所處的文化脈絡。',
      'Taipei’s National Palace Museum preserves major East Asian collections and offers a place to connect cultural heritage with public memory.',
      '台北・士林の国立故宮博物院は東アジアの文化財を収蔵し、コレクションと公共の記憶から台湾の文化的背景を考えられる場所です。',
      '台北士林的故宫博物院收藏大量东亚文物，可以从馆藏和公共记忆认识台湾所处的文化脉络。',
      'ताइपे का National Palace Museum पूर्वी एशिया की बड़ी संग्रहित विरासत को रखता है; यहाँ संग्रह और सार्वजनिक स्मृति के ज़रिए ताइवान के सांस्कृतिक संदर्भ को समझा जा सकता है।',
      'National Palace Museum di Shilin, Taipei, menyimpan koleksi besar Asia Timur dan menghubungkan warisan budaya dengan ingatan publik.',
      'O National Palace Museum, em Shilin, Taipei, preserva importantes coleções do Leste Asiático e relaciona patrimônio cultural e memória pública.',
    ),
  },
  {
    name: '東京國立博物館',
    city_code: 'tokyo',
    country_code: 'JP',
    place_type: 'permanent',
    topic_relevance: 'direct',
    topic_slugs: ['national-days'],
    address: '13-9 Ueno Park, Taito-ku, Tokyo 110-8712, Japan',
    map_query: 'Tokyo National Museum 13-9 Ueno Park Taito-ku Tokyo',
    source_urls: ['https://www.tnm.jp/modules/r_free_page/index.php?id=113Impey&lang=en'],
    descriptions: descriptions(
      '東京上野的東京國立博物館以日本與亞洲文化資產為核心，能把國家文化記憶放回具體的展覽與收藏中理解。',
      'Tokyo National Museum in Ueno presents Japanese and Asian cultural heritage through long-term collections, exhibitions, and public learning.',
      '上野の東京国立博物館は日本とアジアの文化財を紹介し、国家や地域の記憶を展示と収蔵品から具体的に見られます。',
      '上野的东京国立博物馆以日本和亚洲文化遗产为核心，通过展览和收藏呈现公共文化记忆。',
      'उएनो स्थित Tokyo National Museum जापान और एशिया की सांस्कृतिक विरासत को संग्रह और प्रदर्शनियों के माध्यम से दिखाता है।',
      'Tokyo National Museum di Ueno menampilkan warisan budaya Jepang dan Asia melalui koleksi serta pameran publik.',
      'O Tokyo National Museum, em Ueno, apresenta o patrimônio cultural do Japão e da Ásia por meio de coleções e exposições.',
    ),
  },
  {
    name: '豫園',
    city_code: 'shanghai',
    country_code: 'CN',
    place_type: 'permanent',
    topic_relevance: 'direct',
    topic_slugs: ['lantern-festival'],
    address: '上海市黃浦區豫園老街 279 號南門',
    map_query: '豫園 上海市黃浦區豫園老街279號',
    source_urls: ['https://english.shanghai.gov.cn/en-UniqueExperience-travelinshanghai/20250729/25cfb8bce97d4e798f99ac62986255ff.html'],
    descriptions: descriptions(
      '上海豫園是保存古典園林與城市節慶景觀的常設地點；官方旅遊資訊也介紹夜遊、光影與茶文化體驗。',
      'Yuyuan Garden is a permanent Shanghai heritage site where classical gardens, night scenes, light, and tea culture meet.',
      '上海の豫園は古典庭園と都市の季節行事を感じられる常設の文化空間で、公式案内には夜景、光、茶文化の体験も紹介されています。',
      '上海豫园是保存古典园林与城市节庆景观的常设地点，官方旅游信息也介绍夜游、光影和茶文化体验。',
      'शंघाई का Yuyuan Garden स्थायी सांस्कृतिक स्थल है जहाँ शास्त्रीय उद्यान, रात्रि-दृश्य, रोशनी और चाय संस्कृति मिलते हैं।',
      'Yuyuan Garden di Shanghai adalah situs warisan permanen yang memadukan taman klasik, suasana malam, cahaya, dan budaya teh.',
      'O Yuyuan Garden é um espaço permanente de patrimônio em Xangai, unindo jardins clássicos, cenas noturnas, luz e cultura do chá.',
    ),
  },
  {
    name: 'Aga Khan Palace',
    city_code: 'pune',
    country_code: 'IN',
    place_type: 'permanent',
    topic_relevance: 'direct',
    topic_slugs: ['national-days'],
    address: 'Pune, Maharashtra, India',
    map_query: 'Aga Khan Palace Pune Maharashtra India',
    source_urls: ['https://pune.gov.in/en/tourist-place/aagakhan-palace/'],
    descriptions: descriptions(
      'Pune 的 Aga Khan Palace 是與印度獨立運動和甘地記憶相連的歷史場所，適合從建築與地方史理解公共紀念。',
      'Aga Khan Palace in Pune is a historic site connected with India’s independence movement and Gandhi memory, linking architecture with public remembrance.',
      'プネーのAga Khan Palaceはインド独立運動とガンディーの記憶に結び付く歴史的な場所で、建築と公共の記憶を一緒に学べます。',
      'Pune 的 Aga Khan Palace 是与印度独立运动和甘地记忆相连的历史地点，可以从建筑和地方史理解公共纪念。',
      'पुणे का Aga Khan Palace भारत के स्वतंत्रता आंदोलन और गांधी की स्मृति से जुड़ा ऐतिहासिक स्थल है।',
      'Aga Khan Palace di Pune adalah situs sejarah yang terkait dengan gerakan kemerdekaan India dan ingatan tentang Gandhi.',
      'O Aga Khan Palace, em Pune, é um local histórico ligado ao movimento de independência da Índia e à memória de Gandhi.',
    ),
  },
  {
    name: 'Istiqlal Mosque',
    city_code: 'jakarta',
    country_code: 'ID',
    place_type: 'permanent',
    topic_relevance: 'direct',
    topic_slugs: ['ramadan-and-eid', 'eid-al-adha'],
    address: 'Jl. Taman Wijaya Kusuma, Pasar Baru, Sawah Besar, Jakarta Pusat, DKI Jakarta',
    map_query: 'Istiqlal Mosque Jakarta',
    source_urls: ['https://turis.istiqlal.or.id/'],
    descriptions: descriptions(
      '雅加達的 Istiqlal Mosque 是可參訪的國家清真寺，官方旅遊系統提供國內外訪客導覽資訊，能連結齋戒月、開齋節與宰牲節的公共宗教生活。',
      'Istiqlal Mosque in Jakarta is Indonesia’s national mosque and provides visitor guidance, making it a concrete place to understand Ramadan, Eid al-Fitr, and Eid al-Adha in public life.',
      'ジャカルタのIstiqlal Mosqueはインドネシアの国立モスクで、公式の観光案内が国内外の訪問者を受け入れています。ラマダーンやイードの公共的な宗教生活を知る手がかりになります。',
      '雅加达的 Istiqlal Mosque 是可参访的国家清真寺，官方旅游系统为国内外访客提供导览信息，可联系斋戒月、开斋节与宰牲节的公共宗教生活。',
      'जकार्ता की Istiqlal Mosque इंडोनेशिया की राष्ट्रीय मस्जिद है; आधिकारिक पर्यटक व्यवस्था रमज़ान और दोनों ईद के सार्वजनिक धार्मिक जीवन को समझने का ठोस स्थान देती है।',
      'Istiqlal Mosque di Jakarta adalah masjid nasional Indonesia dengan panduan bagi wisatawan, sehingga menjadi tempat nyata untuk memahami Ramadan, Idul Fitri, dan Idul Adha.',
      'A Istiqlal Mosque, em Jacarta, é a mesquita nacional da Indonésia e oferece orientação para visitantes, conectando a vida religiosa pública ao Ramadã e aos dois Eid.',
    ),
  },
  {
    name: 'Museu do Ipiranga',
    city_code: 'sao-paulo',
    country_code: 'BR',
    place_type: 'permanent',
    topic_relevance: 'direct',
    topic_slugs: ['national-days'],
    address: 'Rua dos Patriotas, 100 – Ipiranga – São Paulo/SP – CEP 04207-030',
    map_query: 'Museu do Ipiranga Rua dos Patriotas 100 São Paulo',
    source_urls: ['https://museudoipiranga.org.br/en/visit/'],
    descriptions: descriptions(
      'São Paulo 的 Museu do Ipiranga 位在獨立公園旁，官方參觀頁列有地址與巴西獨立日免費開放資訊，是理解國家記憶的具體場所。',
      'Museu do Ipiranga in São Paulo stands beside Independence Park; its official visitor page lists the address and Brazil’s Independence Day programming.',
      'サンパウロのMuseu do Ipirangaは独立公園にあり、公式の訪問案内には住所とブラジル独立日に関する開館情報が掲載されています。',
      'São Paulo 的 Museu do Ipiranga 位于独立公园旁，官方参观页面列出地址和巴西独立日开放信息，是理解国家记忆的具体地点。',
      'साओ पाउलो का Museu do Ipiranga Independence Park के पास है; आधिकारिक आगंतुक पेज पर पता और ब्राज़ील के स्वतंत्रता दिवस की जानकारी है।',
      'Museu do Ipiranga di São Paulo berada di dekat Independence Park; halaman kunjungan resminya mencantumkan alamat dan informasi Hari Kemerdekaan Brasil.',
      'O Museu do Ipiranga, em São Paulo, fica junto ao Parque da Independência; a página oficial informa o endereço e a programação ligada ao Dia da Independência do Brasil.',
    ),
  },
];

const events = [
  {
    name: '2026 Taipei Night Market Festival',
    city_code: 'taipei',
    country_code: 'TW',
    venue: 'Taipei night markets',
    start_at: '2026-05-14T00:00:00+08:00',
    end_at: '2026-10-31T23:59:00+08:00',
    source_url: 'https://www.travel.taipei/en/event-calendar/details/66783',
    topic_slugs: ['harvest-and-gratitude'],
    descriptions: descriptions(
      '2026 臺北夜市節以城市夜市、地方小吃與夜間逛街為主題，適合把共享餐桌放回臺北的日常場景理解。',
      'The 2026 Taipei Night Market Festival connects local food, night markets, and shared city life across Taipei.',
      '2026 Taipei Night Market Festivalは、台北の夜市、地域の食べ物、夜の街歩きを通して共有の食卓を感じる催しです。',
      '2026 台北夜市节以城市夜市、地方小吃和夜间逛街为主题，把共享餐桌放回台北的日常场景。',
      '2026 Taipei Night Market Festival ताइपे के नाइट मार्केट, स्थानीय भोजन और साझा शहर-जीवन को जोड़ता है।',
      '2026 Taipei Night Market Festival menghubungkan pasar malam, makanan lokal, dan kehidupan kota bersama di Taipei.',
      'O 2026 Taipei Night Market Festival reúne mercados noturnos, comida local e a vida compartilhada da cidade de Taipei.',
    ),
  },
  {
    name: 'Tokyo Festival 2026',
    city_code: 'tokyo',
    country_code: 'JP',
    venue: 'Tokyo metropolitan venues',
    start_at: '2026-09-01T00:00:00+09:00',
    end_at: '2026-11-03T23:59:00+09:00',
    source_url: 'https://tokyofestival.jp/en/about',
    topic_slugs: ['ask-the-world'],
    descriptions: descriptions(
      'Tokyo Festival 2026 在東京多個場地串起跨文化表演與交流，讓「向世界提問」落在真實的城市節目與觀眾互動裡。',
      'Tokyo Festival 2026 brings intercultural performance and exchange to venues across Tokyo, giving cross-border questions a real public setting.',
      'Tokyo Festival 2026は東京各地で異文化の舞台と交流をつなぎ、世界に問いかける場を都市のプログラムと観客の出会いにします。',
      'Tokyo Festival 2026 在东京多个场地串联跨文化表演与交流，让“向世界提问”落在真实的城市节目和观众互动中。',
      'Tokyo Festival 2026 टोक्यो के कई स्थलों पर अंतर-सांस्कृतिक प्रदर्शन और संवाद लाता है, जिससे दुनिया से सवाल करना सार्वजनिक अनुभव बनता है।',
      'Tokyo Festival 2026 menghubungkan pertunjukan dan pertukaran lintas budaya di berbagai tempat Tokyo, memberi ruang publik bagi pertanyaan lintas negara.',
      'O Tokyo Festival 2026 leva apresentações e intercâmbio intercultural a vários locais de Tóquio, criando um espaço público para perguntas entre países.',
    ),
  },
];

const placeSources = [
  {
    url: 'https://www.npm.gov.tw/Articles.aspx?l=2&sno=02007001',
    market: 'zh-TW', kind: 'place',
    discovery_query: 'National Palace Museum Taipei official visitor information address',
    markers: ['National Palace Museum', 'Lixing St'],
  },
  {
    url: 'https://www.tnm.jp/modules/r_free_page/index.php?id=113Impey&lang=en',
    market: 'ja', kind: 'place',
    discovery_query: 'Tokyo National Museum official visitor information Ueno Park address',
    markers: ['TOKYO NATIONAL MUSEUM', '13-9 Ueno Park'],
  },
  {
    url: 'https://english.shanghai.gov.cn/en-UniqueExperience-travelinshanghai/20250729/25cfb8bce97d4e798f99ac62986255ff.html',
    market: 'zh-CN', kind: 'place',
    discovery_query: 'Shanghai government Yuyuan Garden South Gate official visitor information',
    markers: ['Yuyuan Garden', 'Yuyuan Garden South Gate'],
  },
  {
    url: 'https://pune.gov.in/en/tourist-place/aagakhan-palace/',
    market: 'hi', kind: 'place',
    discovery_query: 'District Pune government Aagakhan Palace tourist place',
    markers: ['Aagakhan Palace', 'Pune'],
  },
  {
    url: 'https://turis.istiqlal.or.id/',
    market: 'id', kind: 'place',
    discovery_query: 'Istiqlal Mosque Jakarta official tourist information',
    markers: ['Welcome to Istiqlal Mosque', 'INTERNATIONAL TOURIST'],
  },
  {
    url: 'https://museudoipiranga.org.br/en/visit/',
    market: 'pt-BR', kind: 'place',
    discovery_query: 'Ipiranga Museum official visit Rua dos Patriotas 100',
    markers: ['Ipiranga Museum', 'Rua dos Patriotas, 100'],
  },
];

const eventSources = [
  {
    url: 'https://www.travel.taipei/en/event-calendar/details/66783',
    market: 'zh-TW', kind: 'event',
    discovery_query: 'Taipei Travel official 2026 Taipei Night Market Festival May 14 October 31',
    markers: ['2026 Taipei Night Market Festival', '17 night markets'],
    date_markers: ['2026-05-14', '2026-10-31'],
  },
  {
    url: 'https://tokyofestival.jp/en/about',
    market: 'ja', kind: 'event',
    discovery_query: 'Tokyo Festival official 2026 September 1 November 3',
    markers: ['Tokyo Festival', '2026'],
    date_markers: ['September 1st', 'November 3rd'],
  },
];

const sample = JSON.parse(readFileSync(SAMPLE_PATH, 'utf8'));
const catalog = JSON.parse(readFileSync(SOURCES_PATH, 'utf8'));
const sourceByUrl = new Map((catalog.sources || []).map((source) => [source.url, source]));
const existingPlaceKeys = new Set((sample.places || []).map((place) => `${place.country_code}:${place.city_code}:${place.name}`));
const existingEventKeys = new Set((sample.events || []).map((event) => `${event.country_code}:${event.city_code}:${event.name}`));

for (const source of [...placeSources, ...eventSources]) {
  const previous = sourceByUrl.get(source.url);
  if (previous) {
    if (previous.kind !== source.kind || previous.market !== source.market) {
      throw new Error(`來源的 kind/market 與既有目錄衝突：${source.url}`);
    }
    if (source.date_markers) previous.date_markers = [...new Set([...(previous.date_markers || []), ...source.date_markers])];
    previous.markers = [...new Set([...(previous.markers || []), ...source.markers])];
    continue;
  }
  catalog.sources.push(source);
  sourceByUrl.set(source.url, source);
}

for (const place of places) {
  const key = `${place.country_code}:${place.city_code}:${place.name}`;
  if (!existingPlaceKeys.has(key)) {
    sample.places.push(place);
    existingPlaceKeys.add(key);
  }
  for (const url of place.source_urls) {
    if (!sample.managed_place_source_urls.includes(url)) sample.managed_place_source_urls.push(url);
  }
}
for (const event of events) {
  const key = `${event.country_code}:${event.city_code}:${event.name}`;
  const previous = sample.events.find((candidate) => `${candidate.country_code}:${candidate.city_code}:${candidate.name}` === key);
  if (previous) {
    Object.assign(previous, event);
  } else {
    sample.events.push(event);
    existingEventKeys.add(key);
  }
  if (!sample.managed_event_source_urls.includes(event.source_url)) sample.managed_event_source_urls.push(event.source_url);
}

sample.as_of = '2026-08-14';
catalog.version = catalog.version || 1;
writeFileSync(SAMPLE_PATH, `${JSON.stringify(sample, null, 2)}\n`);
writeFileSync(SOURCES_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`local data expansion: ${places.length} places + ${events.length} events; catalog ${catalog.sources.length} sources`);
