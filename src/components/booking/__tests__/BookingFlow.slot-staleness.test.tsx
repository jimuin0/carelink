/**
 * @jest-environment jsdom
 *
 * 予約画面で選んだ枠が古くなったまま予約に進めないこと（2026年10月23日）。
 *
 * 回帰 1: 枠を選んでから「戻る」でメニューを足すと、旧い終了時刻の枠が残ったまま確認・予約まで進めた。
 *         120分の内容が 60分の枠で保存され、後半の時間は他のお客様に再び売られていた。
 * 回帰 2: 空き状況は開いた時点のもの。画面を開いたままにすると、開始時刻を過ぎた枠のまま
 *         確認画面へ進み、予約できた（作った直後からオンラインでキャンセルも変更もできない）。
 * どちらも、サーバーが断った場合は同じ枠を送り直させず、日時の選択に戻して空き状況を取り直す。
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import BookingFlow from '../BookingFlow';
import { readPointsBalance } from '@/lib/points-balance';
import { completeClientCleanupMarker } from '@/lib/client-cleanup-marker';
import { slotsWeekBody } from '@/test-utils/slots-week-mock';
import { BOOKING_DURATION_MISMATCH_MESSAGE, BOOKING_SLOT_PASSED_MESSAGE } from '@/lib/booking-slot-rules';
import { clampDuration } from '@/lib/available-slots';
import type { FacilityMenu, StaffProfile, Coupon } from '@/types';

jest.mock('@/lib/points-balance');
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, refresh: jest.fn() }) }));
const mockGetUser = jest.fn();
jest.mock('@/lib/supabase-browser', () => ({
  createBrowserSupabaseClient: () => ({
    auth: { getUser: () => mockGetUser() },
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [] }) }) }),
  }),
}));

const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const originalEncoder = Object.getOwnPropertyDescriptor(globalThis, 'TextEncoder');

const FACILITY = { id: 'fac-1', slug: 'test-salon', name: 'テストサロン' };
const menu = (id: string, name: string, duration: number) => ({
  id, facility_id: 'fac-1', category: name, name, description: null,
  price: 5000, price_note: null, duration_minutes: duration, photo_url: null, is_featured: false, sort_order: 0,
} as FacilityMenu);
const CUT = menu('menu-cut', 'カット', 60);
const COLOR = menu('menu-color', 'カラー', 60);
const STAFF: StaffProfile[] = [{ id: 'staff-1', facility_id: 'fac-1', name: '山田', position: 'スタイリスト', nomination_fee: 0 } as StaffProfile];
const DAY = 86_400_000;

/** 空き枠 API の代わり。所要時間（duration・15〜480 分に丸める）どおりの長さで 10:00 の枠を返す（本物と同じ）。 */
let bookingResponse: (action: string, key: string) => { status: number; body: unknown };
function installFetch() {
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/slots/week')) {
      const duration = clampDuration(new URL(url, 'http://localhost').searchParams.get('duration'));
      const end = `${String(10 + Math.floor(duration / 60)).padStart(2, '0')}:${String(duration % 60).padStart(2, '0')}:00`;
      const body = slotsWeekBody(url, [{ slot_start: '10:00:00', slot_end: end, staff_id: 'staff-1' }]);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
    }
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const { status, body } = bookingResponse(headers['X-Booking-Action'], headers['Idempotency-Key']);
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response);
  }) as unknown as typeof fetch;
}
const slotRequests = () => (global.fetch as jest.Mock).mock.calls.map(([u]) => String(u)).filter((u) => u.startsWith('/api/slots/week'));
const createRequests = () => (global.fetch as jest.Mock).mock.calls
  .filter(([u, init]) => String(u) === '/api/booking' && (init?.headers as Record<string, string>)['X-Booking-Action'] === 'create');

beforeEach(() => {
  jest.clearAllMocks();
  document.cookie = 'carelink_client_cleanup=; Path=/; Max-Age=0'; completeClientCleanupMarker(); localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  Object.defineProperty(globalThis, 'TextEncoder', { configurable: true, value: TextEncoder });
  // jsdom には structuredClone が無い（受付の送信内容を固定するのに使う）。
  if (typeof globalThis.structuredClone !== 'function') {
    Object.defineProperty(globalThis, 'structuredClone', { configurable: true, value: <T,>(v: T): T => JSON.parse(JSON.stringify(v)) });
  }
  mockGetUser.mockResolvedValue({ data: { user: null } });
  (readPointsBalance as jest.Mock).mockResolvedValue(0);
  bookingResponse = () => ({ status: 500, body: {} });
  installFetch();
});
afterEach(() => {
  jest.restoreAllMocks(); if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
  if (originalEncoder) Object.defineProperty(globalThis, 'TextEncoder', originalEncoder); else Reflect.deleteProperty(globalThis, 'TextEncoder');
});

/** メニューを選んで日時の表へ進み、翌日 10:00 の枠を選ぶ（当日は時刻しだいで過ぎているため使わない）。 */
async function pickTomorrowTen(
  menus: FacilityMenu[] = [CUT, COLOR], coupons: Coupon[] = [], couponMenuMap?: Record<string, string[]>,
  extraMenus: string[] = [], expected = '10:00〜11:00',
) {
  render(<BookingFlow facility={FACILITY} staff={STAFF} menus={menus} coupons={coupons} couponMenuMap={couponMenuMap} />);
  if (coupons.length > 0) fireEvent.click(screen.getByText('メニューから選ぶ'));
  fireEvent.click(await screen.findByText('カット'));
  for (const name of extraMenus) fireEvent.click(screen.getByText(name));
  fireEvent.click(screen.getByText('次へ（日時を選ぶ）'));
  const tomorrow = new Date(Date.now() + 9 * 3_600_000 + DAY);
  const label = `${tomorrow.getUTCMonth() + 1}/${tomorrow.getUTCDate()} 10:00 予約可`;
  fireEvent.click(await screen.findByRole('button', { name: label }));
  expect(screen.getByText(new RegExp(expected))).toBeInTheDocument();
  return tomorrow;
}

test('枠を選んでから「戻る」でメニューを足すと、旧い枠は外れて選び直しになる（回帰）', async () => {
  await pickTomorrowTen();
  fireEvent.click(screen.getByText('戻る'));
  fireEvent.click(await screen.findByText('カラー'));
  expect(await screen.findByText('メニューの変更で所要時間が変わったため、日時の選択を解除しました。日時を選び直してください')).toBeInTheDocument();
  fireEvent.click(screen.getByText('次へ（日時を選ぶ）'));
  // 120 分で取り直し、旧い 60 分の枠は選ばれていない（確認・予約へ進めない）。
  await waitFor(() => expect(slotRequests().some((u) => u.includes('duration=120'))).toBe(true));
  await screen.findAllByText('△');
  expect(screen.queryByText(/選択中：/)).not.toBeInTheDocument();
  expect(screen.queryByText('次へ（確認・予約）')).not.toBeInTheDocument();
});

test('クーポンで対象メニューが自動で足された場合も、旧い枠は外れる', async () => {
  const coupon = {
    id: 'c-1', facility_id: 'fac-1', name: 'カラー割', description: null, coupon_type: 'all',
    discount_type: 'fixed', discount_value: 500, special_price: null, valid_from: null, valid_until: null,
    is_active: true, sort_order: 0, created_at: '2026-01-01T00:00:00Z',
  } as Coupon;
  // カットとカラーが対象のクーポン。カットを選んだ状態で選ぶと、カラーが自動で足される。
  await pickTomorrowTen([CUT, COLOR], [coupon], { 'c-1': ['menu-cut', 'menu-color'] });
  fireEvent.click(screen.getByText('戻る'));
  fireEvent.click(screen.getByText('クーポン', { selector: 'button' }));
  fireEvent.click(await screen.findByText('カラー割'));
  expect(await screen.findByText('メニューの変更で所要時間が変わったため、日時の選択を解除しました。日時を選び直してください')).toBeInTheDocument();
});

test('メニューの合計が 480 分を超えても、空き枠 API と同じ丸めで比べるので枠を選べる', async () => {
  // 300 分 + 300 分 = 600 分。空き枠 API は 480 分（上限）の枠を返す。比べる側が丸めないと、
  // 選んだ枠がその場で外れ続けて予約できなくなる。
  await pickTomorrowTen([menu('menu-cut', 'カット', 300), menu('menu-color', 'カラー', 300)], [], undefined, ['カラー'], '10:00〜18:00');
  expect(screen.getByText('次へ（確認・予約）')).toBeInTheDocument();
  expect(slotRequests().some((u) => u.includes('duration=600'))).toBe(true);
});

test('開始時刻を過ぎた枠のまま「次へ（確認・予約）」を押すと、選び直しになる（回帰）', async () => {
  const tomorrow = await pickTomorrowTen();
  const before = slotRequests().length;
  // 画面を開いたまま翌日 10:05（JST）になった。
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse(`${tomorrow.toISOString().slice(0, 10)}T10:05:00+09:00`));
  fireEvent.click(screen.getByText('次へ（確認・予約）'));
  expect(await screen.findByText(BOOKING_SLOT_PASSED_MESSAGE)).toBeInTheDocument();
  expect(screen.queryByText('予約内容の確認・お客様情報')).not.toBeInTheDocument();
  expect(screen.queryByText(/選択中：/)).not.toBeInTheDocument();
  await waitFor(() => expect(slotRequests().length).toBeGreaterThan(before));
});

async function confirmTomorrowTen() {
  const tomorrow = await pickTomorrowTen();
  fireEvent.click(screen.getByText('次へ（確認・予約）'));
  await screen.findByText('予約内容の確認・お客様情報');
  fireEvent.change(screen.getByLabelText(/お名前/), { target: { value: '合成 太郎' } });
  fireEvent.change(screen.getByLabelText(/メールアドレス/), { target: { value: 'synthetic@example.invalid' } });
  return tomorrow;
}

test('確認画面に留まるうちに開始時刻を過ぎたら、送らずに日時の選択へ戻す（回帰）', async () => {
  const tomorrow = await confirmTomorrowTen();
  jest.spyOn(Date, 'now').mockReturnValue(Date.parse(`${tomorrow.toISOString().slice(0, 10)}T10:00:00+09:00`));
  fireEvent.click(screen.getByText('この内容で予約する'));
  expect(await screen.findByText(BOOKING_SLOT_PASSED_MESSAGE)).toBeInTheDocument();
  expect(screen.queryByText('予約内容の確認・お客様情報')).not.toBeInTheDocument();
  expect((global.fetch as jest.Mock).mock.calls.filter(([u]) => String(u) === '/api/booking')).toHaveLength(0);
});

test.each([
  ['開始時刻を過ぎた', BOOKING_SLOT_PASSED_MESSAGE],
  ['所要時間と合わない', BOOKING_DURATION_MISMATCH_MESSAGE],
])('サーバーが「%s」枠として断ったら、同じ枠を送り直させず日時の選択に戻して取り直す', async (_label, error) => {
  bookingResponse = (action, key) => {
    if (action === 'context') return { status: 200, body: { state: 'context_ready' } };
    if (action === 'status') return { status: 200, body: { state: 'missing', operationId: key } };
    if (action === 'prepare') return { status: 200, body: { state: 'prepared', operationId: key } };
    return { status: 409, body: { state: 'closed', operationId: key, error } };
  };
  await confirmTomorrowTen();
  const before = slotRequests().length;
  fireEvent.click(screen.getByText('この内容で予約する'));
  expect(await screen.findByText(error)).toBeInTheDocument();
  expect(createRequests()).toHaveLength(1);
  expect(screen.queryByText('予約内容の確認・お客様情報')).not.toBeInTheDocument();
  expect(screen.queryByText(/選択中：/)).not.toBeInTheDocument();
  await waitFor(() => expect(slotRequests().length).toBeGreaterThan(before));
});

test('それ以外の断り（満席など）は従来どおり確認画面のまま知らせる', async () => {
  bookingResponse = (action, key) => {
    if (action === 'context') return { status: 200, body: { state: 'context_ready' } };
    if (action === 'status') return { status: 200, body: { state: 'missing', operationId: key } };
    if (action === 'prepare') return { status: 200, body: { state: 'prepared', operationId: key } };
    return { status: 409, body: { state: 'closed', operationId: key, error: 'この時間帯は既に予約が入っています' } };
  };
  await confirmTomorrowTen();
  fireEvent.click(screen.getByText('この内容で予約する'));
  expect(await screen.findByText('この時間帯は既に予約が入っています')).toBeInTheDocument();
  expect(screen.getByText('予約内容の確認・お客様情報')).toBeInTheDocument();
  // 確認画面の「日時」の行に、選んだ枠が残っている。
  expect(within(screen.getByText('日時', { selector: 'span.text-gray-500' }).parentElement!).getByText(/10:00〜11:00/)).toBeInTheDocument();
});
