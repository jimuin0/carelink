/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/admin/subscription-plans
 * Key assertions:
 *   - Non-member → 401 (IDOR prevention)
 *   - sessions_per_month min 1, max 100
 *   - valid_months max 24
 *   - price min 0
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID       = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeGetRequest(facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/subscription-plans');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), { method: 'GET' });
}

function makePostRequest(body: object, facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/subscription-plans');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: object = {}) {
  return { name: 'テストプラン', price: 5000, sessions_per_month: 4, valid_months: 6, ...overrides };
}

function memberSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function listChain(data: unknown[], error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnValue({
      order: jest.fn(() => Promise.resolve({ data, error })),
    }),
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

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
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

test('GET: 非管理者 → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(401);
});

test('GET: 正常取得 → 200 with plans', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(listChain([{ id: 'plan-1' }]));
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.plans).toBeDefined();
});

// ─── POST ─────────────────────────────────────────────────────────────────────

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makePostRequest(validBody()));
  expect(res.status).toBe(401);
});

test('POST: 非管理者 → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await POST(makePostRequest(validBody()));
  expect(res.status).toBe(401);
});

test('POST: sessions_per_month が 0 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest(validBody({ sessions_per_month: 0 })));
  expect(res.status).toBe(400);
});

test('POST: sessions_per_month が 101 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest(validBody({ sessions_per_month: 101 })));
  expect(res.status).toBe(400);
});

test('POST: valid_months が 25 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest(validBody({ valid_months: 25 })));
  expect(res.status).toBe(400);
});

test('POST: price が負数 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makePostRequest(validBody({ price: -1 })));
  expect(res.status).toBe(400);
});

test('POST: DB挿入失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle(null, { message: 'DB error' }));
  const res = await POST(makePostRequest(validBody()));
  expect(res.status).toBe(500);
});

test('POST: 正常作成 → 201 with plan', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'plan-1', name: 'テストプラン' }));
  const res = await POST(makePostRequest(validBody()));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.plan).toBeDefined();
});

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makePostRequest(validBody()));
  expect(res.status).toBe(403);
});

test('GET: DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(listChain([], { message: 'DB error' }));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(500);
});

test('GET: レートリミット params (30/60s)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(listChain([]));
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (inMemoryRateLimit as jest.Mock).mockClear();
  await GET(makeGetRequest());
  const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBe(30);
  expect(call[2]).toBe(60_000);
});

test('POST: レートリミット params (20/60s)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'plan-x', name: 'test' }));
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (inMemoryRateLimit as jest.Mock).mockClear();
  await POST(makePostRequest(validBody()));
  const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBe(20);
  expect(call[2]).toBe(60_000);
});

test('POST: sessions_per_month が 100 (上限ぴったり) → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'plan-2', name: 'test' }));
  const res = await POST(makePostRequest(validBody({ sessions_per_month: 100 })));
  expect(res.status).toBe(201);
});

test('POST: valid_months が 24 (上限ぴったり) → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'plan-3', name: 'test' }));
  const res = await POST(makePostRequest(validBody({ valid_months: 24 })));
  expect(res.status).toBe(201);
});

test('POST: price が 0 → 201 (無料プラン)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'plan-4', name: 'フリープラン' }));
  const res = await POST(makePostRequest(validBody({ price: 0 })));
  expect(res.status).toBe(201);
});

test('GET: レスポンスが { plans: [] } 形式', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(listChain([]));
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(Array.isArray(json.plans)).toBe(true);
});

// ─── Branch coverage gaps ─────────────────────────────────────────────────────

test('GET: facility_id クエリなし → 401', async () => {
  const res = await GET(makeGetRequest(null));
  expect(res.status).toBe(401);
});

test('GET: facility_id 不正UUID → 401', async () => {
  const res = await GET(makeGetRequest('bad-uuid'));
  expect(res.status).toBe(401);
});

test('POST: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makePostRequest(validBody()));
  expect(res.status).toBe(429);
});

test('POST: 不正JSONボディ → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const url = new URL('http://localhost/api/admin/subscription-plans');
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'invalid {',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('POST: is_active=false 明示 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'plan-x', is_active: false }));
  const res = await POST(makePostRequest(validBody({ is_active: false })));
  expect(res.status).toBe(201);
});

test('GET: x-forwarded-for ヘッダ → IP抽出', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(listChain([]));
  (inMemoryRateLimit as jest.Mock).mockClear();
  const url = new URL('http://localhost/api/admin/subscription-plans');
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'GET',
    headers: { 'x-forwarded-for': '10.0.0.1, 1.2.3.4' },
  });
  await GET(req);
  expect((inMemoryRateLimit as jest.Mock).mock.calls[0][0]).toBe('10.0.0.1');
});
