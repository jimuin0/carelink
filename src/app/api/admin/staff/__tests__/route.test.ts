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

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
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
  return { name: 'テストスタッフ', ...overrides };
}

function memberSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function insertSingle(data: unknown, error: unknown = null) {
  return {
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn(() => Promise.resolve({ data, error })),
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
  expect(json.staff.id).toBe('aaa');
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

// staff_profiles.insert(obj).select().single() と staff_schedules.insert(array) を
// 単一の from() モックで両対応する（insert 引数が配列なら schedule 用と判定）。
function staffWithScheduleMock(opts: {
  staffId?: string;
  scheduleInsert: jest.Mock;
  deleteEq?: jest.Mock;
}) {
  const obj: Record<string, unknown> = {
    insert: jest.fn((arg: unknown) =>
      Array.isArray(arg)
        ? opts.scheduleInsert(arg)
        : {
            select: jest.fn().mockReturnValue({
              single: jest.fn(() => Promise.resolve({ data: { id: opts.staffId ?? 'staff-1' }, error: null })),
            }),
          }
    ),
  };
  if (opts.deleteEq) obj.delete = jest.fn(() => ({ eq: opts.deleteEq }));
  return obj;
}

test('POST: 正常作成時にデフォルト勤務スケジュール(全7日09:00-19:00)を seed する', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const scheduleInsert = jest.fn(() => Promise.resolve({ error: null }));
  mockAdminFrom.mockReturnValue(staffWithScheduleMock({ scheduleInsert }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(201);
  const rows = scheduleInsert.mock.calls[0][0] as Array<{ staff_id: string; day_of_week: number; start_time: string; end_time: string }>;
  expect(rows).toHaveLength(7);
  expect(rows.map((r) => r.day_of_week)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(rows.every((r) => r.staff_id === 'staff-1' && r.start_time === '09:00' && r.end_time === '19:00')).toBe(true);
});

test('POST: スケジュール seed 失敗時はスタッフを削除して 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const deleteEq = jest.fn(() => Promise.resolve({ error: null }));
  const scheduleInsert = jest.fn(() => Promise.resolve({ error: { message: 'seed fail' } }));
  mockAdminFrom.mockReturnValue(staffWithScheduleMock({ scheduleInsert, deleteEq }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(500);
  expect(deleteEq).toHaveBeenCalledWith('id', 'staff-1');
});
