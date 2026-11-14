/**
 * @jest-environment jsdom
 *
 * 監査 A431: 店舗情報を読み直したら（router.refresh）、選択中のスタッフも新しい内容に置き換える。
 * 選んだ時点の写しのままだと指名料が古いまま合計に出て、サーバーの請求額とずれる。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import BookingFlow from '../BookingFlow';
import type { FacilityMenu, StaffProfile, Coupon } from '@/types';
import { slotsWeekFetch } from '@/test-utils/slots-week-mock';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [] }) }) }),
  }),
}));

const FACILITY = { id: 'fac-1', slug: 'test-salon', name: 'テストサロン' };
const MENUS: FacilityMenu[] = [{
  id: 'menu-1', facility_id: 'fac-1', category: 'カット', name: 'カット', description: null,
  price: 5000, price_note: null, duration_minutes: 60, photo_url: null, is_featured: false, sort_order: 0,
} as FacilityMenu];
const COUPONS: Coupon[] = [];
const staffWithFee = (fee: number): StaffProfile[] => [
  { id: 'staff-1', facility_id: 'fac-1', name: '山田', position: 'スタイリスト', nomination_fee: fee } as StaffProfile,
];

beforeEach(() => {
  global.fetch = jest.fn(slotsWeekFetch([])) as unknown as typeof fetch;
});

test('読み直した指名料が合計に反映され、消えたスタッフの指名は解除される', async () => {
  const view = render(<BookingFlow facility={FACILITY} staff={staffWithFee(1000)} menus={MENUS} coupons={COUPONS} />);
  fireEvent.click(await screen.findByText('カット'));
  fireEvent.click(screen.getByText('次へ（日時を選ぶ）'));
  fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'staff-1' } });
  expect(await screen.findByText('合計 ¥6,000')).toBeInTheDocument();

  view.rerender(<BookingFlow facility={FACILITY} staff={staffWithFee(2000)} menus={MENUS} coupons={COUPONS} />);
  expect(await screen.findByText('合計 ¥7,000')).toBeInTheDocument();

  view.rerender(<BookingFlow facility={FACILITY} staff={[]} menus={MENUS} coupons={COUPONS} />);
  expect(await screen.findByText('合計 ¥5,000')).toBeInTheDocument();
  expect(screen.getByText('指名中のスタッフがご予約いただけなくなったため、指名を解除しました')).toBeInTheDocument();
});
