-- aeiou.now — M1 示範資料(Track A / W1.1)
-- 可重跑:全部 INSERT OR REPLACE,連跑兩次不報錯、結果相同。
-- ID 格式 <prefix>_<ULID>,ULID 為手寫合法 Crockford Base32(26 字元,不含 I/L/O/U)。
-- 時間一律 Unix epoch 秒。基準:2026-08-11 00:00:00 UTC = 1786406400。
--
-- ID 一覽:
--   top_01J50000000000000000000T01  affection-and-reciprocity
--   top_01J50000000000000000000T02  ask-the-world
--   cyc_01J50000000000000000000C01  affection-and-reciprocity 2026-02(進行中)
--   cyc_01J50000000000000000000C02  ask-the-world 2026-01(進行中)
--   src_...S01~S06  假來源;plc_...P01~P03  places;evt_...E01~E02  events
--   als_...A01~A02  aliases;snp_...R01  ranking snapshot

-- ============ sources(假來源,供 source_ids_json / events.source_id 指向) ============

INSERT OR REPLACE INTO sources (source_id, url, domain, source_type, language, country_code, city_code, title, published_at, crawled_at, next_crawl_at, crawl_freq_s, content_hash, quality_score, trust_score, status, updated_at) VALUES
  ('src_01J50000000000000000000S01', 'https://en.wikipedia.org/wiki/Valentine%27s_Day', 'en.wikipedia.org', 'encyclopedia', 'en', NULL, NULL, 'Valentine''s Day - Wikipedia', 1769904000, 1786320000, 1786492800, 86400, NULL, 0.9, 0.9, 'processed', 1786320000),
  ('src_01J50000000000000000000S02', 'https://www.japantimes.co.jp/culture/2026/02/valentine-chocolate-guide/', 'japantimes.co.jp', 'news', 'ja', 'JP', 'tokyo', 'Honmei or giri? Japan''s Valentine chocolate culture', 1770595200, 1786320000, 1786492800, 86400, NULL, 0.8, 0.8, 'processed', 1786320000),
  ('src_01J50000000000000000000S03', 'https://g1.globo.com/economia/noticia/2026/06/dia-dos-namorados-comercio.html', 'g1.globo.com', 'news', 'pt-BR', 'BR', NULL, 'Dia dos Namorados movimenta o comércio em 12 de junho', 1781222400, 1786320000, 1786492800, 86400, NULL, 0.8, 0.8, 'processed', 1786320000),
  ('src_01J50000000000000000000S04', 'https://timesofindia.indiatimes.com/life-style/relationships/valentine-week-2026-full-list', 'timesofindia.indiatimes.com', 'news', 'en', 'IN', NULL, 'Valentine Week 2026: Rose Day to Kiss Day, the full list', 1770508800, 1786320000, 1786492800, 86400, NULL, 0.7, 0.7, 'processed', 1786320000),
  ('src_01J50000000000000000000S05', 'https://www.history.com/topics/valentines-day/history-of-valentines-day-2', 'history.com', 'news', 'en', 'US', NULL, 'History of Valentine''s Day', 1769904000, 1786320000, 1786492800, 86400, NULL, 0.8, 0.8, 'processed', 1786320000),
  ('src_01J50000000000000000000S06', 'https://www.travel.taipei/event/chocolate-salon-2027', 'www.travel.taipei', 'official', 'zh-TW', 'TW', 'taipei', '2027 台北巧克力沙龍活動資訊', 1785801600, 1786320000, 1786492800, 86400, NULL, 0.8, 0.9, 'processed', 1786320000);

-- ============ ① affection-and-reciprocity(週期性) ============

INSERT OR REPLACE INTO topics (topic_id, slug, canonical_name, commonality, category, status, merged_into, is_perennial, access_level, access_source, global_score, first_seen_at, last_activity_at, created_at, updated_at) VALUES
  ('top_01J50000000000000000000T01', 'affection-and-reciprocity', 'Affection and Reciprocity', 'expressing affection through gifts, attention, and reciprocal gestures', 'relationship', 'active', NULL, 0, 0, 'category', 87.5, 1768435200, 1786406400, 1768435200, 1786406400);

INSERT OR REPLACE INTO topic_i18n (topic_id, locale, title, summary, keywords_json, updated_at) VALUES
  ('top_01J50000000000000000000T01', 'zh-TW', '表達愛意與互惠', '各地用節日、禮物、陪伴與回禮表達親密關係；日本有情人節與白色情人節，巴西在 6 月 12 日過戀人節。', '["表達愛意","親密關係","禮物","回禮"]', 1786406400),
  ('top_01J50000000000000000000T01', 'en', 'Affection and reciprocity', 'People express intimacy through holidays, gifts, attention and return gestures; Japan has Valentine and White Day, while Brazil celebrates on June 12.', '["affection","intimacy","gifts","reciprocity"]', 1786406400),
  ('top_01J50000000000000000000T01', 'ja', '愛情表現とお返し', '祝日、贈り物、気遣い、お返しで親密さを表す方法は社会ごとに異なる。日本にはバレンタインとホワイトデーがあり、ブラジルは6月12日です。', '["愛情表現","親密さ","贈り物","お返し"]', 1786406400),
  ('top_01J50000000000000000000T01', 'zh-CN', '表达爱意与互惠', '各地用节日、礼物、陪伴和回礼表达亲密关系；日本有情人节与白色情人节，巴西在 6 月 12 日过恋人节。', '["表达爱意","亲密关系","礼物","回礼"]', 1786406400),
  ('top_01J50000000000000000000T01', 'hi', 'स्नेह और पारस्परिकता', 'समाज त्योहारों, उपहारों, साथ और लौटाए गए उपहारों से निकटता व्यक्त करते हैं; जापान में वैलेंटाइन और व्हाइट डे, ब्राज़ील में 12 जून है।', '["स्नेह","निकटता","उपहार","पारस्परिकता"]', 1786406400),
  ('top_01J50000000000000000000T01', 'id', 'Kasih sayang dan timbal balik', 'Masyarakat mengekspresikan kedekatan melalui perayaan, hadiah, perhatian, dan balasan; Jepang memiliki Valentine dan White Day, sedangkan Brasil merayakannya pada 12 Juni.', '["kasih sayang","kedekatan","hadiah","timbal balik"]', 1786406400),
  ('top_01J50000000000000000000T01', 'pt-BR', 'Afeto e reciprocidade', 'As sociedades expressam intimidade por datas, presentes, atenção e retribuição; o Japão tem Valentine e White Day, enquanto o Brasil celebra em 12 de junho.', '["afeto","intimidade","presentes","reciprocidade"]', 1786406400);

-- 事實層:四國(JP/US/BR/IN),每一筆是地方表現(observance),source_ids_json 必填
INSERT OR REPLACE INTO topic_observances
  (observance_id, topic_id, observance_key, country_code, local_name, observed_date, date_rule,
   date_range_end, popularity_rank, source_ids_json, updated_at) VALUES
  ('obs_top_01J50000000000000000000T01_valentine', 'top_01J50000000000000000000T01', 'valentine', 'JP', 'バレンタインデー', '02-14', NULL, NULL, 1, '["src_01J50000000000000000000S01","src_01J50000000000000000000S02"]', 1786406400),
  ('obs_top_01J50000000000000000000T01_valentine-us', 'top_01J50000000000000000000T01', 'valentine-us', 'US', 'Valentine''s Day', '02-14', NULL, NULL, 2, '["src_01J50000000000000000000S01","src_01J50000000000000000000S05"]', 1786406400),
  ('obs_top_01J50000000000000000000T01_dia-dos-namorados', 'top_01J50000000000000000000T01', 'dia-dos-namorados', 'BR', 'Dia dos Namorados', '06-12', NULL, NULL, 3, '["src_01J50000000000000000000S01","src_01J50000000000000000000S03"]', 1786406400),
  ('obs_top_01J50000000000000000000T01_valentine-week', 'top_01J50000000000000000000T01', 'valentine-week', 'IN', 'Valentine Week', '02-07', NULL, '02-14', 4, '["src_01J50000000000000000000S01","src_01J50000000000000000000S04"]', 1786406400);

-- 每國 × 七語 customs(真實文化事實,非佔位)
INSERT OR REPLACE INTO topic_observance_i18n (observance_id, locale, customs_text) VALUES
  -- 日本
  ('obs_top_01J50000000000000000000T01_valentine', 'zh-TW', '在日本,2 月 14 日由女性送巧克力:給心儀對象的「本命巧克力」,給同事朋友的「義理巧克力」。男性在 3 月 14 日白色情人節回禮。'),
  ('obs_top_01J50000000000000000000T01_valentine', 'en', 'In Japan, women give chocolate on February 14: honmei-choco (true-feelings chocolate) for a romantic interest and giri-choco (obligation chocolate) for colleagues and friends. Men reciprocate on White Day, March 14.'),
  ('obs_top_01J50000000000000000000T01_valentine', 'ja', '日本では2月14日に女性がチョコレートを贈る。意中の相手には本命チョコ、同僚や友人には義理チョコ。男性は3月14日のホワイトデーにお返しをする。'),
  ('obs_top_01J50000000000000000000T01_valentine', 'zh-CN', '在日本,2 月 14 日由女性送巧克力:给心仪对象的"本命巧克力",给同事朋友的"义理巧克力"。男性在 3 月 14 日白色情人节回礼。'),
  ('obs_top_01J50000000000000000000T01_valentine', 'hi', 'जापान में 14 फ़रवरी को महिलाएँ चॉकलेट देती हैं: पसंद के व्यक्ति को होनमेई-चोको और सहकर्मियों-दोस्तों को गिरी-चोको। पुरुष 14 मार्च के व्हाइट डे पर बदले में उपहार देते हैं।'),
  ('obs_top_01J50000000000000000000T01_valentine', 'id', 'Di Jepang, perempuan memberi cokelat pada 14 Februari: honmei-choco untuk orang yang disukai dan giri-choco untuk rekan kerja atau teman. Laki-laki membalasnya pada White Day, 14 Maret.'),
  ('obs_top_01J50000000000000000000T01_valentine', 'pt-BR', 'No Japão, as mulheres dão chocolate em 14 de fevereiro: honmei-choco para o interesse romântico e giri-choco para colegas e amigos. Os homens retribuem no White Day, 14 de março.'),
  -- 美國
  ('obs_top_01J50000000000000000000T01_valentine-us', 'zh-TW', '美國人在 2 月 14 日互送賀卡、鮮花與巧克力;小學生常在班上互贈情人節卡片,情侶則以晚餐約會慶祝。'),
  ('obs_top_01J50000000000000000000T01_valentine-us', 'en', 'Americans exchange greeting cards, flowers and chocolates on February 14. Schoolchildren often hand out valentine cards to the whole class, and couples celebrate with dinner dates.'),
  ('obs_top_01J50000000000000000000T01_valentine-us', 'ja', 'アメリカでは2月14日にカードや花、チョコレートを贈り合う。小学生はクラス全員にバレンタインカードを配ることが多く、カップルはディナーデートで祝う。'),
  ('obs_top_01J50000000000000000000T01_valentine-us', 'zh-CN', '美国人在 2 月 14 日互赠贺卡、鲜花和巧克力;小学生常给全班同学分发情人节卡片,情侣则以晚餐约会庆祝。'),
  ('obs_top_01J50000000000000000000T01_valentine-us', 'hi', 'अमेरिका में 14 फ़रवरी को लोग ग्रीटिंग कार्ड, फूल और चॉकलेट का आदान-प्रदान करते हैं। स्कूली बच्चे पूरी कक्षा को वैलेंटाइन कार्ड बाँटते हैं और जोड़े डिनर डेट से मनाते हैं।'),
  ('obs_top_01J50000000000000000000T01_valentine-us', 'id', 'Di Amerika Serikat, orang bertukar kartu ucapan, bunga, dan cokelat pada 14 Februari. Anak sekolah biasa membagikan kartu valentine ke seluruh kelas, dan pasangan merayakannya dengan makan malam.'),
  ('obs_top_01J50000000000000000000T01_valentine-us', 'pt-BR', 'Nos Estados Unidos, trocam-se cartões, flores e chocolates em 14 de fevereiro. As crianças distribuem cartões de valentine para a turma toda, e os casais comemoram com jantares românticos.'),
  -- 巴西
  ('obs_top_01J50000000000000000000T01_dia-dos-namorados', 'zh-TW', '巴西的情人節是 6 月 12 日的「Dia dos Namorados」,即「媒人聖人」聖安東尼日前夕;情侶互贈禮物、共進浪漫晚餐。2 月 14 日適逢嘉年華季,幾乎不慶祝。'),
  ('obs_top_01J50000000000000000000T01_dia-dos-namorados', 'en', 'Brazil celebrates Dia dos Namorados on June 12, the eve of Saint Anthony''s Day, the matchmaker saint. Couples exchange gifts and go out for romantic dinners; February 14 passes largely unnoticed amid Carnival season.'),
  ('obs_top_01J50000000000000000000T01_dia-dos-namorados', 'ja', 'ブラジルの恋人の日は6月12日の「Dia dos Namorados」。縁結びの聖人・聖アントニオの日の前夜にあたり、恋人同士が贈り物を交換しディナーを楽しむ。2月14日はカーニバルの時期で、ほとんど祝われない。'),
  ('obs_top_01J50000000000000000000T01_dia-dos-namorados', 'zh-CN', '巴西的情人节是 6 月 12 日的"Dia dos Namorados",即"媒人圣人"圣安东尼日前夕;情侣互赠礼物、共进浪漫晚餐。2 月 14 日恰逢狂欢节季,几乎不庆祝。'),
  ('obs_top_01J50000000000000000000T01_dia-dos-namorados', 'hi', 'ब्राज़ील में प्रेमियों का दिन "Dia dos Namorados" 12 जून को मनाया जाता है, जो विवाह कराने वाले संत एंटोनियो के दिन की पूर्व संध्या है। जोड़े उपहार बदलते हैं और डिनर पर जाते हैं; कार्निवल के मौसम के कारण 14 फ़रवरी लगभग नहीं मनाई जाती।'),
  ('obs_top_01J50000000000000000000T01_dia-dos-namorados', 'id', 'Brasil merayakan Dia dos Namorados pada 12 Juni, malam sebelum hari Santo Antonius, santo perjodohan. Pasangan bertukar hadiah dan makan malam romantis; 14 Februari nyaris tidak dirayakan karena musim Karnaval.'),
  ('obs_top_01J50000000000000000000T01_dia-dos-namorados', 'pt-BR', 'No Brasil, o Dia dos Namorados é 12 de junho, véspera do dia de Santo Antônio, o santo casamenteiro. Casais trocam presentes e jantam fora; o 14 de fevereiro passa quase despercebido por causa do Carnaval.'),
  -- 印度
  ('obs_top_01J50000000000000000000T01_valentine-week', 'zh-TW', '在印度,都市青年慶祝 2 月 7 日至 14 日的「情人週」:玫瑰日、告白日、巧克力日、泰迪熊日、承諾日、擁抱日、親吻日,最後是情人節。慶祝以都市為主,也曾遭部分保守團體反對。'),
  ('obs_top_01J50000000000000000000T01_valentine-week', 'en', 'In India, urban youth celebrate Valentine Week from February 7 to 14: Rose Day, Propose Day, Chocolate Day, Teddy Day, Promise Day, Hug Day, Kiss Day, then Valentine''s Day. Celebrations are mainly urban and have faced opposition from some conservative groups.'),
  ('obs_top_01J50000000000000000000T01_valentine-week', 'ja', 'インドでは都市部の若者が2月7日から14日までの「バレンタインウィーク」を祝う。ローズデー、プロポーズデー、チョコレートデー、テディデー、プロミスデー、ハグデー、キスデー、そしてバレンタインデー。都市部が中心で、一部の保守団体からの反発もある。'),
  ('obs_top_01J50000000000000000000T01_valentine-week', 'zh-CN', '在印度,城市青年庆祝 2 月 7 日至 14 日的"情人周":玫瑰日、表白日、巧克力日、泰迪熊日、承诺日、拥抱日、亲吻日,最后是情人节。庆祝以城市为主,也曾遭部分保守团体反对。'),
  ('obs_top_01J50000000000000000000T01_valentine-week', 'hi', 'भारत में शहरी युवा 7 से 14 फ़रवरी तक वैलेंटाइन वीक मनाते हैं: रोज़ डे, प्रपोज़ डे, चॉकलेट डे, टेडी डे, प्रॉमिस डे, हग डे, किस डे और अंत में वैलेंटाइन डे। यह मुख्यतः शहरों में मनाया जाता है और कुछ रूढ़िवादी समूह इसका विरोध भी करते रहे हैं।'),
  ('obs_top_01J50000000000000000000T01_valentine-week', 'id', 'Di India, anak muda perkotaan merayakan Valentine Week dari 7 hingga 14 Februari: Rose Day, Propose Day, Chocolate Day, Teddy Day, Promise Day, Hug Day, Kiss Day, lalu Hari Valentine. Perayaan terutama di kota besar dan sempat ditentang sebagian kelompok konservatif.'),
  ('obs_top_01J50000000000000000000T01_valentine-week', 'pt-BR', 'Na Índia, jovens urbanos celebram a Valentine Week de 7 a 14 de fevereiro: Rose Day, Propose Day, Chocolate Day, Teddy Day, Promise Day, Hug Day, Kiss Day e, por fim, o Valentine''s Day. A celebração é sobretudo urbana e já enfrentou oposição de grupos conservadores.');

-- ============ ② ask-the-world(長青) ============

INSERT OR REPLACE INTO topics (topic_id, slug, canonical_name, commonality, category, status, merged_into, is_perennial, access_level, access_source, global_score, first_seen_at, last_activity_at, created_at, updated_at) VALUES
  ('top_01J50000000000000000000T02', 'ask-the-world', 'Ask the World', 'year-round curiosity and respectful exchange between people in different places', 'community', 'active', NULL, 1, 0, 'category', 52.0, 1767225600, 1786406400, 1767225600, 1786406400);

INSERT OR REPLACE INTO topic_i18n (topic_id, locale, title, summary, keywords_json, updated_at) VALUES
  ('top_01J50000000000000000000T02', 'zh-TW', '問世界', '對其他國家的日常感到好奇?在這裡向全世界發問,讓當地人來回答。長青主題,全年開放。', '["問世界","跨國問答","文化交流"]', 1786406400),
  ('top_01J50000000000000000000T02', 'en', 'Ask the World', 'Curious about everyday life in other countries? Post your question here and let locals answer. A perennial topic, open all year round.', '["ask the world","cross-country Q&A","culture exchange"]', 1786406400),
  ('top_01J50000000000000000000T02', 'ja', '世界に聞く', '他の国の日常が気になる?ここで世界に質問して、現地の人に答えてもらおう。一年中開かれている常設トピック。', '["世界に聞く","国際Q&A","文化交流"]', 1786406400),
  ('top_01J50000000000000000000T02', 'zh-CN', '问世界', '对其他国家的日常感到好奇?在这里向全世界提问,让当地人来回答。长青主题,全年开放。', '["问世界","跨国问答","文化交流"]', 1786406400),
  ('top_01J50000000000000000000T02', 'hi', 'दुनिया से पूछो', 'दूसरे देशों की रोज़मर्रा की ज़िंदगी के बारे में जानना चाहते हैं? यहाँ सवाल पूछें और स्थानीय लोगों से जवाब पाएँ। साल भर खुला रहने वाला सदाबहार विषय।', '["दुनिया से पूछो","अंतरराष्ट्रीय प्रश्नोत्तर","संस्कृति"]', 1786406400),
  ('top_01J50000000000000000000T02', 'id', 'Tanya Dunia', 'Penasaran dengan kehidupan sehari-hari di negara lain? Ajukan pertanyaanmu di sini dan biarkan warga lokal menjawab. Topik abadi, terbuka sepanjang tahun.', '["tanya dunia","tanya jawab lintas negara","pertukaran budaya"]', 1786406400),
  ('top_01J50000000000000000000T02', 'pt-BR', 'Pergunte ao Mundo', 'Curioso sobre o dia a dia em outros países? Publique sua pergunta aqui e deixe os moradores locais responderem. Um tópico perene, aberto o ano todo.', '["pergunte ao mundo","perguntas entre países","intercâmbio cultural"]', 1786406400);

-- ============ topic_scores:兩 topic × 七時窗,scope='global',含 rank ============

INSERT OR REPLACE INTO topic_scores (topic_id, scope, window, score, rank, computed_at) VALUES
  ('top_01J50000000000000000000T01', 'global', '8h',  3.2,  2, 1786406400),
  ('top_01J50000000000000000000T01', 'global', '24h', 4.1,  2, 1786406400),
  ('top_01J50000000000000000000T01', 'global', '72h', 5.0,  2, 1786406400),
  ('top_01J50000000000000000000T01', 'global', '7d',  6.4,  2, 1786406400),
  ('top_01J50000000000000000000T01', 'global', '1m',  9.8,  2, 1786406400),
  ('top_01J50000000000000000000T01', 'global', '3m', 14.2,  2, 1786406400),
  ('top_01J50000000000000000000T01', 'global', '1y', 87.5,  1, 1786406400),
  ('top_01J50000000000000000000T02', 'global', '8h', 20.3,  1, 1786406400),
  ('top_01J50000000000000000000T02', 'global', '24h',19.8,  1, 1786406400),
  ('top_01J50000000000000000000T02', 'global', '72h',19.5,  1, 1786406400),
  ('top_01J50000000000000000000T02', 'global', '7d', 19.2,  1, 1786406400),
  ('top_01J50000000000000000000T02', 'global', '1m', 18.9,  1, 1786406400),
  ('top_01J50000000000000000000T02', 'global', '3m', 18.5,  1, 1786406400),
  ('top_01J50000000000000000000T02', 'global', '1y', 52.0,  2, 1786406400);

-- ============ topic_cycles:各 1 個進行中(ended_at IS NULL) ============

INSERT OR REPLACE INTO topic_cycles (cycle_id, topic_id, label, started_at, ended_at, peak_score, peak_rank, post_count) VALUES
  ('cyc_01J50000000000000000000C01', 'top_01J50000000000000000000T01', '2026-02', 1769904000, NULL, 87.5, 1, 0),
  ('cyc_01J50000000000000000000C02', 'top_01J50000000000000000000T02', '2026-01', 1767225600, NULL, 20.3, 1, 0);

-- ============ topic_aliases / topic_relations(Topic Graph) ============

INSERT OR REPLACE INTO topic_aliases (alias_id, topic_id, alias, locale, source, created_at) VALUES
  ('als_01J50000000000000000000A01', 'top_01J50000000000000000000T01', 'バレンタインデー', 'ja', 'manual', 1768435200),
  ('als_01J50000000000000000000A02', 'top_01J50000000000000000000T01', 'Saint Valentine''s Day', NULL, 'manual', 1768435200);

INSERT OR REPLACE INTO topic_relations (from_topic_id, to_topic_id, relation, country_code, weight, created_at) VALUES
  ('top_01J50000000000000000000T01', 'top_01J50000000000000000000T02', 'related', NULL, 0.2, 1768435200),
  ('top_01J50000000000000000000T02', 'top_01J50000000000000000000T01', 'related', NULL, 0.2, 1768435200);

-- ============ ③ ranking snapshot(global / 24h / hourly)+ items ============

INSERT OR REPLACE INTO ranking_snapshots (snapshot_id, scope, window, taken_at, granularity) VALUES
  ('snp_01J50000000000000000000R01', 'global', '24h', 1786406400, 'hourly');

INSERT OR REPLACE INTO ranking_items (snapshot_id, rank, topic_id, score) VALUES
  ('snp_01J50000000000000000000R01', 1, 'top_01J50000000000000000000T02', 19.8),
  ('snp_01J50000000000000000000R01', 2, 'top_01J50000000000000000000T01', 4.1);

-- ============ ④ places(map_url / nav_urls_json 皆為純字串組裝,絕無 Places API) ============

INSERT OR REPLACE INTO places (place_id, name, city_code, country_code, address, map_url, nav_urls_json, mention_count, discovered_via, source_urls_json, first_seen_at, updated_at) VALUES
  ('plc_01J50000000000000000000P01', 'GODIVA 銀座本店', 'tokyo', 'JP', '東京都中央区銀座', 'https://www.google.com/maps/search/?api=1&query=GODIVA%20Ginza%20Tokyo', '{"google":"https://www.google.com/maps/search/?api=1&query=GODIVA%20Ginza%20Tokyo","baidu":"https://map.baidu.com/search/?querytype=s&wd=GODIVA%20Ginza%20Tokyo","amap":"https://uri.amap.com/search?keyword=GODIVA%20Ginza%20Tokyo"}', 12, 'mention', NULL, 1769904000, 1786406400),
  ('plc_01J50000000000000000000P02', '畬室法式巧克力甜點創作', 'taipei', 'TW', '台北市大安區', 'https://www.google.com/maps/search/?api=1&query=Yu%20Chocolatier%20Taipei', '{"google":"https://www.google.com/maps/search/?api=1&query=Yu%20Chocolatier%20Taipei","baidu":"https://map.baidu.com/search/?querytype=s&wd=Yu%20Chocolatier%20Taipei","amap":"https://uri.amap.com/search?keyword=Yu%20Chocolatier%20Taipei"}', 8, 'mention', NULL, 1770595200, 1786406400),
  ('plc_01J50000000000000000000P03', '青山フラワーマーケット 表参道店', 'tokyo', 'JP', '東京都港区北青山', 'https://www.google.com/maps/search/?api=1&query=Aoyama%20Flower%20Market%20Omotesando', '{"google":"https://www.google.com/maps/search/?api=1&query=Aoyama%20Flower%20Market%20Omotesando","baidu":"https://map.baidu.com/search/?querytype=s&wd=Aoyama%20Flower%20Market%20Omotesando","amap":"https://uri.amap.com/search?keyword=Aoyama%20Flower%20Market%20Omotesando"}', 5, 'mention', NULL, 1771027200, 1786406400);

INSERT OR REPLACE INTO place_i18n (place_id, locale, description) VALUES
  ('plc_01J50000000000000000000P01', 'zh-TW', '銀座的比利時巧克力名店,情人節前排隊人潮眾多,常被討論為送禮首選。'),
  ('plc_01J50000000000000000000P01', 'en', 'Belgian chocolatier''s flagship in Ginza; long queues before Valentine''s Day, often mentioned as a go-to gift shop.'),
  ('plc_01J50000000000000000000P01', 'ja', '銀座のベルギー系チョコレート名店。バレンタイン前は行列ができ、贈り物の定番としてよく話題になる。'),
  ('plc_01J50000000000000000000P02', 'zh-TW', '台北知名法式巧克力專門店,曾獲國際巧克力賽事獎項,情人節限定禮盒常被推薦。'),
  ('plc_01J50000000000000000000P02', 'en', 'Award-winning French-style chocolate atelier in Taipei; its Valentine gift boxes are frequently recommended in discussions.'),
  ('plc_01J50000000000000000000P02', 'ja', '台北の有名なフレンチスタイルのショコラトリー。国際コンクール受賞歴があり、バレンタイン限定ボックスがよく薦められる。'),
  ('plc_01J50000000000000000000P03', 'zh-TW', '表參道的人氣花店,情人節玫瑰花束的熱門選擇。'),
  ('plc_01J50000000000000000000P03', 'en', 'Popular flower shop in Omotesando, a favorite for Valentine''s Day rose bouquets.'),
  ('plc_01J50000000000000000000P03', 'ja', '表参道の人気フラワーショップ。バレンタインのバラの花束の定番。');

INSERT OR REPLACE INTO place_topics (place_id, topic_id, relevance) VALUES
  ('plc_01J50000000000000000000P01', 'top_01J50000000000000000000T01', 0.9),
  ('plc_01J50000000000000000000P02', 'top_01J50000000000000000000T01', 0.8),
  ('plc_01J50000000000000000000P03', 'top_01J50000000000000000000T01', 0.6);

-- ============ events ============

INSERT OR REPLACE INTO events (event_id, name, city_code, country_code, venue, start_at, end_at, ticket_url, source_id, updated_at) VALUES
  ('evt_01J50000000000000000000E01', 'サロン・デュ・ショコラ 東京 2027', 'tokyo', 'JP', '新宿NSビル', 1800403200, 1800748800, NULL, 'src_01J50000000000000000000S02', 1786406400),
  ('evt_01J50000000000000000000E02', '2027 台北巧克力沙龍', 'taipei', 'TW', '圓山花博爭艷館', 1801785600, 1801958400, NULL, 'src_01J50000000000000000000S06', 1786406400);

INSERT OR REPLACE INTO event_i18n (event_id, locale, description) VALUES
  ('evt_01J50000000000000000000E01', 'zh-TW', '世界最大巧克力展的東京場,每年 1 月底登場,是日本情人節採購季的起點。'),
  ('evt_01J50000000000000000000E01', 'en', 'Tokyo edition of the world''s largest chocolate fair, held in late January and marking the start of Japan''s Valentine shopping season.'),
  ('evt_01J50000000000000000000E01', 'ja', '世界最大級のチョコレートの祭典の東京会場。毎年1月下旬に開かれ、日本のバレンタイン商戦の幕開けとなる。'),
  ('evt_01J50000000000000000000E02', 'zh-TW', '台北的巧克力主題市集,集合本地與國際品牌,情人節前夕的採購與試吃活動。'),
  ('evt_01J50000000000000000000E02', 'en', 'Chocolate-themed fair in Taipei gathering local and international brands, with tastings ahead of Valentine''s Day.'),
  ('evt_01J50000000000000000000E02', 'ja', '台北のチョコレートをテーマにしたフェア。地元と海外のブランドが集まり、バレンタイン前に試食や購入ができる。');

INSERT OR REPLACE INTO event_topics (event_id, topic_id, relevance) VALUES
  ('evt_01J50000000000000000000E01', 'top_01J50000000000000000000T01', 0.9),
  ('evt_01J50000000000000000000E02', 'top_01J50000000000000000000T01', 0.8);
