/** @jest-environment jsdom */
import { render, screen } from '@testing-library/react';
import BookingPage from '../page';
import { getFacilityBySlug, getFacilityMenus, getFacilityCancelPolicy } from '@/lib/facilities';
import { getBookableStaffByFacility, getMenuStaffByMenuIds } from '@/lib/staff';
import { getActiveCouponsByFacility } from '@/lib/coupons';
import { checkBookingReadiness } from '@/lib/facility-publish-gate';

jest.mock('@/lib/facilities', () => ({ getFacilityBySlug: jest.fn(), getFacilityMenus: jest.fn(), getFacilityCancelPolicy: jest.fn() }));
jest.mock('@/lib/staff', () => ({ getBookableStaffByFacility: jest.fn(), getMenuStaffByMenuIds: jest.fn() }));
jest.mock('@/lib/coupons', () => ({ getActiveCouponsByFacility: jest.fn(), getCouponMenus: jest.fn() }));
jest.mock('@/lib/supabase-server', () => ({ createServerSupabaseClient: () => ({}) }));
jest.mock('@/lib/facility-publish-gate', () => ({ checkBookingReadiness: jest.fn() }));
const mockFlow = jest.fn();
jest.mock('@/components/booking/BookingFlow', () => ({ __esModule: true, default: (props: unknown) => { mockFlow(props); return <div>予約入力画面</div>; } }));
jest.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));

const props = () => ({ params: Promise.resolve({ slug: 'synthetic-facility' }), searchParams: Promise.resolve({}) });

beforeEach(() => {
  jest.clearAllMocks();
  (getFacilityBySlug as jest.Mock).mockResolvedValue({ facility: { id: 'synthetic-id', name: 'テスト施設', phone: '000-0000-0000' } });
  (checkBookingReadiness as jest.Mock).mockResolvedValue({ readiness: { ready: false }, error: null });
  (getBookableStaffByFacility as jest.Mock).mockResolvedValue([]);
  (getFacilityMenus as jest.Mock).mockResolvedValue({ menus: [] });
  (getActiveCouponsByFacility as jest.Mock).mockResolvedValue([]);
  (getFacilityCancelPolicy as jest.Mock).mockResolvedValue(null);
  (getMenuStaffByMenuIds as jest.Mock).mockResolvedValue([]);
});

test('掲載のみなら予約入力へ進まず、電話・お問い合わせフォーム・詳細を表示する', async () => {
  render(await BookingPage(props()));
  expect(screen.queryByText('予約入力画面')).toBeNull();
  expect(screen.getByRole('heading', { name: 'ネット予約は受け付けていません' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '店舗に電話する' }).getAttribute('href')).toBe('tel:000-0000-0000');
  expect(screen.getByText('000-0000-0000')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'お問い合わせフォームで問い合わせる' }).getAttribute('href')).toBe('/facility/synthetic-facility#contact-section');
  expect(screen.getByRole('link', { name: '店舗情報に戻る' }).getAttribute('href')).toBe('/facility/synthetic-facility');
  expect(getBookableStaffByFacility).not.toHaveBeenCalled();
  expect(getFacilityMenus).not.toHaveBeenCalled();
});

// 2026年10月23日: 電話番号が無い（tel: にできない）店舗では連絡手段が 1 つも出ず、行き止まりだった。
test.each([null, '', '電話はお問い合わせください'])('電話番号が無い・電話をかけられない（%p）店舗でもお問い合わせフォームへ案内する', async (phone) => {
  (getFacilityBySlug as jest.Mock).mockResolvedValue({ facility: { id: 'synthetic-id', name: 'テスト施設', phone } });
  render(await BookingPage(props()));
  expect(screen.queryByRole('link', { name: '店舗に電話する' })).toBeNull();
  expect(screen.getByText('ご不明な点は、お問い合わせフォームから店舗へ直接お問い合わせください。')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'お問い合わせフォームで問い合わせる' }).getAttribute('href')).toBe('/facility/synthetic-facility#contact-section');
});

test('DB障害を準備中や予約可へ置換しない', async () => {
  (checkBookingReadiness as jest.Mock).mockResolvedValue({ readiness: { ready: false }, error: { message: 'failed' } });
  await expect(BookingPage(props())).rejects.toThrow('Online booking preparation lookup failed');
  expect(getBookableStaffByFacility).not.toHaveBeenCalled();
});

test('準備確認後だけ予約入力画面を表示する', async () => {
  (checkBookingReadiness as jest.Mock).mockResolvedValue({ readiness: { ready: true }, error: null });
  render(await BookingPage(props()));
  expect(screen.getByText('予約入力画面')).toBeTruthy();
  expect(getFacilityMenus).toHaveBeenCalledWith('synthetic-id');
});

// 勤務時間の無いスタッフを指名候補に出すと、選んだ途端に毎日「満枠」になっていた。
test('指名候補には勤務時間のあるスタッフだけを渡す', async () => {
  const working = [{ id: 'staff-working', name: '勤務あり' }];
  (checkBookingReadiness as jest.Mock).mockResolvedValue({ readiness: { ready: true }, error: null });
  (getBookableStaffByFacility as jest.Mock).mockResolvedValue(working);
  render(await BookingPage(props()));
  expect(getBookableStaffByFacility).toHaveBeenCalledWith('synthetic-id');
  expect(mockFlow).toHaveBeenCalledWith(expect.objectContaining({ staff: working }));
});

test('存在しない施設は準備確認も行わず404にする', async () => {
  (getFacilityBySlug as jest.Mock).mockResolvedValue({ facility: null });
  await expect(BookingPage(props())).rejects.toThrow('NOT_FOUND');
  expect(checkBookingReadiness).not.toHaveBeenCalled();
});
