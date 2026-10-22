import { normalizePostalCodeInput, normalizeWebsiteInput } from '../register-input-normalize';
import { salonStep1Schema, salonStep2Schema } from '../validations';
import { formatMegabytes } from '../format-megabytes';
import { REGISTER_PHOTO_FIELD_NOTE, REGISTER_PHOTO_REQUIREMENT, BOOKING_MIN_PHOTOS } from '../register-photo-policy';

describe('normalizePostalCodeInput', () => {
  test.each([
    ['５６００００１', '5600001'],
    ['５６０－０００１', '560-0001'],
    ['５６０ー０００１', '560-0001'],
    ['〒560-0001', '560-0001'],
    ['〒 ５６０ ０００１', '5600001'],
    ['5600001', '5600001'],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(normalizePostalCodeInput(input)).toBe(expected);
  });

  test('全角入力が正規化後に郵便番号の検証を通る（旧実装では弾かれていた）', () => {
    expect(salonStep2Schema.shape.postal_code.safeParse('５６０－０００１').success).toBe(false);
    expect(salonStep2Schema.shape.postal_code.safeParse(normalizePostalCodeInput('５６０－０００１')).success).toBe(true);
  });
});

describe('normalizeWebsiteInput', () => {
  test.each([
    ['example.com', 'https://example.com'],
    ['  www.example.com/menu  ', 'https://www.example.com/menu'],
    ['example.com:8080/x', 'https://example.com:8080/x'],
    ['//example.com', 'https://example.com'],
    ['https://example.com', 'https://example.com'],
    ['http://example.com', 'http://example.com'],
    ['mailto:a@example.com', 'mailto:a@example.com'],
    ['', ''],
    ['   ', ''],
  ])('%s → %s', (input, expected) => {
    expect(normalizeWebsiteInput(input)).toBe(expected);
  });

  test('スキーム省略の URL が正規化後に検証を通る（旧実装では弾かれていた）', () => {
    expect(salonStep1Schema.shape.website.safeParse('example.com').success).toBe(false);
    expect(salonStep1Schema.shape.website.safeParse(normalizeWebsiteInput('example.com')).success).toBe(true);
  });
});

describe('formatMegabytes', () => {
  test.each([
    [10 * 1024 * 1024, '10MB'],
    [10 * 1024 * 1024 + 1, '10.1MB'],
    [12.34 * 1024 * 1024, '12.4MB'],
    [5 * 1024 * 1024, '5MB'],
  ])('%d bytes → %s', (bytes, expected) => {
    expect(formatMegabytes(bytes)).toBe(expected);
  });
});

describe('写真の要否の文言（単一ソース）', () => {
  test('掲載公開に写真は不要・ネット予約には1枚以上、という実際の判定と一致する', () => {
    expect(BOOKING_MIN_PHOTOS).toBe(1);
    expect(REGISTER_PHOTO_REQUIREMENT).toContain('写真がなくても掲載公開できます');
    expect(REGISTER_PHOTO_REQUIREMENT).toContain('ネット予約');
    expect(REGISTER_PHOTO_FIELD_NOTE).toContain(REGISTER_PHOTO_REQUIREMENT);
    // 旧文言「公開時には写真の設定が必要です」は FAQ・公開ゲートと矛盾していた。
    expect(REGISTER_PHOTO_FIELD_NOTE).not.toMatch(/公開時には写真/);
  });
});
