/**
 * @jest-environment jsdom
 *
 * 施設ページのクーポン一覧の「通常 ¥X → ¥Y」表示。
 *
 * 【回帰防止・2026年10月22日】以前は施設の全メニューの最安値を全クーポン共通の「通常価格」に
 * していた。本番ではオプション「コーティング ¥500」が最安値だったため、全クーポンが
 * 「通常 ¥500 → ¥5,800」のように、通常価格の方が安く見えていた。通常価格はクーポンごとに
 * 対象メニュー（coupon_menus）の定価から出し、出せないときは取り消し線を出さない。
 *
 * 旧テスト（全メニュー price=null で「¥∞」を出さない）も残す。
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

function menu(id: string, price: number | null, name = 'メニュー'): FacilityMenu {
  return {
    id, facility_id: 'f1', category: 'cut', name, description: null,
    price, price_note: null, duration_minutes: null, photo_url: null,
    is_featured: false, sort_order: 0,
  };
}

const OPTION = menu('option', 500, 'コーティング');
const LASH = menu('lash', 6900, 'まつげパーマ');
const SPECIAL: Coupon = { ...coupon, id: 'c-special', name: '初回まつげパーマ', discount_type: 'special_price', discount_value: null, special_price: 5800 };

test('通常価格は対象メニューの定価。施設の最安値（オプション ¥500）を通常価格にしない', () => {
  render(<CouponList coupons={[SPECIAL]} menus={[OPTION, LASH]} couponMenuMap={{ 'c-special': ['lash'] }} />);
  expect(screen.getByText('通常 ¥6,900')).toBeInTheDocument();
  expect(screen.getByText('¥5,800')).toBeInTheDocument();
  expect(screen.queryByText('通常 ¥500')).not.toBeInTheDocument();
  expect(screen.getByText('対象メニュー：まつげパーマ')).toBeInTheDocument();
});

test('割合割引も対象メニューの定価から計算する（予約時の請求額と同じ）', () => {
  render(<CouponList coupons={[coupon]} menus={[OPTION, LASH]} couponMenuMap={{ c1: ['lash'] }} />);
  expect(screen.getByText('通常 ¥6,900')).toBeInTheDocument();
  expect(screen.getByText('¥6,210')).toBeInTheDocument();
});

test('対象メニューが決まっていないクーポンは取り消し線を出さず、割引表記だけ', () => {
  render(<CouponList coupons={[coupon, SPECIAL]} menus={[OPTION, LASH]} couponMenuMap={{}} />);
  expect(screen.queryByText(/通常 ¥/)).not.toBeInTheDocument();
  expect(screen.getByText('10%OFF')).toBeInTheDocument();
  expect(screen.getByText('¥5,800')).toBeInTheDocument();
  expect(screen.queryByText(/対象メニュー：/)).not.toBeInTheDocument();
});

test('対象メニューが取得できなかったとき（couponMenuMap 未指定）も通常価格を作らない', () => {
  render(<CouponList coupons={[SPECIAL]} menus={[OPTION, LASH]} />);
  expect(screen.queryByText(/通常 ¥/)).not.toBeInTheDocument();
  expect(screen.getByText('¥5,800')).toBeInTheDocument();
});

test('特別価格が対象メニューの定価以上なら取り消し線を出さない（逆転表示をしない）', () => {
  render(<CouponList coupons={[{ ...SPECIAL, special_price: 7000 }]} menus={[LASH]} couponMenuMap={{ 'c-special': ['lash'] }} />);
  expect(screen.queryByText(/通常 ¥/)).not.toBeInTheDocument();
  expect(screen.getByText('¥7,000')).toBeInTheDocument();
});

test('全メニューの price=null → 「¥∞」も通常価格も出さない（Infinity ガード・回帰防止）', () => {
  render(<CouponList coupons={[coupon]} menus={[menu('m1', null), menu('m2', null)]} couponMenuMap={{ c1: ['m1'] }} />);
  expect(screen.queryByText(/∞/)).not.toBeInTheDocument();
  expect(screen.queryByText(/通常 ¥/)).not.toBeInTheDocument();
  expect(screen.getByText('10%OFF')).toBeInTheDocument();
});

test('menus 未指定 → 割引表記のみ・∞なし', () => {
  render(<CouponList coupons={[coupon]} />);
  expect(screen.queryByText(/∞/)).not.toBeInTheDocument();
  expect(screen.getByText('10%OFF')).toBeInTheDocument();
});

test('新規・リピーター限定のクーポンには利用条件とログインが必要なことを出す', () => {
  render(<CouponList coupons={[{ ...coupon, id: 'n', coupon_type: 'new_customer' }, { ...coupon, id: 'r', coupon_type: 'repeat' }, coupon]} />);
  expect(screen.getByText('ご利用条件：この店舗を初めてご予約の方限定（ログインが必要です）')).toBeInTheDocument();
  expect(screen.getByText('ご利用条件：この店舗にご来店いただいたことがある方限定（ログインが必要です）')).toBeInTheDocument();
  expect(screen.getAllByText(/ご利用条件：/)).toHaveLength(2);
});

test('クーポンが無ければ案内文', () => {
  render(<CouponList coupons={[]} />);
  expect(screen.getByText('現在利用可能なクーポンはありません')).toBeInTheDocument();
});
