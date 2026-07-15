/**
 * クーポン表示ロジックの単一 source of truth（src/lib/coupon-display.ts）のユニットテスト。
 *
 * 2026-07-15 発見のドリフト回帰防止：src/app/liff/coupons/page.tsx が誤った値集合
 * （discount_type='percent'/'fixed'/'special'、coupon_type='limited'）を参照しており、
 * DB CHECK 制約の正（'fixed'|'percentage'|'special_price'、'new_customer'|'repeat'|
 * 'limited_time'|'all'）とドリフトしていた。本テストは discount_type/coupon_type の
 * 全分岐（フォールバックを含む）を網羅し、branches 100% を満たす。
 */
import { discountText, couponTypeLabel } from '@/lib/coupon-display';

describe('discountText', () => {
  test('special_price かつ special_price が非null → ¥金額を返す', () => {
    expect(discountText({ discount_type: 'special_price', discount_value: null, special_price: 3000 })).toBe('¥3,000');
  });

  test('special_price かつ special_price が null → fallback（既定は空文字）', () => {
    expect(discountText({ discount_type: 'special_price', discount_value: null, special_price: null })).toBe('');
  });

  test('percentage かつ discount_value が非null → %OFFを返す', () => {
    expect(discountText({ discount_type: 'percentage', discount_value: 20, special_price: null })).toBe('20%OFF');
  });

  test('percentage かつ discount_value が null → fallback', () => {
    expect(discountText({ discount_type: 'percentage', discount_value: null, special_price: null })).toBe('');
  });

  test('fixed かつ discount_value が非null → ¥金額OFFを返す', () => {
    expect(discountText({ discount_type: 'fixed', discount_value: 500, special_price: null })).toBe('¥500OFF');
  });

  test('fixed かつ discount_value が null → fallback', () => {
    expect(discountText({ discount_type: 'fixed', discount_value: null, special_price: null })).toBe('');
  });

  test('未知の discount_type → fallback', () => {
    expect(discountText({ discount_type: 'unknown', discount_value: 100, special_price: 100 })).toBe('');
  });

  test('fallback 省略時の既定値は空文字', () => {
    expect(discountText({ discount_type: 'unknown', discount_value: null, special_price: null })).toBe('');
  });

  test('fallback を明示指定した場合はそれを返す（liff/coupons の「特別割引」互換）', () => {
    expect(discountText({ discount_type: 'unknown', discount_value: null, special_price: null }, '特別割引')).toBe('特別割引');
  });

  test('discount_value が 0 でも percentage は %OFF を返す（!== null 判定のため0円引き扱いにならない）', () => {
    expect(discountText({ discount_type: 'percentage', discount_value: 0, special_price: null })).toBe('0%OFF');
  });

  test('数値は3桁区切りでカンマ表示される（toLocaleString）', () => {
    expect(discountText({ discount_type: 'fixed', discount_value: 12345, special_price: null })).toBe('¥12,345OFF');
  });
});

describe('couponTypeLabel', () => {
  test.each([
    ['new_customer', '新規限定'],
    ['repeat', 'リピーター'],
    ['limited_time', '期間限定'],
    ['all', '全員'],
  ])('%s → %s', (input, expected) => {
    expect(couponTypeLabel(input)).toBe(expected);
  });

  test('未知値（旧バグの limited 等）は「全員」にフォールバックする', () => {
    expect(couponTypeLabel('limited')).toBe('全員');
  });

  test('空文字も「全員」にフォールバックする', () => {
    expect(couponTypeLabel('')).toBe('全員');
  });
});
