/**
 * @jest-environment node
 *
 * Tests for POST /api/stripe/checkout
 * Key assertion: if stripe_sessions INSERT fails, the Stripe session must be expired
 * immediately to prevent orphaned charges (customer charged, no DB record).
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const VALID_UUID = '11111111-1111-1111-1111-111111111111';
const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

// ─── Supabase mock ────────────────────────────────────────────────────────────
const mockFrom = jest.fn();
const mockGetUser = jest.fn();
const mockGetUserById = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    from: mockFrom,
    auth: { getUser: mockGetUser },
  }),
}));

jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({
    from: mockFrom,
    auth: { admin: { getUserById: mockGetUserById } },
  }),
}));

// ─── Stripe mock ──────────────────────────────────────────────────────────────
const mockStripeSessionCreate = jest.fn();
const mockStripeSessionExpire = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: mockStripeSessionCreate,
        expire: mockStripeSessionExpire,
      },
    },
  }))
);

import { POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

const STRIPE_SESSION = { id: 'cs_test_abc123', url: 'https://checkout.stripe.com/abc123' };

function makeRequest(body: object) {
  return new Request('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Returns a mock chain that resolves to { data, error: null } on .single()
function singleChain(data: unknown) {
  const chain = { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data, error: null })) };
  return chain;
}

function insertChain(error: unknown = null) {
  return { insert: jest.fn(() => Promise.resolve({ error })) };
}

function setupHappyPath(insertError: unknown = null) {
  let callNum = 0;
  mockFrom.mockImplementation((table: string) => {
    callNum++;
    if (table === 'facility_profiles' && callNum === 1) {
      return singleChain({ id: FACILITY_UUID, name: 'テスト施設', slug: 'test', stripe_enabled: true, stripe_account_id: null });
    }
    if (table === 'bookings') {
      return singleChain({ total_price: 5000, user_id: USER_ID });
    }
    if (table === 'stripe_sessions') {
      return insertChain(insertError);
    }
    return singleChain(null);
  });
  mockGetUserById.mockResolvedValue({ data: { user: { email: 'user@example.com' } } });
  mockStripeSessionCreate.mockResolvedValue(STRIPE_SESSION);
  mockStripeSessionExpire.mockResolvedValue({});
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.NEXT_PUBLIC_SITE_URL = 'https://carelink-jp.com';
});

// ─── Security guards ──────────────────────────────────────────────────────────

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest({ facility_id: FACILITY_UUID }));
  expect(res.status).toBe(401);
});

test('レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest({ facility_id: FACILITY_UUID }));
  expect(res.status).toBe(429);
});

test('CSRFエラー → csrfErrorを返す', async () => {
  (checkCsrf as jest.Mock).mockReturnValue(new Response(JSON.stringify({ error: 'csrf' }), { status: 403 }));
  const res = await POST(makeRequest({ facility_id: FACILITY_UUID }));
  expect(res.status).toBe(403);
});

test('不正なfacility_id形式 → 400', async () => {
  const res = await POST(makeRequest({ facility_id: 'not-a-uuid' }));
  expect(res.status).toBe(400);
});

test('不正なbooking_id形式 → 400', async () => {
  const res = await POST(makeRequest({ facility_id: FACILITY_UUID, booking_id: 'invalid' }));
  expect(res.status).toBe(400);
});

test('不正なpayment_type → 400', async () => {
  const res = await POST(makeRequest({ facility_id: FACILITY_UUID, payment_type: 'hack' }));
  expect(res.status).toBe(400);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test('正常フロー → 200 with Stripe URL', async () => {
  setupHappyPath();
  const res = await POST(makeRequest({ facility_id: FACILITY_UUID, booking_id: VALID_UUID }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.url).toBe(STRIPE_SESSION.url);
  expect(json.session_id).toBe(STRIPE_SESSION.id);
});

// ─── Critical: orphaned Stripe session prevention ─────────────────────────────

test('stripe_sessions INSERT失敗 → Stripeセッション即時失効 + 500', async () => {
  setupHappyPath({ message: 'DB write failed' });

  const res = await POST(makeRequest({ facility_id: FACILITY_UUID, booking_id: VALID_UUID }));
  expect(res.status).toBe(500);
  // Stripe session must be expired immediately to prevent orphaned charge
  expect(mockStripeSessionExpire).toHaveBeenCalledWith(STRIPE_SESSION.id);
});

test('stripe_sessions INSERT失敗時 — Stripeセッションを確実に失効させる（expire失敗は無視）', async () => {
  setupHappyPath({ message: 'DB write failed' });
  mockStripeSessionExpire.mockRejectedValue(new Error('Stripe API down'));

  const res = await POST(makeRequest({ facility_id: FACILITY_UUID, booking_id: VALID_UUID }));
  // Still returns 500 even if expire call itself throws
  expect(res.status).toBe(500);
});

// ─── Other DB failure paths ───────────────────────────────────────────────────

test('施設が見つからない → 404', async () => {
  mockFrom.mockImplementation(() => singleChain(null));
  const res = await POST(makeRequest({ facility_id: FACILITY_UUID }));
  expect(res.status).toBe(404);
});

test('Stripeが無効な施設 → 400', async () => {
  mockFrom.mockImplementation(() => singleChain({ id: FACILITY_UUID, name: 'テスト', slug: 'test', stripe_enabled: false, stripe_account_id: null }));
  const res = await POST(makeRequest({ facility_id: FACILITY_UUID }));
  expect(res.status).toBe(400);
});

test('booking_idが別ユーザーの予約 → 403 (IDOR防止)', async () => {
  let callNum = 0;
  mockFrom.mockImplementation((table: string) => {
    callNum++;
    if (table === 'facility_profiles') return singleChain({ id: FACILITY_UUID, name: 'テスト', slug: 'test', stripe_enabled: true, stripe_account_id: null });
    if (table === 'bookings') return singleChain({ total_price: 5000, user_id: 'other-user-id' });
    return singleChain(null);
  });
  mockGetUserById.mockResolvedValue({ data: { user: { email: 'user@example.com' } } });
  const res = await POST(makeRequest({ facility_id: FACILITY_UUID, booking_id: VALID_UUID }));
  expect(res.status).toBe(403);
});
