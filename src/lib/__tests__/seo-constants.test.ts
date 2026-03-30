import {
  prefectureSlugs,
  businessTypeSlugs,
  getPrefectureSlug,
  getPrefectureName,
  getBusinessTypeSlug,
  getBusinessTypeName,
  allPrefectureSlugs,
  allBusinessTypeSlugs,
  isValidPrefectureSlug,
  isValidBusinessTypeSlug,
} from '../seo-constants';

describe('prefectureSlugs', () => {
  test('47都道府県が含まれる', () => {
    expect(Object.keys(prefectureSlugs)).toHaveLength(47);
  });

  test('tokyo → 東京都', () => {
    expect(prefectureSlugs['tokyo']).toBe('東京都');
  });

  test('okinawa → 沖縄県', () => {
    expect(prefectureSlugs['okinawa']).toBe('沖縄県');
  });

  test('hokkaido → 北海道', () => {
    expect(prefectureSlugs['hokkaido']).toBe('北海道');
  });
});

describe('businessTypeSlugs', () => {
  test('8業種が含まれる', () => {
    expect(Object.keys(businessTypeSlugs)).toHaveLength(8);
  });

  test('hair-salon → ヘアサロン', () => {
    expect(businessTypeSlugs['hair-salon']).toBe('ヘアサロン');
  });
});

describe('getPrefectureSlug', () => {
  test('東京都 → tokyo', () => {
    expect(getPrefectureSlug('東京都')).toBe('tokyo');
  });

  test('存在しない県 → undefined', () => {
    expect(getPrefectureSlug('存在しない県')).toBeUndefined();
  });
});

describe('getPrefectureName', () => {
  test('tokyo → 東京都', () => {
    expect(getPrefectureName('tokyo')).toBe('東京都');
  });

  test('存在しないスラッグ → undefined', () => {
    expect(getPrefectureName('invalid')).toBeUndefined();
  });
});

describe('getBusinessTypeSlug', () => {
  test('ヘアサロン → hair-salon', () => {
    expect(getBusinessTypeSlug('ヘアサロン')).toBe('hair-salon');
  });

  test('存在しない業種 → undefined', () => {
    expect(getBusinessTypeSlug('存在しない')).toBeUndefined();
  });
});

describe('getBusinessTypeName', () => {
  test('hair-salon → ヘアサロン', () => {
    expect(getBusinessTypeName('hair-salon')).toBe('ヘアサロン');
  });

  test('存在しないスラッグ → undefined', () => {
    expect(getBusinessTypeName('xxx')).toBeUndefined();
  });
});

describe('allPrefectureSlugs', () => {
  test('47件', () => {
    expect(allPrefectureSlugs).toHaveLength(47);
  });

  test('tokyoが含まれる', () => {
    expect(allPrefectureSlugs).toContain('tokyo');
  });
});

describe('allBusinessTypeSlugs', () => {
  test('8件', () => {
    expect(allBusinessTypeSlugs).toHaveLength(8);
  });
});

describe('isValidPrefectureSlug', () => {
  test('tokyo → true', () => {
    expect(isValidPrefectureSlug('tokyo')).toBe(true);
  });

  test('invalid → false', () => {
    expect(isValidPrefectureSlug('invalid')).toBe(false);
  });
});

describe('isValidBusinessTypeSlug', () => {
  test('other → true', () => {
    expect(isValidBusinessTypeSlug('other')).toBe(true);
  });

  test('invalid → false', () => {
    expect(isValidBusinessTypeSlug('invalid')).toBe(false);
  });
});
