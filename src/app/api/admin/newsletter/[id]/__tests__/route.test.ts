/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/newsletter/[id]
 * Key assertions:
 *   - Non-platform-admin → 403
 *   - cancel: non-scheduled → 400 (state machine guard)
 *   - schedule: non-draft → 400
 *   - send: CAS miss → 409 (double-send prevention)
 *   - Unknown action → 400
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ip: '127.0.0.1', ua: 'test' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    batch: { send: jest.fn(() => Promise.resolve({ data: null, error: null })) },
  })),
}));
jest.mock('@/lib/email', () => ({ escSubject: jest.fn((s: string) => s) }));

const CAMPAIGN_UUID = '11111111-1111-1111-1111-111111111111';
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
  return new Request(`http://localhost/api/admin/newsletter/${CAMPAIGN_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : '{}',
  });
}

function makeProps(id = CAMPAIGN_UUID) {
  return { params: Promise.resolve({ id }) };
}

function profileChain(isAdmin: boolean) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: { is_platform_admin: isAdmin }, error: null })),
  };
}

function campaignChain(data: unknown, fetchError: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: fetchError })),
  };
}

function buildCampaign(overrides: Record<string, unknown> = {}) {
  return {
    id: CAMPAIGN_UUID,
    status: 'draft',
    campaign_type: 'user_digest',
    subject: 'テストメール',
    html_content: '<p>Hello</p>',
    text_content: 'Hello',
    ...overrides,
  };
}

function updateStatusChain(data: unknown[] | null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        in: jest.fn().mockReturnValue({
          select: jest.fn(() => Promise.resolve({ data })),
        }),
        select: jest.fn().mockReturnValue({
          single: jest.fn(() => Promise.resolve({ data: data ? data[0] ?? null : null, error: null })),
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
  process.env.NEWSLETTER_UNSUBSCRIBE_SECRET = 'test-secret';
  process.env.RESEND_API_KEY = 'test-resend-key';
});

// ─── Guards ───────────────────────────────────────────────────────────────────

test('PATCH: 未認証 → 403', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest({ action: 'cancel' }), makeProps());
  expect(res.status).toBe(403);
});

test('PATCH: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest({ action: 'cancel' }), makeProps());
  expect(res.status).toBe(429);
});

test('PATCH: 不正なUUID → 400', async () => {
  const res = await PATCH(makeRequest({ action: 'cancel' }), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('PATCH: 一般ユーザー → 403', async () => {
  mockAnonFrom.mockReturnValue(profileChain(false));
  const res = await PATCH(makeRequest({ action: 'cancel' }), makeProps());
  expect(res.status).toBe(403);
});

// ─── Campaign not found ───────────────────────────────────────────────────────

test('PATCH: キャンペーンが見つからない → 404', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(campaignChain(null, { message: 'not found' }));
  const res = await PATCH(makeRequest({ action: 'cancel' }), makeProps());
  expect(res.status).toBe(404);
});

// ─── cancel action ────────────────────────────────────────────────────────────

test('PATCH: cancel — scheduled でないキャンペーン → 400', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(campaignChain(buildCampaign({ status: 'draft' }))); // not scheduled
  const res = await PATCH(makeRequest({ action: 'cancel' }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: cancel — scheduled キャンペーン → 200', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return campaignChain(buildCampaign({ status: 'scheduled' }));
    return {
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn(() => Promise.resolve({ data: { id: CAMPAIGN_UUID, status: 'cancelled' }, error: null })),
          }),
        }),
      }),
    };
  });
  const res = await PATCH(makeRequest({ action: 'cancel' }), makeProps());
  expect(res.status).toBe(200);
});

// ─── schedule action ──────────────────────────────────────────────────────────

test('PATCH: schedule — draft でないキャンペーン → 400', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(campaignChain(buildCampaign({ status: 'sent' }))); // not draft
  const res = await PATCH(makeRequest({ action: 'schedule' }), makeProps());
  expect(res.status).toBe(400);
});

// ─── send: CAS double-send prevention ────────────────────────────────────────

test('PATCH: send — CAS競合（二重送信防止）→ 409', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  let callNum = 0;
  mockAdminFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return campaignChain(buildCampaign({ status: 'draft' }));
    // CAS update returns empty array (another process already claimed it)
    return updateStatusChain([]);
  });
  const res = await PATCH(makeRequest({ action: 'send' }), makeProps());
  expect(res.status).toBe(409);
});

// ─── Unknown action ───────────────────────────────────────────────────────────

test('PATCH: 不明なaction → 400', async () => {
  mockAnonFrom.mockReturnValue(profileChain(true));
  mockAdminFrom.mockReturnValue(campaignChain(buildCampaign()));
  const res = await PATCH(makeRequest({ action: 'delete' }), makeProps());
  expect(res.status).toBe(400);
});
