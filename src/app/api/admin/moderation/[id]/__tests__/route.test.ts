/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/moderation/[id]
 * Key assertions:
 *   - Non-platform-admin → 403
 *   - Item not found → 404
 *   - content_id UUID validation (prevents injection via stored data)
 *   - Rejected review → facility_reviews.status = 'hidden'
 *   - DB update failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const QUEUE_UUID = '11111111-1111-1111-1111-111111111111';
const REVIEW_UUID = '22222222-2222-2222-2222-222222222222';
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
  return new Request(`http://localhost/api/admin/moderation/${QUEUE_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeProps(id = QUEUE_UUID) {
  return { params: Promise.resolve({ id }) };
}

function profileChain(isAdmin: boolean) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: { is_platform_admin: isAdmin }, error: null })),
  };
}

function buildQueueItem(overrides: Record<string, unknown> = {}) {
  return {
    id: QUEUE_UUID,
    content_type: 'review',
    content_id: REVIEW_UUID,
    status: 'pending',
    ...overrides,
  };
}

function setupAdmin() {
  mockAnonFrom.mockReturnValue(profileChain(true));
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── Guards ───────────────────────────────────────────────────────────────────

test('PATCH: 未認証 → 403', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest({ decision: 'approved' }), makeProps());
  expect(res.status).toBe(403);
});

test('PATCH: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest({ decision: 'approved' }), makeProps());
  expect(res.status).toBe(429);
});

test('PATCH: 不正なUUID → 400', async () => {
  const res = await PATCH(makeRequest({ decision: 'approved' }), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('PATCH: 一般ユーザー → 403', async () => {
  mockAnonFrom.mockReturnValue(profileChain(false));
  const res = await PATCH(makeRequest({ decision: 'approved' }), makeProps());
  expect(res.status).toBe(403);
});

// ─── Schema validation ────────────────────────────────────────────────────────

test('PATCH: 不正なdecision → 400', async () => {
  setupAdmin();
  mockAdminFrom.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: buildQueueItem(), error: null })),
  });
  const res = await PATCH(makeRequest({ decision: 'deleted' }), makeProps());
  expect(res.status).toBe(400);
});

// ─── Not found ────────────────────────────────────────────────────────────────

test('PATCH: キューアイテムが存在しない → 404', async () => {
  setupAdmin();
  mockAdminFrom.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: null, error: null })),
  });
  const res = await PATCH(makeRequest({ decision: 'approved' }), makeProps());
  expect(res.status).toBe(404);
});

// ─── DB failure ───────────────────────────────────────────────────────────────

test('PATCH: moderation_queue 更新失敗 → 500', async () => {
  setupAdmin();
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn(() => Promise.resolve({ data: buildQueueItem(), error: null })),
      };
    }
    return {
      update: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error: { message: 'DB error' } })),
      }),
    };
  });
  const res = await PATCH(makeRequest({ decision: 'approved' }), makeProps());
  expect(res.status).toBe(500);
});

// ─── Approved path ────────────────────────────────────────────────────────────

test('PATCH: approved → 200 decision:approved', async () => {
  setupAdmin();
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn(() => Promise.resolve({ data: buildQueueItem(), error: null })),
      };
    }
    return {
      update: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error: null })),
      }),
    };
  });
  const res = await PATCH(makeRequest({ decision: 'approved' }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.decision).toBe('approved');
});

// ─── Rejected review hiding ───────────────────────────────────────────────────

test('PATCH: rejected + content_type:review → facility_reviews が非表示化される', async () => {
  setupAdmin();
  let callNum = 0;
  const reviewUpdateEq = jest.fn(() => Promise.resolve({ error: null }));
  const reviewUpdateMock = jest.fn().mockReturnValue({ eq: reviewUpdateEq });

  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn(() => Promise.resolve({ data: buildQueueItem(), error: null })),
      };
    }
    if (callNum === 2) {
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn(() => Promise.resolve({ error: null })), // queue update success
        }),
      };
    }
    // callNum === 3: facility_reviews update
    return { update: reviewUpdateMock };
  });

  const res = await PATCH(makeRequest({ decision: 'rejected', review_note: '不適切なコメント' }), makeProps());
  expect(res.status).toBe(200);
  // Verify facility_reviews.update was called with hidden status
  expect(reviewUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'hidden', is_flagged: true }));
  expect(reviewUpdateEq).toHaveBeenCalledWith('id', REVIEW_UUID);
});
