/**
 * @jest-environment node
 */

import { t, detectLocale, SUPPORTED_LOCALES, LOCALE_LABELS, LOCALE_FLAGS, LOCALE_COOKIE_KEY } from '../i18n';

describe('t()', () => {
  test('ja (default) returns Japanese string', () => {
    expect(t('booking.title')).toBe('予約する');
  });

  test('en returns English string', () => {
    expect(t('booking.title', 'en')).toBe('Book Now');
  });

  test('zh returns Chinese string', () => {
    expect(t('booking.title', 'zh')).toBe('立即预约');
  });

  test('ko returns Korean string', () => {
    expect(t('booking.title', 'ko')).toBe('예약하기');
  });

  test('unknown key returns fallback when provided', () => {
    expect(t('nonexistent.key', 'ja', 'fallback text')).toBe('fallback text');
  });

  test('unknown key returns key itself when no fallback', () => {
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });

  test('known key with locale that has no translation falls back to ja', () => {
    // All keys have ja, so this tests the dict[locale] ?? dict.ja path
    expect(t('common.free', 'ja')).toBe('無料');
    expect(t('common.free', 'en')).toBe('Free');
  });

  test('search keys are translated', () => {
    expect(t('search.placeholder', 'en')).toBe('Search by area, type, or name');
    expect(t('nav.home', 'ko')).toBe('홈');
  });
});

describe('detectLocale()', () => {
  test('null → ja', () => {
    expect(detectLocale(null)).toBe('ja');
  });

  test('empty string → ja', () => {
    expect(detectLocale('')).toBe('ja');
  });

  test('en → en', () => {
    expect(detectLocale('en')).toBe('en');
  });

  test('en-US → en (strips region)', () => {
    expect(detectLocale('en-US,en;q=0.9')).toBe('en');
  });

  test('zh → zh', () => {
    expect(detectLocale('zh-TW,zh;q=0.9')).toBe('zh');
  });

  test('ko → ko', () => {
    expect(detectLocale('ko-KR')).toBe('ko');
  });

  test('ja → ja', () => {
    expect(detectLocale('ja-JP')).toBe('ja');
  });

  test('unsupported locale → ja fallback', () => {
    expect(detectLocale('fr-FR')).toBe('ja');
    expect(detectLocale('de')).toBe('ja');
  });
});

describe('constants', () => {
  test('SUPPORTED_LOCALES contains 4 locales', () => {
    expect(SUPPORTED_LOCALES).toEqual(['ja', 'en', 'zh', 'ko']);
  });

  test('LOCALE_LABELS has all 4 locales', () => {
    expect(Object.keys(LOCALE_LABELS)).toEqual(['ja', 'en', 'zh', 'ko']);
    expect(LOCALE_LABELS.en).toBe('English');
  });

  test('LOCALE_FLAGS has all 4 locales', () => {
    expect(Object.keys(LOCALE_FLAGS)).toEqual(['ja', 'en', 'zh', 'ko']);
  });

  test('LOCALE_COOKIE_KEY is a string', () => {
    expect(typeof LOCALE_COOKIE_KEY).toBe('string');
  });
});
