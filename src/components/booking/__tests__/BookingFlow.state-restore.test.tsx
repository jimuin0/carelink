/**
 * @jest-environment jsdom
 *
 * 【2026年7月10日 恒久根治の回帰】予約確認ステップで「ログインする」を押すと選択内容
 * （メニュー・日時・氏名等）が全消失していたバグ（フルページ遷移で useState がリセットされる）
 * を、ログイン遷移直前の sessionStorage 保存 → 復帰時の1回限り復元 で根治したことを検証する。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import BookingFlow from '../BookingFlow';
import type { FacilityMenu, StaffProfile, Coupon } from '@/types';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));

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
  sessionStorage.clear();
  mockGetUser.mockResolvedValue({ data: { user: null } }); // 未認証固定（ログインバナー表示のため）
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ slots: [] }) })
  ) as unknown as typeof fetch;
});

function draftKey() {
  return `booking-draft:${FACILITY.id}`;
}

test('確認ステップで「ログインする」を押すと選択内容がsessionStorageに保存され、フルページ遷移前に消えない', async () => {
  (global.fetch as jest.Mock).mockImplementation(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ slots: [{ slot_start: '10:00:00', slot_end: '11:00:00', staff_id: 'staff-1' }] }),
    })
  );

  render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);

  fireEvent.click(await screen.findByText('カット'));
  fireEvent.click(screen.getByText('次へ（スタッフ選択）'));
  fireEvent.click(await screen.findByText('指名なし（おまかせ）'));

  const firstDateCell = document.querySelectorAll('.grid.grid-cols-5 button')[0] as HTMLElement;
  fireEvent.click(firstDateCell);

  const slotButton = await screen.findByText('10:00');
  fireEvent.click(slotButton);

  fireEvent.click(screen.getByText('次へ（確認・予約）'));

  // 確認ステップに到達
  await screen.findByText('予約内容の確認・お客様情報');

  fireEvent.change(screen.getByLabelText(/お名前/), { target: { value: '鈴木太郎' } });
  fireEvent.change(screen.getByLabelText(/メールアドレス/), { target: { value: 'suzuki@example.com' } });
  fireEvent.change(screen.getByLabelText('電話番号'), { target: { value: '09012345678' } });
  fireEvent.change(screen.getByLabelText('備考'), { target: { value: 'よろしくお願いします' } });

  const loginLink = await screen.findByText('ログインする');
  fireEvent.click(loginLink);

  const raw = sessionStorage.getItem(draftKey());
  expect(raw).not.toBeNull();
  const draft = JSON.parse(raw!);
  expect(draft.menuIds).toEqual(['menu-1']);
  expect(draft.staffId).toBeNull();
  expect(draft.customerName).toBe('鈴木太郎');
  expect(draft.email).toBe('suzuki@example.com');
  expect(draft.phone).toBe('09012345678');
  expect(draft.note).toBe('よろしくお願いします');
  expect(typeof draft.savedAt).toBe('number');
});

test('再マウント時、保存済みドラフトを1回だけ復元し日時ステップへ進める（sessionStorageは消去される）', async () => {
  sessionStorage.setItem(draftKey(), JSON.stringify({
    savedAt: Date.now(),
    menuIds: ['menu-1'],
    staffId: null,
    couponId: null,
    selectedDate: '2099-01-15',
    customerName: '復元太郎',
    email: 'restore@example.com',
    phone: '08000000000',
    note: '復元メモ',
    usePoints: false,
    pointsToUse: 0,
  }));

  render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);

  // 日時ステップへ直接復帰していること（メニュー選択画面からやり直しにならない）
  await screen.findByText('日時を選択');

  // 復元後は消去され、再訪問時に再利用されない
  expect(sessionStorage.getItem(draftKey())).toBeNull();
});

test('15分より古いドラフトは復元されない（陳腐化データによる誤復元防止）', async () => {
  const STALE_MS = 16 * 60 * 1000;
  sessionStorage.setItem(draftKey(), JSON.stringify({
    savedAt: Date.now() - STALE_MS,
    menuIds: ['menu-1'],
    staffId: null,
    couponId: null,
    selectedDate: '2099-01-15',
    customerName: '古太郎',
    email: 'old@example.com',
    phone: '',
    note: '',
    usePoints: false,
    pointsToUse: 0,
  }));

  render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);

  // メニュー選択画面のまま（復元されない）
  await screen.findByText('メニューを選択');
  expect(screen.queryByText('日時を選択')).not.toBeInTheDocument();
});

test('破損した sessionStorage データは無視され通常フローを継続する（例外を投げない）', async () => {
  sessionStorage.setItem(draftKey(), 'not-valid-json{{{');

  expect(() => {
    render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);
  }).not.toThrow();

  await screen.findByText('メニューを選択');
});

test('他施設のドラフトは復元されない（facility.id でスコープされる）', async () => {
  sessionStorage.setItem('booking-draft:other-facility', JSON.stringify({
    savedAt: Date.now(),
    menuIds: ['menu-1'],
    staffId: null,
    couponId: null,
    selectedDate: '2099-01-15',
    customerName: '他施設太郎',
    email: 'other@example.com',
    phone: '',
    note: '',
    usePoints: false,
    pointsToUse: 0,
  }));

  render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);

  await screen.findByText('メニューを選択');
  expect(screen.queryByText('日時を選択')).not.toBeInTheDocument();
});
