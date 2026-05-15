/**
 * @jest-environment node
 *
 * Tests for PATCH/DELETE /api/admin/subscription-plans/[id]
 * Key assertions:
 *   - facility_id defence-in-depth in UPDATE/DELETE WHERE
 *   - sessions_per_month max 100 / valid_months max 24
 *   - DELETE: active subscribers → soft deactivate (not hard delete)
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const PLAN_UUID = '11111111-1111-1111-1111-111111111111';
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

import { PATCH, DELETE } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeRequest(method: string, body?: object) {
  return new Request(`http://localhost/api/admin/subscription-plans/${PLAN_UUID}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeProps(id = PLAN_UUID) {
  return { params: Promise.resolve({ id }) };
}

function planChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function memberChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

// Sets up verifyAdmin: admin call 1 (plan lookup) + anon call (member check)
function setupVerifyAdmin() {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return planChain({ facility_id: FACILITY_UUID });
    return buildUpdateChain({ id: PLAN_UUID });
  });
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  return { getAdminCallNum: () => adminCallNum };
}

function buildUpdateChain(data: unknown, error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn(() => Promise.resolve({ data, error })),
          }),
        }),
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

// ─── PATCH: guards ────────────────────────────────────────────────────────────

test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest('PATCH', { name: 'test' }), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest('PATCH', { name: 'test' }), makeProps());
  expect(res.status).toBe(429);
});

test('PATCH: 不正なUUID → 400', async () => {
  const res = await PATCH(makeRequest('PATCH', { name: 'test' }), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('PATCH: 非管理者 → 401 (IDOR防止)', async () => {
  mockAdminFrom.mockReturnValue(planChain(null)); // plan not found or no access
  mockAnonFrom.mockReturnValue(memberChain(null));
  const res = await PATCH(makeRequest('PATCH', { name: 'test' }), makeProps());
  expect(res.status).toBe(401);
});

// ─── PATCH: schema validation ─────────────────────────────────────────────────

test('PATCH: sessions_per_month > 100 → 400', async () => {
  setupVerifyAdmin();
  const res = await PATCH(makeRequest('PATCH', { sessions_per_month: 101 }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: valid_months > 24 → 400', async () => {
  setupVerifyAdmin();
  const res = await PATCH(makeRequest('PATCH', { valid_months: 25 }), makeProps());
  expect(res.status).toBe(400);
});

// ─── PATCH: defence-in-depth ─────────────────────────────────────────────────

test('PATCH: UPDATEのWHEREにfacility_idが含まれる', async () => {
  let adminCallNum = 0;
  const innerEq = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      single: jest.fn(() => Promise.resolve({ data: { id: PLAN_UUID }, error: null })),
    }),
  });
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  const updateMock = jest.fn().mockReturnValue({ eq: outerEq });

  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return planChain({ facility_id: FACILITY_UUID });
    return { update: updateMock };
  });
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));

  await PATCH(makeRequest('PATCH', { name: 'updated' }), makeProps());
  expect(outerEq).toHaveBeenCalledWith('id', PLAN_UUID);
  expect(innerEq).toHaveBeenCalledWith('facility_id', FACILITY_UUID);
});

test('PATCH: DB更新失敗 → 500', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return planChain({ facility_id: FACILITY_UUID });
    return buildUpdateChain(null, { message: 'DB error' });
  });
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest('PATCH', { name: 'test' }), makeProps());
  expect(res.status).toBe(500);
});

// ─── DELETE: active subscribers → soft deactivate ────────────────────────────

test('DELETE: 契約中ユーザーあり → soft deactivate (200)', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return planChain({ facility_id: FACILITY_UUID }); // verifyAdmin
    if (adminCallNum === 2) {
      // user_subscriptions count check
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn(() => Promise.resolve({ count: 3 })),
          }),
        }),
      };
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
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));

  const res = await DELETE(makeRequest('DELETE'), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.message).toContain('非公開');
});

test('DELETE: 契約中ユーザーなし → 正常削除 (200 deleted)', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return planChain({ facility_id: FACILITY_UUID });
    if (adminCallNum === 2) {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn(() => Promise.resolve({ count: 0 })),
          }),
        }),
      };
    }
    return {
      delete: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error: null })),
      }),
    };
  });
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));

  const res = await DELETE(makeRequest('DELETE'), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.message).toBe('deleted');
});

test('DELETE: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(429);
});
