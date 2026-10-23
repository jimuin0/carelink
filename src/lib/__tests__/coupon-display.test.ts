/**
 * クーポン表示ロジックの単一 source of truth（src/lib/coupon-display.ts）のユニットテスト。
 *
 * 2026-07-15 発見のドリフト回帰防止：src/app/liff/coupons/page.tsx が誤った値集合
 * （discount_type='percent'/'fixed'/'special'、coupon_type='limited'）を参照しており、
 * DB CHECK 制約の正（'fixed'|'percentage'|'special_price'、'new_customer'|'repeat'|
 * 'limited_time'|'all'）とドリフトしていた。本テストは discount_type/coupon_type の
 * 全分岐（フォールバックを含む）を網羅し、branches 100% を満たす。
 */
import { discountText, couponTypeLabel, couponDisplayName, isPriceOnlyDescription } from '@/lib/coupon-display';

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

describe('couponDisplayName（バッジと同じ意味の先頭の括弧書きだけを外す）', () => {
  test.each([
    ['【新規】上まつ毛パーマ', 'new_customer', '上まつ毛パーマ'],
    ['【初回限定】カット', 'new_customer', 'カット'],
    ['［新規］カット', 'new_customer', 'カット'],
    ['[新規の方] カット', 'new_customer', 'カット'],
    ['【再来】カット', 'repeat', 'カット'],
    ['【リピーター限定】カット', 'repeat', 'カット'],
    ['【期間限定】カット', 'limited_time', 'カット'],
    ['【全員】カット', 'all', 'カット'],
  ])('%s（%s）→ %s', (name, type, expected) => {
    expect(couponDisplayName(name, type)).toBe(expected);
  });

  test.each([
    ['括弧書きが無い', 'カット', 'new_customer'],
    ['対象と無関係な括弧書き', '【人気No.1】カット', 'new_customer'],
    ['バッジと食い違う括弧書き', '【再来】カット', 'new_customer'],
    ['未知の coupon_type', '【新規】カット', 'vip'],
    ['外すと空になる', '【新規】', 'new_customer'],
  ])('%s はそのまま', (_label, name, type) => {
    expect(couponDisplayName(name, type)).toBe(name);
  });
});

describe('isPriceOnlyDescription（表示中の価格の言い直しだけの説明か）', () => {
  const price = { regular: 6900, discounted: 5800 };
  test.each(['通常¥6,900→¥5,800', '通常価格 6,900円 ⇒ 5,800円', '¥5,800', '(通常 ¥6,900) → ¥5,800'])('%s は言い直し', (d) => {
    expect(isPriceOnlyDescription(d, price)).toBe(true);
  });
  test.each([
    ['言葉を含む', '初回の方は通常¥6,900→¥5,800'],
    ['数字が食い違う', '通常¥7,000→¥5,800'],
    ['数字が無い', '通常 →'],
    ['空文字', ''],
  ])('%s説明は残す', (_label, d) => {
    expect(isPriceOnlyDescription(d, price)).toBe(false);
  });
});
