// aeiou.now — ISO 3166-1 alpha-3 → alpha-2 對照(2026-08-21 新增)
//
// 為什麼需要:本專案的國碼標準是 **alpha-2**(兩碼)——
//   posts.country_code 來自 Cloudflare 的 request.cf.country(契約 §0,兩碼)
//   topic_observances / places 的 country_code(content/topics/*.md,兩碼)
//   data/meta/countries.json 的 key(兩碼)
//   topic_search_metrics.scope 的 schema 註解也明寫 'country:XX'(兩碼)
// 只有 Google Search Console 的 country 維度給的是 **alpha-3**。
// 2026-08-21 之前 gsc-topic-metrics.mjs 直接把它串進 scope,於是同一個國家被切成兩個:
// `country:TW`(貼文來的)與 `country:TWN`(GSC 來的)並存,data/rankings/ 底下也是
// TW/ 與 TWN/ 兩個目錄。
//
// 這份表由 /usr/share/iso-codes/json/iso_3166-1.json(Debian iso-codes 套件)產出後**寫死進 repo**
// —— 不在執行期讀那個檔:CI 的 runner 不保證裝了它,而一份會因為環境不同而改變的對照表
// 比沒有更糟。要更新就重新產一次(產法見上一行的路徑)。
//
// **不要只放七個市場的部分對照** —— 貼文與搜尋可能來自任何國家,漏掉的會靜靜地
// 變成第三套代碼,比現在的兩套更難查。

export const ALPHA3_TO_ALPHA2 = Object.freeze({
  ABW: "AW", AFG: "AF", AGO: "AO", AIA: "AI", ALA: "AX", ALB: "AL",
  AND: "AD", ARE: "AE", ARG: "AR", ARM: "AM", ASM: "AS", ATA: "AQ",
  ATF: "TF", ATG: "AG", AUS: "AU", AUT: "AT", AZE: "AZ", BDI: "BI",
  BEL: "BE", BEN: "BJ", BES: "BQ", BFA: "BF", BGD: "BD", BGR: "BG",
  BHR: "BH", BHS: "BS", BIH: "BA", BLM: "BL", BLR: "BY", BLZ: "BZ",
  BMU: "BM", BOL: "BO", BRA: "BR", BRB: "BB", BRN: "BN", BTN: "BT",
  BVT: "BV", BWA: "BW", CAF: "CF", CAN: "CA", CCK: "CC", CHE: "CH",
  CHL: "CL", CHN: "CN", CIV: "CI", CMR: "CM", COD: "CD", COG: "CG",
  COK: "CK", COL: "CO", COM: "KM", CPV: "CV", CRI: "CR", CUB: "CU",
  CUW: "CW", CXR: "CX", CYM: "KY", CYP: "CY", CZE: "CZ", DEU: "DE",
  DJI: "DJ", DMA: "DM", DNK: "DK", DOM: "DO", DZA: "DZ", ECU: "EC",
  EGY: "EG", ERI: "ER", ESH: "EH", ESP: "ES", EST: "EE", ETH: "ET",
  FIN: "FI", FJI: "FJ", FLK: "FK", FRA: "FR", FRO: "FO", FSM: "FM",
  GAB: "GA", GBR: "GB", GEO: "GE", GGY: "GG", GHA: "GH", GIB: "GI",
  GIN: "GN", GLP: "GP", GMB: "GM", GNB: "GW", GNQ: "GQ", GRC: "GR",
  GRD: "GD", GRL: "GL", GTM: "GT", GUF: "GF", GUM: "GU", GUY: "GY",
  HKG: "HK", HMD: "HM", HND: "HN", HRV: "HR", HTI: "HT", HUN: "HU",
  IDN: "ID", IMN: "IM", IND: "IN", IOT: "IO", IRL: "IE", IRN: "IR",
  IRQ: "IQ", ISL: "IS", ISR: "IL", ITA: "IT", JAM: "JM", JEY: "JE",
  JOR: "JO", JPN: "JP", KAZ: "KZ", KEN: "KE", KGZ: "KG", KHM: "KH",
  KIR: "KI", KNA: "KN", KOR: "KR", KWT: "KW", LAO: "LA", LBN: "LB",
  LBR: "LR", LBY: "LY", LCA: "LC", LIE: "LI", LKA: "LK", LSO: "LS",
  LTU: "LT", LUX: "LU", LVA: "LV", MAC: "MO", MAF: "MF", MAR: "MA",
  MCO: "MC", MDA: "MD", MDG: "MG", MDV: "MV", MEX: "MX", MHL: "MH",
  MKD: "MK", MLI: "ML", MLT: "MT", MMR: "MM", MNE: "ME", MNG: "MN",
  MNP: "MP", MOZ: "MZ", MRT: "MR", MSR: "MS", MTQ: "MQ", MUS: "MU",
  MWI: "MW", MYS: "MY", MYT: "YT", NAM: "NA", NCL: "NC", NER: "NE",
  NFK: "NF", NGA: "NG", NIC: "NI", NIU: "NU", NLD: "NL", NOR: "NO",
  NPL: "NP", NRU: "NR", NZL: "NZ", OMN: "OM", PAK: "PK", PAN: "PA",
  PCN: "PN", PER: "PE", PHL: "PH", PLW: "PW", PNG: "PG", POL: "PL",
  PRI: "PR", PRK: "KP", PRT: "PT", PRY: "PY", PSE: "PS", PYF: "PF",
  QAT: "QA", REU: "RE", ROU: "RO", RUS: "RU", RWA: "RW", SAU: "SA",
  SDN: "SD", SEN: "SN", SGP: "SG", SGS: "GS", SHN: "SH", SJM: "SJ",
  SLB: "SB", SLE: "SL", SLV: "SV", SMR: "SM", SOM: "SO", SPM: "PM",
  SRB: "RS", SSD: "SS", STP: "ST", SUR: "SR", SVK: "SK", SVN: "SI",
  SWE: "SE", SWZ: "SZ", SXM: "SX", SYC: "SC", SYR: "SY", TCA: "TC",
  TCD: "TD", TGO: "TG", THA: "TH", TJK: "TJ", TKL: "TK", TKM: "TM",
  TLS: "TL", TON: "TO", TTO: "TT", TUN: "TN", TUR: "TR", TUV: "TV",
  TWN: "TW", TZA: "TZ", UGA: "UG", UKR: "UA", UMI: "UM", URY: "UY",
  USA: "US", UZB: "UZ", VAT: "VA", VCT: "VC", VEN: "VE", VGB: "VG",
  VIR: "VI", VNM: "VN", VUT: "VU", WLF: "WF", WSM: "WS", YEM: "YE",
  ZAF: "ZA", ZMB: "ZM", ZWE: "ZW",
});

/** alpha-3 轉 alpha-2;查不到回 null(呼叫端要自己決定怎麼吵,不要靜靜吞掉) */
export function alpha2From(alpha3) {
  if (typeof alpha3 !== "string") return null;
  return ALPHA3_TO_ALPHA2[alpha3.toUpperCase()] || null;
}
