/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/inquiries/[id]
 * Key assertions:
 *   - facility_id defence-in-depth in UPDATE WHERE (IDOR prevention)
 *   - Invalid status → 400 (only allowed status enum values)
 *   - Non-admin → 401
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const INQUIRY_UUID = '11111111-1111-1111-1111-111111111111';
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

function makeRequest(body: object = { ticket_status: 'in_progress' }, facilityId: string | null = FACILITY_UUID) {
  const url = new URL(`http://localhost/api/admin/inquiries/${INQUIRY_UUID}`);
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeProps(id = INQUIRY_UUID) {
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
  const res = await PATCH(makeRequest({ ticket_status: 'open' }, null), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: 非管理者 → 401 (IDOR防止)', async () => {
  mockAnonFrom.mockReturnValue(memberChain(null));
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: 不正なticket_status → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest({ ticket_status: 'deleted' }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: 不正なpriority → 400', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest({ priority: 'critical' }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: UPDATEのWHEREにfacility_idが含まれる', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  const innerEq = jest.fn(() => Promise.resolve({ error: null }));
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  const updateMock = jest.fn().mockReturnValue({ eq: outerEq });
  mockAdminFrom.mockReturnValue({ update: updateMock });

  await PATCH(makeRequest({ ticket_status: 'resolved' }), makeProps());
  expect(outerEq).toHaveBeenCalledWith('id', INQUIRY_UUID);
  expect(innerEq).toHaveBeenCalledWith('facility_id', FACILITY_UUID);
});

test('PATCH: DB更新失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue({
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error: { message: 'DB error' } })),
      }),
    }),
  });
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(500);
});

test('PATCH: 正常更新 → 200 ok:true', async () => {
  mockAnonFrom.mockReturnValue(memberChain({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue({
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error: null })),
      }),
    }),
  });
  const res = await PATCH(makeRequest({ ticket_status: 'in_progress' }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});
