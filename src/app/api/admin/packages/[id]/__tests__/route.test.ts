/**
 * @jest-environment node
 *
 * Tests for PATCH/DELETE /api/admin/packages/[id]
 * Key assertions:
 *   - PATCH: UPDATE WHERE includes facility_id (defence-in-depth against IDOR
 *     even after ownership is verified by helper)
 *   - DELETE soft-deactivation failure → 500
 *   - DELETE hard-delete failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const PKG_UUID = '11111111-1111-1111-1111-111111111111';
const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const MENU_UUID = '44444444-4444-4444-8444-444444444444';

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
  return new Request(`http://localhost/api/admin/packages/1`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeProps(id = PKG_UUID) {
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

// Setup ownership verification: package lookup (admin) + membership check (anon)
function setupOwnership() {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID }); // package lookup
    return baseUpdateChain();
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID })); // membership
}

function baseUpdateChain(error: unknown = null) {
  // route: .update().eq('id').eq('facility_id').select().single()
  const singleMock = jest.fn(() => Promise.resolve({ data: { id: PKG_UUID }, error }));
  const selectAfterEq = jest.fn().mockReturnValue({ single: singleMock });
  const innerEq = jest.fn().mockReturnValue({ select: selectAfterEq });
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq, select: selectAfterEq });
  return {
    update: jest.fn().mockReturnValue({ eq: outerEq }),
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: null, error: null })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── PATCH: security guards ───────────────────────────────────────────────────

test('PATCH: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest('PATCH', { name: 'test' }), makeProps());
  expect(res.status).toBe(429);
});

test('PATCH: 不正なUUID → 400', async () => {
  const res = await PATCH(makeRequest('PATCH', { name: 'test' }), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  mockAdminFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest('PATCH', { name: 'test' }), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: パッケージが見つからない → 401 (所有権と非存在を区別しない)', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockAdminFrom.mockReturnValue(singleChain(null)); // package not found
  mockAnonFrom.mockReturnValue(singleChain(null));
  const res = await PATCH(makeRequest('PATCH', { name: 'test' }), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: 不正なスキーマ → 400', async () => {
  setupOwnership();
  const res = await PATCH(makeRequest('PATCH', { session_count: -1 }), makeProps());
  expect(res.status).toBe(400);
});

// ─── PATCH: defence-in-depth ─────────────────────────────────────────────────

test('PATCH: UPDATEのWHEREにfacility_idが含まれる', async () => {
  let adminCallNum = 0;
  const updateMock = jest.fn();
  const firstEq = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ single: jest.fn(() => Promise.resolve({ data: { id: PKG_UUID, name: 'updated' }, error: null })) }),
    }),
  });
  updateMock.mockReturnValue({ eq: firstEq });

  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    return { update: updateMock, select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data: { id: PKG_UUID }, error: null })) };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

  await PATCH(makeRequest('PATCH', { name: 'updated' }), makeProps());

  // Verify the update chain was called and facility_id eq was chained
  expect(updateMock).toHaveBeenCalled();
  // firstEq is called with params.id, second eq is called with facility_id
  expect(firstEq).toHaveBeenCalledWith('id', PKG_UUID);
  const secondEq = firstEq.mock.results[0].value.eq;
  expect(secondEq).toHaveBeenCalledWith('facility_id', FACILITY_UUID);
});

// ─── PATCH: menu_id 越境参照防止（IDOR）の分岐網羅 ──────────────────────────────

test('PATCH: menu_id が自施設のメニュー → 200', async () => {
  let n = 0;
  mockAdminFrom.mockImplementation(() => {
    n++;
    if (n === 1) return singleChain({ facility_id: FACILITY_UUID }); // ownership(service_packages)
    if (n === 2) return singleChain({ id: 'menu-1' });               // menu check(facility_menus)
    return baseUpdateChain();                                         // update
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest('PATCH', { menu_id: MENU_UUID }), makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: menu_id が他施設のメニュー → 400 (IDOR防止)', async () => {
  let n = 0;
  mockAdminFrom.mockImplementation(() => {
    n++;
    if (n === 1) return singleChain({ facility_id: FACILITY_UUID }); // ownership
    if (n === 2) return singleChain(null);                           // menu not found / cross-facility
    return baseUpdateChain();
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest('PATCH', { menu_id: MENU_UUID }), makeProps());
  expect(res.status).toBe(400);
});

// ─── DELETE: security guards ──────────────────────────────────────────────────

test('DELETE: 不正なUUID → 400', async () => {
  const res = await DELETE(makeRequest('DELETE'), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

// ─── DELETE: soft-deactivate (purchased packages) ────────────────────────────

test('DELETE: 購入済みユーザーがいる → 非公開化 → 200', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID }); // package lookup
    if (adminCallNum === 2) {
      // user_packages count check
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue(Promise.resolve({ count: 2, error: null })),
        }),
      };
    }
    // deactivate update
    return {
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) }) }),
    };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

  const res = await DELETE(makeRequest('DELETE'), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.message).toContain('非公開');
});

test('DELETE: 購入済みユーザーあり・非公開化失敗 → 500', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    if (adminCallNum === 2) {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue(Promise.resolve({ count: 3, error: null })),
        }),
      };
    }
    return {
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: { message: 'DB error' } })) }) }),
    };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(500);
});

// ─── DELETE: hard delete (no purchased users) ─────────────────────────────────

test('DELETE: 購入ユーザーなし → 完全削除 → 200', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    if (adminCallNum === 2) {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue(Promise.resolve({ count: 0, error: null })),
        }),
      };
    }
    return { delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) }) }) };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

  const res = await DELETE(makeRequest('DELETE'), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.message).toBe('deleted');
});

test('DELETE: 完全削除失敗 → 500', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    if (adminCallNum === 2) {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue(Promise.resolve({ count: 0, error: null })),
        }),
      };
    }
    return { delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: { message: 'DB error' } })) }) }) };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));

  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(500);
});

// ─── 追加ブランチカバレッジ ───────────────────────────────────────────

test('PATCH: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await PATCH(makeRequest('PATCH', { name: 'x' }), makeProps());
  expect(res).toBe(csrfRes);
});

test('PATCH: DB更新失敗 → 500', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    return {
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn(() => Promise.resolve({ data: null, error: { message: 'fail' } })),
            }),
          }),
        }),
      }),
    };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest('PATCH', { name: 'x' }), makeProps());
  expect(res.status).toBe(500);
});

test('PATCH: 不正な JSON body → 400', async () => {
  setupOwnership();
  const req = new Request(`http://localhost/api/admin/packages/${PKG_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await PATCH(req as unknown as Parameters<typeof PATCH>[0], makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: x-forwarded-for ヘッダから IP 取得', async () => {
  setupOwnership();
  const req = new Request(`http://localhost/api/admin/packages/${PKG_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify({ name: 'x' }),
  });
  const res = await PATCH(req as unknown as Parameters<typeof PATCH>[0], makeProps());
  expect(res.status).toBe(200);
});

test('DELETE: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res).toBe(csrfRes);
});

test('DELETE: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(429);
});

test('DELETE: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  mockAdminFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(401);
});

test('DELETE: count=null → ハード削除', async () => {
  let adminCallNum = 0;
  mockAdminFrom.mockImplementation(() => {
    adminCallNum++;
    if (adminCallNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    if (adminCallNum === 2) {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue(Promise.resolve({ count: null, error: null })),
        }),
      };
    }
    return { delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) }) }) };
  });
  mockAnonFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(200);
});

// Branch coverage: line 40 — package 存在・membership null → null 返却（false 分岐 → 401）
test('PATCH: package 存在・membership null → verifyPackage null → 401（line 40 false 分岐）', async () => {
  mockAdminFrom.mockReturnValue(singleChain({ facility_id: FACILITY_UUID }));
  mockAnonFrom.mockReturnValue(singleChain(null));
  const res = await PATCH(makeRequest('PATCH', { name: 'x' }), makeProps());
  expect(res.status).toBe(401);
});
