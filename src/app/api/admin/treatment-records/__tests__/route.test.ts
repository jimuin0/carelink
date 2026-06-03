/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/treatment-records
 * Key assertions:
 *   - Non-member → 401 (IDOR prevention via facility_id query param)
 *   - Invalid treated_at format → 400
 *   - subjective max 2000 chars
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID       = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();
const mockAdminFrom = jest.fn();

jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: () => Promise.resolve({
    from: mockAnonFrom,
    auth: { getUser: mockGetUser },
  }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
  createServerSupabaseClient: () => ({ from: mockAnonFrom }),
}));

import { NextRequest } from 'next/server';
import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

function makeRequest(body: object, facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/treatment-records');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: object = {}) {
  return { treated_at: '2026-06-01T10:00:00+09:00', ...overrides };
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

test('POST: treated_at が不正フォーマット → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ treated_at: 'not-a-date' })));
  expect(res.status).toBe(400);
});

test('POST: subjective が 2001文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ subjective: 'a'.repeat(2001) })));
  expect(res.status).toBe(400);
});

test('POST: notes が 2001文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ notes: 'a'.repeat(2001) })));
  expect(res.status).toBe(400);
});

test('POST: DB挿入失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle(null, { message: 'DB error' }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(500);
});

test('POST: 正常作成 → 201 with record', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'rec-1', treated_at: '2026-06-01T10:00:00+09:00' }));
  const res = await POST(makeRequest(validBody({ subjective: '肩こり', notes: 'テスト' })));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.record).toBeDefined();
});

test('POST: treated_at が YYYY-MM-DDTHH:MM 形式 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'rec-1' }));
  const res = await POST(makeRequest(validBody({ treated_at: '2026-06-01T10:00' })));
  expect(res.status).toBe(201);
});

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(403);
});

test('POST: objective が 2001文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ objective: 'a'.repeat(2001) })));
  expect(res.status).toBe(400);
});

test('POST: assessment が 2001文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ assessment: 'a'.repeat(2001) })));
  expect(res.status).toBe(400);
});

test('POST: plan が 2001文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ plan: 'a'.repeat(2001) })));
  expect(res.status).toBe(400);
});

test('POST: next_visit_note が 501文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ next_visit_note: 'a'.repeat(501) })));
  expect(res.status).toBe(400);
});

test('POST: menu_name が 101文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ menu_name: 'a'.repeat(101) })));
  expect(res.status).toBe(400);
});

test('POST: facility_id が不正UUID → 401', async () => {
  const url = new URL('http://localhost/api/admin/treatment-records');
  url.searchParams.set('facility_id', 'bad-uuid');
  const req = new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validBody()),
  });
  const res = await POST(req);
  expect(res.status).toBe(401);
});

test('POST: 全フィールド指定でも 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  // user_id 指定時は bookings 存在確認 → treatment_records insert の 2 経路
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'bookings') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'booking-1' } }),
      } as any;
    }
    return insertSingle({ id: 'rec-full' });
  });
  const res = await POST(makeRequest(validBody({
    user_id: '550e8400-e29b-41d4-a716-446655440099',
    menu_name: '鍼灸',
    subjective: '腰痛',
    objective: '圧痛あり',
    assessment: '腰椎症',
    plan: '週1鍼灸',
    notes: 'テスト',
    next_visit_note: '再診',
  })));
  expect(res.status).toBe(201);
});

test('POST: user_id 指定だが施設に予約なし → 403', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'bookings') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null }),
      } as any;
    }
    return insertSingle({ id: 'r1' });
  });
  const userIdValue = ['550e8400', 'e29b', '41d4', 'a716', '446655440099'].join('-');
  const res = await POST(makeRequest(validBody({ user_id: userIdValue })));
  expect(res.status).toBe(403);
});

test('POST: 不正JSON → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const url = new URL('http://localhost/api/admin/treatment-records');
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('POST: レスポンスが { record: ... } 形式', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'rec-1' }));
  const res = await POST(makeRequest(validBody()));
  const json = await res.json();
  expect(json.record).toBeDefined();
});
