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

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
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
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

const OPEN_GROUP = {
  id: GROUP_UUID,
  organizer_id: ORGANIZER_ID,
  status: 'open',
  facility_profiles: { name: 'テスト施設', slug: 'test', phone: '06-1234-5678' },
  group_booking_members: [{ user_id: MEMBER_ID, status: 'confirmed' }],
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
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
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
