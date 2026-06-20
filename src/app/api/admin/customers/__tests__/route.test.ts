/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/customers（顧客マスター作成）
 * 分岐網羅: csrf / rate limit / 未認証 / facility_id 不正 / 非メンバー /
 *          バリデーション各種 / 重複メール(23505→409) / DB失敗(→500) / 正常(201)
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

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
  const url = new URL('http://localhost/api/admin/customers');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: object = {}) {
  return { name: '山田 太郎', ...overrides };
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

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(403);
});

test('POST: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(429);
});

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(401);
});

test('POST: facility_id なし → 401', async () => {
  const res = await POST(makeRequest(validBody(), null));
  expect(res.status).toBe(401);
});

test('POST: facility_id が不正UUID → 401', async () => {
  const res = await POST(makeRequest(validBody(), 'bad-uuid'));
  expect(res.status).toBe(401);
});

test('POST: 非メンバー → 401 (IDOR防止)', async () => {
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
  const res = await POST(makeRequest(validBody({ name: 'あ'.repeat(51) })));
  expect(res.status).toBe(400);
});

test('POST: email が不正 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ email: 'not-an-email' })));
  expect(res.status).toBe(400);
});

test('POST: birthday が不正形式 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ birthday: '2020/01/01' })));
  expect(res.status).toBe(400);
});

test('POST: gender が不正値 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ gender: 'x' })));
  expect(res.status).toBe(400);
});

test('POST: notes が 2001文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ notes: 'a'.repeat(2001) })));
  expect(res.status).toBe(400);
});

test('POST: 重複メール(23505) → 409', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle(null, { code: '23505', message: 'dup' }));
  const res = await POST(makeRequest(validBody({ email: 'dup@example.com' })));
  expect(res.status).toBe(409);
});

test('POST: DB挿入失敗(その他) → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle(null, { code: 'XXXXX', message: 'DB error' }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(500);
});

test('POST: 全項目入力で正常作成 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'cust-1', name: '山田 太郎' }));
  const res = await POST(makeRequest(validBody({
    name_kana: 'ヤマダ タロウ',
    email: 'taro@example.com',
    phone: '090-1234-5678',
    birthday: '1990-04-01',
    gender: 'male',
    notes: '常連',
  })));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.customer.id).toBe('cust-1');
});

test('POST: 名前のみ(任意項目すべて未入力)で正常作成 → 201（?? null 分岐）', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'cust-2', name: '佐藤' }));
  const res = await POST(makeRequest({ name: '佐藤' }));
  expect(res.status).toBe(201);
});

test('POST: email/birthday 空文字 → null 正規化で 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const insert = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({ single: jest.fn(() => Promise.resolve({ data: { id: 'cust-3' }, error: null })) }),
  });
  mockAdminFrom.mockReturnValue({ insert });
  const res = await POST(makeRequest(validBody({ email: '', birthday: '' })));
  expect(res.status).toBe(201);
  const inserted = insert.mock.calls[0][0];
  expect(inserted.email).toBeNull();
  expect(inserted.birthday).toBeNull();
});

test('POST: 不正JSON body → 400（json catch 分岐）', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const url = new URL('http://localhost/api/admin/customers');
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

test('POST: writeAuditLog が呼ばれる', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'cust-1', name: '山田 太郎' }));
  const { writeAuditLog } = require('@/lib/audit-logger');
  await POST(makeRequest(validBody()));
  expect(writeAuditLog).toHaveBeenCalled();
});
