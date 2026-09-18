// Topic 主頁的 observance 排序必須在一個 UTC 日內完全固定。
//
// 為什麼要有這支：occurrenceDistance() 原本拿 occurrence.timezone 各自算「今天」，
// 於是同一天、不同國家的 observance（12-25 的 IN/BR/JP/US）之間的距離會隨 UTC 時鐘
// 一天翻轉好幾次，Topic 主頁的 HTML 指紋因此每小時都在變，sitemap 每輪對 Google
// 宣告一次「這頁改版了」。2026-09-18 實測 aeiou.now 的 544 個 URL 裡有 15 個
// Topic 主頁標成當天，全部是同日多國的 Topic。詳見 site/src/lib/occurrence.mjs 檔頭。
//
// 這支盯的是那個行為本身：同一批資料餵不同時刻的 now，輸出順序必須一模一樣。

import assert from 'node:assert/strict';
import test from 'node:test';

import { occurrenceDistance } from '../../site/src/lib/occurrence.mjs';

// 同一天、跨 UTC-11 到 UTC+14 的七個時區 —— 任何一個 UTC 時刻都會有人已經跨日、有人還沒。
const SAME_DAY = [
  { observance_id: 'x-in', country_code: 'IN', next_occurrence: { starts_on: '2026-12-25', timezone: 'Asia/Kolkata' } },
  { observance_id: 'x-br', country_code: 'BR', next_occurrence: { starts_on: '2026-12-25', timezone: 'America/Sao_Paulo' } },
  { observance_id: 'x-jp', country_code: 'JP', next_occurrence: { starts_on: '2026-12-25', timezone: 'Asia/Tokyo' } },
  { observance_id: 'x-us', country_code: 'US', next_occurrence: { starts_on: '2026-12-25', timezone: 'America/Los_Angeles' } },
  { observance_id: 'x-nz', country_code: 'NZ', next_occurrence: { starts_on: '2026-12-25', timezone: 'Pacific/Auckland' } },
  { observance_id: 'y-tw', country_code: 'TW', next_occurrence: { starts_on: '2027-01-01', timezone: 'Asia/Taipei' } },
  { observance_id: 'y-id', country_code: 'ID', next_occurrence: { starts_on: '2026-11-08', timezone: 'Asia/Jakarta' } },
];

// [slug].astro 的排序鍵；這裡照抄是刻意的 —— 改了那邊而沒改這裡，這支就會過但線上會壞，
// 所以下面另有一支直接比對 [slug].astro 的原始碼。
const order = (list, now) => list
  .slice()
  .sort((a, b) => {
    const aDistance = occurrenceDistance(a.next_occurrence, now);
    const bDistance = occurrenceDistance(b.next_occurrence, now);
    if (aDistance == null && bDistance == null) return (a.popularity_rank || 99) - (b.popularity_rank || 99);
    if (aDistance == null) return 1;
    if (bDistance == null) return -1;
    return aDistance - bDistance
      || (a.next_occurrence?.starts_on || '').localeCompare(b.next_occurrence?.starts_on || '')
      || (a.popularity_rank || 99) - (b.popularity_rank || 99)
      || String(a.observance_id).localeCompare(String(b.observance_id));
  })
  .map((o) => o.observance_id);

test('同一個 UTC 日內，任何時刻的排序都相同', () => {
  const day = '2026-09-18';
  const hours = [0, 3, 6, 9, 11, 12, 13, 15, 18, 21, 23];
  const expected = order(SAME_DAY, new Date(`${day}T00:00:00Z`));
  for (const h of hours) {
    const now = new Date(`${day}T${String(h).padStart(2, '0')}:30:00Z`);
    assert.deepEqual(order(SAME_DAY, now), expected, `${day}T${h}:30Z 的順序與 00:00Z 不同`);
  }
});

test('連續三十天，每天內部都固定（跨 UTC 午夜才允許變）', () => {
  for (let d = 0; d < 30; d += 1) {
    const base = new Date(Date.parse('2026-09-18T00:00:00Z') + d * 86400000);
    const day = base.toISOString().slice(0, 10);
    const expected = order(SAME_DAY, new Date(`${day}T00:00:00Z`));
    for (const h of [5, 11, 16, 22]) {
      const now = new Date(`${day}T${String(h).padStart(2, '0')}:00:00Z`);
      assert.deepEqual(order(SAME_DAY, now), expected, `${day} 當天 ${h}:00Z 順序跑掉`);
    }
  }
});

test('distance 只由 starts_on 決定，與 occurrence 自己的時區無關', () => {
  const now = new Date('2026-09-18T16:30:00Z'); // 此刻 Asia/Tokyo 已是 09-19、America/Los_Angeles 還是 09-18
  const distances = SAME_DAY
    .filter((o) => o.next_occurrence.starts_on === '2026-12-25')
    .map((o) => occurrenceDistance(o.next_occurrence, now));
  assert.equal(new Set(distances).size, 1, `同一天的 observance 距離不一致:${distances.join(', ')}`);
});

test('進行中的 occurrence 回 0', () => {
  const now = new Date('2026-12-25T12:00:00Z');
  assert.equal(occurrenceDistance({ starts_on: '2026-12-25', timezone: 'Asia/Tokyo' }, now), 0);
  assert.equal(occurrenceDistance({ starts_on: '2026-12-24', ends_on: '2026-12-26', timezone: 'Asia/Tokyo' }, now), 0);
  // 進行中那一批（12-25 的五國）排在還沒到的 2027-01-01 前面。
  const ids = order(SAME_DAY.filter((o) => o.next_occurrence.starts_on >= '2026-12-25'), now);
  assert.equal(ids[0].startsWith('x-'), true, `進行中的沒排最前面:${ids.join(', ')}`);
});

// 已知行為，不是本次修的東西，但要釘住：next_occurrence 落在過去時距離為負，
// 會排到最前面。正常情況下 export-data.mjs 保證 next_occurrence 是未來日期，
// 所以這只在匯出停擺時才會出現（2026-09-03~09-17 hourly-export 連續失敗過 14 天）。
// 哪天要修，是在匯出層保證日期新鮮，不是在顯示層猜日期。
test('過去的 next_occurrence 距離為負並排到最前面（已知行為，靠匯出層保證新鮮）', () => {
  const now = new Date('2026-12-25T12:00:00Z');
  const stale = occurrenceDistance({ starts_on: '2026-11-08', timezone: 'Asia/Jakarta' }, now);
  assert.ok(stale < 0, `預期負數，實得 ${stale}`);
  assert.equal(order(SAME_DAY, now)[0], 'y-id');
});

test('資料不完整回 null，不猜日期', () => {
  assert.equal(occurrenceDistance(null), null);
  assert.equal(occurrenceDistance({ starts_on: '2026-12-25' }), null);
  assert.equal(occurrenceDistance({ timezone: 'Asia/Tokyo' }), null);
});

test('[slug].astro 的排序仍然走 occurrenceDistance，沒有自己另算今天', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../../site/src/pages/topic/[slug].astro', import.meta.url), 'utf8');
  assert.match(src, /occurrenceDistance\(a\.next_occurrence\)/, '[slug].astro 的排序鍵變了，請同步更新本測試');
  assert.doesNotMatch(
    src,
    /Intl\.DateTimeFormat[^)]*timeZone:\s*(?!'UTC')/,
    '[slug].astro 自己用非 UTC 時區算日期，會繞過本修正',
  );
});
