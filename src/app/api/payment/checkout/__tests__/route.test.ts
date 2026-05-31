/**
 * @jest-environment node
 *
 * Tests for POST /api/payment/checkout
 * Key assertions:
 *   - Amount is determined server-side from DB, never from client
 *   - Already-paid booking → 400 (prevents double charge)
 *   - Other user's booking → 403 (IDOR prevention)
 *   - Stripe not configured → 503
 */

jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: {},
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: jest.fn() }),
}));

const BOOKING_UUID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockFrom = jest.fn();
const mockGetUser = jest.fn();
const mockServiceInsert = jest.fn(() => Promise.resolve({ error: null }));

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: jest.fn(() => ({ insert: mockServiceInsert })),
  })),
  createServerSupabaseClient: jest.fn(),
  createServerSupabaseAuthClient: jest.fn(),
}));

const mockStripeCreate = jest.fn();
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: mockStripeCreate } },
  }))
);

import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

const BOOKING_ROW = {
  id: BOOKING_UUID,
  user_id: USER_ID,
  total_price: 8000,
  menu_id: null,
  facility_id: '22222222-2222-2222-2222-222222222222',
  payment_status: 'pending',
  facility: { name: 'テスト施設' },
  menu: { name: 'テストメニュー', price: 8000 },
};

function makeRequest(body: object = { bookingId: BOOKING_UUID }) {
  return new Request('http://localhost/api/payment/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as import('next/server').NextRequest;
}

function singleChain(data: unknown, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockStripeCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/test', id: 'cs_test' });
  mockServiceInsert.mockImplementation(() => Promise.resolve({ error: null }));
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
});

// ─── Basic guards ─────────────────────────────────────────────────────────────

test('Stripe未設定 → 503', async () => {
  delete process.env.STRIPE_SECRET_KEY;
  const res = await POST(makeRequest());
  expect(res.status).toBe(503);
});

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest());
  expect(res.status).toBe(401);
});

test('レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockResolvedValue(true);
  const res = await POST(makeRequest());
  expect(res.status).toBe(429);
});

test('bookingId なし → 400', async () => {
  const res = await POST(makeRequest({}));
  expect(res.status).toBe(400);
});

test('不正なUUID → 400', async () => {
  const res = await POST(makeRequest({ bookingId: 'not-uuid' }));
  expect(res.status).toBe(400);
});

test('予約が見つからない → 404', async () => {
  mockFrom.mockReturnValue(singleChain(null, { code: 'PGRST116' }));
  const res = await POST(makeRequest());
  expect(res.status).toBe(404);
});

// ─── IDOR prevention ──────────────────────────────────────────────────────────

test('他ユーザーの予約 → 403', async () => {
  mockFrom.mockReturnValue(singleChain({ ...BOOKING_ROW, user_id: 'other-user' }));
  const res = await POST(makeRequest());
  expect(res.status).toBe(403);
});

// ─── Business logic guards ────────────────────────────────────────────────────

test('支払い済み予約 → 400 (二重請求防止)', async () => {
  mockFrom.mockReturnValue(singleChain({ ...BOOKING_ROW, payment_status: 'paid' }));
  const res = await POST(makeRequest());
  expect(res.status).toBe(400);
});

test('金額 0 → 400', async () => {
  mockFrom.mockReturnValue(singleChain({ ...BOOKING_ROW, total_price: 0, menu: null }));
  const res = await POST(makeRequest());
  expect(res.status).toBe(400);
});

// ─── Amount is from DB, not client ───────────────────────────────────────────

test('Stripeセッション作成時の金額はDBのtotal_priceから（クライアント値は使わない）', async () => {
  mockFrom.mockReturnValue(singleChain(BOOKING_ROW));

  await POST(makeRequest({ bookingId: BOOKING_UUID, amount: 1 })); // client sends amount: 1

  const createCall = mockStripeCreate.mock.calls[0][0];
  // Must use DB amount (8000), not client-provided amount (1)
  expect(createCall.line_items[0].price_data.unit_amount).toBe(8000);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test('正常フロー → 200 with Stripe URL', async () => {
  mockFrom.mockReturnValue(singleChain(BOOKING_ROW));

  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.url).toContain('checkout.stripe.com');
});

// ─── Additional coverage ──────────────────────────────────────────────────────

test('CSRF エラー → 403', async () => {
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makeRequest());
  expect(res.status).toBe(403);
});

test('rate limit params (5/60s)', async () => {
  mockFrom.mockReturnValue(singleChain(BOOKING_ROW));
  (checkRateLimit as jest.Mock).mockClear();
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  await POST(makeRequest());
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(5);
  expect(call[3]).toBe(60_000);
});

test('Stripe API エラー → 500', async () => {
  mockFrom.mockReturnValue(singleChain(BOOKING_ROW));
  mockStripeCreate.mockRejectedValue(new Error('Stripe error'));
  const res = await POST(makeRequest());
  expect(res.status).toBe(500);
});

test('レスポンスが { url } 形式', async () => {
  mockFrom.mockReturnValue(singleChain(BOOKING_ROW));
  const res = await POST(makeRequest());
  const json = await res.json();
  expect(json.url).toBeDefined();
});

test('x-forwarded-for なし → unknown IP', async () => {
  (checkRateLimit as jest.Mock).mockClear();
  mockFrom.mockReturnValue(singleChain(BOOKING_ROW));
  await POST(makeRequest());
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBe('unknown');
});

test('不正JSON ボディ → 400 (bookingId なし扱い)', async () => {
  mockFrom.mockReturnValue(singleChain(BOOKING_ROW));
  const req = new Request('http://localhost/api/payment/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  }) as unknown as import('next/server').NextRequest;
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('menu/facility が配列 → 配列の先頭を使う', async () => {
  const arrayRow = {
    ...BOOKING_ROW,
    total_price: null,
    menu: [{ name: 'メニューA', price: 5000 }],
    facility: [{ name: '施設A' }],
  };
  mockFrom.mockReturnValue(singleChain(arrayRow));
  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
  // serverAmount は menu[0].price 経由
  const call = mockStripeCreate.mock.calls[0][0];
  expect(call.line_items[0].price_data.unit_amount).toBe(5000);
});

test('total_price null かつ menu.price あり → menu.price 採用', async () => {
  const row = { ...BOOKING_ROW, total_price: null };
  mockFrom.mockReturnValue(singleChain(row));
  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
  const call = mockStripeCreate.mock.calls[0][0];
  expect(call.line_items[0].price_data.unit_amount).toBe(8000);
});

test('menu / facility が null → デフォルト名で続行', async () => {
  const row = { ...BOOKING_ROW, total_price: 3000, menu: null, facility: null };
  mockFrom.mockReturnValue(singleChain(row));
  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
  const call = mockStripeCreate.mock.calls[0][0];
  expect(call.line_items[0].price_data.product_data.name).toBe('施術予約');
  expect(call.line_items[0].price_data.product_data.description).toBe('CareLink予約');
});

test('stripe_sessions insert 失敗 → Stripe session を expire して 500', async () => {
  mockFrom.mockReturnValue(singleChain(BOOKING_ROW));
  mockServiceInsert.mockImplementationOnce(() => Promise.resolve({ error: { message: 'session insert err' } }));
  const expireMock = jest.fn().mockResolvedValue(undefined);
  mockStripeCreate.mockResolvedValue({ url: 'https://checkout.stripe.com/test', id: 'cs_test_failed' });
  // 既存 Stripe mock を再構成して expire を生やす
  const Stripe = require('stripe');
  Stripe.mockImplementation(() => ({
    checkout: {
      sessions: { create: mockStripeCreate, expire: expireMock },
    },
  }));
  const res = await POST(makeRequest());
  expect(res.status).toBe(500);
  expect(expireMock).toHaveBeenCalledWith('cs_test_failed');
});

// Branch coverage: line 69 — total_price が null かつ menu?.price も undefined → ?? 0 にフォールバック（全 ?? false 分岐）
test('total_price null・menu.price undefined → 0 にフォールバック → 400（line 69 全 ?? false 分岐）', async () => {
  const row = { ...BOOKING_ROW, total_price: null, menu: { name: 'プライスなし' } };
  mockFrom.mockReturnValue(singleChain(row));
  const res = await POST(makeRequest());
  // serverAmount=0 → "金額を決定できませんでした" → 400
  expect(res.status).toBe(400);
});
