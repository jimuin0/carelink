/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import BookingPage from '../page';
import { getFacilityBySlug, getFacilityMenus, getFacilityCancelPolicy } from '@/lib/facilities';
import { getStaffByFacility, getMenuStaffByMenuIds } from '@/lib/staff';
import { getActiveCouponsByFacility } from '@/lib/coupons';
import { checkBookingReadiness } from '@/lib/facility-publish-gate';

jest.mock('@/lib/facilities', () => ({ getFacilityBySlug: jest.fn(), getFacilityMenus: jest.fn(), getFacilityCancelPolicy: jest.fn() }));
jest.mock('@/lib/staff', () => ({ getStaffByFacility: jest.fn(), getMenuStaffByMenuIds: jest.fn() }));
jest.mock('@/lib/coupons', () => ({ getActiveCouponsByFacility: jest.fn(), getCouponMenus: jest.fn() }));
jest.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: () => ({}) }));
jest.mock('@/lib/facility-publish-gate', () => ({ checkBookingReadiness: jest.fn() }));
jest.mock('@/components/booking/BookingFlow', () => ({ __esModule: true, default: () => <div>予約入力画面</div> }));
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));

const props = () => ({ params: Promise.resolve({ slug: 'synthetic-facility' }), searchParams: Promise.resolve({}) });

beforeEach(() => {
  jest.clearAllMocks();
  (getFacilityBySlug as jest.Mock).mockResolvedValue({ facility: { id: 'synthetic-id', name: 'テスト施設', phone: '000-0000-0000' } });
  (checkBookingReadiness as jest.Mock).mockResolvedValue({ readiness: { ready: false }, error: null });
  (getStaffByFacility as jest.Mock).mockResolvedValue([]);
  (getFacilityMenus as jest.Mock).mockResolvedValue({ menus: [] });
  (getActiveCouponsByFacility as jest.Mock).mockResolvedValue([]);
  (getFacilityCancelPolicy as jest.Mock).mockResolvedValue(null);
  (getMenuStaffByMenuIds as jest.Mock).mockResolvedValue([]);
});

test('掲載のみなら予約入力へ進まず、電話と詳細を表示する', async () => {
  render(await BookingPage(props()));
  expect(screen.queryByText('予約入力画面')).toBeNull();
  expect(screen.getByRole('link', { name: '店舗に電話する' }).getAttribute('href')).toBe('tel:000-0000-0000');
  expect(screen.getByRole('link', { name: '店舗情報に戻る' }).getAttribute('href')).toBe('/facility/synthetic-facility');
  expect(getStaffByFacility).not.toHaveBeenCalled();
  expect(getFacilityMenus).not.toHaveBeenCalled();
});

test('DB障害を準備中や予約可へ置換しない', async () => {
  (checkBookingReadiness as jest.Mock).mockResolvedValue({ readiness: { ready: false }, error: { message: 'failed' } });
  await expect(BookingPage(props())).rejects.toThrow('Online booking preparation lookup failed');
  expect(getStaffByFacility).not.toHaveBeenCalled();
});

test('準備確認後だけ予約入力画面を表示する', async () => {
  (checkBookingReadiness as jest.Mock).mockResolvedValue({ readiness: { ready: true }, error: null });
  render(await BookingPage(props()));
  expect(screen.getByText('予約入力画面')).toBeTruthy();
  expect(getFacilityMenus).toHaveBeenCalledWith('synthetic-id');
});

test('存在しない施設は準備確認も行わず404にする', async () => {
  (getFacilityBySlug as jest.Mock).mockResolvedValue({ facility: null });
  await expect(BookingPage(props())).rejects.toThrow('NOT_FOUND');
  expect(checkBookingReadiness).not.toHaveBeenCalled();
});
