/**
 * @jest-environment node
 *
 * Tests for POST /api/group-booking/join
 * Key assertions:
 *   - CAS optimistic lock prevents over-capacity joins → 409
 *   - member INSERT failure rolls back confirmed_members counter
 *   - invited member confirmation returns 500 if UPDATE fails
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const USER_ID = 'user-aaa';
const GROUP_ID = 'group-bbb';

const mockFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockFrom }),
}));

import { POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

const OPEN_GROUP = {
  id: GROUP_ID,
  organizer_id: 'organizer-id',
  total_members: 4,
  confirmed_members: 2,
  status: 'open',
};

function makeRequest(body: object) {
  return new Request('http://localhost/api/group-booking/join', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// A mock chain that terminates with .single() → { data, error }
function singleChain(data: unknown, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error })),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error })),
    lt: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    insert: jest.fn(() => Promise.resolve({ error: null })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
});

// ─── Security guards ──────────────────────────────────────────────────────────

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest({ share_code: 'ABCD12' }));
  expect(res.status).toBe(401);
});

test('レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest({ share_code: 'ABCD12' }));
  expect(res.status).toBe(429);
});

test('CSRFエラー → csrfErrorを返す', async () => {
  (checkCsrf as jest.Mock).mockReturnValue(new Response(JSON.stringify({ error: 'csrf' }), { status: 403 }));
  const res = await POST(makeRequest({ share_code: 'ABCD12' }));
  expect(res.status).toBe(403);
});

test('share_code なし → 400', async () => {
  mockFrom.mockReturnValue(singleChain(null));
  const res = await POST(makeRequest({}));
  expect(res.status).toBe(400);
});

test('share_code が長すぎる (>20文字) → 400', async () => {
  const res = await POST(makeRequest({ share_code: 'A'.repeat(21) }));
  expect(res.status).toBe(400);
});

// ─── Group status guards ──────────────────────────────────────────────────────

test('存在しないshare_code → 404', async () => {
  mockFrom.mockReturnValue(singleChain(null));
  const res = await POST(makeRequest({ share_code: 'NOTFOUND' }));
  expect(res.status).toBe(404);
});

test('キャンセル済み予約 → 410', async () => {
  mockFrom.mockReturnValue(singleChain({ ...OPEN_GROUP, status: 'cancelled' }));
  const res = await POST(makeRequest({ share_code: 'CODE01' }));
  expect(res.status).toBe(410);
});

test('完了済み予約 → 410', async () => {
  mockFrom.mockReturnValue(singleChain({ ...OPEN_GROUP, status: 'completed' }));
  const res = await POST(makeRequest({ share_code: 'CODE01' }));
  expect(res.status).toBe(410);
});

// ─── Already-joined path ──────────────────────────────────────────────────────

test('既にconfirmed参加済み → 200 already_joined:true', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(OPEN_GROUP); // group lookup
    if (callNum === 2) return singleChain({ id: 'mem-1', status: 'confirmed' }); // existing member
    return singleChain(null);
  });

  const res = await POST(makeRequest({ share_code: 'CODE01' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.already_joined).toBe(true);
});

test('invitedメンバーが参加 → confirmed更新 → 200', async () => {
  let callNum = 0;
  const updateMock = jest.fn(() => ({
    eq: jest.fn(() => Promise.resolve({ error: null })),
  }));
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(OPEN_GROUP);
    if (callNum === 2) return singleChain({ id: 'mem-1', status: 'invited' });
    // callNum === 3: update invited → confirmed
    return { update: updateMock, eq: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis() };
  });

  const res = await POST(makeRequest({ share_code: 'CODE01' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.already_joined).toBe(true);
  expect(updateMock).toHaveBeenCalled();
});

test('invitedメンバーのconfirmed更新失敗 → 500', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(OPEN_GROUP);
    if (callNum === 2) return singleChain({ id: 'mem-1', status: 'invited' });
    return {
      update: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: { message: 'DB error' } })),
      })),
    };
  });

  const res = await POST(makeRequest({ share_code: 'CODE01' }));
  expect(res.status).toBe(500);
});

// ─── New join: CAS capacity guard ─────────────────────────────────────────────

test('正常参加フロー → 200 joined:true', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(OPEN_GROUP);
    if (callNum === 2) return singleChain(null); // no existing member
    if (callNum === 3) {
      // capacity CAS update → succeeds
      return {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        lt: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn(() => Promise.resolve({ data: { id: GROUP_ID }, error: null })),
      };
    }
    // member insert
    return { insert: jest.fn(() => Promise.resolve({ error: null })) };
  });

  const res = await POST(makeRequest({ share_code: 'CODE01' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.joined).toBe(true);
});

test('定員に達している (CAS失敗) → 409', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(OPEN_GROUP);
    if (callNum === 2) return singleChain(null); // no existing member
    // CAS update returns no rows (full or race)
    return {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn(() => Promise.resolve({ data: null, error: { code: 'PGRST116' } })),
    };
  });

  const res = await POST(makeRequest({ share_code: 'CODE01' }));
  expect(res.status).toBe(409);
});

test('member INSERT失敗 → confirmed_membersをロールバック → 500', async () => {
  let callNum = 0;
  const rollbackUpdate = jest.fn().mockReturnValue({
    eq: jest.fn(() => Promise.resolve({ error: null })),
  });

  mockFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain(OPEN_GROUP);
    if (callNum === 2) return singleChain(null); // no existing member
    if (callNum === 3) {
      // CAS capacity update → succeeds
      return {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        lt: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn(() => Promise.resolve({ data: { id: GROUP_ID }, error: null })),
      };
    }
    if (table === 'group_booking_members') {
      // member insert → fails
      return { insert: jest.fn(() => Promise.resolve({ error: { message: 'insert failed' } })) };
    }
    // rollback update on group_bookings
    return { update: rollbackUpdate };
  });

  const res = await POST(makeRequest({ share_code: 'CODE01' }));
  expect(res.status).toBe(500);
  // Rollback must be called to restore confirmed_members
  expect(rollbackUpdate).toHaveBeenCalled();
});
