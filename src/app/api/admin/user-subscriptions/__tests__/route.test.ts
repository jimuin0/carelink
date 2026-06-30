/**
 * @jest-environment node
 *
 * Tests for GET/POST/PATCH /api/admin/user-subscriptions
 * Key assertions:
 *   - セッション消費は consume_subscription_session RPC（行ロックで原子的）に集約
 *   - RPC 結果コード（not_found/inactive/expired/cap_reached）→ 対応 HTTP
 *   - Booking must belong to subscription's user/facility
 *   - Status update path (active/cancelled/paused/expired)
 *   - Non-admin → 401 (IDOR prevention)
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
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
const mockAdminRpc = jest.fn();
const mockAnonFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom, rpc: mockAdminRpc }),
}));

import { NextRequest } from 'next/server';
import { GET, POST, PATCH } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

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
    in: jest.fn(() => Promise.resolve({ data: Array.isArray(data) ? data : [data], error })),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn(() => Promise.resolve({ data: Array.isArray(data) ? data : [data], error })),
    single: jest.fn(() => Promise.resolve({ data, error })),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error })),
  };
}
// user_subscriptions 取得チェーン（select→eq→order→limit）と profiles 別取得チェーン（select→in）。
function usChain(rows: unknown[], error: unknown = null) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(), limit: jest.fn(() => Promise.resolve({ data: rows, error })) };
}
function profilesChain(profs: unknown[], error: unknown = null) {
  return { select: jest.fn().mockReturnThis(), in: jest.fn(() => Promise.resolve({ data: profs, error })) };
}

// usage log（subscription_usage_logs）への insert を受けるチェーン
function insertChain() {
  return { insert: jest.fn(() => Promise.resolve({ error: null })) };
}

// 二重消費防止の事前チェック（select→eq→eq→limit→maybeSingle）用。limit は this を返す。
function usageLogSelectChain(existing: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data: existing, error: null })),
  };
}

// booking 検証用の maybeSingle チェーン
function bookingChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function buildActiveSub(overrides: Record<string, unknown> = {}) {
  return {
    id: SUB_UUID,
    user_id: USER_ID,
    status: 'active',
    ends_at: new Date(Date.now() + 86400_000).toISOString(),
    sessions_used_this_month: 0,
    month_reset_at: new Date(Date.now() - 1000).toISOString(),
    subscription_plans: { sessions_per_month: 4, facility_id: FACILITY_UUID },
    ...overrides,
  };
}

// RPC 成功（ok:true）の既定戻り値
function rpcOk() {
  return { data: { ok: true, subscription: { id: SUB_UUID, sessions_used_this_month: 1 } }, error: null };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  // 既定は RPC 成功。消費に到達しないテスト（pre-check 400/401/404）では呼ばれない。
  mockAdminRpc.mockResolvedValue(rpcOk());
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

test('GET: 正常 → 200（profiles を別取得してマージ＝embed不使用の回帰）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation((table: string) =>
    table === 'profiles'
      ? profilesChain([{ id: USER_ID, display_name: '花子', email: 'h@example.com' }])
      : usChain([buildActiveSub()]));
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.subscriptions[0].profiles).toEqual({ display_name: '花子', email: 'h@example.com' });
});

test('GET: 0件 → 200（profiles 取得をスキップ）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation((table: string) => (table === 'profiles' ? profilesChain([]) : usChain([])));
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.subscriptions).toEqual([]);
});

test('GET: user_subscriptions が null(エラー無し) → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation((table: string) => (table === 'profiles' ? profilesChain([]) : usChain(null as unknown as unknown[])));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(500);
});

test('GET: profiles 取得失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation((table: string) =>
    table === 'profiles' ? profilesChain(null as unknown as unknown[], { message: 'db' }) : usChain([buildActiveSub()]));
  const res = await GET(makeGetRequest());
  expect(res.status).toBe(500);
});

test('GET: 該当 profiles 無しの行は profiles=null になる', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation((table: string) =>
    table === 'profiles' ? profilesChain([]) : usChain([buildActiveSub()]));
  const res = await GET(makeGetRequest());
  const json = await res.json();
  expect(json.subscriptions[0].profiles).toBeNull();
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

// ─── PATCH: session use path（RPC 集約後）──────────────────────────────────────

test('PATCH: サブスクが active でない → 400（pre-check・RPC到達せず）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(buildActiveSub({ status: 'cancelled' })));
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(400);
  expect(mockAdminRpc).not.toHaveBeenCalled();
});

test('PATCH: 有効期限切れ → 400（pre-check・RPC到達せず）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(buildActiveSub({ ends_at: new Date(Date.now() - 1000).toISOString() })));
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(400);
  expect(mockAdminRpc).not.toHaveBeenCalled();
});

test('PATCH: RPC cap_reached（上限・limit あり）→ 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(buildActiveSub()));
  mockAdminRpc.mockResolvedValue({ data: { ok: false, code: 'cap_reached', limit: 4 }, error: null });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  const json = await res.json();
  expect(res.status).toBe(400);
  expect(json.error).toMatch(/上限（4回）/);
});

test('PATCH: RPC cap_reached（limit 欠落）→ 400（?? の右側ブランチ）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(buildActiveSub()));
  mockAdminRpc.mockResolvedValue({ data: { ok: false, code: 'cap_reached' }, error: null });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  const json = await res.json();
  expect(res.status).toBe(400);
  expect(json.error).toMatch(/上限（回）/);
});

test('PATCH: RPC not_found → 404', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(buildActiveSub()));
  mockAdminRpc.mockResolvedValue({ data: { ok: false, code: 'not_found' }, error: null });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(404);
});

test('PATCH: RPC inactive（読取後にrace）→ 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(buildActiveSub()));
  mockAdminRpc.mockResolvedValue({ data: { ok: false, code: 'inactive' }, error: null });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(400);
});

test('PATCH: RPC expired（読取後にrace）→ 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(buildActiveSub()));
  mockAdminRpc.mockResolvedValue({ data: { ok: false, code: 'expired' }, error: null });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(400);
});

test('PATCH: RPC 不明コード → 500（default ブランチ）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(buildActiveSub()));
  mockAdminRpc.mockResolvedValue({ data: { ok: false, code: 'something_else' }, error: null });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(500);
});

test('PATCH: RPC 結果 null → 500（result?.ok / code 欠落で default）', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(buildActiveSub()));
  mockAdminRpc.mockResolvedValue({ data: null, error: null });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(500);
});

test('PATCH: RPC 自体がエラー → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockReturnValue(singleChain(buildActiveSub()));
  mockAdminRpc.mockResolvedValue({ data: null, error: { message: 'rpc failed' } });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(500);
});

test('PATCH: booking_id が他ユーザーのもの → 400（RPC到達せず）', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(buildActiveSub());
    return bookingChain({ id: BOOKING_UUID, user_id: 'other-user', facility_id: 'other-facility' });
  });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID, booking_id: BOOKING_UUID }));
  expect(res.status).toBe(400);
  expect(mockAdminRpc).not.toHaveBeenCalled();
});

test('PATCH: 正常セッション使用 → 200（RPC ok→利用ログ）', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(buildActiveSub());
    return insertChain(); // usage log
  });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.subscription).toBeDefined();
  expect(mockAdminRpc).toHaveBeenCalledWith('consume_subscription_session', { p_subscription_id: SUB_UUID });
});

test('PATCH: booking_id が既に当月利用記録済み → 409（二重消費防止・RPC到達せず）', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(buildActiveSub());
    if (callNum === 2) return bookingChain({ id: BOOKING_UUID, user_id: USER_ID, facility_id: FACILITY_UUID });
    return usageLogSelectChain({ id: 'existing-log' }); // 事前チェック: 既存ログあり
  });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID, booking_id: BOOKING_UUID }));
  expect(res.status).toBe(409);
  expect(mockAdminRpc).not.toHaveBeenCalled();
});

// ─── GET: additional branches ─────────────────────────────────────────────────

test('GET: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
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
  (checkRateLimit as jest.Mock).mockReturnValue(true);
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
  (checkRateLimit as jest.Mock).mockReturnValue(true);
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
  mockAdminFrom.mockReturnValue(singleChain(buildActiveSub()));
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(401);
});

test('PATCH: booking_id が存在しない → 404', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(buildActiveSub());
    return bookingChain(null); // booking not found
  });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID, booking_id: BOOKING_UUID }));
  expect(res.status).toBe(404);
});

test('PATCH: booking_id が施設の予約に一致 → 正常 (200)', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(buildActiveSub());
    if (callNum === 2) return bookingChain({ id: BOOKING_UUID, user_id: 'other-user', facility_id: FACILITY_UUID });
    if (callNum === 3) return usageLogSelectChain(null); // 二重消費事前チェック: 既存ログ無し
    return insertChain();
  });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID, booking_id: BOOKING_UUID }));
  expect(res.status).toBe(200);
});

test('PATCH: 月リセット境界でも RPC が原子的に処理 → 200', async () => {
  let callNum = 0;
  const pastReset = new Date(Date.now() - 86400_000).toISOString();
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(buildActiveSub({ sessions_used_this_month: 3, month_reset_at: pastReset }));
    return insertChain();
  });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(200);
});

test('PATCH: facility_id なしサブスク (subscription_plans が null) → 本人なら通過 (200)', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain(null)); // not admin
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(buildActiveSub({ user_id: USER_ID, subscription_plans: null }));
    return insertChain();
  });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(200);
});

test('PATCH: booking_id が本サブスクのuser_id所属 → 200', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(buildActiveSub());
    if (callNum === 2) return bookingChain({ id: BOOKING_UUID, user_id: USER_ID, facility_id: 'other-facility' });
    if (callNum === 3) return usageLogSelectChain(null); // 二重消費事前チェック: 既存ログ無し
    return insertChain();
  });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID, booking_id: BOOKING_UUID }));
  expect(res.status).toBe(200);
});

// Branch coverage: line 137 — PATCH で !user → 401
test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID, status: 'cancelled' }));
  expect(res.status).toBe(401);
});

// subscription_plans が null → facilityId が null → isAdminUser=false、isOwner=false なら 401
test('PATCH: subscription_plans null (facilityId=null) かつ本人でない → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'other-user-id' } } });
  mockAnonFrom.mockReturnValue(memberChain(null)); // not admin
  mockAdminFrom.mockReturnValue(singleChain(buildActiveSub({
    user_id: USER_ID, // different from 'other-user-id'
    subscription_plans: null,
  })));
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID }));
  expect(res.status).toBe(401);
});

test('PATCH: PATCH 不正ボディ (JSON パース失敗) → 400', async () => {
  const req = new Request('http://localhost/api/admin/user-subscriptions', {
    method: 'PATCH',
    body: 'not-json',
  });
  const res = await PATCH(req as any);
  expect(res.status).toBe(400);
});

// subscription_plans.facility_id = null → subFacilityId = null → bookingInFacility = false
// bookingOwnsUser = false → 400
test('PATCH: subscription_plans.facility_id=null かつ booking が別ユーザーのもの → bookingInFacility=false → 400', async () => {
  let callNum = 0;
  mockAnonFrom.mockReturnValue(memberChain({ role: 'owner' }));
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) {
      return singleChain(buildActiveSub({ subscription_plans: { sessions_per_month: 4, facility_id: null } }));
    }
    return bookingChain({ id: BOOKING_UUID, user_id: 'completely-different-user', facility_id: 'some-facility' });
  });
  const res = await PATCH(makePatchRequest({ subscription_id: SUB_UUID, booking_id: BOOKING_UUID }));
  expect(res.status).toBe(400);
  const json = await res.json();
  expect(json.error).toMatch(/予約がサブスクリプションと一致しません/);
});
