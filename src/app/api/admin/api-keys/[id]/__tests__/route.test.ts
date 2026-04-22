/**
 * @jest-environment node
 *
 * Tests for DELETE /api/admin/api-keys/[id]
 * Key assertion: deactivation DB failure must return 500 (not silent success).
 * Also verifies ID enumeration prevention (key not found and unauthorized both → 404).
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const KEY_UUID = '11111111-1111-1111-1111-111111111111';
const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockAdminFrom = jest.fn();
const mockAnonFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { DELETE } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeRequest() {
  return new Request('http://localhost/api/admin/api-keys/1', { method: 'DELETE' });
}
function makeProps(id = KEY_UUID) {
  return { params: Promise.resolve({ id }) };
}

function singleChain(data: unknown, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error })),
  };
}

function updateChain(error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error })),
      }),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

// ─── Security guards ──────────────────────────────────────────────────────────

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  mockAdminFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
  const res = await DELETE(makeRequest(), makeProps());
  expect(res.status).toBe(401);
});

test('レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await DELETE(makeRequest(), makeProps());
  expect(res.status).toBe(429);
});

test('不正なUUID → 400', async () => {
  const res = await DELETE(makeRequest(), makeProps('not-uuid'));
  expect(res.status).toBe(400);
});

// ─── ID enumeration prevention ────────────────────────────────────────────────

test('存在しないAPIキー → 404 (列挙攻撃防止)', async () => {
  mockAdminFrom.mockReturnValue(singleChain(null)); // key not found
  mockAnonFrom.mockReturnValue(singleChain(null));
  const res = await DELETE(makeRequest(), makeProps());
  expect(res.status).toBe(404);
});

test('他施設のキー（権限なし） → 404 (列挙攻撃防止)', async () => {
  mockAdminFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
  mockAnonFrom.mockReturnValue(singleChain(null)); // not a member
  const res = await DELETE(makeRequest(), makeProps());
  expect(res.status).toBe(404);
});

// ─── Critical: deactivation failure ──────────────────────────────────────────

test('無効化DB失敗 → 500 (サイレント成功を防ぐ)', async () => {
  // key found + membership verified
  mockAdminFrom.mockImplementation(() => {
    const calls: number[] = [];
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      single: jest.fn(() => {
        calls.push(1);
        if (calls.length === 1) return Promise.resolve({ data: { facility_id: FACILITY_UUID }, error: null });
        return Promise.resolve({ data: null, error: null });
      }),
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn(() => Promise.resolve({ error: { message: 'DB update failed' } })),
        }),
      }),
    };
  });
  mockAnonFrom.mockReturnValue(singleChain({ role: 'owner' }));

  const res = await DELETE(makeRequest(), makeProps());
  expect(res.status).toBe(500);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test('正常無効化 → 200 success:true', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) {
      // key lookup
      return singleChain({ facility_id: FACILITY_UUID });
    }
    // deactivate update
    return {
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn(() => Promise.resolve({ error: null })),
        }),
      }),
    };
  });
  mockAnonFrom.mockReturnValue(singleChain({ role: 'owner' }));

  const res = await DELETE(makeRequest(), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.success).toBe(true);
});

test('CSRF エラー → 403', async () => {
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await DELETE(makeRequest(), makeProps());
  expect(res.status).toBe(403);
});

test('writeAuditLog が呼ばれる（delete アクション）', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    return { update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) }) }) };
  });
  mockAnonFrom.mockReturnValue(singleChain({ role: 'owner' }));
  const { writeAuditLog } = require('@/lib/audit-logger');
  await DELETE(makeRequest(), makeProps());
  await new Promise(r => setTimeout(r, 10));
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete', tableName: 'api_keys' }));
});

test('レートリミット params (10/60s)', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    return { update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) }) }) };
  });
  mockAnonFrom.mockReturnValue(singleChain({ role: 'owner' }));
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (inMemoryRateLimit as jest.Mock).mockClear();
  await DELETE(makeRequest(), makeProps());
  const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBe(10);
  expect(call[2]).toBe(60_000);
});

test('レスポンスが { success: true } 形式', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    return { update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) }) }) };
  });
  mockAnonFrom.mockReturnValue(singleChain({ role: 'owner' }));
  const res = await DELETE(makeRequest(), makeProps());
  const json = await res.json();
  expect(json.success).toBe(true);
});
