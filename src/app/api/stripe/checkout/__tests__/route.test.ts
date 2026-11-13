/**
 * @jest-environment node
 *
 * Tests for POST /api/stripe/checkout
 * Key assertion: if stripe_sessions INSERT fails, the Stripe session must be expired
 * immediately to prevent orphaned charges (customer charged, no DB record).
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
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
import { checkRateLimit } from '@/lib/rate-limit';
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

let mockStaleRows: { data: unknown; error: unknown } = { data: [], error: null };
let mockStaleUpdateError: unknown = null;
const mockStaleUpdate = jest.fn();
function insertChain(error: unknown = null) {
  const selectChain: any = { eq: jest.fn(() => selectChain), then: (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => Promise.resolve(mockStaleRows).then(r, j) };
  const updateChain: any = { eq: jest.fn(() => updateChain), then: (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => Promise.resolve({ error: mockStaleUpdateError }).then(r, j) };
  return {
    insert: jest.fn(() => Promise.resolve({ error })),
    select: jest.fn(() => selectChain),
    update: jest.fn((v: unknown) => { mockStaleUpdate(v); return updateChain; }),
  };
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
  mockStaleRows = { data: [], error: null };
  mockStaleUpdateError = null;
  (checkRateLimit as jest.Mock).mockReturnValue(false);
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
  (checkRateLimit as jest.Mock).mockReturnValue(true);
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
  mockFrom.mockImplementation((table: string) => {
    if (table === 'facility_profiles') return singleChain({ id: FACILITY_UUID, name: 'テスト', slug: 'test', stripe_enabled: true, stripe_account_id: null });
    if (table === 'bookings') return singleChain({ total_price: 5000, user_id: 'other-user-id' });
    return singleChain(null);
  });
  mockGetUserById.mockResolvedValue({ data: { user: { email: 'user@example.com' } } });
  const res = await POST(makeRequest({ facility_id: FACILITY_UUID, booking_id: VALID_UUID }));
  expect(res.status).toBe(403);
});

// ─── Deposit flow (no booking_id) ─────────────────────────────────────────────

test('booking_idなし（デポジットフロー）→ 200', async () => {
  let callNum = 0;
  mockFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain({ id: FACILITY_UUID, name: 'テスト施設', slug: 'test', stripe_enabled: true, stripe_account_id: null });
    if (callNum === 2) return singleChain({ deposit_type: 'fixed', deposit_amount: 3000 }); // facility deposit
    if (table === 'stripe_sessions') return insertChain(null);
    return singleChain(null);
  });
  mockGetUserById.mockResolvedValue({ data: { user: { email: 'user@example.com' } } });
  mockStripeSessionCreate.mockResolvedValue(STRIPE_SESSION);
  mockStripeSessionExpire.mockResolvedValue({});

  const res = await POST(makeRequest({ facility_id: FACILITY_UUID }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.url).toBe(STRIPE_SESSION.url);
});

test('デポジット金額なし（deposit_amount=null, deposit_type=fixed）→ 400', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ id: FACILITY_UUID, name: 'テスト施設', slug: 'test', stripe_enabled: true, stripe_account_id: null });
    return singleChain({ deposit_type: 'fixed', deposit_amount: null }); // no deposit amount
  });
  mockGetUserById.mockResolvedValue({ data: { user: { email: null } } });
  const res = await POST(makeRequest({ facility_id: FACILITY_UUID }));
  expect(res.status).toBe(400);
});

test('booking_idなし + deposit_type=none → 400（未設定デポジットを誤課金しない）', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ id: FACILITY_UUID, name: 'テスト施設', slug: 'test', stripe_enabled: true, stripe_account_id: null });
    return singleChain({ deposit_type: 'none', deposit_amount: 3000 }); // 残存 deposit_amount があっても none なら課金しない
  });
  mockGetUserById.mockResolvedValue({ data: { user: { email: null } } });
  const res = await POST(makeRequest({ facility_id: FACILITY_UUID }));
  expect(res.status).toBe(400);
});

test('booking_idなし + deposit_type未設定（レガシー・列未移行）→ none 扱いで 400', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ id: FACILITY_UUID, name: 'テスト施設', slug: 'test', stripe_enabled: true, stripe_account_id: null });
    return singleChain({ deposit_amount: 3000 }); // deposit_type が無い（undefined）
  });
  mockGetUserById.mockResolvedValue({ data: { user: { email: null } } });
  const res = await POST(makeRequest({ facility_id: FACILITY_UUID }));
  expect(res.status).toBe(400);
});

test('booking_idなし + deposit_type=percent → 400（割合の基準となる予約が無く算出不能）', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ id: FACILITY_UUID, name: 'テスト施設', slug: 'test', stripe_enabled: true, stripe_account_id: null });
    return singleChain({ deposit_type: 'percent', deposit_amount: 20 });
  });
  mockGetUserById.mockResolvedValue({ data: { user: { email: null } } });
  const res = await POST(makeRequest({ facility_id: FACILITY_UUID }));
  expect(res.status).toBe(400);
});

test('booking total_priceがnull → amount=0 → 400', async () => {
  let callNum = 0;
  mockFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain({ id: FACILITY_UUID, name: 'テスト', slug: 'test', stripe_enabled: true, stripe_account_id: null });
    if (table === 'bookings') return singleChain({ total_price: null, user_id: USER_ID });
    return singleChain(null);
  });
  const res = await POST(makeRequest({ facility_id: FACILITY_UUID, booking_id: VALID_UUID }));
  expect(res.status).toBe(400);
});

test('booking_idなし + booking not found → 404', async () => {
  let callNum = 0;
  mockFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain({ id: FACILITY_UUID, name: 'テスト', slug: 'test', stripe_enabled: true, stripe_account_id: null });
    if (table === 'bookings') return singleChain(null); // booking not found
    return singleChain(null);
  });
  const res = await POST(makeRequest({ facility_id: FACILITY_UUID, booking_id: VALID_UUID }));
  expect(res.status).toBe(404);
});

test('stripe_account_id設定あり（Connect）→ 200 with platform fee', async () => {
  let callNum = 0;
  mockFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain({ id: FACILITY_UUID, name: 'テスト施設', slug: 'test', stripe_enabled: true, stripe_account_id: 'acct_test_connect' });
    if (table === 'bookings') return singleChain({ total_price: 10000, user_id: USER_ID });
    if (table === 'stripe_sessions') return insertChain(null);
    return singleChain(null);
  });
  mockGetUserById.mockResolvedValue({ data: { user: { email: null } } });
  mockStripeSessionCreate.mockResolvedValue(STRIPE_SESSION);
  mockStripeSessionExpire.mockResolvedValue({});

  const res = await POST(makeRequest({ facility_id: FACILITY_UUID, booking_id: VALID_UUID }));
  expect(res.status).toBe(200);
  // Verify platform fee was set
  const createCall = mockStripeSessionCreate.mock.calls[0][0];
  expect(createCall.payment_intent_data?.application_fee_amount).toBe(500); // 5% of 10000
});

test('payment_type=deposit → セッション名にデポジット', async () => {
  let callNum = 0;
  mockFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain({ id: FACILITY_UUID, name: 'テスト施設', slug: 'test', stripe_enabled: true, stripe_account_id: null });
    if (callNum === 2) return singleChain({ deposit_type: 'fixed', deposit_amount: 5000 });
    if (table === 'stripe_sessions') return insertChain(null);
    return singleChain(null);
  });
  mockGetUserById.mockResolvedValue({ data: { user: { email: 'u@u.com' } } });
  mockStripeSessionCreate.mockResolvedValue(STRIPE_SESSION);
  mockStripeSessionExpire.mockResolvedValue({});

  const res = await POST(makeRequest({ facility_id: FACILITY_UUID, payment_type: 'deposit' }));
  expect(res.status).toBe(200);
  const createCall = mockStripeSessionCreate.mock.calls[0][0];
  expect(createCall.line_items[0].price_data.product_data.name).toContain('デポジット');
});

test('x-forwarded-for なし → unknown IP', async () => {
  (checkRateLimit as jest.Mock).mockClear();
  let callNum = 0;
  mockFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain({ id: FACILITY_UUID, name: 'テスト', slug: 'test', stripe_enabled: true, stripe_account_id: null });
    if (callNum === 2) return singleChain({ deposit_type: 'fixed', deposit_amount: 3000 });
    if (table === 'stripe_sessions') return insertChain(null);
    return singleChain(null);
  });
  mockGetUserById.mockResolvedValue({ data: { user: { email: 'u@u.com' } } });
  mockStripeSessionCreate.mockResolvedValue(STRIPE_SESSION);
  const req = new Request('http://localhost/api/stripe/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ facility_id: FACILITY_UUID }),
  });
  Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
  await POST(req as any);
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBe('unknown');
});

test('booking_idなし → product description undefined, success_url が /mypage/bookings 直下', async () => {
  let callNum = 0;
  mockFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain({ id: FACILITY_UUID, name: 'テスト施設', slug: 'test-slug', stripe_enabled: true, stripe_account_id: null });
    if (callNum === 2) return singleChain({ deposit_type: 'fixed', deposit_amount: 5000 });
    if (table === 'stripe_sessions') return insertChain(null);
    return singleChain(null);
  });
  mockGetUserById.mockResolvedValue({ data: { user: { email: 'u@u.com' } } });
  mockStripeSessionCreate.mockResolvedValue(STRIPE_SESSION);

  const res = await POST(makeRequest({ facility_id: FACILITY_UUID }));
  expect(res.status).toBe(200);
  const createCall = mockStripeSessionCreate.mock.calls[0][0];
  expect(createCall.line_items[0].price_data.product_data.description).toBeUndefined();
  expect(createCall.success_url).toContain('/mypage/bookings?payment=success');
  expect(createCall.metadata.booking_id).toBe('');
});

test('booking_id 指定 → product description にbooking_id前方8文字, success_url にIDを含む', async () => {
  let callNum = 0;
  mockFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain({ id: FACILITY_UUID, name: 'テスト施設', slug: 'test-slug', stripe_enabled: true, stripe_account_id: null });
    if (table === 'bookings') return singleChain({ total_price: 8000, user_id: USER_ID });
    if (table === 'stripe_sessions') return insertChain(null);
    return singleChain(null);
  });
  mockGetUserById.mockResolvedValue({ data: { user: { email: 'u@u.com' } } });
  mockStripeSessionCreate.mockResolvedValue(STRIPE_SESSION);

  const res = await POST(makeRequest({ facility_id: FACILITY_UUID, booking_id: VALID_UUID }));
  expect(res.status).toBe(200);
  const createCall = mockStripeSessionCreate.mock.calls[0][0];
  expect(createCall.line_items[0].price_data.product_data.description).toContain('予約ID:');
  expect(createCall.success_url).toContain(`/mypage/bookings/${VALID_UUID}`);
});

// Branch coverage: line 106 — payment_type !== 'deposit' のとき '予約料金' を使用（false 分岐）
// payment_type='full' は有効値（'deposit'/'full'）なので 'deposit' 以外のブランチをカバーする
test('payment_type=full → 商品名に「予約料金」が含まれる（line 106 false 分岐）', async () => {
  let callNum = 0;
  mockFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain({ id: FACILITY_UUID, name: 'テスト施設', slug: 'test-slug', stripe_enabled: true, stripe_account_id: null });
    if (table === 'bookings') return singleChain({ total_price: 5000, user_id: USER_ID });
    if (table === 'stripe_sessions') return insertChain(null);
    return singleChain(null);
  });
  mockGetUserById.mockResolvedValue({ data: { user: { email: 'u@u.com' } } });
  mockStripeSessionCreate.mockResolvedValue(STRIPE_SESSION);

  const res = await POST(makeRequest({ facility_id: FACILITY_UUID, booking_id: VALID_UUID, payment_type: 'full' }));
  expect(res.status).toBe(200);
  const createCall = mockStripeSessionCreate.mock.calls[0][0];
  expect(createCall.line_items[0].price_data.product_data.name).toContain('予約料金');
});

test('payment_type 省略時はデフォルト deposit', async () => {
  let callNum = 0;
  mockFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain({ id: FACILITY_UUID, name: 'テスト', slug: 'test', stripe_enabled: true, stripe_account_id: null });
    if (callNum === 2) return singleChain({ deposit_type: 'fixed', deposit_amount: 3000 });
    if (table === 'stripe_sessions') return insertChain(null);
    return singleChain(null);
  });
  mockGetUserById.mockResolvedValue({ data: { user: { email: 'u@u.com' } } });
  mockStripeSessionCreate.mockResolvedValue(STRIPE_SESSION);
  const res = await POST(makeRequest({ facility_id: FACILITY_UUID }));
  expect(res.status).toBe(200);
  const createCall = mockStripeSessionCreate.mock.calls[0][0];
  expect(createCall.metadata.payment_type).toBe('deposit');
});

test('user.email が undefined → customer_email も undefined', async () => {
  let callNum = 0;
  mockFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain({ id: FACILITY_UUID, name: 'テスト', slug: 'test', stripe_enabled: true, stripe_account_id: null });
    if (callNum === 2) return singleChain({ deposit_type: 'fixed', deposit_amount: 3000 });
    if (table === 'stripe_sessions') return insertChain(null);
    return singleChain(null);
  });
  mockGetUserById.mockResolvedValue({ data: { user: null } });
  mockStripeSessionCreate.mockResolvedValue(STRIPE_SESSION);
  const res = await POST(makeRequest({ facility_id: FACILITY_UUID }));
  expect(res.status).toBe(200);
  const createCall = mockStripeSessionCreate.mock.calls[0][0];
  expect(createCall.customer_email).toBeUndefined();
});

// ─── 古い pending の後始末（B1-13） ─────────────────────────────────────────────
describe('同じ予約に残った pending セッション', () => {
  const body = { facility_id: FACILITY_UUID, booking_id: VALID_UUID, payment_type: 'deposit' };
  const future = () => new Date(Date.now() + 10 * 60 * 1000).toISOString();

  test('Stripe で失効させてから expired にし、新しいセッションを作る', async () => {
    setupHappyPath();
    mockStaleRows = { data: [{ stripe_session_id: 'cs_old', expires_at: future() }], error: null };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(mockStripeSessionExpire).toHaveBeenCalledWith('cs_old');
    expect(mockStaleUpdate).toHaveBeenCalledWith({ status: 'expired' });
    expect(mockStripeSessionCreate).toHaveBeenCalled();
  });

  test('期限切れの pending は Stripe を呼ばずに expired にする', async () => {
    setupHappyPath();
    mockStaleRows = { data: [{ stripe_session_id: 'cs_old', expires_at: '2000-01-01T00:00:00Z' }], error: null };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(mockStripeSessionExpire).not.toHaveBeenCalled();
    expect(mockStaleUpdate).toHaveBeenCalledWith({ status: 'expired' });
  });

  test('失効を確認できない（支払われ得る）なら新しいセッションを作らず 409', async () => {
    setupHappyPath();
    mockStaleRows = { data: [{ stripe_session_id: 'cs_old', expires_at: null }], error: null };
    mockStripeSessionExpire.mockRejectedValueOnce(new Error('already complete'));
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(409);
    expect(mockStripeSessionCreate).not.toHaveBeenCalled();
    expect(mockStaleUpdate).not.toHaveBeenCalled();
  });

  test('pending の読み取り結果が null（行なし）→ 何も閉じずに作る', async () => {
    setupHappyPath();
    mockStaleRows = { data: null, error: null };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    expect(mockStaleUpdate).not.toHaveBeenCalled();
  });

  test('pending の読み取り失敗 → 500（作らない）', async () => {
    setupHappyPath();
    mockStaleRows = { data: null, error: { message: 'down' } };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(500);
    expect(mockStripeSessionCreate).not.toHaveBeenCalled();
  });

  test('expired への更新失敗 → 500（作らない）', async () => {
    setupHappyPath();
    mockStaleRows = { data: [{ stripe_session_id: 'cs_old', expires_at: future() }], error: null };
    mockStaleUpdateError = { message: 'down' };
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(500);
    expect(mockStripeSessionCreate).not.toHaveBeenCalled();
  });
});
