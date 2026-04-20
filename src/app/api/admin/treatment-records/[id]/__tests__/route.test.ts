/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/treatment-records/[id]
 * Key assertions:
 *   - facility_id defence-in-depth in UPDATE WHERE
 *   - Non-admin → 401 (IDOR prevention)
 *   - subjective max 2000 chars
 *   - DB failure → 500, record not found → 404
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const RECORD_UUID = '11111111-1111-1111-1111-111111111111';
const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockAdminFrom = jest.fn();
const mockAnonFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { NextRequest } from 'next/server';
import { PATCH } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeRequest(body: object = { subjective: 'テスト' }, facilityId: string | null = FACILITY_UUID) {
  const url = new URL(`http://localhost/api/admin/treatment-records/${RECORD_UUID}`);
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeProps(id = RECORD_UUID) {
  return { params: Promise.resolve({ id }) };
}

function memberChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function updateFacilityIdChain(data: unknown, error: unknown = null) {
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
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(429);
});

test('PATCH: 不正なUUID → 400', async () => {
  const res = await PATCH(makeRequest(), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('PATCH: facility_id なし → 401', async () => {
  const res = await PATCH(makeRequest({ subjective: 'test' }, null), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: 非管理者 → 401 (IDOR防止)', async () => {
  mockAnonFrom.mockReturnValue(memberChain(null));
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: subjective が 2001文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest({ subjective: 'a'.repeat(2001) }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: UPDATEのWHEREにfacility_idが含まれる', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const innerEq = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      single: jest.fn(() => Promise.resolve({ data: { id: RECORD_UUID }, error: null })),
    }),
  });
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  const updateMock = jest.fn().mockReturnValue({ eq: outerEq });
  mockAdminFrom.mockReturnValue({ update: updateMock });

  await PATCH(makeRequest({ notes: 'test' }), makeProps());
  expect(outerEq).toHaveBeenCalledWith('id', RECORD_UUID);
  expect(innerEq).toHaveBeenCalledWith('facility_id', FACILITY_UUID);
});

test('PATCH: DB更新失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateFacilityIdChain(null, { message: 'DB error' }));
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(500);
});

test('PATCH: 記録が見つからない → 404', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateFacilityIdChain(null));
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(404);
});

test('PATCH: 正常更新 → 200 with record', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateFacilityIdChain({ id: RECORD_UUID, subjective: 'updated' }));
  const res = await PATCH(makeRequest({ subjective: 'updated' }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.record).toBeDefined();
});
