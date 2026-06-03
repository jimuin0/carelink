/**
 * @jest-environment node
 *
 * Tests for POST /api/payment/payjp/charge（PAY.JP 同期課金・Phase 1）
 */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/alert', () => ({ alertError: jest.fn(), alertWarning: jest.fn() }));
jest.mock('@/lib/rate-limit', () => ({ mutationRateLimit: null, checkRateLimit: jest.fn(() => Promise.resolve(false)) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ auth: { getUser: mockGetUser }, from: mockAnonFrom }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockAdminFrom }) }));

const mockChargeCreate = jest.fn();
const mockChargeRefund = jest.fn();
jest.mock('@/lib/payjp', () => ({ getPayjp: jest.fn(() => ({ charges: { create: mockChargeCreate, refund: mockChargeRefund } })) }));

import { POST } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getPayjp } from '@/lib/payjp';

const BOOKING_UUID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const TOKEN = 'tok_abc123XYZ';

function makeReq(body: unknown) {
  return new Request('http://localhost/api/payment/payjp/charge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify(body),
  }) as any;
}

function bookingChain(data: unknown, error: unknown = null) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data, error })) };
}
function adminUpdateChain(error: unknown = null) {
  return { update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error })) }) }) };
}

const BOOKING = { id: BOOKING_UUID, user_id: USER_ID, total_price: 5000, facility_id: FACILITY_UUID, payment_status: 'unpaid', menu: { name: 'カット', price: 4000 } };

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  (getPayjp as jest.Mock).mockReturnValue({ charges: { create: mockChargeCreate, refund: mockChargeRefund } });
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockAnonFrom.mockReturnValue(bookingChain(BOOKING));
  mockAdminFrom.mockReturnValue(adminUpdateChain(null));
  mockChargeCreate.mockResolvedValue({ id: 'ch_1', paid: true, captured: true, amount: 5000 });
  mockChargeRefund.mockResolvedValue({ id: 'rf_1', refunded: true });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://t.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});

test('CSRF → 403', async () => {
  (checkCsrf as jest.Mock).mockReturnValue(new Response('{}', { status: 403 }));
  expect((await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }))).status).toBe(403);
});

test('PAY.JP 未設定 → 503', async () => {
  (getPayjp as jest.Mock).mockReturnValue(null);
  expect((await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }))).status).toBe(503);
});

test('レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockResolvedValue(true);
  expect((await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }))).status).toBe(429);
});

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  expect((await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }))).status).toBe(401);
});

test('bookingId 不正 → 400', async () => {
  expect((await POST(makeReq({ bookingId: 'bad', token: TOKEN }))).status).toBe(400);
});

test('token 不正(形式) → 400', async () => {
  expect((await POST(makeReq({ bookingId: BOOKING_UUID, token: 'xxx' }))).status).toBe(400);
});

test('token 不正(非文字列) → 400', async () => {
  expect((await POST(makeReq({ bookingId: BOOKING_UUID, token: 123 }))).status).toBe(400);
});

test('予約が見つからない → 404', async () => {
  mockAnonFrom.mockReturnValue(bookingChain(null, { message: 'no' }));
  expect((await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }))).status).toBe(404);
});

test('他人の予約 → 403', async () => {
  mockAnonFrom.mockReturnValue(bookingChain({ ...BOOKING, user_id: 'other' }));
  expect((await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }))).status).toBe(403);
});

test('支払い済み → 400', async () => {
  mockAnonFrom.mockReturnValue(bookingChain({ ...BOOKING, payment_status: 'paid' }));
  expect((await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }))).status).toBe(400);
});

test('金額決定不可(total_price/menu とも無し) → 400', async () => {
  mockAnonFrom.mockReturnValue(bookingChain({ ...BOOKING, total_price: null, menu: null }));
  expect((await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }))).status).toBe(400);
});

test('menu が配列でも価格決定できる（total_price null → menu[0].price）', async () => {
  mockAnonFrom.mockReturnValue(bookingChain({ ...BOOKING, total_price: null, menu: [{ name: 'カット', price: 4000 }] }));
  const res = await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }));
  expect(res.status).toBe(200);
  expect(mockChargeCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 4000, currency: 'jpy', card: TOKEN }));
});

test('課金成功 → 200・payment_status=paid に更新', async () => {
  const res = await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.success).toBe(true);
  expect(json.chargeId).toBe('ch_1');
});

test('カード拒否(charges.create throw) → 402・failed 記録', async () => {
  mockChargeCreate.mockRejectedValue(new Error('card_declined'));
  const res = await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }));
  expect(res.status).toBe(402);
});

test('charges.create が非Error を throw → 402（String 化経路）', async () => {
  mockChargeCreate.mockRejectedValue('plain_string_error');
  const res = await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }));
  expect(res.status).toBe(402);
});

test('x-forwarded-for ヘッダ無し → ip="unknown" で処理継続（200）', async () => {
  const req = new Request('http://localhost/api/payment/payjp/charge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId: BOOKING_UUID, token: TOKEN }),
  }) as any;
  expect((await POST(req)).status).toBe(200);
});

test('charge.paid=false → 402', async () => {
  mockChargeCreate.mockResolvedValue({ id: 'ch_2', paid: false, captured: false, amount: 5000 });
  expect((await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }))).status).toBe(402);
});

test('課金成立後の予約更新が全リトライ失敗 → 自動返金して 500（返金成功・chargeId返さない）', async () => {
  mockAdminFrom.mockReturnValue(adminUpdateChain({ message: 'db error' }));
  const res = await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }));
  const json = await res.json();
  expect(res.status).toBe(500);
  expect(mockChargeRefund).toHaveBeenCalledWith('ch_1');
  expect(json.chargeId).toBeUndefined();
});

test('予約更新失敗かつ返金も失敗 → 500（chargeId 返却・手動 reconcile）', async () => {
  mockAdminFrom.mockReturnValue(adminUpdateChain({ message: 'db error' }));
  mockChargeRefund.mockRejectedValue(new Error('refund api down'));
  const res = await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }));
  const json = await res.json();
  expect(res.status).toBe(500);
  expect(json.chargeId).toBe('ch_1');
});

test('予約更新失敗かつ返金が非Errorをthrow → String フォールバックで 500', async () => {
  mockAdminFrom.mockReturnValue(adminUpdateChain({ message: 'db error' }));
  mockChargeRefund.mockRejectedValue('refund-string-err');
  const res = await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }));
  expect(res.status).toBe(500);
  const json = await res.json();
  expect(json.chargeId).toBe('ch_1');
});

test('予約更新は1回目失敗・2回目成功 → 200（リトライで整合確定）', async () => {
  let call = 0;
  mockAdminFrom.mockReturnValue({
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn(() => {
          call++;
          return Promise.resolve({ error: call === 1 ? { message: 'transient' } : null });
        }),
      }),
    }),
  });
  const res = await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }));
  expect(res.status).toBe(200);
  expect(mockChargeRefund).not.toHaveBeenCalled();
});

test('予期せぬ例外（getUser が reject）→ 外側catchで 500', async () => {
  mockGetUser.mockRejectedValue(new Error('auth boom'));
  const res = await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }));
  expect(res.status).toBe(500);
  const json = await res.json();
  expect(json.error).toBe('決済処理に失敗しました');
});

test('token が長すぎる(>100) → 400', async () => {
  const longToken = 'tok_' + 'a'.repeat(200);
  expect((await POST(makeReq({ bookingId: BOOKING_UUID, token: longToken }))).status).toBe(400);
});

test('メニュー名が空でも課金できる（description フォールバック）', async () => {
  mockAnonFrom.mockReturnValue(bookingChain({ ...BOOKING, total_price: 5000, menu: { name: '', price: 0 } }));
  const res = await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }));
  expect(res.status).toBe(200);
  expect(mockChargeCreate).toHaveBeenCalledWith(expect.objectContaining({ description: '施術予約' }));
});

test('menu が null でも total_price で課金（description フォールバック）', async () => {
  mockAnonFrom.mockReturnValue(bookingChain({ ...BOOKING, total_price: 5000, menu: null }));
  const res = await POST(makeReq({ bookingId: BOOKING_UUID, token: TOKEN }));
  expect(res.status).toBe(200);
  expect(mockChargeCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 5000, description: '施術予約' }));
});

test('JSON パース失敗 → 400（bookingId 欠落）', async () => {
  const req = new Request('http://localhost/api/payment/payjp/charge', { method: 'POST', headers: { 'x-forwarded-for': '1.2.3.4' }, body: 'not json' }) as any;
  expect((await POST(req)).status).toBe(400);
});
