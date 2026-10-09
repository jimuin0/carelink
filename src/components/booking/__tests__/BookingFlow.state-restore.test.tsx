/**
 * @jest-environment jsdom
 *
 * 【2026年7月10日 恒久根治の回帰】予約確認ステップで「ログインする」を押すと選択内容
 * （メニュー・日時・氏名等）が全消失していたバグ（フルページ遷移で useState がリセットされる）
 * を、ログイン遷移直前の sessionStorage 保存 → 復帰時の1回限り復元 で根治したことを検証する。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import BookingFlow from '../BookingFlow';
import { saveBookingDraftForLogin, BOOKING_DRAFT_OBSOLETE, BOOKING_DRAFT_STORAGE_FAILED } from '@/lib/booking-draft-storage';
import { CLIENT_CLEANUP_GENERATION_KEY, completeClientCleanupMarker } from '@/lib/client-cleanup-marker';
import type { FacilityMenu, StaffProfile, Coupon } from '@/types';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, refresh: jest.fn() }) }));
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
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ slots: [] }) })
  ) as unknown as typeof fetch;
});
afterEach(() => {
  jest.restoreAllMocks(); if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
  if (originalEncoder) Object.defineProperty(globalThis, 'TextEncoder', originalEncoder); else Reflect.deleteProperty(globalThis, 'TextEncoder');
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

  // メニュー・クーポンステップ（クーポン無しなのでメニュータブが初期表示）
  fireEvent.click(await screen.findByText('カット'));
  fireEvent.click(screen.getByText('次へ（日時を選ぶ）'));

  // 日時ステップ＝週×時間の空き状況マトリクス。指名なし(既定)＋1スタッフ空きで △ セルが出る。
  const cell = (await screen.findAllByText('△'))[0];
  fireEvent.click(cell);

  fireEvent.click(screen.getByText('次へ（確認・予約）'));

  // 確認ステップに到達
  await screen.findByText('予約内容の確認・お客様情報');

  fireEvent.change(screen.getByLabelText(/お名前/), { target: { value: '鈴木太郎' } });
  fireEvent.change(screen.getByLabelText(/メールアドレス/), { target: { value: 'suzuki@example.com' } });
  fireEvent.change(screen.getByLabelText(/電話番号/), { target: { value: '09012345678' } });
  fireEvent.change(screen.getByLabelText('ご要望・備考'), { target: { value: 'よろしくお願いします' } });

  const loginLink = await screen.findByText('ログインする');
  fireEvent.click(loginLink);
  await waitFor(() => expect(sessionStorage.getItem(draftKey())).not.toBeNull());
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/auth/login?redirect=/facility/test-salon/booking'));
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

const restoredInput = () => JSON.stringify({ savedAt: Date.now(), menuIds: ['menu-1'], staffId: null, couponId: null,
  selectedDate: '2099-01-15', customerName: '復元太郎', email: 'restore@example.invalid', phone: '08000000000', note: '復元メモ', usePoints: false, pointsToUse: 0 });
const epoch = 'bda00000-0000-4000-8000-000000000001';
test('cookieが別タブで消費された後も、休眠タブの旧未タグ入力は復元せず削除する', async () => {
  localStorage.setItem(CLIENT_CLEANUP_GENERATION_KEY, epoch); sessionStorage.setItem(draftKey(), restoredInput());
  render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);
  await screen.findByText(BOOKING_DRAFT_OBSOLETE); expect(screen.queryByText('日時を選択')).not.toBeInTheDocument();
  expect(sessionStorage.getItem(draftKey())).toBeNull(); expect(mockPush).not.toHaveBeenCalled();
});
test('削除後に新しく保存したゲスト入力はcurrent世代で一度だけ復元する', async () => {
  localStorage.setItem(CLIENT_CLEANUP_GENERATION_KEY, epoch); await saveBookingDraftForLogin(FACILITY.id, restoredInput());
  render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);
  await screen.findByText('日時を選択'); expect(sessionStorage.getItem(draftKey())).toBeNull();
  expect(screen.queryByText(BOOKING_DRAFT_OBSOLETE)).not.toBeInTheDocument();
});
test('StrictModeのeffect再実行でも復元可能なlegacy snapshotを失わない', async () => {
  sessionStorage.setItem(draftKey(), restoredInput());
  render(<StrictMode><BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} /></StrictMode>);
  await screen.findByText('日時を選択'); expect(sessionStorage.getItem(draftKey())).toBeNull();
});
test('共有世代を読めない場合は既存入力を復元せず、通常のゲスト予約画面に固定案内を出す', async () => {
  sessionStorage.setItem(draftKey(), restoredInput()); const original = Storage.prototype.getItem;
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(function(key) { if (this === localStorage) throw new Error('private'); return original.call(this, key); });
  render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);
  await screen.findByText(BOOKING_DRAFT_STORAGE_FAILED); expect(screen.queryByText('日時を選択')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('カット'));
  expect(screen.getByText('次へ（日時を選ぶ）')).toBeEnabled(); expect(mockPush).not.toHaveBeenCalled();
});
test('保存確認に失敗したlogin遷移は止め、現在の氏名・メール入力を維持する', async () => {
  (global.fetch as jest.Mock).mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve({
    slots: [{ slot_start: '10:00:00', slot_end: '11:00:00', staff_id: 'staff-1' }],
  }) }));
  render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);
  fireEvent.click(await screen.findByText('カット')); fireEvent.click(screen.getByText('次へ（日時を選ぶ）'));
  fireEvent.click((await screen.findAllByText('△'))[0]); fireEvent.click(screen.getByText('次へ（確認・予約）'));
  await screen.findByText('予約内容の確認・お客様情報');
  fireEvent.change(screen.getByLabelText(/お名前/), { target: { value: '保持する合成氏名' } });
  fireEvent.change(screen.getByLabelText(/メールアドレス/), { target: { value: 'keep@example.invalid' } });
  const original = Storage.prototype.getItem;
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(function(key) { if (this === localStorage) throw new Error('private'); return original.call(this, key); });
  fireEvent.click(await screen.findByText('ログインする'));
  await screen.findByText(BOOKING_DRAFT_STORAGE_FAILED);
  expect(screen.getByLabelText(/お名前/)).toHaveValue('保持する合成氏名');
  expect(screen.getByLabelText(/メールアドレス/)).toHaveValue('keep@example.invalid'); expect(mockPush).not.toHaveBeenCalled();
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
  await screen.findByText('次へ（日時を選ぶ）');
  expect(screen.queryByText('日時を選択')).not.toBeInTheDocument();
});

test('破損した sessionStorage データは無視され通常フローを継続する（例外を投げない）', async () => {
  sessionStorage.setItem(draftKey(), 'not-valid-json{{{');

  expect(() => {
    render(<BookingFlow facility={FACILITY} staff={STAFF} menus={MENUS} coupons={COUPONS} />);
  }).not.toThrow();

  await screen.findByText('次へ（日時を選ぶ）');
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

  await screen.findByText('次へ（日時を選ぶ）');
  expect(screen.queryByText('日時を選択')).not.toBeInTheDocument();
});
