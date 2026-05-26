/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/chain/bulk-publish
 * Key assertions:
 *   - Partial facility ownership → 403 (all-or-nothing check)
 *   - facility_ids > 50 → 400
 *   - is_published not boolean → 400
 *   - DB update failure → 500
 *   - Success → 200
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const USER_ID    = '33333333-3333-3333-3333-333333333333';
const FACILITY_A = '11111111-1111-1111-1111-111111111111';
const FACILITY_B = '22222222-2222-2222-2222-222222222222';

const mockGetUser = jest.fn();
const mockAdminFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/chain/bulk-publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: object = {}) {
  return {
    facility_ids: [FACILITY_A, FACILITY_B],
    is_published: true,
    ...overrides,
  };
}

function membershipChain(data: unknown[]) {
  const finalIn = jest.fn(() => Promise.resolve({ data, error: null }));
  const firstIn = jest.fn().mockReturnValue({ in: finalIn });
  return {
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({ in: firstIn }),
    }),
  };
}

function updateChain(error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      in: jest.fn(() => Promise.resolve({ error })),
    }),
  };
}

function setupSuccess() {
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') {
      return membershipChain([{ facility_id: FACILITY_A }, { facility_id: FACILITY_B }]);
    }
    return updateChain(null);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(401);
});

test('POST: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(429);
});

test('POST: facility_ids が空 → 400', async () => {
  const res = await POST(makeRequest({ facility_ids: [], is_published: true }));
  expect(res.status).toBe(400);
});

test('POST: is_published が文字列 → 400', async () => {
  const res = await POST(makeRequest(validBody({ is_published: 'true' })));
  expect(res.status).toBe(400);
});

test('POST: is_published が欠落 → 400', async () => {
  const res = await POST(makeRequest({ facility_ids: [FACILITY_A] }));
  expect(res.status).toBe(400);
});

test('POST: facility_ids が 51件 → 400', async () => {
  const ids = Array.from({ length: 51 }, (_, i) =>
    `${String(i).padStart(8, '0')}-0000-1000-8000-000000000000`
  );
  const res = await POST(makeRequest(validBody({ facility_ids: ids })));
  expect(res.status).toBe(400);
});

test('POST: facility_ids に不正なUUID → 400', async () => {
  const res = await POST(makeRequest(validBody({ facility_ids: ['not-a-uuid'] })));
  expect(res.status).toBe(400);
});

test('POST: 一部施設が未認可 → 403', async () => {
  mockAdminFrom.mockImplementation(() =>
    membershipChain([{ facility_id: FACILITY_A }]) // only one of two
  );
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(403);
});

test('POST: DB更新失敗 → 500', async () => {
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') {
      return membershipChain([{ facility_id: FACILITY_A }, { facility_id: FACILITY_B }]);
    }
    return updateChain({ message: 'DB error' });
  });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(500);
});

test('POST: 公開に一括変更 → 200', async () => {
  setupSuccess();
  const res = await POST(makeRequest(validBody({ is_published: true })));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
  expect(json.updated).toBe(2);
});

test('POST: 非公開に一括変更 → 200', async () => {
  setupSuccess();
  const res = await POST(makeRequest(validBody({ is_published: false })));
  expect(res.status).toBe(200);
});

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(403);
});

test('POST: writeAuditLog が呼ばれる', async () => {
  setupSuccess();
  const { writeAuditLog } = require('@/lib/audit-logger');
  await POST(makeRequest(validBody()));
  await new Promise(r => setTimeout(r, 10));
  expect(writeAuditLog).toHaveBeenCalled();
});

test('POST: レートリミット params (10/60s)', async () => {
  setupSuccess();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (inMemoryRateLimit as jest.Mock).mockClear();
  await POST(makeRequest(validBody()));
  const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBe(10);
  expect(call[2]).toBe(60_000);
});

test('POST: レスポンスが { ok: true, updated: N } 形式', async () => {
  setupSuccess();
  const res = await POST(makeRequest(validBody()));
  const json = await res.json();
  expect(json.ok).toBe(true);
  expect(typeof json.updated).toBe('number');
});

test('POST: 不正なJSON → 400', async () => {
  const req = new NextRequest('http://localhost/api/admin/chain/bulk-publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('POST: facility_ids が文字列 (非配列) → 400', async () => {
  const res = await POST(makeRequest({ facility_ids: 'not-array' as any, is_published: true }));
  expect(res.status).toBe(400);
});

test('POST: memberships が null → 403', async () => {
  // membership query returns data: null
  mockAdminFrom.mockImplementation(() => {
    const finalIn = jest.fn(() => Promise.resolve({ data: null, error: null }));
    const firstIn = jest.fn().mockReturnValue({ in: finalIn });
    return {
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ in: firstIn }),
      }),
    };
  });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(403);
});

test('POST: facility_ids が 50件 (上限ぴったり) → 200', async () => {
  const ids = Array.from({ length: 50 }, (_, i) =>
    `${String(i + 1).padStart(8, '0')}-0000-4000-8000-000000000001`
  );
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') {
      return membershipChain(ids.map(id => ({ facility_id: id })));
    }
    return updateChain(null);
  });
  const res = await POST(makeRequest({ facility_ids: ids, is_published: true }));
  expect(res.status).toBe(200);
});
