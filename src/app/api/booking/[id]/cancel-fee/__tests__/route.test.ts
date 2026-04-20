/**
 * @jest-environment node
 *
 * Tests for POST /api/booking/[id]/cancel-fee
 * Key assertion: if stripe_sessions INSERT fails, the Stripe session must be
 * expired immediately to prevent orphaned charges.
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const BOOKING_UUID = '11111111-1111-1111-1111-111111111111';
const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockFrom }),
}));

const mockStripeCreate = jest.fn();
const mockStripeExpire = jest.fn();
jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    checkout: { sessions: { create: mockStripeCreate, expire: mockStripeExpire } },
  }))
);

import { POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

const STRIPE_SESSION = { id: 'cs_test_cancel', url: 'https://checkout.stripe.com/cancel123' };

function makeRequest() {
  return new Request('http://localhost/api/booking/1/cancel-fee', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

function makeProps(id = BOOKING_UUID) {
  return { params: Promise.resolve({ id }) };
}

function singleChain(data: unknown, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error })),
  };
}

// Future date (+5 days) → no cancellation fee (daysUntil > 3 and no 3-day policy)
const FUTURE_BOOKING = {
  id: BOOKING_UUID,
  user_id: USER_ID,
  facility_id: FACILITY_UUID,
  booking_date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  total_price: 10000,
  status: 'cancelled',
  menu_name: 'テストメニュー',
};

// Past date (no-show scenario) → 100% fee
const PAST_BOOKING = {
  ...FUTURE_BOOKING,
  booking_date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
};

const POLICY = {
  no_show_fee_percent: 100,
  same_day_fee_percent: 50,
  one_day_fee_percent: 30,
  three_day_fee_percent: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://carelink-jp.com';
  mockStripeCreate.mockResolvedValue(STRIPE_SESSION);
  mockStripeExpire.mockResolvedValue({});
});

// ─── Security guards ──────────────────────────────────────────────────────────

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(401);
});

test('レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(429);
});

test('不正なUUID → 400', async () => {
  const res = await POST(makeRequest(), makeProps('not-uuid'));
  expect(res.status).toBe(400);
});

test('予約が見つからない → 404', async () => {
  mockFrom.mockReturnValue(singleChain(null));
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(404);
});

test('別ユーザーの予約 → 403 (IDOR防止)', async () => {
  mockFrom.mockReturnValue(singleChain({ ...PAST_BOOKING, user_id: 'other-user' }));
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(403);
});

test('キャンセル済み以外のステータス → 400', async () => {
  mockFrom.mockReturnValue(singleChain({ ...PAST_BOOKING, status: 'confirmed' }));
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(400);
});

// ─── Fee calculation ──────────────────────────────────────────────────────────

test('キャンセル料不要（3日以上前）→ 200 fee:0', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(FUTURE_BOOKING);
    // policy: three_day_fee_percent = 0
    return singleChain({ ...POLICY, three_day_fee_percent: 0 });
  });
  const res = await POST(makeRequest(), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.fee).toBe(0);
});

// ─── Happy path (past booking → no-show 100%) ────────────────────────────────

test('正常フロー (no-show 100%) → 200 with Stripe URL', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(PAST_BOOKING);
    if (callNum === 2) return singleChain(POLICY);
    if (callNum === 3) return singleChain({ name: 'テスト施設', slug: 'test', stripe_enabled: true });
    // stripe_sessions insert
    return { insert: jest.fn(() => Promise.resolve({ error: null })) };
  });

  const res = await POST(makeRequest(), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.url).toBe(STRIPE_SESSION.url);
  expect(json.fee_percent).toBe(100);
});

// ─── Critical: orphaned Stripe session prevention ─────────────────────────────

test('stripe_sessions INSERT失敗 → Stripeセッション即時失効 + 500', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(PAST_BOOKING);
    if (callNum === 2) return singleChain(POLICY);
    if (callNum === 3) return singleChain({ name: 'テスト施設', slug: 'test', stripe_enabled: true });
    return { insert: jest.fn(() => Promise.resolve({ error: { message: 'DB write failed' } })) };
  });

  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(500);
  expect(mockStripeExpire).toHaveBeenCalledWith(STRIPE_SESSION.id);
});

test('Stripe失効がthrowしても500を返す（データなし状態は変わらない）', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(PAST_BOOKING);
    if (callNum === 2) return singleChain(POLICY);
    if (callNum === 3) return singleChain({ name: 'テスト施設', slug: 'test', stripe_enabled: true });
    return { insert: jest.fn(() => Promise.resolve({ error: { message: 'DB error' } })) };
  });
  mockStripeExpire.mockRejectedValue(new Error('Stripe API unavailable'));

  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(500);
});

test('Stripe非対応施設 → 400', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(PAST_BOOKING);
    if (callNum === 2) return singleChain(POLICY);
    return singleChain({ name: 'テスト施設', slug: 'test', stripe_enabled: false });
  });
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(400);
});
