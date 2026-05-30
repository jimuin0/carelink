/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/facility-status（一括停止・再開＝掲載ステータス切替）
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));

const uuid = (c: string) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const FACILITY_UUID = uuid('2');
const USER_ID = uuid('3');

const mockGetUser = jest.fn();
const mockAuthFrom = jest.fn();
const mockAdminFrom = jest.fn();

jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: jest.fn(async () => ({ auth: { getUser: mockGetUser }, from: mockAuthFrom })),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function chain(result: unknown) {
  const p = Promise.resolve(result);
  const proxy: unknown = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return p.then.bind(p);
      if (prop === 'catch') return p.catch.bind(p);
      if (prop === 'finally') return p.finally.bind(p);
      return () => proxy;
    },
    apply() { return proxy; },
  });
  return proxy;
}

function makeRequest(body: object, facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/facility-status');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockAuthFrom.mockReturnValue(chain({ data: { facility_id: FACILITY_UUID }, error: null }));
});

test('CSRF 失敗 → 403', async () => {
  const { NextResponse } = await import('next/server');
  (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({ error: 'x' }, { status: 403 }));
  const res = await POST(makeRequest({ action: 'suspend' }));
  expect(res.status).toBe(403);
});

test('レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest({ action: 'suspend' }));
  expect(res.status).toBe(429);
});

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest({ action: 'suspend' }));
  expect(res.status).toBe(401);
});

test('facility_id 欠落 → 401', async () => {
  const res = await POST(makeRequest({ action: 'suspend' }, null));
  expect(res.status).toBe(401);
});

test('非メンバー → 401', async () => {
  mockAuthFrom.mockReturnValue(chain({ data: null, error: null }));
  const res = await POST(makeRequest({ action: 'suspend' }));
  expect(res.status).toBe(401);
});

test('不正なaction → 400', async () => {
  const res = await POST(makeRequest({ action: 'invalid' }));
  expect(res.status).toBe(400);
});

test('update エラー → 500', async () => {
  mockAdminFrom.mockReturnValueOnce(chain({ data: null, error: { message: 'fail' } }));
  const res = await POST(makeRequest({ action: 'suspend' }));
  expect(res.status).toBe(500);
});

test('更新0件 → 404', async () => {
  mockAdminFrom.mockReturnValueOnce(chain({ data: [], error: null }));
  const res = await POST(makeRequest({ action: 'suspend' }));
  expect(res.status).toBe(404);
});

test('正常: 受付停止 → 200 / status=suspended', async () => {
  mockAdminFrom.mockReturnValueOnce(chain({ data: [{ id: FACILITY_UUID, status: 'suspended' }], error: null }));
  const res = await POST(makeRequest({ action: 'suspend' }));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.status).toBe('suspended');
});

test('正常: 受付再開 → 200 / status=published', async () => {
  mockAdminFrom.mockReturnValueOnce(chain({ data: [{ id: FACILITY_UUID, status: 'published' }], error: null }));
  const res = await POST(makeRequest({ action: 'resume' }));
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.status).toBe('published');
});

test('audit用 getUser が null でも 200（userId null 分岐）', async () => {
  mockAdminFrom.mockReturnValueOnce(chain({ data: [{ id: FACILITY_UUID, status: 'suspended' }], error: null }));
  mockGetUser
    .mockResolvedValueOnce({ data: { user: { id: USER_ID } } })
    .mockResolvedValueOnce({ data: { user: null } });
  const res = await POST(makeRequest({ action: 'suspend' }));
  expect(res.status).toBe(200);
});

test('不正JSON → 400', async () => {
  const url = new URL('http://localhost/api/admin/facility-status');
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not-json{' });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('例外 → 500（catch）', async () => {
  (inMemoryRateLimit as jest.Mock).mockImplementation(() => { throw new Error('boom'); });
  const res = await POST(makeRequest({ action: 'suspend' }));
  expect(res.status).toBe(500);
});
