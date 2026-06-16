/**
 * @jest-environment jsdom
 *
 * CouponList の representativePrice 計算テスト。
 * メニューはあるが全 price=null の場合に Math.min() が Infinity になり「¥∞」が表示される
 * 不具合の回帰防止。価格ありメニューがあれば最小価格を通常価格として表示する。
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import CouponList from '@/components/facility/CouponList';
import type { Coupon, FacilityMenu } from '@/types';

const coupon: Coupon = {
  id: 'c1',
  facility_id: 'f1',
  name: 'カット10%OFF',
  description: null,
  coupon_type: 'all',
  discount_type: 'percentage',
  discount_value: 10,
  special_price: null,
  valid_from: null,
  valid_until: null,
  is_active: true,
  sort_order: 0,
  created_at: '2026-01-01',
};

function menu(id: string, price: number | null): FacilityMenu {
  return {
    id, facility_id: 'f1', category: 'cut', name: 'メニュー', description: null,
    price, price_note: null, duration_minutes: null, photo_url: null,
    is_featured: false, sort_order: 0,
  };
}

test('全メニューの price=null → 「¥∞」を表示しない（Infinity ガード・回帰防止）', () => {
  render(<CouponList coupons={[coupon]} menus={[menu('m1', null), menu('m2', null)]} />);
  expect(screen.queryByText(/∞/)).not.toBeInTheDocument();
  // 通常価格(line-through)は出さず、割引表記のみ
  expect(screen.queryByText(/通常 ¥/)).not.toBeInTheDocument();
  expect(screen.getByText('10%OFF')).toBeInTheDocument();
});

test('価格ありメニューがある → 最小価格を通常価格として表示', () => {
  render(<CouponList coupons={[coupon]} menus={[menu('m1', 5000), menu('m2', 3000)]} />);
  // 最小価格 3000 が通常価格として line-through 表示される
  expect(screen.getByText('通常 ¥3,000')).toBeInTheDocument();
  // 10%OFF → 2700
  expect(screen.getByText('¥2,700')).toBeInTheDocument();
});

test('menus 未指定 → representativePrice null（割引表記のみ・∞なし）', () => {
  render(<CouponList coupons={[coupon]} />);
  expect(screen.queryByText(/∞/)).not.toBeInTheDocument();
  expect(screen.getByText('10%OFF')).toBeInTheDocument();
});
