/**
 * @jest-environment node
 *
 * Tests for GET/POST/PATCH /api/admin/user-packages
 * Key assertions:
 *   - POST: non-admin → 401 (IDOR prevention)
 *   - POST: package not found → 404
 *   - PATCH (session use): CAS optimistic lock → 409
 *   - PATCH: sessions_remaining = 0 → 400
 *   - PATCH: expired → 400
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

// Zod .uuid() requires RFC 4122 format — version [1-8], variant [89abAB]
const FACILITY_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID =       'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PACKAGE_UUID =  'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const TARGET_USER =   'ffffffff-ffff-4fff-8fff-ffffffffffff';
const UP_UUID =       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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
import { GET, POST, PATCH } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeGetRequest(params: Record<string, string> = { facility_id: FACILITY_UUID }) {
  const url = new URL('http://localhost/api/admin/user-packages');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), { method: 'GET' });
}

function makePostRequest(body: object = { facility_id: FACILITY_UUID, user_id: TARGET_USER, package_id: PACKAGE_UUID }) {
  return new Request('http://localhost/api/admin/user-packages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makePatchRequest(body: object) {
  return new Request('http://localhost/api/admin/user-packages', {
    method: 'PATCH',
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

function singleChain(data: unknown, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn(() => Promise.resolve({ data: [data], error })),
    single: jest.fn(() => Promise.resolve({ data, error })),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error })),
  };
}

function buildUserPackage(overrides: Record<string, unknown> = {}) {
  return {
    id: UP_UUID,
    user_id: USER_ID,
    sessions_remaining: 3,
    expires_at: new Date(Date.now() + 86400_000).toISOString(),
    service_packages: { facility_id: FACILITY_UUID },
    ...overrides,
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

test('GET: facility_id なし → 400', async () => {
  const res = await GET(makeGetRequest({}));
  expect(res.status).toBe(400);
});

test('GET: 非管理者 → 401', async () => {
  mockAnonFrom.mockReturnValue(memberChain(null));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(401);
});

// ─── POST ─────────────────────────────────────────────────────────────────────

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makePostRequest() as any);
  expect(res.status).toBe(401);
});

test('POST: 不正なボディ (invalid UUID) → 400', async () => {
  const res = await POST(makePostRequest({ facility_id: 'bad', user_id: TARGET_USER, package_id: PACKAGE_UUID }) as any);
  expect(res.status).toBe(400);
});

test('POST: 非管理者 → 401', async () => {
  mockAnonFrom.mockReturnValue(memberChain(null));
  const res = await POST(makePostRequest() as any);
  expect(res.status).toBe(401);
});

test('POST: パッケージが存在しない → 404', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(null));
  const res = await POST(makePostRequest() as any);
  expect(res.status).toBe(404);
});

test('POST: DB挿入失敗 → 500', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ session_count: 5, bonus_count: 1, valid_days: 90 });
    return {
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn(() => Promise.resolve({ data: null, error: { message: 'DB error' } })),
        }),
      }),
    };
  });
  const res = await POST(makePostRequest() as any);
  expect(res.status).toBe(500);
});

test('POST: 正常付与 → 201', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ session_count: 5, bonus_count: 1, valid_days: 90 });
    return {
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn(() => Promise.resolve({ data: { id: UP_UUID }, error: null })),
        }),
      }),
    };
  });
  const res = await POST(makePostRequest() as any);
  expect(res.status).toBe(201);
});

// ─── PATCH: session use ───────────────────────────────────────────────────────

test('PATCH: 残り回数 0 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(buildUserPackage({ sessions_remaining: 0 })));
  const res = await PATCH(makePatchRequest({ user_package_id: UP_UUID }) as any);
  expect(res.status).toBe(400);
});

test('PATCH: 有効期限切れ → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(buildUserPackage({
    expires_at: new Date(Date.now() - 1000).toISOString(),
  })));
  const res = await PATCH(makePatchRequest({ user_package_id: UP_UUID }) as any);
  expect(res.status).toBe(400);
});

test('PATCH: CAS競合 → 409', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(buildUserPackage());
    // CAS miss: data is null
    return {
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn(() => Promise.resolve({ data: null, error: null })),
            }),
          }),
        }),
      }),
    };
  });
  const res = await PATCH(makePatchRequest({ user_package_id: UP_UUID }) as any);
  expect(res.status).toBe(409);
});

test('PATCH: 正常使用 → 200', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(buildUserPackage());
    if (callNum === 2) {
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn(() => Promise.resolve({ data: { id: UP_UUID, sessions_remaining: 2 }, error: null })),
              }),
            }),
          }),
        }),
      };
    }
    return {
      insert: jest.fn(() => Promise.resolve({ error: null })),
    };
  });
  const res = await PATCH(makePatchRequest({ user_package_id: UP_UUID }) as any);
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.user_package).toBeDefined();
});

// ─── GET: additional branches ─────────────────────────────────────────────────

test('GET: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(429);
});

test('GET: 不正な user_id UUID → 400', async () => {
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, user_id: 'bad-user-id' }));
  expect(res.status).toBe(400);
});

test('GET: user_id フィルタ付きで管理者 → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'admin' }));
  mockAdminFrom.mockReturnValue(singleChain([{ id: UP_UUID }]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, user_id: TARGET_USER }));
  expect(res.status).toBe(200);
});

test('GET: DB エラー → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(null, { message: 'DB error' }));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(500);
});

test('GET: 管理者 → 200 with user_packages', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain([{ id: UP_UUID }]));
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.user_packages).toBeDefined();
});

// ─── POST: additional branches ────────────────────────────────────────────────

test('POST: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makePostRequest() as any);
  expect(res.status).toBe(429);
});

test('POST: CSRF エラー → CSRF レスポンス', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(
    new Response(JSON.stringify({ error: 'csrf' }), { status: 403 })
  );
  const res = await POST(makePostRequest() as any);
  expect(res.status).toBe(403);
});

test('POST: JSON パース失敗 → 400', async () => {
  const req = new Request('http://localhost/api/admin/user-packages', {
    method: 'POST',
    body: 'not-json',
  });
  const res = await POST(req as any);
  expect(res.status).toBe(400);
});

test('POST: notes 付きで正常付与 → 201', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ session_count: 5, bonus_count: 2, valid_days: 180 });
    return {
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn(() => Promise.resolve({ data: { id: UP_UUID }, error: null })),
        }),
      }),
    };
  });
  const res = await POST(makePostRequest({
    facility_id: FACILITY_UUID,
    user_id: TARGET_USER,
    package_id: PACKAGE_UUID,
    notes: 'キャンペーン付与',
  }) as any);
  expect(res.status).toBe(201);
});

// ─── PATCH: additional branches ───────────────────────────────────────────────

test('PATCH: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makePatchRequest({ user_package_id: UP_UUID }) as any);
  expect(res.status).toBe(429);
});

test('PATCH: CSRF エラー → CSRF レスポンス', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(
    new Response(JSON.stringify({ error: 'csrf' }), { status: 403 })
  );
  const res = await PATCH(makePatchRequest({ user_package_id: UP_UUID }) as any);
  expect(res.status).toBe(403);
});

test('PATCH: 不正なボディ (JSON パース失敗) → 400', async () => {
  const req = new Request('http://localhost/api/admin/user-packages', {
    method: 'PATCH',
    body: 'not-json',
  });
  const res = await PATCH(req as any);
  expect(res.status).toBe(400);
});

test('PATCH: user_package_id が不正 UUID → 400', async () => {
  const res = await PATCH(makePatchRequest({ user_package_id: 'bad-id' }) as any);
  expect(res.status).toBe(400);
});

test('PATCH: パッケージが存在しない → 404', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(null));
  const res = await PATCH(makePatchRequest({ user_package_id: UP_UUID }) as any);
  expect(res.status).toBe(404);
});

test('PATCH: 本人でも管理者でもない → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'other-user-id' } } });
  mockAnonFrom.mockReturnValue(memberChain(null)); // not admin
  mockAdminFrom.mockReturnValue(singleChain(buildUserPackage())); // user_id = USER_ID (different)
  const res = await PATCH(makePatchRequest({ user_package_id: UP_UUID }) as any);
  expect(res.status).toBe(401);
});

test('PATCH: service_packages が null (facilityId なし) で本人なら通過 → 200', async () => {
  let callNum = 0;
  // The logged-in user IS the owner of the package
  mockAnonFrom.mockReturnValue(memberChain(null));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) {
      return singleChain(buildUserPackage({ service_packages: null }));
    }
    if (callNum === 2) {
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn(() => Promise.resolve({ data: { id: UP_UUID, sessions_remaining: 2 }, error: null })),
              }),
            }),
          }),
        }),
      };
    }
    return { insert: jest.fn(() => Promise.resolve({ error: null })) };
  });
  const res = await PATCH(makePatchRequest({ user_package_id: UP_UUID }) as any);
  expect(res.status).toBe(200);
});

test('PATCH: expires_at が null → 期限チェックをスキップして通過', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(buildUserPackage({ expires_at: null }));
    if (callNum === 2) {
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn(() => Promise.resolve({ data: { id: UP_UUID, sessions_remaining: 2 }, error: null })),
              }),
            }),
          }),
        }),
      };
    }
    return { insert: jest.fn(() => Promise.resolve({ error: null })) };
  });
  const res = await PATCH(makePatchRequest({ user_package_id: UP_UUID }) as any);
  expect(res.status).toBe(200);
});

test('PATCH: CAS 更新 DB エラー → 500', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(buildUserPackage());
    return {
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn(() => Promise.resolve({ data: null, error: { message: 'DB error' } })),
            }),
          }),
        }),
      }),
    };
  });
  const res = await PATCH(makePatchRequest({ user_package_id: UP_UUID }) as any);
  expect(res.status).toBe(500);
});

test('PATCH: ログ挿入失敗 → console.error だが 200 を返す', async () => {
  const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(buildUserPackage());
    if (callNum === 2) {
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn(() => Promise.resolve({ data: { id: UP_UUID, sessions_remaining: 2 }, error: null })),
              }),
            }),
          }),
        }),
      };
    }
    return { insert: jest.fn(() => Promise.resolve({ error: { message: 'log failed' } })) };
  });
  const res = await PATCH(makePatchRequest({ user_package_id: UP_UUID }) as any);
  expect(res.status).toBe(200);
  expect(consoleSpy).toHaveBeenCalled();
  consoleSpy.mockRestore();
});

test('GET: facility_id が不正UUID → 400', async () => {
  const res = await GET(makeGetRequest({ facility_id: 'bad-uuid' }));
  expect(res.status).toBe(400);
});

// Branch coverage: line 137 — PATCH で user が null → 401 (true 分岐)
test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makePatchRequest({ user_package_id: UP_UUID }) as any);
  expect(res.status).toBe(401);
});

test('PATCH: booking_id 付きで正常使用 → 200', async () => {
  const BOOKING_UUID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(buildUserPackage());
    if (callNum === 2) {
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn(() => Promise.resolve({ data: { id: UP_UUID, sessions_remaining: 2 }, error: null })),
              }),
            }),
          }),
        }),
      };
    }
    return { insert: jest.fn(() => Promise.resolve({ error: null })) };
  });
  const res = await PATCH(makePatchRequest({ user_package_id: UP_UUID, booking_id: BOOKING_UUID }) as any);
  expect(res.status).toBe(200);
});
