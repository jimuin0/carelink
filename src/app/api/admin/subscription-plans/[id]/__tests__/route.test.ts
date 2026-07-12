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

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
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
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

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
            maybeSingle: jest.fn(() => Promise.resolve({ data, error })),
          }),
        }),
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

// ─── PATCH: guards ────────────────────────────────────────────────────────────

test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest('PATCH', { name: 'test' }), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
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
      maybeSingle: jest.fn(() => Promise.resolve({ data: { id: PLAN_UUID }, error: null })),
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

test('PATCH: 更新0行（verify後にTOCTOU削除）→ 404', async () => {
  // .maybeSingle() が error なし・data null（0行）を返すケース。verifyAdmin で存在確認した後に
  // 別リクエストで削除される TOCTOU 等で発生。.single() だと PGRST116→500 に化けるため
  // .maybeSingle()＋!data で 404 を返す。この 404 分岐の回帰防止。
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return planChain({ facility_id: FACILITY_UUID });
    return buildUpdateChain(null, null);
  });
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest('PATCH', { name: 'test' }), makeProps());
  expect(res.status).toBe(404);
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
  expect(json.message).toBe('deleted');
});

test('DELETE: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(429);
});

// ─── CSRF / additional branch coverage ────────────────────────────────────────

test('PATCH: CSRFエラー → そのまま返却', async () => {
  const csrfResponse = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfResponse);
  const res = await PATCH(makeRequest('PATCH', { name: 'x' }), makeProps());
  expect(res).toBe(csrfResponse);
});

test('DELETE: CSRFエラー → そのまま返却', async () => {
  const csrfResponse = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfResponse);
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res).toBe(csrfResponse);
});

test('DELETE: 不正なUUID → 400', async () => {
  const res = await DELETE(makeRequest('DELETE'), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('DELETE: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(401);
});

test('DELETE: 非管理者 → 401', async () => {
  mockAdminFrom.mockReturnValue(planChain(null));
  mockAnonFrom.mockReturnValue(memberChain(null));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: x-forwarded-for ヘッダから IP 取得', async () => {
  setupVerifyAdmin();
  const req = new Request(`http://localhost/api/admin/subscription-plans/${PLAN_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    body: JSON.stringify({ name: 'x' }),
  });
  const res = await PATCH(req as unknown as Parameters<typeof PATCH>[0], makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: 不正な JSON body → 400', async () => {
  setupVerifyAdmin();
  const req = new Request(`http://localhost/api/admin/subscription-plans/${PLAN_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await PATCH(req as unknown as Parameters<typeof PATCH>[0], makeProps());
  expect(res.status).toBe(400);
});

test('DELETE: count=null → ハード削除 (200 deleted)', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return planChain({ facility_id: FACILITY_UUID });
    if (adminCallNum === 2) {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn(() => Promise.resolve({ count: null })),
          }),
        }),
      };
    }
    return {
      delete: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn(() => Promise.resolve({ error: null })),
        }),
      }),
    };
  });
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(200);
});

test('DELETE: 契約中ユーザーあり + deactivate 失敗 → 500', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return planChain({ facility_id: FACILITY_UUID });
    if (adminCallNum === 2) {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn(() => Promise.resolve({ count: 5 })),
          }),
        }),
      };
    }
    return {
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn(() => Promise.resolve({ error: { message: 'fail' } })),
        }),
      }),
    };
  });
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(500);
});

test('DELETE: ハード削除 失敗 → 500', async () => {
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
        eq: jest.fn().mockReturnValue({
          eq: jest.fn(() => Promise.resolve({ error: { message: 'fail' } })),
        }),
      }),
    };
  });
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(500);
});

// Branch coverage: line 35 — plan が存在するが facility_members が null → mem=null → null 返却（false 分岐 → 401）
test('PATCH: plan 存在・facility_members null → verifyAdmin null → 401（line 35 false 分岐）', async () => {
  mockAdminFrom.mockReturnValue(planChain({ facility_id: FACILITY_UUID }));
  mockAnonFrom.mockReturnValue(memberChain(null));
  const res = await PATCH(makeRequest('PATCH', { name: 'x' }), makeProps());
  expect(res.status).toBe(401);
});

// Branch coverage: L97 — user_subscriptions count クエリ失敗 → 500
test('DELETE: countErr → 500 (L97 countErr 分岐)', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return planChain({ facility_id: FACILITY_UUID }); // verifyAdmin: plan lookup
    if (adminCallNum === 2) {
      // user_subscriptions count check fails
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn(() => Promise.resolve({ count: null, error: { message: 'DB error' } })),
          }),
        }),
      };
    }
    return planChain(null);
  });
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(500);
  const json = await res.json();
  expect(json.error).toBeDefined();
});
