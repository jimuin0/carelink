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

describe('prefectureSlugs — 全47都道府県の値を検証', () => {
  const expected: [string, string][] = [
    ['hokkaido', '北海道'],
    ['aomori', '青森県'],
    ['iwate', '岩手県'],
    ['miyagi', '宮城県'],
    ['akita', '秋田県'],
    ['yamagata', '山形県'],
    ['fukushima', '福島県'],
    ['ibaraki', '茨城県'],
    ['tochigi', '栃木県'],
    ['gunma', '群馬県'],
    ['saitama', '埼玉県'],
    ['chiba', '千葉県'],
    ['tokyo', '東京都'],
    ['kanagawa', '神奈川県'],
    ['niigata', '新潟県'],
    ['toyama', '富山県'],
    ['ishikawa', '石川県'],
    ['fukui', '福井県'],
    ['yamanashi', '山梨県'],
    ['nagano', '長野県'],
    ['gifu', '岐阜県'],
    ['shizuoka', '静岡県'],
    ['aichi', '愛知県'],
    ['mie', '三重県'],
    ['shiga', '滋賀県'],
    ['kyoto', '京都府'],
    ['osaka', '大阪府'],
    ['hyogo', '兵庫県'],
    ['nara', '奈良県'],
    ['wakayama', '和歌山県'],
    ['tottori', '鳥取県'],
    ['shimane', '島根県'],
    ['okayama', '岡山県'],
    ['hiroshima', '広島県'],
    ['yamaguchi', '山口県'],
    ['tokushima', '徳島県'],
    ['kagawa', '香川県'],
    ['ehime', '愛媛県'],
    ['kochi', '高知県'],
    ['fukuoka', '福岡県'],
    ['saga', '佐賀県'],
    ['nagasaki', '長崎県'],
    ['kumamoto', '熊本県'],
    ['oita', '大分県'],
    ['miyazaki', '宮崎県'],
    ['kagoshima', '鹿児島県'],
    ['okinawa', '沖縄県'],
  ];

  test.each(expected)('prefectureSlugs[%s] === %s', (slug, name) => {
    expect(prefectureSlugs[slug]).toBe(name);
  });
});

describe('businessTypeSlugs — 全8業種の値を検証', () => {
  const expected: [string, string][] = [
    ['hair-salon', 'ヘアサロン'],
    ['nail-eyelash', 'ネイル・まつげサロン'],
    ['relaxation', 'リラクサロン'],
    ['esthetic', 'エステサロン'],
    ['beauty-clinic', '美容クリニック'],
    ['acupuncture', '鍼灸院・整骨院'],
    ['care-service', '介護・デイサービス'],
    ['other', 'その他'],
  ];

  test.each(expected)('businessTypeSlugs[%s] === %s', (slug, name) => {
    expect(businessTypeSlugs[slug]).toBe(name);
  });
});

describe('getPrefectureSlug — 逆引き検証', () => {
  test('大阪府 → osaka', () => {
    expect(getPrefectureSlug('大阪府')).toBe('osaka');
  });
  test('北海道 → hokkaido', () => {
    expect(getPrefectureSlug('北海道')).toBe('hokkaido');
  });
  test('神奈川県 → kanagawa', () => {
    expect(getPrefectureSlug('神奈川県')).toBe('kanagawa');
  });
  test('沖縄県 → okinawa', () => {
    expect(getPrefectureSlug('沖縄県')).toBe('okinawa');
  });
  test('福岡県 → fukuoka', () => {
    expect(getPrefectureSlug('福岡県')).toBe('fukuoka');
  });
});

describe('getBusinessTypeSlug — 逆引き検証', () => {
  test('ネイル・まつげサロン → nail-eyelash', () => {
    expect(getBusinessTypeSlug('ネイル・まつげサロン')).toBe('nail-eyelash');
  });
  test('リラクサロン → relaxation', () => {
    expect(getBusinessTypeSlug('リラクサロン')).toBe('relaxation');
  });
  test('エステサロン → esthetic', () => {
    expect(getBusinessTypeSlug('エステサロン')).toBe('esthetic');
  });
  test('美容クリニック → beauty-clinic', () => {
    expect(getBusinessTypeSlug('美容クリニック')).toBe('beauty-clinic');
  });
  test('鍼灸院・整骨院 → acupuncture', () => {
    expect(getBusinessTypeSlug('鍼灸院・整骨院')).toBe('acupuncture');
  });
  test('介護・デイサービス → care-service', () => {
    expect(getBusinessTypeSlug('介護・デイサービス')).toBe('care-service');
  });
  test('その他 → other', () => {
    expect(getBusinessTypeSlug('その他')).toBe('other');
  });
});

describe('getPrefectureName — 全スラッグの正引き', () => {
  test('osaka → 大阪府', () => {
    expect(getPrefectureName('osaka')).toBe('大阪府');
  });
  test('hokkaido → 北海道', () => {
    expect(getPrefectureName('hokkaido')).toBe('北海道');
  });
  test('okinawa → 沖縄県', () => {
    expect(getPrefectureName('okinawa')).toBe('沖縄県');
  });
  test('kyoto → 京都府', () => {
    expect(getPrefectureName('kyoto')).toBe('京都府');
  });
  test('kanagawa → 神奈川県', () => {
    expect(getPrefectureName('kanagawa')).toBe('神奈川県');
  });
});

describe('getBusinessTypeName — 全スラッグの正引き', () => {
  test('nail-eyelash → ネイル・まつげサロン', () => {
    expect(getBusinessTypeName('nail-eyelash')).toBe('ネイル・まつげサロン');
  });
  test('relaxation → リラクサロン', () => {
    expect(getBusinessTypeName('relaxation')).toBe('リラクサロン');
  });
  test('esthetic → エステサロン', () => {
    expect(getBusinessTypeName('esthetic')).toBe('エステサロン');
  });
  test('beauty-clinic → 美容クリニック', () => {
    expect(getBusinessTypeName('beauty-clinic')).toBe('美容クリニック');
  });
  test('acupuncture → 鍼灸院・整骨院', () => {
    expect(getBusinessTypeName('acupuncture')).toBe('鍼灸院・整骨院');
  });
  test('care-service → 介護・デイサービス', () => {
    expect(getBusinessTypeName('care-service')).toBe('介護・デイサービス');
  });
  test('other → その他', () => {
    expect(getBusinessTypeName('other')).toBe('その他');
  });
});

describe('isValidPrefectureSlug — 全スラッグが true', () => {
  const slugs = [
    'hokkaido', 'aomori', 'iwate', 'miyagi', 'akita', 'yamagata', 'fukushima',
    'ibaraki', 'tochigi', 'gunma', 'saitama', 'chiba', 'tokyo', 'kanagawa',
    'niigata', 'toyama', 'ishikawa', 'fukui', 'yamanashi', 'nagano', 'gifu',
    'shizuoka', 'aichi', 'mie', 'shiga', 'kyoto', 'osaka', 'hyogo', 'nara',
    'wakayama', 'tottori', 'shimane', 'okayama', 'hiroshima', 'yamaguchi',
    'tokushima', 'kagawa', 'ehime', 'kochi', 'fukuoka', 'saga', 'nagasaki',
    'kumamoto', 'oita', 'miyazaki', 'kagoshima', 'okinawa',
  ];

  test.each(slugs)('isValidPrefectureSlug(%s) === true', (slug) => {
    expect(isValidPrefectureSlug(slug)).toBe(true);
  });
});

describe('isValidBusinessTypeSlug — 全スラッグが true', () => {
  const slugs = ['hair-salon', 'nail-eyelash', 'relaxation', 'esthetic', 'beauty-clinic', 'acupuncture', 'care-service', 'other'];

  test.each(slugs)('isValidBusinessTypeSlug(%s) === true', (slug) => {
    expect(isValidBusinessTypeSlug(slug)).toBe(true);
  });
});

describe('allPrefectureSlugs — 順序と内容', () => {
  test('最初のスラッグは hokkaido', () => {
    expect(allPrefectureSlugs[0]).toBe('hokkaido');
  });
  test('最後のスラッグは okinawa', () => {
    expect(allPrefectureSlugs[allPrefectureSlugs.length - 1]).toBe('okinawa');
  });
});

describe('allBusinessTypeSlugs — 順序と内容', () => {
  test('最初のスラッグは hair-salon', () => {
    expect(allBusinessTypeSlugs[0]).toBe('hair-salon');
  });
  test('最後のスラッグは other', () => {
    expect(allBusinessTypeSlugs[allBusinessTypeSlugs.length - 1]).toBe('other');
  });
  test('nail-eyelash が含まれる', () => {
    expect(allBusinessTypeSlugs).toContain('nail-eyelash');
  });
  test('acupuncture が含まれる', () => {
    expect(allBusinessTypeSlugs).toContain('acupuncture');
  });
});
