/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import {
  addressesMatch, namesMatch, normalizeAddress, normalizeJapanesePhone, placeMatchesFacility,
  FACILITY_IDENTITY_COLUMNS, GBP_PLACE_LOOKUP_FAILED_MESSAGE, GBP_PLACE_MISMATCH_MESSAGE, GBP_PLACE_MISMATCH_NOTICE, GBP_IDENTITY_CHANGE_NOTICE,
  GBP_PLACE_TAKEN_MESSAGE,
} from '../gbp-ownership';

// Google Places（language=ja）が返す形をそのまま使う。
const GOOGLE = {
  name: 'さくら整骨院 渋谷院',
  formatted_phone_number: '03-1234-5678',
  formatted_address: '日本、〒150-0002 東京都渋谷区渋谷１丁目２−３ 渋谷ビル5F',
};
const FACILITY = {
  name: 'さくら整骨院 渋谷院',
  phone: '0312345678',
  postal_code: '150-0002',
  prefecture: '東京都',
  city: '渋谷区',
  address: '渋谷1-2-3 渋谷ビル5F',
};

describe('normalizeJapanesePhone', () => {
  test.each([
    ['03-1234-5678', '0312345678'],
    ['０３－１２３４－５６７８', '0312345678'],
    ['+81 3-1234-5678', '0312345678'],
    ['+81 (0)3-1234-5678', '0312345678'],
    ['090-1234-5678', '09012345678'],
    ['0120-123-456', '0120123456'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeJapanesePhone(raw)).toBe(expected);
  });
  test.each([null, undefined, '', '1234', '+1 415-555-0100', '03-1234-5678-9999'])('%p is not a Japanese number', raw => {
    expect(normalizeJapanesePhone(raw)).toBeNull();
  });
});

describe('namesMatch', () => {
  test('same name after width, case, space and symbol differences', () => {
    expect(namesMatch('ＣａｒｅＬｉｎｋ・整体院', 'carelink 整体院')).toBe(true);
  });
  test.each([
    ['さくら整骨院', 'さくら整骨院 渋谷院'],
    ['さくら整骨院 渋谷院', 'さくら整骨院'],
  ])('a branch suffix on either side still matches (%s / %s)', (a, b) => {
    expect(namesMatch(a, b)).toBe(true);
  });
  test('different names do not match', () => {
    expect(namesMatch('さくら整骨院', 'ひまわり整体')).toBe(false);
  });
  test.each([[null, 'さくら'], ['さくら', undefined], ['・', 'さくら'], ['さくら', 'A']])('missing or one-character names never match (%p / %p)', (a, b) => {
    expect(namesMatch(a, b)).toBe(false);
  });
});

describe('normalizeAddress', () => {
  test('Google form and owner form reduce to the same street', () => {
    expect(normalizeAddress(GOOGLE.formatted_address)).toBe('東京都渋谷区渋谷1-2-3渋谷ビル5f');
    expect(normalizeAddress('東京都渋谷区渋谷1丁目2番3号')).toBe('東京都渋谷区渋谷1-2-3-');
    expect(normalizeAddress('渋谷2番地5')).toBe('渋谷2-5');
    expect(normalizeAddress('渋谷1ー2ー3')).toBe('渋谷1-2-3');
    expect(normalizeAddress(null)).toBe('');
  });
});

describe('addressesMatch', () => {
  test('city plus the first two street numbers found in the Google address', () => {
    expect(addressesMatch(GOOGLE.formatted_address, FACILITY)).toBe(true);
    // 住所欄に都道府県・市区町村まで書いてあっても同じ
    expect(addressesMatch(GOOGLE.formatted_address, { ...FACILITY, address: '東京都渋谷区渋谷1丁目2番3号' })).toBe(true);
    // 番地の 3 つ目（号）が Google 側に無くても一致する
    expect(addressesMatch('日本、〒150-0002 東京都渋谷区渋谷1丁目2', { ...FACILITY, address: '渋谷1-2-3' })).toBe(true);
  });
  test('an address without street numbers is compared whole', () => {
    expect(addressesMatch('日本、北海道虻田郡ニセコ町字ニセコ', { prefecture: '北海道', city: '虻田郡ニセコ町', address: '字ニセコ' })).toBe(true);
  });
  test('postal code and city match when the street is written differently', () => {
    expect(addressesMatch(GOOGLE.formatted_address, { ...FACILITY, address: '渋谷一丁目二番三号' })).toBe(true);
    expect(addressesMatch(GOOGLE.formatted_address, { ...FACILITY, address: '渋谷一丁目二番三号', postal_code: '1500003' })).toBe(false);
    expect(addressesMatch(GOOGLE.formatted_address, { ...FACILITY, address: '渋谷一丁目二番三号', postal_code: null })).toBe(false);
    expect(addressesMatch('東京都渋谷区渋谷１丁目２−３', { ...FACILITY, address: '渋谷一丁目二番三号' })).toBe(false);
    expect(addressesMatch('日本、〒150-0002 東京都港区', { ...FACILITY, address: '渋谷一丁目二番三号' })).toBe(false);
  });
  test('another street or city does not match', () => {
    expect(addressesMatch(GOOGLE.formatted_address, { ...FACILITY, address: '渋谷4-5-6', postal_code: null })).toBe(false);
    expect(addressesMatch(GOOGLE.formatted_address, { ...FACILITY, city: '港区', postal_code: null })).toBe(false);
  });
  test.each([
    [undefined, FACILITY],
    ['', FACILITY],
    [GOOGLE.formatted_address, { ...FACILITY, city: null, postal_code: null }],
    [GOOGLE.formatted_address, { ...FACILITY, city: '', postal_code: '1500002' }],
    [GOOGLE.formatted_address, { ...FACILITY, address: null, postal_code: null }],
    [GOOGLE.formatted_address, { ...FACILITY, address: '渋谷区', postal_code: null }],
  ])('missing data never matches (%p)', (google, facility) => {
    expect(addressesMatch(google, facility)).toBe(false);
  });
});

describe('placeMatchesFacility', () => {
  test('the phone number alone is enough', () => {
    expect(placeMatchesFacility({ formatted_phone_number: '03-1234-5678' }, { phone: '03(1234)5678' })).toBe(true);
  });
  test('name and address together are enough when the phone differs or is missing', () => {
    expect(placeMatchesFacility({ ...GOOGLE, formatted_phone_number: '03-9999-9999' }, FACILITY)).toBe(true);
    expect(placeMatchesFacility({ name: GOOGLE.name, formatted_address: GOOGLE.formatted_address }, { ...FACILITY, phone: null })).toBe(true);
  });
  test('another business is refused: a competitor in the same building, or a high-rated clinic elsewhere', () => {
    expect(placeMatchesFacility({ ...GOOGLE, name: 'ひまわり整体', formatted_phone_number: '03-9999-9999' }, FACILITY)).toBe(false);
    expect(placeMatchesFacility({ name: 'さくら整骨院 梅田院', formatted_phone_number: '06-1111-2222', formatted_address: '日本、〒530-0001 大阪府大阪市北区梅田1丁目1−1' }, FACILITY)).toBe(false);
  });
  test('name alone is not enough', () => {
    expect(placeMatchesFacility({ name: GOOGLE.name }, { ...FACILITY, phone: null })).toBe(false);
  });
  test('nothing to compare is refused', () => {
    expect(placeMatchesFacility({}, {})).toBe(false);
  });
  test('the select list names every column the check reads', () => {
    expect(FACILITY_IDENTITY_COLUMNS.split(',').map(c => c.trim()).sort()).toEqual(['address', 'city', 'name', 'phone', 'postal_code', 'prefecture']);
  });
});

test('every refusal tells the owner what to check and to contact CareLink', () => {
  for (const message of [GBP_PLACE_LOOKUP_FAILED_MESSAGE, GBP_PLACE_MISMATCH_MESSAGE, GBP_PLACE_TAKEN_MESSAGE, GBP_PLACE_MISMATCH_NOTICE]) {
    expect(message).toContain('CareLink までお問い合わせください');
  }
  expect(GBP_PLACE_MISMATCH_MESSAGE).toContain('保存できません');
  expect(GBP_PLACE_TAKEN_MESSAGE).toContain('別の店舗に登録されています');
  expect(GBP_PLACE_MISMATCH_NOTICE).toContain('表示していません');
  // 照合が外れたら Place ID ごと外すので、登録し直す先まで案内する（gbp-place-release.ts）
  expect(GBP_PLACE_MISMATCH_NOTICE).toContain('登録を解除');
  expect(GBP_PLACE_MISMATCH_NOTICE).toContain('登録し直してください');
});

test('the settings screen warns that changing the checked details detaches the Place ID', () => {
  for (const item of ['店舗名', '電話番号', '郵便番号', '住所']) expect(GBP_IDENTITY_CHANGE_NOTICE).toContain(item);
  expect(GBP_IDENTITY_CHANGE_NOTICE).toContain('解除されます');
  const settings = require('node:fs').readFileSync(require('node:path').join(process.cwd(), 'src/app/admin/settings/page.tsx'), 'utf8');
  expect(settings).toContain('{GBP_IDENTITY_CHANGE_NOTICE}');
});
