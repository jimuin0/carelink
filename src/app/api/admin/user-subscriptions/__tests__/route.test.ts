/**
 * @jest-environment node
 *
 * Tests for GET/POST/PATCH /api/admin/user-subscriptions
 * Key assertions:
 *   - CAS optimistic lock: concurrent session use → 409
 *   - Monthly session cap enforcement → 400
 *   - Booking must belong to subscription's user/facility
 *   - Status update path (active/cancelled/paused/expired)
 *   - Non-admin → 401 (IDOR prevention)
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

// Zod .uuid() enforces RFC 4122: version nibble ∈ [1-8], variant nibble ∈ [89abAB]
const SUB_UUID =     'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FACILITY_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_ID =       'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PLAN_UUID =     'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const BOOKING_UUID =  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TARGET_USER =   'ffffffff-ffff-4fff-8fff-ffffffffffff';

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
  const url = new URL('http://localhost/api/admin/user-subscriptions');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url.toString(), { method: 'GET' });
}

function makePostRequest(body: object = { facility_id: FACILITY_UUID, user_id: TARGET_USER, plan_id: PLAN_UUID }) {
  return new Request('http://localhost/api/admin/user-subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makePatchRequest(body: object) {
  return new Request('http://localhost/api/admin/user-subscriptions', {
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
    limit: jest.fn(() => Promise.resolve({ data: Array.isArray(data) ? data : [data], error })),
    single: jest.fn(() => Promise.resolve({ data, error })),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error })),
  };
}

function buildActiveSub(overrides: Record<string, unknown> = {}) {
  return {
    id: SUB_UUID,
    user_id: USER_ID,
    status: 'active',
    ends_at: new Date(Date.now() + 86400_000).toISOString(),
    sessions_used_this_month: 0,
    month_reset_at: new Date(Date.now() - 1000).toISOString(), // already past → no reset needed (use future date)
    subscription_plans: { sessions_per_month: 4, facility_id: FACILITY_UUID },
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

// ─── GET: guards ──────────────────────────────────────────────────────────────

test('GET: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(401);
});

test('GET: facility_id なし → 400', async () => {
  const res = await GET(makeGetRequest({}));
  expect(res.status).toBe(400);
});

test('GET: 不正なfacility_id UUID → 400', async () => {
  const res = await GET(makeGetRequest({ facility_id: 'bad-id' }));
  expect(res.status).toBe(400);
});

test('GET: 非管理者 → 401 (IDOR防止)', async () => {
  mockAnonFrom.mockReturnValue(memberChain(null));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(401);
});

test('GET: 管理者 → 200 with subscriptions', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain([{ id: SUB_UUID }]));
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.subscriptions).toBeDefined();
});

// ─── POST: grant subscription ────────────────────────────────────────────────

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makePostRequest());
  expect(res.status).toBe(401);
});

test('POST: 不正ボディ → 400', async () => {
  const res = await POST(makePostRequest({ facility_id: 'bad' }));
  expect(res.status).toBe(400);
});

test('POST: 非管理者 → 401', async () => {
  mockAnonFrom.mockReturnValue(memberChain(null));
  const res = await POST(makePostRequest());
  expect(res.status).toBe(401);
});

test('POST: プランが見つからない → 404', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(null));
  const res = await POST(makePostRequest());
  expect(res.status).toBe(404);
});

test('POST: DB挿入失敗 → 500', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ valid_months: 3 }); // plan found
    return {
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn(() => Promise.resolve({ data: null, error: { message: 'DB error' } })),
        }),
      }),
    };
  });
  const res = await POST(makePostRequest());
  expect(res.status).toBe(500);
});

test('POST: 正常付与 → 201 with subscription', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ valid_months: 3 });
    return {
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn(() => Promise.resolve({ data: { id: SUB_UUID }, error: null })),
        }),
      }),
    };
  });
  const res = await POST(makePostRequest());
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.subscription).toBeDefined();
});

// ─── PATCH: status update path ───────────────────────────────────────────────

test('PATCH: ステータス変更 (cancelled) → 200', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ facility_id: FACILITY_UUID }); // sub lookup
    return {
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn(() => Promise.resolve({ data: { id: SUB_UUID, status: 'cancelled' }, error: null })),
          }),
        }),
      }),
    };
  });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID, status: 'cancelled' }));
  expect(res.status).toBe(200);
});

test('PATCH: ステータス変更DB失敗 → 500', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ facility_id: FACILITY_UUID });
    return {
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn(() => Promise.resolve({ data: null, error: { message: 'DB error' } })),
          }),
        }),
      }),
    };
  });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID, status: 'paused' }));
  expect(res.status).toBe(500);
});

// ─── PATCH: session use path ──────────────────────────────────────────────────

test('PATCH: サブスクが active でない → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(buildActiveSub({ status: 'cancelled' })));
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(400);
});

test('PATCH: 有効期限切れ → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(buildActiveSub({ ends_at: new Date(Date.now() - 1000).toISOString() })));
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(400);
});

test('PATCH: 月上限到達 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  const futureReset = new Date(Date.now() + 86400_000).toISOString();
  mockAdminFrom.mockReturnValue(singleChain(buildActiveSub({
    sessions_used_this_month: 4,
    month_reset_at: futureReset,
  })));
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(400);
});

test('PATCH: CAS競合 (同時リクエスト) → 409', async () => {
  let callNum = 0;
  const futureReset = new Date(Date.now() + 86400_000).toISOString();
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(buildActiveSub({ month_reset_at: futureReset }));
    // CAS miss: update returns null data (another request already incremented)
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
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(409);
});

test('PATCH: booking_id が他ユーザーのもの → 400', async () => {
  let callNum = 0;
  const futureReset = new Date(Date.now() + 86400_000).toISOString();
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(buildActiveSub({ month_reset_at: futureReset }));
    // booking lookup — wrong user AND wrong facility
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(() => Promise.resolve({
        data: { id: BOOKING_UUID, user_id: 'other-user', facility_id: 'other-facility' },
        error: null,
      })),
    };
  });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID, booking_id: BOOKING_UUID }));
  expect(res.status).toBe(400);
});

test('PATCH: 正常セッション使用 → 200', async () => {
  let callNum = 0;
  const futureReset = new Date(Date.now() + 86400_000).toISOString();
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) {
      return singleChain(buildActiveSub({ month_reset_at: futureReset }));
    }
    if (callNum === 2) {
      // CAS update success
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn(() => Promise.resolve({ data: { id: SUB_UUID, sessions_used_this_month: 1 }, error: null })),
              }),
            }),
          }),
        }),
      };
    }
    // usage log insert
    return {
      insert: jest.fn(() => Promise.resolve({ error: null })),
    };
  });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.subscription).toBeDefined();
});

// ─── GET: additional branches ─────────────────────────────────────────────────

test('GET: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(429);
});

test('GET: 不正な user_id UUID → 400', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, user_id: 'bad-user-id' }));
  expect(res.status).toBe(400);
});

test('GET: user_id フィルタ付きで管理者 → 200', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'admin' }));
  mockAdminFrom.mockReturnValue(singleChain([{ id: SUB_UUID }]));
  const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID, user_id: TARGET_USER }));
  expect(res.status).toBe(200);
});

test('GET: DB エラー → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(null, { message: 'DB error' }));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(500);
});

// ─── POST: additional branches ────────────────────────────────────────────────

test('POST: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makePostRequest());
  expect(res.status).toBe(429);
});

test('POST: CSRF エラー → CSRF レスポンス', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(
    new Response(JSON.stringify({ error: 'csrf' }), { status: 403 })
  );
  const res = await POST(makePostRequest());
  expect(res.status).toBe(403);
});

test('POST: JSON パース失敗 → 400', async () => {
  const req = new Request('http://localhost/api/admin/user-subscriptions', {
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
    if (callNum === 1) return singleChain({ valid_months: 6 });
    return {
      insert: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn(() => Promise.resolve({ data: { id: SUB_UUID }, error: null })),
        }),
      }),
    };
  });
  const res = await POST(makePostRequest({
    facility_id: FACILITY_UUID,
    user_id: TARGET_USER,
    plan_id: PLAN_UUID,
    notes: 'テスト用メモ',
  }));
  expect(res.status).toBe(201);
});

// ─── PATCH: status path additional branches ───────────────────────────────────

test('PATCH: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID, status: 'cancelled' }));
  expect(res.status).toBe(429);
});

test('PATCH: CSRF エラー → CSRF レスポンス', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(
    new Response(JSON.stringify({ error: 'csrf' }), { status: 403 })
  );
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(403);
});

test('PATCH: ステータス変更でサブスクが存在しない → 404', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(null)); // sub not found
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID, status: 'active' }));
  expect(res.status).toBe(404);
});

test('PATCH: ステータス変更で非管理者 → 401', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ facility_id: FACILITY_UUID }); // sub found
    return singleChain(null);
  });
  mockAnonFrom.mockReturnValue(memberChain(null)); // not admin
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID, status: 'paused' }));
  expect(res.status).toBe(401);
});

// ─── PATCH: session use additional branches ───────────────────────────────────

test('PATCH: セッション使用でサブスクが存在しない → 404', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(null));
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(404);
});

test('PATCH: 本人でも管理者でもない → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'other-user-id' } } });
  mockAnonFrom.mockReturnValue(memberChain(null)); // not admin
  const futureReset = new Date(Date.now() + 86400_000).toISOString();
  mockAdminFrom.mockReturnValue(singleChain(buildActiveSub({ month_reset_at: futureReset })));
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(401);
});

test('PATCH: booking_id が存在しない → 404', async () => {
  let callNum = 0;
  const futureReset = new Date(Date.now() + 86400_000).toISOString();
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(buildActiveSub({ month_reset_at: futureReset }));
    // booking not found
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
    };
  });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID, booking_id: BOOKING_UUID }));
  expect(res.status).toBe(404);
});

test('PATCH: booking_id が施設の予約に一致 → 正常 (200)', async () => {
  let callNum = 0;
  const futureReset = new Date(Date.now() + 86400_000).toISOString();
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(buildActiveSub({ month_reset_at: futureReset }));
    if (callNum === 2) {
      // booking belongs to the same facility (admin use case)
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn(() => Promise.resolve({
          data: { id: BOOKING_UUID, user_id: 'other-user', facility_id: FACILITY_UUID },
          error: null,
        })),
      };
    }
    if (callNum === 3) {
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn(() => Promise.resolve({ data: { id: SUB_UUID, sessions_used_this_month: 1 }, error: null })),
              }),
            }),
          }),
        }),
      };
    }
    return { insert: jest.fn(() => Promise.resolve({ error: null })) };
  });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID, booking_id: BOOKING_UUID }));
  expect(res.status).toBe(200);
});

test('PATCH: 月リセット発生 → 0にリセットしてセッション使用', async () => {
  let callNum = 0;
  // month_reset_at is in the past → triggers reset
  const pastReset = new Date(Date.now() - 86400_000).toISOString();
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) {
      return singleChain(buildActiveSub({
        sessions_used_this_month: 3,
        month_reset_at: pastReset,
      }));
    }
    if (callNum === 2) {
      // monthly reset update
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn(() => Promise.resolve({ error: null })),
        }),
      };
    }
    if (callNum === 3) {
      // CAS update
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn(() => Promise.resolve({ data: { id: SUB_UUID, sessions_used_this_month: 1 }, error: null })),
              }),
            }),
          }),
        }),
      };
    }
    return { insert: jest.fn(() => Promise.resolve({ error: null })) };
  });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(200);
});

test('PATCH: CAS 更新 DB エラー → 500', async () => {
  let callNum = 0;
  const futureReset = new Date(Date.now() + 86400_000).toISOString();
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(buildActiveSub({ month_reset_at: futureReset }));
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
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(500);
});

test('PATCH: facility_id なしサブスク (subscription_plans が null) → 本人なら通過', async () => {
  // user IS the subscription owner, but facility_id is null
  let callNum = 0;
  const futureReset = new Date(Date.now() + 86400_000).toISOString();
  mockAnonFrom.mockReturnValue(memberChain(null)); // not admin
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) {
      return singleChain(buildActiveSub({
        user_id: USER_ID,
        month_reset_at: futureReset,
        subscription_plans: null, // no facility_id
      }));
    }
    if (callNum === 2) {
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn(() => Promise.resolve({ data: { id: SUB_UUID, sessions_used_this_month: 1 }, error: null })),
              }),
            }),
          }),
        }),
      };
    }
    return { insert: jest.fn(() => Promise.resolve({ error: null })) };
  });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(200);
});

test('PATCH: PATCH 不正ボディ (JSON パース失敗) → 400', async () => {
  const req = new Request('http://localhost/api/admin/user-subscriptions', {
    method: 'PATCH',
    body: 'not-json',
  });
  const res = await PATCH(req as any);
  expect(res.status).toBe(400);
});
