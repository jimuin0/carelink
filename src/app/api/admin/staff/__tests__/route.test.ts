/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/staff
 * Key assertions:
 *   - Non-member → 401 (IDOR prevention)
 *   - name max 50 chars
 *   - instagram_url must be valid URL or empty string
 *   - nomination_fee max 99999
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID       = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();
const mockAdminRpc = jest.fn();
const OPERATION_ID = '55555555-5555-4555-8555-555555555555';
const STAFF_ID = '66666666-6666-4666-8666-666666666666';

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom, rpc: mockAdminRpc }),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

function makeRequest(body: object, facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/staff');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: object = {}) {
  return { operation_id: OPERATION_ID, name: 'テストスタッフ', ...overrides };
}

function memberSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function insertSingle(data: unknown, error: unknown = null) {
  mockAdminRpc.mockResolvedValue({ data: error ? null : { staff: { ...(data as object), id: STAFF_ID }, replayed: false }, error });
  return {};
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(401);
});

test('POST: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(429);
});

test('POST: facility_id なし → 401', async () => {
  const res = await POST(makeRequest(validBody(), null));
  expect(res.status).toBe(401);
});

test('POST: 非管理者 → 401 (IDOR防止)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(401);
});

test('POST: name が空 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ name: '' })));
  expect(res.status).toBe(400);
});

test('POST: name が 51文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ name: 'a'.repeat(51) })));
  expect(res.status).toBe(400);
});

test('POST: instagram_url が不正URL → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ instagram_url: 'not-a-url' })));
  expect(res.status).toBe(400);
});

test('POST: nomination_fee が 100000 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ nomination_fee: 100000 })));
  expect(res.status).toBe(400);
});

test('POST: years_experience が 100 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ years_experience: 100 })));
  expect(res.status).toBe(400);
});

test('POST: DB挿入失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle(null, { message: 'DB error' }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(500);
});

test('POST: 正常作成 → 201 with staff', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'aaa', name: 'テストスタッフ' }));
  const res = await POST(makeRequest(validBody()));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.staff).toBeDefined();
});

test('POST: instagram_url が空文字 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'aaa', name: 'テストスタッフ' }));
  const res = await POST(makeRequest(validBody({ instagram_url: '' })));
  expect(res.status).toBe(201);
});

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(403);
});

test('POST: name が 50文字 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'aaa' }));
  const res = await POST(makeRequest(validBody({ name: 'a'.repeat(50) })));
  expect(res.status).toBe(201);
});

test('POST: nomination_fee が 99999 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'aaa' }));
  const res = await POST(makeRequest(validBody({ nomination_fee: 99999 })));
  expect(res.status).toBe(201);
});

test('POST: years_experience が 0 と 99 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'aaa' }));
  const res0 = await POST(makeRequest(validBody({ years_experience: 0 })));
  expect(res0.status).toBe(201);

  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'aaa' }));
  const res99 = await POST(makeRequest(validBody({ years_experience: 99 })));
  expect(res99.status).toBe(201);
});

test('POST: specialties が 20件 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'aaa' }));
  const specialties = Array.from({ length: 20 }, (_, i) => `spec${i}`);
  const res = await POST(makeRequest(validBody({ specialties })));
  expect(res.status).toBe(201);
});

test('POST: specialties が 21件 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const specialties = Array.from({ length: 21 }, (_, i) => `spec${i}`);
  const res = await POST(makeRequest(validBody({ specialties })));
  expect(res.status).toBe(400);
});

test('POST: facility_id が不正UUID → 401', async () => {
  const url = new URL('http://localhost/api/admin/staff');
  url.searchParams.set('facility_id', 'bad-uuid');
  const req = new (require('next/server').NextRequest)(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validBody()),
  });
  const res = await POST(req);
  expect(res.status).toBe(401);
});

test('POST: writeAuditLog が呼ばれる', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'aaa', name: 'テストスタッフ' }));
  const { writeAuditLog } = require('@/lib/audit-logger');
  await POST(makeRequest(validBody()));
  await new Promise(r => setTimeout(r, 10));
  expect(writeAuditLog).toHaveBeenCalled();
});

test('POST: レスポンスが { staff: ... } 形式', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'aaa', name: 'テストスタッフ' }));
  const res = await POST(makeRequest(validBody()));
  const json = await res.json();
  expect(json.staff).toBeDefined();
  expect(json.staff.id).toBe(STAFF_ID);
});

test('POST: レートリミット params (20/60s)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'aaa' }));
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await POST(makeRequest(validBody()));
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(20);
  expect(call[3]).toBe(60_000);
});

test('POST: actor/facility/operation and validated input go to one atomic RPC, no separate inserts/deletes', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  insertSingle({ id: STAFF_ID });
  const res = await POST(makeRequest(validBody({ name: '  trimmed  ' })));
  expect(res.status).toBe(201);
  expect(mockAdminRpc).toHaveBeenCalledWith('create_staff_with_schedules_atomic', {
    p_actor_id: USER_ID, p_facility_id: FACILITY_UUID, p_operation_id: OPERATION_ID, p_input: { name: 'trimmed' },
  });
  expect(mockAdminFrom).not.toHaveBeenCalled();
});
test('POST: data alongside RPC error never counts as successful staff creation', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminRpc.mockResolvedValue({ data: { staff: { id: STAFF_ID }, replayed: false }, error: { message: 'schedule seed failed' } });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(500); expect(mockAdminFrom).not.toHaveBeenCalled();
});
test.each([null, {}, { staff: {}, replayed: false }, { staff: { id: STAFF_ID } }])('POST: malformed RPC success fails visibly', async data => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminRpc.mockResolvedValue({ data, error: null });
  expect((await POST(makeRequest(validBody()))).status).toBe(500);
});
test('POST: replay returns original staff and receipt flag without a second insert', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminRpc.mockResolvedValue({ data: { staff: { id: STAFF_ID }, replayed: true }, error: null });
  expect(await (await POST(makeRequest(validBody()))).json()).toEqual({ staff: { id: STAFF_ID }, replayed: true });
});
test.each([{ operation_id: undefined }, { operation_id: 'invalid' }])('POST: stale/non-idempotent clients must reload instead of creating twice', async fields => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody(fields)));
  expect(res.status).toBe(400); expect((await res.json()).error).toContain('再読み込み'); expect(mockAdminRpc).not.toHaveBeenCalled();
});

import { GET } from '../route';
function recoveryRequest(query = `operation_id=${OPERATION_ID}`) { return new NextRequest(`http://localhost/api/admin/staff?facility_id=${FACILITY_UUID}&${query}`); }
test('GET recovery validates current membership and never caches operation state', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID })); mockAdminRpc.mockResolvedValue({ data: { state: 'saved', staff_id: STAFF_ID }, error: null });
  const res = await GET(recoveryRequest()); expect(res.status).toBe(200); expect(res.headers.get('Cache-Control')).toBe('no-store');
  expect(await res.json()).toEqual({ state: 'saved', staff_id: STAFF_ID });
  expect(mockAdminRpc).toHaveBeenCalledWith('get_staff_mutation_operation', { p_actor_id: USER_ID, p_facility_id: FACILITY_UUID, p_operation_id: OPERATION_ID, p_kind: 'create', p_staff_id: null });
});
test.each(['absent','retired'])('GET confirmed %s operation allowed', async state => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID })); mockAdminRpc.mockResolvedValue({ data: { state }, error: null }); expect((await GET(recoveryRequest())).status).toBe(200);
});
test.each(['operation_id=bad', `operation_id=${OPERATION_ID}&kind=weekly`, `operation_id=${OPERATION_ID}&kind=unknown`])('GET invalid operation input rejected', async query => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID })); expect((await GET(recoveryRequest(query))).status).toBe(400); expect(mockAdminRpc).not.toHaveBeenCalled();
});
test('GET weekly operation target is passed without changing it', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID })); mockAdminRpc.mockResolvedValue({ data: { state: 'absent' }, error: null });
  expect((await GET(recoveryRequest(`operation_id=${OPERATION_ID}&kind=weekly&staff_id=${STAFF_ID}`))).status).toBe(200);
  expect(mockAdminRpc).toHaveBeenCalledWith('get_staff_mutation_operation', expect.objectContaining({ p_kind: 'weekly', p_staff_id: STAFF_ID }));
});
test('GET rate limit/unauthenticated block RPC', async () => {
  (checkRateLimit as jest.Mock).mockReturnValueOnce(true); expect((await GET(recoveryRequest())).status).toBe(429);
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null }); expect((await GET(recoveryRequest())).status).toBe(401); expect(mockAdminRpc).not.toHaveBeenCalled();
});
test.each([{ data: { state: 'saved', staff_id: STAFF_ID }, error: { message: 'read error' } }, { data: null, error: null }])('GET error/malformed state stays failure', async result => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID })); mockAdminRpc.mockResolvedValue(result); expect((await GET(recoveryRequest())).status).toBe(500);
});
