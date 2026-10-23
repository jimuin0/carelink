/**
 * トップの日本地図の地方区分とラベル位置（src/lib/japan-map-regions.ts）。
 *
 * 【回帰防止・2026年10月23日】地図は独自の 9 地方、隣のリンク一覧は regionGroups の 6 地方で、
 * 同じ画面で分け方が食い違っていた。ラベルも地図とずれていた（四国が九州の上など）。
 * ラベル位置は本番の描画で測った都道府県の外接矩形（下の LAND）に重ならないことを確かめる。
 */
import { regionGroups } from '@/lib/constants';
import { JAPAN_MAP_SIZE, MAP_REGIONS, mapCodeForPrefecture, regionSearchHref } from '@/lib/japan-map-regions';

/** @react-map/japan（size=340）の都道府県の外接矩形 [x1, y1, x2, y2]（本番の描画で実測）。ラベルの近さの確認用。 */
const LAND: Record<string, [number, number, number, number]> = {
  Hokkaido: [241, 0, 340, 87], Aomori: [248, 84, 277, 111], Akita: [246, 105, 266, 137], Iwate: [261, 106, 282, 140],
  Niigata: [214, 144, 249, 179], Ishikawa: [193, 163, 210, 192], Chiba: [247, 191, 264, 213], Ibaraki: [246, 175, 264, 198],
  Wakayama: [175, 223, 189, 240], Mie: [187, 207, 204, 235], Kochi: [137, 232, 163, 253], Yamaguchi: [110, 217, 135, 233],
  Kagoshima: [92, 263, 116, 298], Nagasaki: [76, 217, 103, 256], Okinawa: [0, 328, 98, 401], Osaka: [175, 211, 185, 225],
  Fukuoka: [98, 231, 116, 248], Hiroshima: [129, 210, 150, 228], Tokyo: [235, 195, 250, 213],
};
/** ラベルの大きさ（text-xs 太字・px-2.5・py-1・枠 1px）。全角 1 文字 12px。 */
const labelBox = (r: (typeof MAP_REGIONS)[number]) => {
  const width = Array.from(r.name).length * 12 + 22;
  return [r.left, r.top, r.left + width, r.top + 26] as const;
};
const overlaps = (a: readonly number[], b: readonly number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const distance = (a: readonly number[], b: readonly number[]) => {
  const dx = Math.max(0, b[0] - a[2], a[0] - b[2]);
  const dy = Math.max(0, b[1] - a[3], a[1] - b[3]);
  return Math.hypot(dx, dy);
};

test('地図の地方は regionGroups と同じ 6 地方・同じ都道府県（47 都道府県がちょうど 1 回ずつ）', () => {
  expect(MAP_REGIONS.map((r) => r.name)).toEqual(regionGroups.map((g) => g.name));
  const codes = MAP_REGIONS.flatMap((r) => r.mapCodes);
  expect(codes).toHaveLength(47);
  expect(new Set(codes).size).toBe(47);
  MAP_REGIONS.forEach((r, i) => expect(r.mapCodes).toEqual(regionGroups[i]!.prefectures.map(mapCodeForPrefecture)));
});

test('代表の都道府県はその地方に含まれ、リンク先はその都道府県の検索', () => {
  for (const r of MAP_REGIONS) {
    expect(regionGroups.find((g) => g.name === r.name)!.prefectures).toContain(r.hub);
  }
  expect(regionSearchHref({ hub: '大阪府' })).toBe('/search?area=%E5%A4%A7%E9%98%AA%E5%BA%9C');
});

test('地図の path id は都道府県スラッグの先頭を大文字にしたもの。未知の名前は例外', () => {
  expect(mapCodeForPrefecture('東京都')).toBe('Tokyo');
  expect(mapCodeForPrefecture('北海道')).toBe('Hokkaido');
  expect(() => mapCodeForPrefecture('存在しない県')).toThrow('都道府県のスラッグが無い');
});

test('ラベルは地図の中に収まり、互いに重ならず、陸地に重ならない', () => {
  const boxes = MAP_REGIONS.map(labelBox);
  for (const box of boxes) {
    expect(box[0]).toBeGreaterThanOrEqual(0);
    expect(box[1]).toBeGreaterThanOrEqual(0);
    expect(box[2]).toBeLessThanOrEqual(JAPAN_MAP_SIZE.width);
    expect(box[3]).toBeLessThanOrEqual(JAPAN_MAP_SIZE.height);
  }
  boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b) => expect(overlaps(a, b)).toBe(false)));
  for (const [name, land] of Object.entries(LAND)) {
    boxes.forEach((box, i) => expect([MAP_REGIONS[i]!.name, name, overlaps(box, land)]).toEqual([MAP_REGIONS[i]!.name, name, false]));
  }
});

test('ラベルはその地方の陸地のすぐ隣にあり、別の地方の陸地より自分の地方に近い', () => {
  const regionOf = (code: string) => MAP_REGIONS.find((r) => r.mapCodes.includes(code))!.name;
  for (const r of MAP_REGIONS) {
    const box = labelBox(r);
    const own = Object.entries(LAND).filter(([code]) => regionOf(code) === r.name).map(([, land]) => distance(box, land));
    const other = Object.entries(LAND).filter(([code]) => regionOf(code) !== r.name).map(([, land]) => distance(box, land));
    expect([r.name, Math.min(...own) <= 20]).toEqual([r.name, true]);
    expect([r.name, Math.min(...own) <= Math.min(...other)]).toEqual([r.name, true]);
  }
});

test('regionGroups に地方を足して地図の位置を書き忘れたら、読み込み時に止まる', () => {
  jest.isolateModules(() => {
    jest.doMock('@/lib/constants', () => ({ regionGroups: [{ name: '新しい地方', prefectures: ['東京都'] }] }));
    expect(() => require('@/lib/japan-map-regions')).toThrow('地図のラベル位置が無い地方: 新しい地方');
  });
  jest.dontMock('@/lib/constants');
});
