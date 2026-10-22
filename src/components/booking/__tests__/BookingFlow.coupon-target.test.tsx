/**
 * @jest-environment jsdom
 *
 * クーポンの「対象：新規／リピーター」の予約画面での表示（2026年10月22日 新設）。
 *
 * 判定の権威は予約確定時の RPC（来店歴のある客の新規限定クーポンは確定時に拒否される）。
 * 予約画面では、
 *  - 新規・リピーター限定のクーポンに利用条件を出す（ゲストにも事前に分かるように）
 *  - ログイン中で、この店舗の予約履歴が本人の予約から確かめられたときだけ、新規限定を選べなくする
 *  - 履歴が分からない（未ログイン・取得失敗・本人の予約が見つからない）ときは止めない
 *  - 選択後に履歴が分かった場合は選択を解除して知らせる
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import BookingFlow from '../BookingFlow';
import { readPointsBalance } from '@/lib/points-balance';
import { completeClientCleanupMarker } from '@/lib/client-cleanup-marker';
import { slotsWeekFetch } from '@/test-utils/slots-week-mock';
import type { FacilityMenu, StaffProfile, Coupon } from '@/types';

jest.mock('@/lib/points-balance');
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));

const mockGetUser = jest.fn();
const mockHistory = jest.fn();
const historyQuery = { from: jest.fn(), select: jest.fn(), eq: jest.fn(), not: jest.fn(), limit: jest.fn() };
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: () => mockGetUser() },
    from: (table: string) => {
      historyQuery.from(table);
      const chain = {
        select: (...a: unknown[]) => { historyQuery.select(...a); return chain; },
        eq: (...a: unknown[]) => { historyQuery.eq(...a); return chain; },
        not: (...a: unknown[]) => { historyQuery.not(...a); return chain; },
        limit: (...a: unknown[]) => { historyQuery.limit(...a); return mockHistory(); },
      };
      return chain;
    },
  }),
}));

const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const originalEncoder = Object.getOwnPropertyDescriptor(globalThis, 'TextEncoder');

const FACILITY = { id: 'fac-1', slug: 'test-salon', name: 'テストサロン' };
const MENUS: FacilityMenu[] = [{
  id: 'menu-1', facility_id: 'fac-1', category: 'カット', name: 'カット', description: null,
  price: 5000, price_note: null, duration_minutes: 60, photo_url: null, is_featured: false, sort_order: 0,
} as FacilityMenu];
const STAFF: StaffProfile[] = [{ id: 'staff-1', facility_id: 'fac-1', name: '山田', position: 'スタイリスト', nomination_fee: 0 } as StaffProfile];

function coupon(id: string, name: string, coupon_type: Coupon['coupon_type']): Coupon {
  return {
    id, facility_id: 'fac-1', name, description: null, coupon_type,
    discount_type: 'fixed', discount_value: 1000, special_price: null,
    valid_from: null, valid_until: null, is_active: true, sort_order: 0, created_at: '2026-01-01T00:00:00Z',
  };
}
const NEW = coupon('c-new', '初回限定クーポン', 'new_customer');
const REPEAT = coupon('c-repeat', '再来クーポン', 'repeat');
const ALL = coupon('c-all', 'みんなのクーポン', 'all');
const COUPONS = [NEW, REPEAT, ALL];

const button = async (name: string) => (await screen.findByText(name)).closest('button')!;

beforeEach(() => {
  jest.clearAllMocks();
  document.cookie = 'carelink_client_cleanup=; Path=/; Max-Age=0'; completeClientCleanupMarker(); localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: TextEncoder });
  mockGetUser.mockResolvedValue({ data: { user: null } });
  mockHistory.mockResolvedValue({ data: [], error: null });
  (readPointsBalance as jest.Mock).mockResolvedValue(0);
  global.fetch = jest.fn(slotsWeekFetch([])) as unknown as typeof fetch;
});
afterEach(() => {
  jest.restoreAllMocks(); if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
  if (originalEncoder) Object.defineProperty(globalThis, 'TextEncoder', originalEncoder); else Reflect.deleteProperty(globalThis, 'TextEncoder');
});

test('新規・リピーター限定のクーポンには利用条件を出す（ゲストは選べる・履歴は問い合わせない）', async () => {
  render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);
  expect(await screen.findByText('ご利用条件：この店舗を初めてご予約の方限定')).toBeInTheDocument();
  expect(screen.getByText('ご利用条件：この店舗で2回目以降のご予約の方限定')).toBeInTheDocument();
  expect(screen.getAllByText(/ご利用条件：/)).toHaveLength(2);
  await waitFor(() => expect(mockGetUser).toHaveBeenCalled());
  expect(historyQuery.from).not.toHaveBeenCalledWith('bookings');
  expect(await button('初回限定クーポン')).not.toBeDisabled();
  expect(await button('再来クーポン')).not.toBeDisabled();
});

test('ログイン中で本人の予約履歴があれば、新規限定だけ選べない', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'u@example.invalid', user_metadata: {} } } });
  mockHistory.mockResolvedValue({ data: [{ id: 'b-1' }], error: null });
  render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);
  expect(await screen.findByText(/ご予約履歴により、ご利用いただけません/)).toBeInTheDocument();
  expect(await button('初回限定クーポン')).toBeDisabled();
  expect(await button('再来クーポン')).not.toBeDisabled();
  expect(await button('みんなのクーポン')).not.toBeDisabled();
  // この店舗の本人の予約を、キャンセル系を除いて 1 件だけ確認する。
  expect(historyQuery.from).toHaveBeenCalledWith('bookings');
  expect(historyQuery.eq).toHaveBeenCalledWith('facility_id', 'fac-1');
  expect(historyQuery.eq).toHaveBeenCalledWith('user_id', 'user-1');
  expect(historyQuery.not).toHaveBeenCalledWith('status', 'in', '(cancelled,cancel_fee_paid)');
  expect(historyQuery.limit).toHaveBeenCalledWith(1);
});

test.each([
  ['本人の予約が見つからない', () => mockHistory.mockResolvedValue({ data: [], error: null })],
  ['取得に失敗した', () => mockHistory.mockResolvedValue({ data: null, error: { code: '08006' } })],
  ['問い合わせが例外になった', () => mockHistory.mockRejectedValue(new Error('network'))],
])('ログイン中でも%s場合は止めない（確定時に判定する）', async (_label, arrange) => {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'u@example.invalid', user_metadata: {} } } });
  arrange();
  render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);
  await waitFor(() => expect(historyQuery.limit).toHaveBeenCalled());
  await act(async () => { await Promise.resolve(); });
  expect(await button('初回限定クーポン')).not.toBeDisabled();
  expect(screen.queryByText(/ご予約履歴により/)).not.toBeInTheDocument();
});

test('選択後に予約履歴が分かったら、新規限定の選択を解除して知らせる', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'u@example.invalid', user_metadata: {} } } });
  let resolveHistory!: (v: unknown) => void;
  mockHistory.mockReturnValue(new Promise((resolve) => { resolveHistory = resolve; }));
  render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);
  fireEvent.click(await button('初回限定クーポン'));
  // 対象メニューの無いクーポンを選ぶとメニュー選択へ進み、選択中のクーポン名が案内に出る。
  expect(screen.getByText('「初回限定クーポン」で受けるメニューを選んでください')).toBeInTheDocument();
  await waitFor(() => expect(historyQuery.limit).toHaveBeenCalled());
  await act(async () => { resolveHistory({ data: [{ id: 'b-1' }], error: null }); });
  expect(await screen.findByText('「初回限定クーポン」はこの店舗を初めてご予約の方限定のクーポンのため、選択を解除しました')).toBeInTheDocument();
  expect(screen.queryByText('「初回限定クーポン」で受けるメニューを選んでください')).not.toBeInTheDocument();
});

test('確認画面では選んだクーポンの利用条件と、確定時に確認することを出す', async () => {
  (global.fetch as jest.Mock).mockImplementation(slotsWeekFetch([{ slot_start: '10:00:00', slot_end: '11:00:00', staff_id: 'staff-1' }]));
  render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);
  fireEvent.click(await button('初回限定クーポン'));
  fireEvent.click(await screen.findByText('カット'));
  fireEvent.click(screen.getByText('次へ（日時を選ぶ）'));
  fireEvent.click((await screen.findAllByText('△'))[0]!);
  fireEvent.click(screen.getByText('次へ（確認・予約）'));
  await screen.findByText('予約内容の確認・お客様情報');
  expect(screen.getByText('ご利用条件：この店舗を初めてご予約の方限定（ご予約の確定時に確認します）')).toBeInTheDocument();
});
