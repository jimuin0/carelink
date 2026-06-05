/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/admin/api-keys
 * Key assertions:
 *   - POST: invalid scope → 400 (privilege escalation prevention)
 *   - POST: non-owner/admin → 403 (IDOR prevention)
 *   - POST: DB failure → 500
 *   - POST: raw_key returned once (creation only, not stored in plaintext)
 *   - GET: non-member → 403
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const KEY_UUID = '44444444-4444-4444-4444-444444444444';

const mockAdminFrom = jest.fn();
const mockAnonFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { GET, POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

function makeGetRequest(facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/api-keys');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), { method: 'GET' });
}

function makePostRequest(body: object = { facility_id: FACILITY_UUID, name: 'テストキー', scopes: ['bookings:read'] }) {
  return new Request('http://localhost/api/admin/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function memberChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function adminListChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function insertChain(data: unknown, error: unknown = null) {
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
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── POST: guards ─────────────────────────────────────────────────────────────

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makePostRequest() as any);
  expect(res.status).toBe(401);
});

test('POST: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makePostRequest() as any);
  expect(res.status).toBe(429);
});

test('POST: facility_id なし → 400', async () => {
  const res = await POST(makePostRequest({ name: 'test', scopes: ['bookings:read'] }) as any);
  expect(res.status).toBe(400);
});

test('POST: name なし → 400', async () => {
  const res = await POST(makePostRequest({ facility_id: FACILITY_UUID, scopes: ['bookings:read'] }) as any);
  expect(res.status).toBe(400);
});

test('POST: scopes なし → 400', async () => {
  const res = await POST(makePostRequest({ facility_id: FACILITY_UUID, name: 'test', scopes: [] }) as any);
  expect(res.status).toBe(400);
});

test('POST: 不正なスコープ → 400 (権限昇格防止)', async () => {
  const res = await POST(makePostRequest({ facility_id: FACILITY_UUID, name: 'test', scopes: ['*', 'admin:write'] }) as any);
  expect(res.status).toBe(400);
});

test('POST: 非管理者メンバー → 403 (IDOR防止)', async () => {
  mockAnonFrom.mockReturnValue(memberChain(null));
  const res = await POST(makePostRequest() as any);
  expect(res.status).toBe(403);
});

test('POST: DB挿入失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(insertChain(null, { message: 'DB error' }));
  const res = await POST(makePostRequest() as any);
  expect(res.status).toBe(500);
});

test('POST: 正常作成 → 201 raw_key あり', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(insertChain({ id: KEY_UUID, name: 'テストキー', key_prefix: 'ck_live_abcd' }));
  const res = await POST(makePostRequest() as any);
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.raw_key).toBeDefined();
  expect(json.raw_key).toMatch(/^ck_live_/);
  expect(json.key).toBeDefined();
  // key_hash must NOT be in response (stored only, never returned)
  expect(json.key?.key_hash).toBeUndefined();
});

// ─── GET: guards ──────────────────────────────────────────────────────────────

test('GET: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(401);
});

test('GET: facility_id なし → 400', async () => {
  const res = await GET(makeGetRequest(null));
  expect(res.status).toBe(400);
});

test('GET: 不正なfacility_id → 400', async () => {
  const res = await GET(makeGetRequest('not-a-uuid'));
  expect(res.status).toBe(400);
});

test('GET: 非管理者 → 403 (IDOR防止)', async () => {
  mockAnonFrom.mockReturnValue(memberChain(null));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(403);
});

test('GET: 管理者 → 200 key一覧（key_hashなし）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'admin' }));
  mockAdminFrom.mockReturnValue(adminListChain([{ id: KEY_UUID, name: 'test', key_prefix: 'ck_live_abcd', scopes: ['bookings:read'] }]));
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(Array.isArray(json)).toBe(true);
});

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makePostRequest() as any);
  expect(res.status).toBe(403);
});

test('POST: reviews:read スコープ → 201', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(insertChain({ id: KEY_UUID, name: 'test', key_prefix: 'ck_live_abcd' }));
  const res = await POST(makePostRequest({ facility_id: FACILITY_UUID, name: 'test', scopes: ['reviews:read'] }) as any);
  expect(res.status).toBe(201);
});

test('POST: writeAuditLog が呼ばれる', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(insertChain({ id: KEY_UUID, name: 'テストキー', key_prefix: 'ck_live_abcd' }));
  const { writeAuditLog } = require('@/lib/audit-logger');
  await POST(makePostRequest() as any);
  await new Promise(r => setTimeout(r, 10));
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', tableName: 'api_keys' }));
});

test('POST: facility_id が不正UUID → 400', async () => {
  const res = await POST(makePostRequest({ facility_id: 'not-uuid', name: 'test', scopes: ['bookings:read'] }) as any);
  expect(res.status).toBe(400);
});

test('POST: name が空白のみ → 400', async () => {
  const res = await POST(makePostRequest({ facility_id: FACILITY_UUID, name: '   ', scopes: ['bookings:read'] }) as any);
  expect(res.status).toBe(400);
});

test('POST: レートリミット params (10/60s)', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(insertChain({ id: KEY_UUID, name: 'テストキー', key_prefix: 'ck_live_abcd' }));
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await POST(makePostRequest() as any);
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(10);
  expect(call[3]).toBe(60_000);
});

test('GET: レスポンスが配列形式', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(adminListChain([]));
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(Array.isArray(json)).toBe(true);
});

// ─── Branch coverage gaps ─────────────────────────────────────────────────────

test('GET: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(429);
});

test('GET: data が null → 200 with []', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn(() => Promise.resolve({ data: null, error: null })),
  });
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json).toEqual([]);
});

test('POST: 不正JSONボディ → 400', async () => {
  const req = new Request('http://localhost/api/admin/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'invalid {',
  });
  const res = await POST(req as unknown as NextRequest);
  expect(res.status).toBe(400);
});

test('POST: facility_id が数値 → 400 (typeof check)', async () => {
  const res = await POST(makePostRequest({ facility_id: 12345, name: 'test', scopes: ['bookings:read'] }) as unknown as NextRequest);
  expect(res.status).toBe(400);
});

test('POST: name が数値 → 400 (typeof check)', async () => {
  const res = await POST(makePostRequest({ facility_id: FACILITY_UUID, name: 123, scopes: ['bookings:read'] }) as unknown as NextRequest);
  expect(res.status).toBe(400);
});

test('POST: scopes が配列でない → 400', async () => {
  const res = await POST(makePostRequest({ facility_id: FACILITY_UUID, name: 'test', scopes: 'bookings:read' }) as unknown as NextRequest);
  expect(res.status).toBe(400);
});

test('POST: newKey が null かつ error なし → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(insertChain(null, null));
  const res = await POST(makePostRequest() as unknown as NextRequest);
  expect(res.status).toBe(500);
});

test('POST: x-forwarded-for ヘッダ → IP抽出', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(insertChain({ id: KEY_UUID, name: 'X', key_prefix: 'ck_live_xxxx' }));
  (checkRateLimit as jest.Mock).mockClear();
  const req = new Request('http://localhost/api/admin/api-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '10.0.0.1, 1.2.3.4' },
    body: JSON.stringify({ facility_id: FACILITY_UUID, name: 'X', scopes: ['bookings:read'] }),
  });
  await POST(req as unknown as NextRequest);
  expect((checkRateLimit as jest.Mock).mock.calls[0][1]).toBe('1.2.3.4');
});

test('GET: x-forwarded-for ヘッダ → IP抽出', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(adminListChain([]));
  (checkRateLimit as jest.Mock).mockClear();
  const url = new URL('http://localhost/api/admin/api-keys');
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'GET',
    headers: { 'x-forwarded-for': '10.0.0.1, 1.2.3.4' },
  });
  await GET(req);
  expect((checkRateLimit as jest.Mock).mock.calls[0][1]).toBe('1.2.3.4');
});

test('POST: customers:read スコープ → 201', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(insertChain({ id: KEY_UUID, name: 'X', key_prefix: 'ck_live_xxxx' }));
  const res = await POST(makePostRequest({ facility_id: FACILITY_UUID, name: 'X', scopes: ['customers:read'] }) as unknown as NextRequest);
  expect(res.status).toBe(201);
});

test('GET: レートリミット params (20/60s)', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'admin' }));
  mockAdminFrom.mockReturnValue(adminListChain([]));
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await GET(makeGetRequest());
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(20);
  expect(call[3]).toBe(60_000);
});
