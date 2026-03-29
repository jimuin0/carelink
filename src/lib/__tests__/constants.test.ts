import { UUID_REGEX, prefectures, businessTypes, regionGroups, dayOrder, dayLabels } from '../constants';

describe('UUID_REGEX', () => {
  test('正しいUUID v4を受理する', () => {
    expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  test('大文字UUIDを受理する', () => {
    expect(UUID_REGEX.test('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  test('不正な形式を拒否する', () => {
    expect(UUID_REGEX.test('not-a-uuid')).toBe(false);
    expect(UUID_REGEX.test('')).toBe(false);
    expect(UUID_REGEX.test('550e8400e29b41d4a716446655440000')).toBe(false); // ハイフンなし
  });

  test('長さ超過を拒否する', () => {
    expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-4466554400001')).toBe(false);
  });
});

describe('prefectures', () => {
  test('47都道府県が定義されている', () => {
    expect(prefectures).toHaveLength(47);
  });

  test('北海道から始まり沖縄で終わる', () => {
    expect(prefectures[0]).toBe('北海道');
    expect(prefectures[46]).toBe('沖縄県');
  });

  test('重複がない', () => {
    expect(new Set(prefectures).size).toBe(47);
  });
});

describe('businessTypes', () => {
  test('8種類が定義されている', () => {
    expect(businessTypes).toHaveLength(8);
  });

  test('ヘアサロンが含まれる', () => {
    expect(businessTypes).toContain('ヘアサロン');
  });

  test('鍼灸院・整骨院が含まれる', () => {
    expect(businessTypes).toContain('鍼灸院・整骨院');
  });
});

describe('regionGroups', () => {
  test('6地域が定義されている', () => {
    expect(regionGroups).toHaveLength(6);
  });

  test('全都道府県がいずれかの地域に含まれる', () => {
    const allInRegions = regionGroups.flatMap(g => g.prefectures);
    expect(new Set(allInRegions).size).toBe(47);
    for (const pref of prefectures) {
      expect(allInRegions).toContain(pref);
    }
  });
});

describe('dayOrder & dayLabels', () => {
  test('7曜日が定義されている', () => {
    expect(dayOrder).toHaveLength(7);
  });

  test('月曜から日曜まで', () => {
    expect(dayOrder[0]).toBe('mon');
    expect(dayOrder[6]).toBe('sun');
  });

  test('全曜日にラベルがある', () => {
    for (const day of dayOrder) {
      expect(dayLabels[day]).toBeDefined();
      expect(dayLabels[day].length).toBe(1); // 漢字1文字
    }
  });
});
