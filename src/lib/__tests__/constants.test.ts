/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */

import {
  prefectures,
  businessTypes,
  facilityFeatures,
  regionGroups,
  dayOrder,
  dayLabels,
  UUID_REGEX,
  SITE_URL,
  normalizeSiteUrl,
} from '../constants';

describe('prefectures', () => {
  test('contains all 47 prefectures', () => {
    expect(prefectures).toHaveLength(47);
  });

  test('includes Tokyo', () => {
    expect(prefectures).toContain('東京都');
  });

  test('includes Hokkaido', () => {
    expect(prefectures).toContain('北海道');
  });

  test('includes Okinawa', () => {
    expect(prefectures).toContain('沖縄県');
  });

  test('all entries end with 県, 道, 府, or 都', () => {
    prefectures.forEach(pref => {
      expect(pref).toMatch(/[県道府都]$/);
    });
  });
});

describe('businessTypes', () => {
  test('has at least 8 types', () => {
    expect(businessTypes.length).toBeGreaterThanOrEqual(8);
  });

  test('includes hair salon', () => {
    expect(businessTypes).toContain('ヘアサロン');
  });

  test('includes other for catch-all', () => {
    expect(businessTypes).toContain('その他');
  });

  test('no duplicates', () => {
    const unique = new Set(businessTypes);
    expect(businessTypes).toHaveLength(unique.size);
  });
});

describe('facilityFeatures', () => {
  test('has multiple feature options', () => {
    expect(facilityFeatures.length).toBeGreaterThan(15);
  });

  test('includes parking and wifi', () => {
    expect(facilityFeatures).toContain('駐車場あり');
    expect(facilityFeatures).toContain('WiFi完備');
  });

  test('no duplicates', () => {
    const unique = new Set(facilityFeatures);
    expect(facilityFeatures).toHaveLength(unique.size);
  });
});

describe('regionGroups', () => {
  test('has 6 regions', () => {
    expect(regionGroups).toHaveLength(6);
  });

  test('Kanto has Tokyo', () => {
    const kanto = regionGroups.find(r => r.name === '関東');
    expect(kanto?.prefectures).toContain('東京都');
  });

  test('each region has prefectures', () => {
    regionGroups.forEach(group => {
      expect(group.prefectures.length).toBeGreaterThan(0);
    });
  });

  test('all prefectures in regions are in main list', () => {
    regionGroups.forEach(group => {
      group.prefectures.forEach(pref => {
        expect(prefectures).toContain(pref);
      });
    });
  });

  test('no duplicate prefectures across regions', () => {
    const allPrefs = regionGroups.flatMap(r => r.prefectures);
    const uniquePrefs = new Set(allPrefs);
    expect(allPrefs).toHaveLength(uniquePrefs.size);
  });
});

describe('dayOrder', () => {
  test('has 7 days', () => {
    expect(dayOrder).toHaveLength(7);
  });

  test('starts with mon', () => {
    expect(dayOrder[0]).toBe('mon');
  });

  test('ends with sun', () => {
    expect(dayOrder[dayOrder.length - 1]).toBe('sun');
  });
});

describe('dayLabels', () => {
  test('has labels for all 7 days', () => {
    expect(Object.keys(dayLabels)).toHaveLength(7);
  });

  test('mon maps to 月', () => {
    expect(dayLabels.mon).toBe('月');
  });

  test('sun maps to 日', () => {
    expect(dayLabels.sun).toBe('日');
  });
});

describe('UUID_REGEX', () => {
  test('accepts valid UUID v4', () => {
    expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  test('accepts lowercase UUID', () => {
    expect(UUID_REGEX.test('11111111-1111-1111-1111-111111111111')).toBe(true);
  });

  test('accepts uppercase UUID', () => {
    expect(UUID_REGEX.test('AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE')).toBe(true);
  });

  test('accepts mixed case UUID', () => {
    expect(UUID_REGEX.test('AaBbCcDd-EeFf-AaBb-CcDd-EeFfAaBbCcDd')).toBe(true);
  });

  test('rejects invalid formats', () => {
    expect(UUID_REGEX.test('not-a-uuid')).toBe(false);
    expect(UUID_REGEX.test('11111111111111111111111111111111')).toBe(false);
    expect(UUID_REGEX.test('11111111-1111-1111-1111')).toBe(false);
  });

  test('rejects non-hex characters', () => {
    expect(UUID_REGEX.test('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')).toBe(false);
  });
});

describe('SITE_URL', () => {
  test('is a valid URL', () => {
    expect(() => new URL(SITE_URL)).not.toThrow();
  });

  test('uses https', () => {
    expect(SITE_URL).toMatch(/^https:\/\//);
  });

  test('does not have trailing slash', () => {
    expect(SITE_URL).not.toMatch(/\/$/);
  });

  test('is apex domain (not www)', () => {
    expect(SITE_URL).not.toContain('www.');
  });
});

describe('normalizeSiteUrl', () => {
  test('undefined → デフォルト https://carelink-jp.com を返す', () => {
    // L52 StringLiteral "" mutation: undefined → "" となり失敗する
    expect(normalizeSiteUrl(undefined)).toBe('https://carelink-jp.com');
  });

  test('末尾スラッシュ1つを除去する', () => {
    // L52 MethodExpression mutation: trim/replace を省略すると "/" が残り失敗する
    expect(normalizeSiteUrl('https://carelink-jp.com/')).toBe('https://carelink-jp.com');
  });

  test('末尾スラッシュ複数を全て除去する', () => {
    // L52 Regex /\/$/ mutation: {1}だけ除去になり "//" が残り失敗する
    expect(normalizeSiteUrl('https://carelink-jp.com//')).toBe('https://carelink-jp.com');
  });

  test('https://www. → https://apex に変換する', () => {
    // L53 StringLiteral "" mutation: 置換結果が "" になり失敗する
    expect(normalizeSiteUrl('https://www.carelink-jp.com')).toBe('https://carelink-jp.com');
  });

  test('http://www. も apex に変換する（https? の ? が必要）', () => {
    // L53 Regex ^https: mutation: http:// が対象外になり変換されず失敗する
    expect(normalizeSiteUrl('http://www.carelink-jp.com')).toBe('https://carelink-jp.com');
  });

  test('www でない URL は変換しない（^ アンカーが必要）', () => {
    // L53 Regex without ^ mutation: URL 中間の carelink-jp.com まで置換されてしまい失敗する
    const url = 'https://example.com?redirect=https://www.carelink-jp.com';
    expect(normalizeSiteUrl(url)).toBe('https://example.com?redirect=https://www.carelink-jp.com');
  });

  test('末尾スラッシュなし・www なしの URL はそのまま返す', () => {
    expect(normalizeSiteUrl('https://carelink-jp.com')).toBe('https://carelink-jp.com');
  });

  test('www + 末尾スラッシュの組み合わせ', () => {
    expect(normalizeSiteUrl('https://www.carelink-jp.com/')).toBe('https://carelink-jp.com');
  });
});
