/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/admin/featured-ads
 * Key assertions:
 *   - No facility membership → 403
 *   - Invalid slot_type → 400
 *   - ends_at ≤ starts_at → 400
 *   - ends_at > 2 years out → 400
 *   - DB insert failure → 500
 *   - No STRIPE_SECRET_KEY → dev mode (activate immediately, checkout_url null)
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));
jest.mock('@/lib/constants', () => ({ SITE_URL: 'http://localhost', UUID_REGEX: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID       = '33333333-3333-3333-3333-333333333333';
const SLOT_UUID     = '44444444-4444-4444-4444-444444444444';

const mockGetUser = jest.fn();
const mockAdminFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeGetRequest() {
  return new NextRequest('http://localhost/api/admin/featured-ads', { method: 'GET' });
}

function makePostRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/featured-ads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const STARTS = new Date(Date.now() + 86400_000).toISOString();
const ENDS   = new Date(Date.now() + 30 * 86400_000).toISOString();

function validPostBody(overrides: object = {}) {
  return { slot_type: 'search_top', starts_at: STARTS, ends_at: ENDS, ...overrides };
}

function facilityIdChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function listChain(data: unknown[], error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn(() => Promise.resolve({ data, error })),
  };
}

function insertSingle(data: unknown, error: unknown = null) {
  return {
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn(() => Promise.resolve({ data, error })),
      }),
    }),
  };
}

function updateEq(error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn(() => Promise.resolve({ error })),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  delete process.env.STRIPE_SECRET_KEY; // dev mode: no Stripe
});

// ─── GET ──────────────────────────────────────────────────────────────────────

test('GET: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(401);
});

test('GET: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(429);
});

test('GET: 施設なし → 403', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain(null));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(403);
});

test('GET: 正常取得 → 200 with slots', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return listChain([{ id: SLOT_UUID }]);
  });
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.slots).toBeDefined();
});

// ─── POST ─────────────────────────────────────────────────────────────────────

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(401);
});

test('POST: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(429);
});

test('POST: 施設なし → 403', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain(null));
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(403);
});

test('POST: 必須フィールド欠落 → 400', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest({ slot_type: 'search_top' })); // starts_at, ends_at missing
  expect(res.status).toBe(400);
});

test('POST: 不正な slot_type → 400', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest(validPostBody({ slot_type: 'premium_top' })));
  expect(res.status).toBe(400);
});

test('POST: ends_at ≤ starts_at → 400', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest(validPostBody({ starts_at: ENDS, ends_at: STARTS })));
  expect(res.status).toBe(400);
});

test('POST: ends_at が 2年超え → 400', async () => {
  mockAdminFrom.mockReturnValue(facilityIdChain({ facility_id: FACILITY_UUID }));
  const tooFar = new Date();
  tooFar.setFullYear(tooFar.getFullYear() + 3);
  const res = await POST(makePostRequest(validPostBody({ ends_at: tooFar.toISOString() })));
  expect(res.status).toBe(400);
});

test('POST: DB挿入失敗 → 500', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    return insertSingle(null, { message: 'DB error' });
  });
  const res = await POST(makePostRequest(validPostBody()));
  expect(res.status).toBe(500);
});

test('POST: Stripeなし→devモード→201 checkout_url=null', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return facilityIdChain({ facility_id: FACILITY_UUID });
    if (callNum === 2) return insertSingle({ id: SLOT_UUID, slot_type: 'search_top' });
    return updateEq(null); // activate slot
  });
  const res = await POST(makePostRequest(validPostBody()));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.checkout_url).toBeNull();
  expect(json.slot).toBeDefined();
});
