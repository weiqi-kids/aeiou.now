// 熱度級距（PTT「爆」式量級）——全站唯一定義處。
//
// 為什麼不直接顯示分數：
//   HotScore 的絕對值對讀者沒有意義（19.8 是高是低？沒有基準）。PTT 的推文數也不是印原始數字，
//   而是把量級翻成一眼可讀的符號（爆／XX／破百）。所以三個頁面（首頁卡片、topic 熱度六窗、
//   排行列）一律只呈現「級距」，原始分數不上畫面；排行頁的名次是名次不是分數，照舊顯示。
//
// ⚠⚠ 門檻是 M1 暫定值，M2 必須重新校準 ⚠⚠
//   M1 的 HotScore 尚未完整實作（瀏覽面要等 GA4，屬 M2 範圍），data/ 現有分數是 seed 的 demo 值
//   （情人節 24h = 4.1、問世界 24h = 19.8、情人節 1y = 87.5）。等真實 HotScore 上線後，
//   分數的分佈會整個換掉，這裡的 THRESHOLDS 必須連同重算，不得沿用。
//
// 為什麼切五階、為什麼是 1 / 3 / 10 / 30：
//   注意力是長尾分佈，線性切級會把幾乎所有議題壓在最低階（看起來像死站）。
//   所以用「半個數量級一階」的幾何級距：10^0 → 10^0.5 → 10^1 → 10^1.5，
//   即 1 / 3 / 10 / 30，每階約 3 倍。五階是可讀性上限——再多階讀者分不出差別，
//   再少階則同一階裡什麼都有、失去資訊。
//   以現有 demo 資料驗算：4.1–9.8 → rising、14.2–19.8 → hot、52 與 87.5 → blast，
//   落在中上段而不是全擠在最低階。

/** 由高到低；level 是 1..5（給「填滿幾格」用，色盲/灰階也讀得出差別）。 */
export const HEAT_TIERS = [
  { id: 'blast', min: 30, level: 5 },
  { id: 'hot', min: 10, level: 4 },
  { id: 'rising', min: 3, level: 3 },
  { id: 'warm', min: 1, level: 2 },
  { id: 'quiet', min: -Infinity, level: 1 },
];

/** 級距總格數（HeatMeter 畫幾格）。 */
export const HEAT_LEVELS = HEAT_TIERS.length;

/** 分數 → 級距物件。非數字一律當最低階（不猜、不補值）。 */
export function heatTier(score) {
  const n = typeof score === 'number' && Number.isFinite(score) ? score : 0;
  return HEAT_TIERS.find((tier) => n >= tier.min) || HEAT_TIERS[HEAT_TIERS.length - 1];
}

/** 級距 → i18n key（標籤七語系各自寫在 src/i18n/<locale>.json，模板不得寫死）。 */
export function heatLabelKey(tierId) {
  return `heat.tier.${tierId}`;
}
