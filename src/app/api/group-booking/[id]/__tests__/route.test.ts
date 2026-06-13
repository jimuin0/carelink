/**
 * @jest-environment node
 *
 * Tests for GET/PATCH/DELETE /api/group-booking/[id]
 * Key assertions:
 *   - GET: non-organizer non-member → 403 (IDOR prevention)
 *   - DELETE: organizer_id defence-in-depth in WHERE clause
 *   - DELETE: cancel DB error → 500
 *   - PATCH: only organizer can update
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const GROUP_UUID = '11111111-1111-1111-1111-111111111111';
const ORGANIZER_ID = '22222222-2222-2222-2222-222222222222';
const MEMBER_ID = '33333333-3333-3333-3333-333333333333';
const STRANGER_ID = '44444444-4444-4444-4444-444444444444';

const mockAdminFrom = jest.fn();
const mockAnonFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { GET, PATCH, DELETE } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

const OTHER_MEMBER_ID = '55555555-5555-5555-5555-555555555555';

const OPEN_GROUP = {
  id: GROUP_UUID,
  organizer_id: ORGANIZER_ID,
  status: 'open',
  facility_profiles: { name: 'テスト施設', slug: 'test', phone: '06-1234-5678' },
  group_booking_members: [
    { user_id: ORGANIZER_ID, guest_name: '主催 太郎', guest_email: 'org@example.com', guest_phone: '090-1111-1111', status: 'confirmed', is_organizer: true },
    { user_id: MEMBER_ID, guest_name: 'メンバー 花子', guest_email: 'mem@example.com', guest_phone: '090-2222-2222', status: 'confirmed', is_organizer: false },
    { user_id: OTHER_MEMBER_ID, guest_name: '他 次郎', guest_email: 'other@example.com', guest_phone: '090-3333-3333', status: 'confirmed', is_organizer: false },
  ],
};

function makeRequest(method: string, id = GROUP_UUID, body?: object) {
  return new Request(`http://localhost/api/group-booking/${id}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeProps(id = GROUP_UUID) {
  return { params: Promise.resolve({ id }) };
}

function singleChain(data: unknown, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: ORGANIZER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── GET: security ────────────────────────────────────────────────────────────

test('GET: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  mockAdminFrom.mockReturnValue(singleChain(OPEN_GROUP));
  const res = await GET(makeRequest('GET'), makeProps());
  expect(res.status).toBe(401);
});

test('GET: 不正なUUID → 400', async () => {
  const res = await GET(makeRequest('GET', 'not-uuid'), makeProps('not-uuid'));
  expect(res.status).toBe(400);
});

test('GET: グループが存在しない → 404', async () => {
  mockAdminFrom.mockReturnValue(singleChain(null));
  const res = await GET(makeRequest('GET'), makeProps());
  expect(res.status).toBe(404);
});

test('GET: 主催者でもメンバーでもない → 403 (IDOR防止)', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: STRANGER_ID } } });
  mockAdminFrom.mockReturnValue(singleChain(OPEN_GROUP));
  const res = await GET(makeRequest('GET'), makeProps());
  expect(res.status).toBe(403);
});

test('GET: 主催者 → 200', async () => {
  mockAdminFrom.mockReturnValue(singleChain(OPEN_GROUP));
  const res = await GET(makeRequest('GET'), makeProps());
  expect(res.status).toBe(200);
});

test('GET: メンバー → 200', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: MEMBER_ID } } });
  mockAdminFrom.mockReturnValue(singleChain(OPEN_GROUP));
  const res = await GET(makeRequest('GET'), makeProps());
  expect(res.status).toBe(200);
});

// ─── GET: PII 漏洩防止（T5） ───────────────────────────────────────────────────

test('GET: 主催者は全ゲストの PII（氏名/メール/電話）を受け取る', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: ORGANIZER_ID } } });
  mockAdminFrom.mockReturnValue(singleChain(OPEN_GROUP));
  const res = await GET(makeRequest('GET'), makeProps());
  const json = await res.json();
  const other = json.group_booking_members.find((m: { user_id: string }) => m.user_id === OTHER_MEMBER_ID);
  expect(other.guest_email).toBe('other@example.com');
  expect(other.guest_phone).toBe('090-3333-3333');
  expect(other.guest_name).toBe('他 次郎');
});

test('GET: メンバーは他ゲストの PII を受け取らない（自分の行のみ保持）', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: MEMBER_ID } } });
  mockAdminFrom.mockReturnValue(singleChain(OPEN_GROUP));
  const res = await GET(makeRequest('GET'), makeProps());
  const json = await res.json();
  const me = json.group_booking_members.find((m: { user_id: string }) => m.user_id === MEMBER_ID);
  const other = json.group_booking_members.find((m: { user_id: string }) => m.user_id === OTHER_MEMBER_ID);
  // 自分の行は保持
  expect(me.guest_email).toBe('mem@example.com');
  expect(me.guest_phone).toBe('090-2222-2222');
  // 他ゲストの PII は全て null（漏洩防止）。行自体（user_id/status）は残す。
  expect(other.guest_name).toBeNull();
  expect(other.guest_email).toBeNull();
  expect(other.guest_phone).toBeNull();
  expect(other.user_id).toBe(OTHER_MEMBER_ID);
  expect(other.status).toBe('confirmed');
});

test('GET: group_booking_members が null でも主催者は 200（防御的 ?? []）', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: ORGANIZER_ID } } });
  mockAdminFrom.mockReturnValue(singleChain({ ...OPEN_GROUP, group_booking_members: null }));
  const res = await GET(makeRequest('GET'), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.group_booking_members).toEqual([]);
});

// ─── PATCH: organizer guard ───────────────────────────────────────────────────

test('PATCH: 主催者以外 → 403', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: STRANGER_ID } } });
  mockAdminFrom.mockReturnValue(singleChain({ organizer_id: ORGANIZER_ID }));
  const res = await PATCH(makeRequest('PATCH', GROUP_UUID, { status: 'confirmed' }), makeProps());
  expect(res.status).toBe(403);
});

test('PATCH: 不正なstatusは無視される → 200 (フィールドフィルタリング)', async () => {
  let callNum = 0;
  const updateMock = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn(() => Promise.resolve({ data: { id: GROUP_UUID, status: 'confirmed', notes: null }, error: null })),
      }),
    }),
  });
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ organizer_id: ORGANIZER_ID });
    return { update: updateMock };
  });
  const res = await PATCH(makeRequest('PATCH', GROUP_UUID, { status: 'confirmed', malicious_field: 'hack' }), makeProps());
  expect(res.status).toBe(200);
  // Only allowed fields should be in update call
  expect(updateMock).toHaveBeenCalledWith({ status: 'confirmed' });
});

test('PATCH: UPDATE DBエラー → 500', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ organizer_id: ORGANIZER_ID });
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
  const res = await PATCH(makeRequest('PATCH', GROUP_UUID, { status: 'confirmed' }), makeProps());
  expect(res.status).toBe(500);
});

// ─── DELETE: organizer-only cancel ───────────────────────────────────────────

test('DELETE: 主催者以外 → 403', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: STRANGER_ID } } });
  mockAdminFrom.mockReturnValue(singleChain({ organizer_id: ORGANIZER_ID }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(403);
});

test('DELETE: キャンセルDB失敗 → 500', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ organizer_id: ORGANIZER_ID }); // group lookup
    return {
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn(() => Promise.resolve({ error: { message: 'cancel failed' } })),
        }),
      }),
    };
  });
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(500);
});

test('DELETE: 正常キャンセル → 200 success:true, organizer_idをWHEREに含む', async () => {
  let callNum = 0;
  const secondEq = jest.fn(() => Promise.resolve({ error: null }));
  const firstEq = jest.fn().mockReturnValue({ eq: secondEq });
  const updateMock = jest.fn().mockReturnValue({ eq: firstEq });
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ organizer_id: ORGANIZER_ID });
    return { update: updateMock };
  });

  const res = await DELETE(makeRequest('DELETE'), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.success).toBe(true);
  // organizer_id defence-in-depth in WHERE clause
  expect(secondEq).toHaveBeenCalledWith('organizer_id', ORGANIZER_ID);
});

// ─── Additional coverage ──────────────────────────────────────────────────────

test('PATCH: CSRF エラー → 403', async () => {
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await PATCH(makeRequest('PATCH', GROUP_UUID, { status: 'confirmed' }), makeProps());
  expect(res.status).toBe(403);
});

test('DELETE: CSRF エラー → 403', async () => {
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(403);
});

test('GET: rate limit → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(makeRequest('GET'), makeProps());
  expect(res.status).toBe(429);
});

test('GET: rate limit params (30/60s)', async () => {
  mockAdminFrom.mockReturnValue(singleChain(OPEN_GROUP));
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await GET(makeRequest('GET'), makeProps());
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(30);
  expect(call[3]).toBe(60_000);
});

test('PATCH: rate limit → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest('PATCH', GROUP_UUID, { status: 'confirmed' }), makeProps());
  expect(res.status).toBe(429);
});

test('DELETE: rate limit → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(429);
});

test('GET: レスポンスが group オブジェクト直接返却', async () => {
  mockAdminFrom.mockReturnValue(singleChain(OPEN_GROUP));
  const res = await GET(makeRequest('GET'), makeProps());
  const json = await res.json();
  expect(json.id).toBe(GROUP_UUID);
  expect(json.organizer_id).toBe(ORGANIZER_ID);
});

// ─── Branch coverage 追加 ───────────────────────────────────────────────────

test('PATCH: 不正なUUID → 400', async () => {
  const res = await PATCH(makeRequest('PATCH', 'not-uuid', { status: 'confirmed' }), makeProps('not-uuid'));
  expect(res.status).toBe(400);
});

test('DELETE: 不正なUUID → 400', async () => {
  const res = await DELETE(makeRequest('DELETE', 'not-uuid'), makeProps('not-uuid'));
  expect(res.status).toBe(400);
});

test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest('PATCH', GROUP_UUID, { status: 'confirmed' }), makeProps());
  expect(res.status).toBe(401);
});

test('DELETE: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: グループが存在しない → 404', async () => {
  mockAdminFrom.mockReturnValue(singleChain(null));
  const res = await PATCH(makeRequest('PATCH', GROUP_UUID, { status: 'confirmed' }), makeProps());
  expect(res.status).toBe(404);
});

test('DELETE: グループが存在しない → 404', async () => {
  mockAdminFrom.mockReturnValue(singleChain(null));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(404);
});

test('PATCH: notes に文字列 → 500文字以内に切り詰め', async () => {
  let callNum = 0;
  const longNotes = 'a'.repeat(600);
  const updateMock = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn(() => Promise.resolve({ data: { id: GROUP_UUID, notes: 'a'.repeat(500) }, error: null })),
      }),
    }),
  });
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ organizer_id: ORGANIZER_ID });
    return { update: updateMock };
  });
  const res = await PATCH(makeRequest('PATCH', GROUP_UUID, { notes: longNotes }), makeProps());
  expect(res.status).toBe(200);
  expect(updateMock).toHaveBeenCalledWith({ notes: 'a'.repeat(500) });
});

test('PATCH: notes に非文字列 → null に変換', async () => {
  let callNum = 0;
  const updateMock = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn(() => Promise.resolve({ data: { id: GROUP_UUID }, error: null })),
      }),
    }),
  });
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ organizer_id: ORGANIZER_ID });
    return { update: updateMock };
  });
  const res = await PATCH(makeRequest('PATCH', GROUP_UUID, { notes: 12345 }), makeProps());
  expect(res.status).toBe(200);
  expect(updateMock).toHaveBeenCalledWith({ notes: null });
});

test('PATCH: body の status が allowed リスト外 → 無視', async () => {
  let callNum = 0;
  const updateMock = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn(() => Promise.resolve({ data: { id: GROUP_UUID }, error: null })),
      }),
    }),
  });
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ organizer_id: ORGANIZER_ID });
    return { update: updateMock };
  });
  const res = await PATCH(makeRequest('PATCH', GROUP_UUID, { status: 'invalid-status' }), makeProps());
  expect(res.status).toBe(200);
  expect(updateMock).toHaveBeenCalledWith({});
});

test('PATCH: body 不正JSON → catch で空オブジェクト → 200', async () => {
  let callNum = 0;
  const updateMock = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn(() => Promise.resolve({ data: { id: GROUP_UUID }, error: null })),
      }),
    }),
  });
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ organizer_id: ORGANIZER_ID });
    return { update: updateMock };
  });
  const req = new Request(`http://localhost/api/group-booking/${GROUP_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json{',
  });
  const res = await PATCH(req, makeProps());
  expect(res.status).toBe(200);
});

test('GET: x-forwarded-for ヘッダから IP 取得', async () => {
  mockAdminFrom.mockReturnValue(singleChain(OPEN_GROUP));
  const req = new Request(`http://localhost/api/group-booking/${GROUP_UUID}`, {
    method: 'GET',
    headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' },
  });
  const res = await GET(req, makeProps());
  expect(res.status).toBe(200);
});
