/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/admin/feature-flags
 * Key assertions:
 *   - Platform-admin only → 403 for non-admin
 *   - key must match /^[a-z0-9_-]+$/
 *   - Duplicate key → 409 (unique constraint 23505)
 *   - rollout_pct 0-100
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const USER_ID = '33333333-3333-3333-3333-333333333333';

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

function makeGetRequest(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/admin/feature-flags');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), { method: 'GET' });
}

function makePostRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/feature-flags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function profileSingle(isAdmin: boolean) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: { is_platform_admin: isAdmin }, error: null })),
  };
}

function buildListChain(data: unknown[], error: unknown = null) {
  const p = Promise.resolve({ data, error });
  const chain: Record<string, jest.Mock | ((resolve: (v: unknown) => void, reject: (e: unknown) => void) => void)> = {
    select: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => p.then(resolve, reject),
    catch: (r: (e: unknown) => void) => p.catch(r),
    finally: (f: () => void) => p.finally(f),
  };
  for (const key of ['select', 'order', 'gt', 'lt', 'eq']) {
    (chain[key] as jest.Mock).mockReturnValue(chain);
  }
  return chain;
}

function insertFlagSingle(data: unknown, error: unknown = null) {
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

test('GET: 未認証 → 403', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(403);
});

test('GET: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(429);
});

test('GET: 一般ユーザー → 403', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(false));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(403);
});

test('GET: 正常取得 → 200 with flags', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(buildListChain([{ id: 'flag-1', key: 'my_flag' }]));
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.flags).toBeDefined();
});

test('GET: ab=1 フィルター → 200', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(buildListChain([{ id: 'flag-1', rollout_pct: 50 }]));
  const res = await GET(makeGetRequest({ ab: '1' }));
  expect(res.status).toBe(200);
});

// ─── POST ─────────────────────────────────────────────────────────────────────

test('POST: 未認証 → 403', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makePostRequest({ key: 'test_flag' }));
  expect(res.status).toBe(403);
});

test('POST: 一般ユーザー → 403', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(false));
  const res = await POST(makePostRequest({ key: 'test_flag' }));
  expect(res.status).toBe(403);
});

test('POST: key が大文字を含む → 400', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  const res = await POST(makePostRequest({ key: 'Test_Flag' }));
  expect(res.status).toBe(400);
});

test('POST: key が空 → 400', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  const res = await POST(makePostRequest({ key: '' }));
  expect(res.status).toBe(400);
});

test('POST: rollout_pct が 101 → 400', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  const res = await POST(makePostRequest({ key: 'test_flag', rollout_pct: 101 }));
  expect(res.status).toBe(400);
});

test('POST: 重複キー → 409 (unique constraint)', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(insertFlagSingle(null, { code: '23505', message: 'duplicate' }));
  const res = await POST(makePostRequest({ key: 'existing_flag' }));
  expect(res.status).toBe(409);
});

test('POST: DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(insertFlagSingle(null, { message: 'DB error' }));
  const res = await POST(makePostRequest({ key: 'test_flag' }));
  expect(res.status).toBe(500);
});

test('POST: 正常作成 → 201 with flag', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(insertFlagSingle({ id: 'flag-1', key: 'test_flag', enabled: false }));
  const res = await POST(makePostRequest({ key: 'test_flag', rollout_pct: 0 }));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.flag).toBeDefined();
});
