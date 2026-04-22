/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/telehealth/[id]
 * Key assertions:
 *   - Non-member → 401 (IDOR prevention)
 *   - Invalid status → 400
 *   - facility_id defence-in-depth in UPDATE WHERE
 *   - Session not found → 404
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const SESSION_UUID  = '11111111-1111-1111-1111-111111111111';
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
import { PATCH } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeProps(id = SESSION_UUID) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(body: object, facilityId: string | null = FACILITY_UUID) {
  const url = new URL(`http://localhost/api/admin/telehealth/${SESSION_UUID}`);
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function memberSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function updateFacilityChain(data: unknown, error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn(() => Promise.resolve({ data, error })),
          }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest({ status: 'completed' }), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest({ status: 'completed' }), makeProps());
  expect(res.status).toBe(429);
});

test('PATCH: 不正なUUID → 400', async () => {
  const res = await PATCH(makeRequest({ status: 'completed' }), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('PATCH: facility_id なし → 401', async () => {
  const res = await PATCH(makeRequest({ status: 'completed' }, null), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: 非管理者 → 401 (IDOR防止)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await PATCH(makeRequest({ status: 'completed' }), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: 不正な status → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest({ status: 'deleted' }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: セッションが見つからない → 404', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateFacilityChain(null));
  const res = await PATCH(makeRequest({ status: 'completed' }), makeProps());
  expect(res.status).toBe(404);
});

test('PATCH: DB更新失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateFacilityChain(null, { message: 'DB error' }));
  const res = await PATCH(makeRequest({ status: 'completed' }), makeProps());
  expect(res.status).toBe(500);
});

test('PATCH: 正常更新 → 200 with session', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateFacilityChain({ id: SESSION_UUID, status: 'completed' }));
  const res = await PATCH(makeRequest({ status: 'completed' }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.session).toBeDefined();
});

test('PATCH: status が no_show → 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateFacilityChain({ id: SESSION_UUID, status: 'no_show' }));
  const res = await PATCH(makeRequest({ status: 'no_show' }), makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: status=scheduled → 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateFacilityChain({ id: SESSION_UUID, status: 'scheduled' }));
  const res = await PATCH(makeRequest({ status: 'scheduled' }), makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: status=in_progress → 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateFacilityChain({ id: SESSION_UUID, status: 'in_progress' }));
  const res = await PATCH(makeRequest({ status: 'in_progress' }), makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await PATCH(makeRequest({ status: 'completed' }), makeProps());
  expect(res.status).toBe(403);
});

test('PATCH: writeAuditLog が呼ばれる', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateFacilityChain({ id: SESSION_UUID, status: 'completed' }));
  const { writeAuditLog } = require('@/lib/audit-logger');
  await PATCH(makeRequest({ status: 'completed' }), makeProps());
  await new Promise(r => setTimeout(r, 10));
  expect(writeAuditLog).toHaveBeenCalled();
});

test('PATCH: レスポンスが { session: ... } 形式', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateFacilityChain({ id: SESSION_UUID, status: 'completed' }));
  const res = await PATCH(makeRequest({ status: 'completed' }), makeProps());
  const json = await res.json();
  expect(json.session).toBeDefined();
  expect(json.session.id).toBe(SESSION_UUID);
});

test('PATCH: facility_id が不正UUID → 401', async () => {
  const url = new URL(`http://localhost/api/admin/telehealth/${SESSION_UUID}`);
  url.searchParams.set('facility_id', 'bad-uuid');
  const req = new NextRequest(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed' }),
  });
  const res = await PATCH(req, makeProps());
  expect(res.status).toBe(401);
});
