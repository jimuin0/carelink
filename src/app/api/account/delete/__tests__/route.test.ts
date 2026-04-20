/**
 * @jest-environment node
 *
 * Tests for POST /api/account/delete
 * Key assertions:
 *   - auth.users delete failure must return 500 (user remains; PII not deleted)
 *   - confirmation code required (prevents accidental deletion)
 *   - PII scrub runs before auth delete
 */

jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: {},
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
  inMemoryRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
  getRequestContext: jest.fn(() => ({ ua: 'test-ua', ip: '127.0.0.1' })),
}));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const USER_ID = 'user-delete-test';

const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockDeleteUser = jest.fn();
const mockSelect = jest.fn();

// SSR client (anon key — reads session)
jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));

// Service role client (supabase-js createClient)
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mockFrom,
    auth: { admin: { deleteUser: mockDeleteUser } },
  }),
}));

import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeRequest(body: object = { confirmation: 'DELETE' }) {
  return new Request('http://localhost/api/account/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Returns a mock that resolves with { error: null } for delete/update chains
function successChain() {
  const eq = jest.fn().mockReturnValue(Promise.resolve({ error: null }));
  const neq = jest.fn().mockReturnValue(Promise.resolve({ error: null, count: 0 }));
  const update = jest.fn().mockReturnValue({ eq });
  const del = jest.fn().mockReturnValue({ eq });
  const select = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        neq: jest.fn().mockReturnValue(Promise.resolve({ count: 0, error: null })),
      }),
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue(Promise.resolve({ data: [], error: null })),
      }),
    }),
    select: jest.fn().mockReturnThis(),
  });
  return { delete: del, update, select, eq };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockDeleteUser.mockResolvedValue({ error: null });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';

  // Default: all DB ops succeed, no facility ownership
  mockFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue(Promise.resolve({ data: [], error: null })),
          }),
        }),
        delete: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue(Promise.resolve({ error: null })),
        }),
      };
    }
    return {
      delete: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ error: null })) }),
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ error: null })) }),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
    };
  });
});

// ─── Security guards ──────────────────────────────────────────────────────────

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest());
  expect(res.status).toBe(401);
});

test('レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockResolvedValue(true);
  const res = await POST(makeRequest());
  expect(res.status).toBe(429);
});

test('CSRFエラー → 403', async () => {
  (checkCsrf as jest.Mock).mockReturnValue(new Response(JSON.stringify({ error: 'csrf' }), { status: 403 }));
  const res = await POST(makeRequest());
  expect(res.status).toBe(403);
});

// ─── Input validation ─────────────────────────────────────────────────────────

test('confirmationなし → 400', async () => {
  const res = await POST(makeRequest({}));
  expect(res.status).toBe(400);
});

test('confirmation が "DELETE" 以外 → 400', async () => {
  const res = await POST(makeRequest({ confirmation: 'delete' }));
  expect(res.status).toBe(400);
});

test('不正なJSONボディ → 400', async () => {
  const req = new Request('http://localhost/api/account/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'invalid json',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

// ─── Critical: auth.users delete failure ─────────────────────────────────────

test('auth.users削除失敗 → 500 (ユーザーデータが残存するため公開しない)', async () => {
  mockDeleteUser.mockResolvedValue({ error: { message: 'auth delete failed' } });
  const res = await POST(makeRequest());
  expect(res.status).toBe(500);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test('正常削除フロー → 200 success:true', async () => {
  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.success).toBe(true);
  expect(mockDeleteUser).toHaveBeenCalledWith(USER_ID);
});

test('auth削除は必ずPIIスクラブの後に実行される', async () => {
  const callOrder: string[] = [];
  mockFrom.mockImplementation((table: string) => {
    if (table === 'facility_members') {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue(Promise.resolve({ data: [], error: null })),
          }),
        }),
        delete: jest.fn().mockReturnValue({
          eq: jest.fn().mockImplementation(() => { callOrder.push('facility_members_delete'); return Promise.resolve({ error: null }); }),
        }),
      };
    }
    return {
      delete: jest.fn().mockReturnValue({ eq: jest.fn().mockImplementation(() => { callOrder.push(`${table}_delete`); return Promise.resolve({ error: null }); }) }),
      update: jest.fn().mockReturnValue({ eq: jest.fn().mockImplementation(() => { callOrder.push(`${table}_update`); return Promise.resolve({ error: null }); }) }),
    };
  });
  mockDeleteUser.mockImplementation(() => { callOrder.push('auth_delete'); return Promise.resolve({ error: null }); });

  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
  // auth_delete must come after PII scrub operations
  const authIdx = callOrder.indexOf('auth_delete');
  expect(authIdx).toBeGreaterThan(0);
  expect(callOrder.slice(0, authIdx).length).toBeGreaterThan(0);
});
