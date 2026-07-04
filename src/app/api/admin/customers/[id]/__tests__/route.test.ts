/**
 * @jest-environment node
 *
 * Tests for PATCH / DELETE /api/admin/customers/[id]（顧客マスター更新・削除）
 * 分岐網羅: csrf / rate limit / 不正ID / 未認証 / バリデーション / 重複(23505→409) /
 *          DB失敗(→500) / 未存在(→404) / 正常
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
const CUSTOMER_ID = '44444444-4444-4444-4444-444444444444';

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
import { PATCH, DELETE } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

function makeRequest(method: 'PATCH' | 'DELETE', body: object | null, facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/customers/' + CUSTOMER_ID);
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
}

function params(id: string = CUSTOMER_ID) {
  return { params: Promise.resolve({ id }) };
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

function updateSingle(data: unknown, error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn(() => Promise.resolve({ data, error })),
    }),
  };
}

function deleteSingle(data: unknown, error: unknown = null) {
  return {
    delete: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn(() => Promise.resolve({ data, error })),
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

// ---------- PATCH ----------
test('PATCH: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(null, { status: 403 }));
  const res = await PATCH(makeRequest('PATCH', validBody()), params());
  expect(res.status).toBe(403);
});

test('PATCH: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest('PATCH', validBody()), params());
  expect(res.status).toBe(429);
});

test('PATCH: 不正ID → 400', async () => {
  const res = await PATCH(makeRequest('PATCH', validBody()), params('bad-id'));
  expect(res.status).toBe(400);
});

test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest('PATCH', validBody()), params());
  expect(res.status).toBe(401);
});

test('PATCH: facility_id なし → 401', async () => {
  const res = await PATCH(makeRequest('PATCH', validBody(), null), params());
  expect(res.status).toBe(401);
});

test('PATCH: facility_id が不正UUID → 401', async () => {
  const res = await PATCH(makeRequest('PATCH', validBody(), 'bad-uuid'), params());
  expect(res.status).toBe(401);
});

test('PATCH: 非メンバー → 401 (IDOR防止)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await PATCH(makeRequest('PATCH', validBody()), params());
  expect(res.status).toBe(401);
});

test('PATCH: バリデーション失敗 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest('PATCH', validBody({ name: '' })), params());
  expect(res.status).toBe(400);
});

test('PATCH: 重複メール(23505) → 409', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateSingle(null, { code: '23505' }));
  const res = await PATCH(makeRequest('PATCH', validBody({ email: 'dup@example.com' })), params());
  expect(res.status).toBe(409);
});

test('PATCH: DB失敗(その他) → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateSingle(null, { code: 'XXXXX' }));
  const res = await PATCH(makeRequest('PATCH', validBody()), params());
  expect(res.status).toBe(500);
});

test('PATCH: 該当なし → 404', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateSingle(null, null));
  const res = await PATCH(makeRequest('PATCH', validBody()), params());
  expect(res.status).toBe(404);
});

test('PATCH: 全項目更新で正常 → 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateSingle({ id: CUSTOMER_ID, name: '山田 太郎' }));
  const res = await PATCH(makeRequest('PATCH', validBody({
    name_kana: 'ヤマダ', email: 'a@example.com', phone: '090-1234-5678', birthday: '1990-04-01', gender: 'female', notes: 'memo',
  })), params());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.customer.id).toBe(CUSTOMER_ID);
});

test('PATCH: 名前のみ(任意未入力・空文字)で正常 → 200（null 正規化分岐）', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateSingle({ id: CUSTOMER_ID }));
  const res = await PATCH(makeRequest('PATCH', validBody({ email: '', birthday: '' })), params());
  expect(res.status).toBe(200);
});

test('PATCH: 不正JSON body → 400（json catch 分岐）', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const url = new URL('http://localhost/api/admin/customers/' + CUSTOMER_ID);
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{bad json' });
  const res = await PATCH(req, params());
  expect(res.status).toBe(400);
});

test('PATCH: writeAuditLog が呼ばれる', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateSingle({ id: CUSTOMER_ID }));
  const { writeAuditLog } = require('@/lib/audit-logger');
  await PATCH(makeRequest('PATCH', validBody()), params());
  expect(writeAuditLog).toHaveBeenCalled();
});

// ---------- DELETE ----------
test('DELETE: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(null, { status: 403 }));
  const res = await DELETE(makeRequest('DELETE', null), params());
  expect(res.status).toBe(403);
});

test('DELETE: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await DELETE(makeRequest('DELETE', null), params());
  expect(res.status).toBe(429);
});

test('DELETE: 不正ID → 400', async () => {
  const res = await DELETE(makeRequest('DELETE', null), params('bad-id'));
  expect(res.status).toBe(400);
});

test('DELETE: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await DELETE(makeRequest('DELETE', null), params());
  expect(res.status).toBe(401);
});

test('DELETE: DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(deleteSingle(null, { message: 'DB error' }));
  const res = await DELETE(makeRequest('DELETE', null), params());
  expect(res.status).toBe(500);
});

test('DELETE: 該当なし → 404', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(deleteSingle(null, null));
  const res = await DELETE(makeRequest('DELETE', null), params());
  expect(res.status).toBe(404);
});

test('DELETE: 正常 → 200 ok', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(deleteSingle({ id: CUSTOMER_ID }));
  const res = await DELETE(makeRequest('DELETE', null), params());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('DELETE: writeAuditLog が呼ばれる', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(deleteSingle({ id: CUSTOMER_ID }));
  const { writeAuditLog } = require('@/lib/audit-logger');
  await DELETE(makeRequest('DELETE', null), params());
  expect(writeAuditLog).toHaveBeenCalled();
});
