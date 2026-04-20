/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/job-applications/[id]
 * Key assertions:
 *   - Both "not found" and "wrong owner" → 404 (ID enumeration prevention)
 *   - Invalid status → 400
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const APP_UUID = '11111111-1111-1111-1111-111111111111';
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

import { PATCH } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeRequest(body: object = { status: 'reviewing' }) {
  return new Request(`http://localhost/api/admin/job-applications/${APP_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeProps(id = APP_UUID) {
  return { params: Promise.resolve({ id }) };
}

function existingChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function membershipChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function updateChain(data: unknown, error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          single: jest.fn(() => Promise.resolve({ data, error })),
        }),
      }),
    }),
  };
}

function setupOwnership() {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return existingChain({ facility_id: FACILITY_UUID, status: 'pending' });
    if (callNum === 2) return membershipChain({ role: 'owner' });
    return updateChain({ id: APP_UUID, status: 'reviewing' });
  });
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

test('PATCH: 応募が存在しない → 404 (ID列挙防止)', async () => {
  mockAdminFrom.mockReturnValue(existingChain(null)); // not found
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(404);
});

test('PATCH: 他施設の応募 → 404 (ID列挙防止)', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return existingChain({ facility_id: 'other-facility', status: 'pending' });
    return membershipChain(null); // not a member of that facility
  });
  const res = await PATCH(makeRequest(), makeProps());
  expect(res.status).toBe(404);
});

test('PATCH: 不正なstatus → 400', async () => {
  setupOwnership();
  const res = await PATCH(makeRequest({ status: 'ghosted' }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: DB更新失敗 → 500', async () => {
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return existingChain({ facility_id: FACILITY_UUID, status: 'pending' });
    if (callNum === 2) return membershipChain({ role: 'admin' });
    return updateChain(null, { message: 'DB error' });
  });
  const res = await PATCH(makeRequest({ status: 'reviewing' }), makeProps());
  expect(res.status).toBe(500);
});

test('PATCH: 正常更新 → 200 with application', async () => {
  setupOwnership();
  const res = await PATCH(makeRequest({ status: 'interview_scheduled', notes: 'meeting at 14:00' }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.application).toBeDefined();
});
