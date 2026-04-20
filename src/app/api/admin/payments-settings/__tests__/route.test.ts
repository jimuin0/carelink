/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/payments-settings
 * Key assertions:
 *   - Non-member → 401 (IDOR prevention)
 *   - deposit_type enum validation
 *   - percent deposit_amount must be 1-100
 *   - fixed deposit_amount must be >= 100
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
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
import { PATCH } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeRequest(body: object, facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/payments-settings');
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

function updateEq(error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn(() => Promise.resolve({ error })),
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
  const res = await PATCH(makeRequest({ deposit_type: 'none', deposit_amount: 0 }));
  expect(res.status).toBe(401);
});

test('PATCH: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest({ deposit_type: 'none', deposit_amount: 0 }));
  expect(res.status).toBe(429);
});

test('PATCH: facility_id なし → 401', async () => {
  const res = await PATCH(makeRequest({ deposit_type: 'none', deposit_amount: 0 }, null));
  expect(res.status).toBe(401);
});

test('PATCH: 非管理者 → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await PATCH(makeRequest({ deposit_type: 'none', deposit_amount: 0 }));
  expect(res.status).toBe(401);
});

test('PATCH: 不正な deposit_type → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest({ deposit_type: 'half', deposit_amount: 0 }));
  expect(res.status).toBe(400);
});

test('PATCH: percent で deposit_amount が 0 → 400 (1以上必要)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest({ deposit_type: 'percent', deposit_amount: 0 }));
  expect(res.status).toBe(400);
});

test('PATCH: percent で deposit_amount が 101 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest({ deposit_type: 'percent', deposit_amount: 101 }));
  expect(res.status).toBe(400);
});

test('PATCH: fixed で deposit_amount が 99 → 400 (100円以上必要)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest({ deposit_type: 'fixed', deposit_amount: 99 }));
  expect(res.status).toBe(400);
});

test('PATCH: DB更新失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateEq({ message: 'DB error' }));
  const res = await PATCH(makeRequest({ deposit_type: 'none', deposit_amount: 0 }));
  expect(res.status).toBe(500);
});

test('PATCH: none デポジット → 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateEq(null));
  const res = await PATCH(makeRequest({ deposit_type: 'none', deposit_amount: 0 }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('PATCH: percent で 50% → 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateEq(null));
  const res = await PATCH(makeRequest({ deposit_type: 'percent', deposit_amount: 50 }));
  expect(res.status).toBe(200);
});

test('PATCH: fixed で 1000円 → 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateEq(null));
  const res = await PATCH(makeRequest({ deposit_type: 'fixed', deposit_amount: 1000 }));
  expect(res.status).toBe(200);
});
