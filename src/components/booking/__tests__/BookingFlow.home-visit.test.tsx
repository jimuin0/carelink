/**
 * @jest-environment jsdom
 *
 * 訪問専門の店舗は来店先が無く、施術者が利用者の自宅へ伺う。予約フォームの備考欄を
 * 「訪問先のご住所」の必須欄として出し、空のまま送れないことを固定する（2026年10月21日）。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import BookingFlow from '../BookingFlow';
import { readPointsBalance } from '@/lib/points-balance';
jest.mock('@/lib/points-balance');
import { completeClientCleanupMarker } from '@/lib/client-cleanup-marker';
import type { FacilityMenu, StaffProfile, Coupon } from '@/types';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const originalEncoder = Object.getOwnPropertyDescriptor(globalThis, 'TextEncoder');

const mockGetUser = jest.fn();
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: () => mockGetUser() },
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [] }) }) }),
  }),
}));

const FACILITY = { id: 'fac-1', slug: 'test-salon', name: 'テストサロン' };

const MENUS: FacilityMenu[] = [
  {
    id: 'menu-1', facility_id: 'fac-1', category: 'カット', name: 'カット', description: null,
    price: 5000, price_note: null, duration_minutes: 60, photo_url: null, is_featured: false, sort_order: 0,
  } as FacilityMenu,
];

const STAFF: StaffProfile[] = [
  { id: 'staff-1', facility_id: 'fac-1', name: '山田', position: 'スタイリスト', nomination_fee: 0 } as StaffProfile,
];

const COUPONS: Coupon[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  document.cookie = 'carelink_client_cleanup=; Path=/; Max-Age=0'; completeClientCleanupMarker(); localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: TextEncoder });
  mockGetUser.mockResolvedValue({ data: { user: null } }); // 未認証固定（ログインバナー表示のため）
  (readPointsBalance as jest.Mock).mockResolvedValue(0);
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ slots: [] }) })
  ) as unknown as typeof fetch;
});
afterEach(() => {
  jest.restoreAllMocks(); if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
  if (originalEncoder) Object.defineProperty(globalThis, 'TextEncoder', originalEncoder); else Reflect.deleteProperty(globalThis, 'TextEncoder');
});

async function openConfirmation(facility: typeof FACILITY & { homeVisitOnly?: boolean }) {
  (global.fetch as jest.Mock).mockImplementation(() => Promise.resolve({ ok: true,
    json: () => Promise.resolve({ slots: [{ slot_start: '10:00:00', slot_end: '11:00:00', staff_id: 'staff-1' }] }),
  }));
  render(<BookingFlow facility={facility} staff={STAFF} menus={MENUS} coupons={COUPONS} />);
  fireEvent.click(await screen.findByText('カット'));
  fireEvent.click(screen.getByText('次へ（日時を選ぶ）'));
  fireEvent.click((await screen.findAllByText('△'))[0]);
  fireEvent.click(screen.getByText('次へ（確認・予約）'));
  await screen.findByText('予約内容の確認・お客様情報');
  fireEvent.change(screen.getByLabelText(/お名前/), { target: { value: '合成 太郎' } });
  fireEvent.change(screen.getByLabelText(/メールアドレス/), { target: { value: 'synthetic@example.invalid' } });
}

function bookingRequests() {
  return (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).startsWith('/api/booking'));
}

test('訪問専門の店舗は訪問先の住所を必須欄として出し、空なら予約を送らない', async () => {
  await openConfirmation({ ...FACILITY, homeVisitOnly: true });
  const address = screen.getByLabelText(/訪問先のご住所・ご要望/);
  expect(address).toBeRequired();
  expect(screen.getByText(/訪問先のご住所（建物名・部屋番号まで）をご記入ください/)).toBeInTheDocument();
  fireEvent.change(address, { target: { value: '   ' } });
  fireEvent.click(screen.getByText('この内容で予約する'));
  expect(await screen.findByText('訪問先のご住所を入力してください')).toBeInTheDocument();
  expect(bookingRequests()).toHaveLength(0);
});

test('通常の店舗の備考欄は任意のまま', async () => {
  await openConfirmation(FACILITY);
  expect(screen.getByLabelText('ご要望・備考')).not.toBeRequired();
  expect(screen.queryByText(/訪問先のご住所/)).not.toBeInTheDocument();
});
