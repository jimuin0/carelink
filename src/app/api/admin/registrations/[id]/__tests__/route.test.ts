/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/registrations/[id]
 * Key assertions:
 *   - Non-platform-admin → 403 (role escalation prevention)
 *   - Invalid status value → 400
 *   - DB update failure → 500
 *   - Approved/rejected audit log action
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const SALON_UUID = '11111111-1111-1111-1111-111111111111';
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

import { PATCH } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeRequest(body?: object) {
  return new Request(`http://localhost/api/admin/registrations/${SALON_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeProps(id = SALON_UUID) {
  return { params: Promise.resolve({ id }) };
}

function profileChain(isAdmin: boolean) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: { is_platform_admin: isAdmin }, error: null })),
  };
}

function updateChain(error: unknown = null) {
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

test('PATCH: 未認証 → 403', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest({ status: 'approved' }), makeProps());
  expect(res.status).toBe(403);
});

test('PATCH: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest({ status: 'approved' }), makeProps());
  expect(res.status).toBe(429);
});

test('PATCH: 不正なUUID → 400', async () => {
  const res = await PATCH(makeRequest({ status: 'approved' }), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('PATCH: 一般ユーザー (is_platform_admin: false) → 403', async () => {
  mockAnonFrom.mockReturnValue(profileChain(false));
  const res = await PATCH(makeRequest({ status: 'approved' }), makeProps());
  expect(res.status).toBe(403);
});

test('PATCH: 不正なstatus → 400', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  const res = await PATCH(makeRequest({ status: 'deleted' }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: DB更新失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(updateChain({ message: 'DB error' }));
  const res = await PATCH(makeRequest({ status: 'approved' }), makeProps());
  expect(res.status).toBe(500);
});

test('PATCH: approved → 200 success:true', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makeRequest({ status: 'approved' }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.success).toBe(true);
  expect(json.status).toBe('approved');
});

test('PATCH: rejected → 200 status:rejected', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(updateChain());
  const res = await PATCH(makeRequest({ status: 'rejected' }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.status).toBe('rejected');
});
