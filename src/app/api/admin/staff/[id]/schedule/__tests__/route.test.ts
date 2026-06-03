/**
 * @jest-environment node
 *
 * Tests for PUT/POST/DELETE /api/admin/staff/[id]/schedule
 * Key assertions:
 *   - UUID_REGEX for [id]
 *   - Non-member → 401
 *   - Staff not in facility → 401
 *   - PUT: end_time must be after start_time
 *   - POST: override upsert; end_time > start_time when not holiday
 *   - DELETE: override_id must be RFC 4122 UUID
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const STAFF_UUID    = '11111111-1111-1111-1111-111111111111';
const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID       = '33333333-3333-3333-3333-333333333333';
const OVERRIDE_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // RFC 4122

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { PUT, POST, DELETE } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeProps(id = STAFF_UUID) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(method: string, body: object, facilityId: string | null = FACILITY_UUID) {
  const url = new URL(`http://localhost/api/admin/staff/${STAFF_UUID}/schedule`);
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Anon client: facility_members membership check (ends with .single())
function memberSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

// Admin call 1: staff_profiles check (ends with .single())
function staffSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

// Admin call 2 (PUT): delete().eq() → Promise
function deleteEq(error: unknown = null) {
  return {
    delete: jest.fn().mockReturnValue({
      eq: jest.fn(() => Promise.resolve({ error })),
    }),
  };
}

// Admin call 3 (PUT): insert() → Promise
function insertDirect(error: unknown = null) {
  return {
    insert: jest.fn(() => Promise.resolve({ error })),
  };
}

// Admin call 2 (POST): upsert() → Promise
function upsertDirect(error: unknown = null) {
  return {
    upsert: jest.fn(() => Promise.resolve({ error })),
  };
}

// Admin call 2 (DELETE): delete().eq().eq() → Promise
function deleteEqEq(error: unknown = null) {
  return {
    delete: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error })),
      }),
    }),
  };
}

const VALID_SCHEDULE = { schedules: [{ day_of_week: 1, start_time: '09:00', end_time: '18:00' }] };

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── shared: getAdminFacilityIdAndVerifyStaff branches ───────────────────────

test('PUT: 未認証ユーザー → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  expect(res.status).toBe(401);
});

test('PUT: facility_id なし → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  // makeRequest with null facilityId doesn't set the query param
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE, null), makeProps());
  expect(res.status).toBe(401);
});

test('PUT: 不正な facility_id UUID → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE, 'not-a-uuid'), makeProps());
  expect(res.status).toBe(401);
});

// ─── PUT ──────────────────────────────────────────────────────────────────────

test('PUT: 不正UUID → 400', async () => {
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('PUT: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  expect(res.status).toBe(429);
});

test('PUT: 非管理者 → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  expect(res.status).toBe(401);
});

test('PUT: スタッフが施設に所属しない → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(staffSingle(null)); // staff not found in this facility
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  expect(res.status).toBe(401);
});

test('PUT: end_time が start_time 以前 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return staffSingle({ id: STAFF_UUID });
    return deleteEq(null);
  });
  const res = await PUT(makeRequest('PUT', {
    schedules: [{ day_of_week: 1, start_time: '18:00', end_time: '09:00' }],
  }), makeProps());
  expect(res.status).toBe(400);
});

test('PUT: 正常更新（スケジュールあり）→ 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return staffSingle({ id: STAFF_UUID });
    if (callNum === 2) return deleteEq(null);
    return insertDirect(null);
  });
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('PUT: delete DBエラー → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return staffSingle({ id: STAFF_UUID });
    return deleteEq({ message: 'delete failed' });
  });
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  expect(res.status).toBe(500);
});

test('PUT: insert DBエラー → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return staffSingle({ id: STAFF_UUID });
    if (callNum === 2) return deleteEq(null);
    return insertDirect({ message: 'insert failed' });
  });
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  expect(res.status).toBe(500);
});

test('PUT: 正常更新（空スケジュール）→ 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return staffSingle({ id: STAFF_UUID });
    return deleteEq(null); // only delete, no insert
  });
  const res = await PUT(makeRequest('PUT', { schedules: [] }), makeProps());
  expect(res.status).toBe(200);
});

// ─── POST ─────────────────────────────────────────────────────────────────────

test('POST: 不正UUID → 400', async () => {
  const res = await POST(makeRequest('POST', { date: '2026-01-15', is_holiday: false }), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('POST: date 不正形式 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return staffSingle({ id: STAFF_UUID });
    return upsertDirect(null);
  });
  const res = await POST(makeRequest('POST', { date: '2026/01/15', is_holiday: false }), makeProps());
  expect(res.status).toBe(400);
});

test('POST: 終了時間が開始時間より前 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return staffSingle({ id: STAFF_UUID });
    return upsertDirect(null);
  });
  const res = await POST(makeRequest('POST', {
    date: '2026-01-15', is_holiday: false, start_time: '18:00', end_time: '09:00',
  }), makeProps());
  expect(res.status).toBe(400);
});

test('POST: 正常作成（休日）→ 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return staffSingle({ id: STAFF_UUID });
    return upsertDirect(null);
  });
  const res = await POST(makeRequest('POST', { date: '2026-01-15', is_holiday: true }), makeProps());
  expect(res.status).toBe(201);
});

test('POST: 正常作成（勤務）→ 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return staffSingle({ id: STAFF_UUID });
    return upsertDirect(null);
  });
  const res = await POST(makeRequest('POST', {
    date: '2026-01-15', is_holiday: false, start_time: '09:00', end_time: '18:00',
  }), makeProps());
  expect(res.status).toBe(201);
});

test('POST: upsert DBエラー → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return staffSingle({ id: STAFF_UUID });
    return upsertDirect({ message: 'upsert failed' });
  });
  const res = await POST(makeRequest('POST', { date: '2026-01-15', is_holiday: true }), makeProps());
  expect(res.status).toBe(500);
});

test('POST: is_holiday=true → times not included in row', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let upsertArgs: unknown;
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return staffSingle({ id: STAFF_UUID });
    return {
      upsert: jest.fn((row: unknown) => { upsertArgs = row; return Promise.resolve({ error: null }); }),
    };
  });
  await POST(makeRequest('POST', { date: '2026-01-15', is_holiday: true, start_time: '09:00', end_time: '18:00' }), makeProps());
  // times should NOT be in the upsert row when is_holiday is true
  expect((upsertArgs as any).start_time).toBeUndefined();
  expect((upsertArgs as any).end_time).toBeUndefined();
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

test('DELETE: override_id が非RFC4122UUID → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return staffSingle({ id: STAFF_UUID });
    return deleteEqEq(null);
  });
  const res = await DELETE(makeRequest('DELETE', { override_id: 'bad-uuid' }), makeProps());
  expect(res.status).toBe(400);
});

test('DELETE: DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return staffSingle({ id: STAFF_UUID });
    return deleteEqEq({ message: 'DB error' });
  });
  const res = await DELETE(makeRequest('DELETE', { override_id: OVERRIDE_UUID }), makeProps());
  expect(res.status).toBe(500);
});

test('DELETE: 正常削除 → 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return staffSingle({ id: STAFF_UUID });
    return deleteEqEq(null);
  });
  const res = await DELETE(makeRequest('DELETE', { override_id: OVERRIDE_UUID }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

// ─── 追加ブランチカバレッジ ───────────────────────────────────────────

test('PUT: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await PUT(makeRequest('PUT', VALID_SCHEDULE), makeProps());
  expect(res).toBe(csrfRes);
});

test('POST: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await POST(makeRequest('POST', { date: '2026-01-15', is_holiday: true }), makeProps());
  expect(res).toBe(csrfRes);
});

test('DELETE: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await DELETE(makeRequest('DELETE', { override_id: OVERRIDE_UUID }), makeProps());
  expect(res).toBe(csrfRes);
});

test('POST: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest('POST', { date: '2026-01-15', is_holiday: true }), makeProps());
  expect(res.status).toBe(429);
});

test('DELETE: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await DELETE(makeRequest('DELETE', { override_id: OVERRIDE_UUID }), makeProps());
  expect(res.status).toBe(429);
});

test('DELETE: 不正な params.id UUID → 400', async () => {
  const res = await DELETE(makeRequest('DELETE', { override_id: OVERRIDE_UUID }), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('POST: is_holiday=false で start/end 未指定でも upsert される', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return staffSingle({ id: STAFF_UUID });
    return upsertDirect(null);
  });
  const res = await POST(makeRequest('POST', { date: '2026-01-15', is_holiday: false }), makeProps());
  expect(res.status).toBe(201);
});

test('PUT: 不正な JSON body → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(staffSingle({ id: STAFF_UUID }));
  const url = new URL(`http://localhost/api/admin/staff/${STAFF_UUID}/schedule`);
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await PUT(req, makeProps());
  expect(res.status).toBe(400);
});

test('POST: 不正な JSON body → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(staffSingle({ id: STAFF_UUID }));
  const url = new URL(`http://localhost/api/admin/staff/${STAFF_UUID}/schedule`);
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await POST(req, makeProps());
  expect(res.status).toBe(400);
});

test('DELETE: 不正な JSON body → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(staffSingle({ id: STAFF_UUID }));
  const url = new URL(`http://localhost/api/admin/staff/${STAFF_UUID}/schedule`);
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await DELETE(req, makeProps());
  expect(res.status).toBe(400);
});

// Branch coverage: line 123 — POST で getAdminFacilityIdAndVerifyStaff が null → 401
test('POST: 非管理者 (memberSingle null) → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null)); // not a member
  const res = await POST(makeRequest('POST', { date: '2026-01-15', is_holiday: true }), makeProps());
  expect(res.status).toBe(401);
});

test('POST: スタッフが施設に所属しない → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(staffSingle(null)); // staff not in facility
  const res = await POST(makeRequest('POST', { date: '2026-01-15', is_holiday: true }), makeProps());
  expect(res.status).toBe(401);
});

// Branch coverage: line 164 — DELETE で getAdminFacilityIdAndVerifyStaff が null → 401
test('DELETE: 非管理者 (memberSingle null) → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null)); // not a member
  const res = await DELETE(makeRequest('DELETE', { override_id: OVERRIDE_UUID }), makeProps());
  expect(res.status).toBe(401);
});

test('DELETE: スタッフが施設に所属しない → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(staffSingle(null)); // staff not in facility
  const res = await DELETE(makeRequest('DELETE', { override_id: OVERRIDE_UUID }), makeProps());
  expect(res.status).toBe(401);
});

test('PUT: x-forwarded-for ヘッダから IP 取得', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return staffSingle({ id: STAFF_UUID });
    if (callNum === 2) return deleteEq(null);
    return insertDirect(null);
  });
  const url = new URL(`http://localhost/api/admin/staff/${STAFF_UUID}/schedule`);
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    body: JSON.stringify(VALID_SCHEDULE),
  });
  const res = await PUT(req, makeProps());
  expect(res.status).toBe(200);
});
