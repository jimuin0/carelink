/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/facility-verify
 * Key assertions:
 *   - Platform-admin only → 403
 *   - facility_id UUID required
 *   - verified_type enum ['phone','identity','site_visit']
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

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/admin/facility-verify', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function profileSingle(isAdmin: boolean) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: { is_platform_admin: isAdmin }, error: null })),
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

test('PATCH: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest({ facility_id: FACILITY_UUID, is_verified: true }));
  expect(res.status).toBe(429);
});

test('PATCH: 未認証 → 403', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest({ facility_id: FACILITY_UUID, is_verified: true }));
  expect(res.status).toBe(403);
});

test('PATCH: 一般ユーザー → 403', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(false));
  const res = await PATCH(makeRequest({ facility_id: FACILITY_UUID, is_verified: true }));
  expect(res.status).toBe(403);
});

test('PATCH: facility_id なし → 400', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  const res = await PATCH(makeRequest({ is_verified: true }));
  expect(res.status).toBe(400);
});

test('PATCH: facility_id が不正UUID → 400', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  const res = await PATCH(makeRequest({ facility_id: 'bad-uuid', is_verified: true }));
  expect(res.status).toBe(400);
});

test('PATCH: 不正な verified_type → 400', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  const res = await PATCH(makeRequest({ facility_id: FACILITY_UUID, is_verified: true, verified_type: 'video' }));
  expect(res.status).toBe(400);
});

test('PATCH: DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(updateEq({ message: 'DB error' }));
  const res = await PATCH(makeRequest({ facility_id: FACILITY_UUID, is_verified: false }));
  expect(res.status).toBe(500);
});

test('PATCH: 認証付与 (phone) → 200', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(updateEq(null));
  const res = await PATCH(makeRequest({ facility_id: FACILITY_UUID, is_verified: true, verified_type: 'phone' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.success).toBe(true);
});

test('PATCH: 認証取り消し → 200', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(updateEq(null));
  const res = await PATCH(makeRequest({ facility_id: FACILITY_UUID, is_verified: false }));
  expect(res.status).toBe(200);
});

test('PATCH: verified_type=site_visit → 200', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(updateEq(null));
  const res = await PATCH(makeRequest({ facility_id: FACILITY_UUID, is_verified: true, verified_type: 'site_visit' }));
  expect(res.status).toBe(200);
});
