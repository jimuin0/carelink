/**
 * @jest-environment node
 *
 * Tests for PATCH/DELETE /api/admin/features/[id]
 * Key assertions:
 *   - is_platform_admin(DB)方式 controls access (fail-safe: profile不在/false → 401)（監査A6b）
 *   - Non-platform-admin → 401
 *   - image_url: must be valid URL or empty
 *   - sort_order max 9999
 *   - DELETE: 404 not possible (no pre-check), DB fail → 500
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const FEATURE_UUID = '11111111-1111-1111-1111-111111111111';
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

import { PATCH, DELETE } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';

function makeRequest(method: string, body?: object) {
  return new Request(`http://localhost/api/admin/features/${FEATURE_UUID}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeProps(id = FEATURE_UUID) {
  return { params: Promise.resolve({ id }) };
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

function deleteChain(error: unknown = null, data: unknown = [{ id: 'feature-1' }]) {
  return {
    delete: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn(() => Promise.resolve({ data: error ? null : data, error })),
      }),
    }),
  };
}

function profileChain(isAdmin: boolean | null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: isAdmin === null ? null : { is_platform_admin: isAdmin }, error: null })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  mockAnonFrom.mockReturnValue(profileChain(true)); // grant platform admin by default
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── Fail-safe: not a platform admin ──────────────────────────────────────────

test('PATCH: profileレコードなし → 401 (フェイルセーフ)', async () => {
  mockAnonFrom.mockReturnValue(profileChain(null));
  const res = await PATCH(makeRequest('PATCH', { title: 'test' }), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: is_platform_admin=false → 401', async () => {
  mockAnonFrom.mockReturnValue(profileChain(false));
  const res = await PATCH(makeRequest('PATCH', { title: 'test' }), makeProps());
  expect(res.status).toBe(401);
});

// ─── Guards ───────────────────────────────────────────────────────────────────

test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest('PATCH', { title: 'test' }), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest('PATCH', { title: 'test' }), makeProps());
  expect(res.status).toBe(429);
});

test('PATCH: 不正なUUID → 400', async () => {
  const res = await PATCH(makeRequest('PATCH', { title: 'test' }), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

// ─── Schema validation ────────────────────────────────────────────────────────

test('PATCH: image_url が無効URL → 400', async () => {
  const res = await PATCH(makeRequest('PATCH', { image_url: 'not-a-url' }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: image_url が空文字 → 許可', async () => {
  mockAdminFrom.mockReturnValue(updateChain({ id: FEATURE_UUID, title: 'test' }));
  const res = await PATCH(makeRequest('PATCH', { title: 'test', image_url: '' }), makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: sort_order > 9999 → 400', async () => {
  const res = await PATCH(makeRequest('PATCH', { sort_order: 10000 }), makeProps());
  expect(res.status).toBe(400);
});

// ─── DB paths ─────────────────────────────────────────────────────────────────

test('PATCH: DB更新失敗 → 500', async () => {
  mockAdminFrom.mockReturnValue(updateChain(null, { message: 'DB error' }));
  const res = await PATCH(makeRequest('PATCH', { title: 'updated' }), makeProps());
  expect(res.status).toBe(500);
});

test('PATCH: 記事が見つからない (data:null) → 404', async () => {
  mockAdminFrom.mockReturnValue(updateChain(null));
  const res = await PATCH(makeRequest('PATCH', { title: 'updated' }), makeProps());
  expect(res.status).toBe(404);
});

test('PATCH: 正常更新 → 200 with feature', async () => {
  mockAdminFrom.mockReturnValue(updateChain({ id: FEATURE_UUID, title: 'updated', is_active: true }));
  const res = await PATCH(makeRequest('PATCH', { title: 'updated', is_active: true }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.feature).toBeDefined();
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

test('DELETE: 不正なUUID → 400', async () => {
  const res = await DELETE(makeRequest('DELETE'), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('DELETE: DB削除失敗 → 500', async () => {
  mockAdminFrom.mockReturnValue(deleteChain({ message: 'DB error' }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(500);
});

// 【2026年7月10日 恒久根治の回帰】存在しないIDの削除試行（0件削除）が「成功」と偽装されない
// ことを検証する（phantom success の再発防止）。
test('DELETE: 0件削除（存在しないID）→ 404（成功と偽装しない）', async () => {
  mockAdminFrom.mockReturnValue(deleteChain(null, []));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(404);
});

test('DELETE: 正常削除 → 200 ok:true', async () => {
  mockAdminFrom.mockReturnValue(deleteChain());
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

// ─── Additional coverage ──────────────────────────────────────────────────────

test('PATCH: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await PATCH(makeRequest('PATCH', { title: 'test' }), makeProps());
  expect(res.status).toBe(403);
});

test('DELETE: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(403);
});

test('PATCH: rate limit params (20/60s)', async () => {
  mockAdminFrom.mockReturnValue(updateChain({ id: FEATURE_UUID, title: 'test' }));
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await PATCH(makeRequest('PATCH', { title: 'test' }), makeProps());
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(20);
  expect(call[3]).toBe(60_000);
});

test('DELETE: rate limit → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(429);
});

test('DELETE: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: 不正JSON → 400', async () => {
  const req = new Request(`http://localhost/api/admin/features/${FEATURE_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await PATCH(req, makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: image_url が有効URLで設定 → 200 (truthy 分岐)', async () => {
  mockAdminFrom.mockReturnValue(updateChain({ id: FEATURE_UUID, image_url: 'https://example.com/x.png' }));
  const res = await PATCH(makeRequest('PATCH', { title: 'test', image_url: 'https://example.com/x.png' }), makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: レスポンスが { feature.id } 形式', async () => {
  mockAdminFrom.mockReturnValue(updateChain({ id: FEATURE_UUID, title: 'test' }));
  const res = await PATCH(makeRequest('PATCH', { title: 'test' }), makeProps());
  const json = await res.json();
  expect(json.feature.id).toBe(FEATURE_UUID);
});
