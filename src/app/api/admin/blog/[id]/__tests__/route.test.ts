/**
 * @jest-environment node
 *
 * Tests for PATCH/DELETE /api/admin/blog/[id]
 * Key assertions:
 *   - Non-member → 401 (IDOR prevention via facility_id query param)
 *   - facility_id defence-in-depth in UPDATE/DELETE WHERE
 *   - Record not found → 404
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const POST_UUID     = '11111111-1111-1111-1111-111111111111';
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
import { PATCH, DELETE } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeProps(id = POST_UUID) {
  return { params: Promise.resolve({ id }) };
}

function makeRequest(method: string, body?: object, facilityId: string | null = FACILITY_UUID) {
  const url = new URL(`http://localhost/api/admin/blog/${POST_UUID}`);
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
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

function updateFacilityChain(data: unknown, error: unknown = null) {
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

function deleteFacilityChain(error: unknown = null) {
  return {
    delete: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error })),
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

// ─── PATCH ────────────────────────────────────────────────────────────────────

test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest('PATCH', { title: 'New' }), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest('PATCH', { title: 'New' }), makeProps());
  expect(res.status).toBe(429);
});

test('PATCH: 不正なUUID → 400', async () => {
  const res = await PATCH(makeRequest('PATCH', { title: 'New' }), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('PATCH: facility_id なし → 401', async () => {
  const res = await PATCH(makeRequest('PATCH', { title: 'New' }, null), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: 非管理者 → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await PATCH(makeRequest('PATCH', { title: 'New' }), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: title が 201文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest('PATCH', { title: 'a'.repeat(201) }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: 記事が見つからない → 404', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateFacilityChain(null)); // null data = not found
  const res = await PATCH(makeRequest('PATCH', { title: 'New' }), makeProps());
  expect(res.status).toBe(404);
});

test('PATCH: DB更新失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateFacilityChain(null, { message: 'DB error' }));
  const res = await PATCH(makeRequest('PATCH', { title: 'New' }), makeProps());
  expect(res.status).toBe(500);
});

test('PATCH: 正常更新 → 200 with post', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateFacilityChain({ id: POST_UUID, title: 'New' }));
  const res = await PATCH(makeRequest('PATCH', { title: 'New' }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.post).toBeDefined();
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

test('DELETE: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(401);
});

test('DELETE: 不正なUUID → 400', async () => {
  const res = await DELETE(makeRequest('DELETE'), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('DELETE: 非管理者 → 401', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(401);
});

test('DELETE: DB削除失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(deleteFacilityChain({ message: 'DB error' }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(500);
});

test('DELETE: 正常削除 → 200 ok:true', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(deleteFacilityChain(null));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('PATCH: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await PATCH(makeRequest('PATCH', { title: 'New' }), makeProps());
  expect(res.status).toBe(403);
});

test('PATCH: content が 50001文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await PATCH(makeRequest('PATCH', { content: 'a'.repeat(50001) }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: is_published=false → 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateFacilityChain({ id: POST_UUID, is_published: false }));
  const res = await PATCH(makeRequest('PATCH', { is_published: false }), makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: facility_id が不正UUID → 401', async () => {
  const url = new URL(`http://localhost/api/admin/blog/${POST_UUID}`);
  url.searchParams.set('facility_id', 'bad-uuid');
  const req = new NextRequest(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'New' }),
  });
  const res = await PATCH(req, makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: レートリミット params (20/60s)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateFacilityChain({ id: POST_UUID, title: 'New' }));
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (inMemoryRateLimit as jest.Mock).mockClear();
  await PATCH(makeRequest('PATCH', { title: 'New' }), makeProps());
  const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBe(20);
  expect(call[2]).toBe(60_000);
});

test('PATCH: レスポンスが { post: ... } 形式', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateFacilityChain({ id: POST_UUID, title: 'New' }));
  const res = await PATCH(makeRequest('PATCH', { title: 'New' }), makeProps());
  const json = await res.json();
  expect(json.post).toBeDefined();
  expect(json.post.id).toBe(POST_UUID);
});

test('DELETE: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(403);
});

test('DELETE: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(429);
});

test('PATCH: is_published=true → published_at が設定されて 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(updateFacilityChain({ id: POST_UUID, is_published: true }));
  const res = await PATCH(makeRequest('PATCH', { is_published: true }), makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: 不正JSON → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const url = new URL(`http://localhost/api/admin/blog/${POST_UUID}`);
  url.searchParams.set('facility_id', FACILITY_UUID);
  const req = new NextRequest(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await PATCH(req, makeProps());
  expect(res.status).toBe(400);
});

test('DELETE: facility_id なし → 401', async () => {
  const res = await DELETE(makeRequest('DELETE', undefined, null), makeProps());
  expect(res.status).toBe(401);
});

// ─── category カラム不在フォールバック（PATCH） ───────────────────────────────
test('PATCH: category カラム不在(42703)なら除外して再試行し 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom
    .mockReturnValueOnce(updateFacilityChain(null, { code: '42703', message: 'column does not exist' }))
    .mockReturnValueOnce(updateFacilityChain({ id: POST_UUID, title: 'New' }));
  const res = await PATCH(makeRequest('PATCH', { category: 'ネイル' }), makeProps());
  expect(res.status).toBe(200);
  expect(mockAdminFrom).toHaveBeenCalledTimes(2);
});

// ─── coupon_id / author_id 施設所有検証（#3/#12・PATCH） ──────────────────────
function scopeRow(data: unknown) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn(() => Promise.resolve({ data })) };
}
const VALID_COUPON = '88888888-8888-4888-8888-888888888888';
const VALID_AUTHOR = '77777777-7777-4777-8777-777777777777';

test('PATCH: coupon_id が他施設 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(scopeRow(null));
  const res = await PATCH(makeRequest('PATCH', { coupon_id: VALID_COUPON }), makeProps());
  expect(res.status).toBe(400);
});
test('PATCH: coupon_id が自施設 → 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(scopeRow({ id: VALID_COUPON })).mockReturnValueOnce(updateFacilityChain({ id: POST_UUID }));
  const res = await PATCH(makeRequest('PATCH', { coupon_id: VALID_COUPON }), makeProps());
  expect(res.status).toBe(200);
});
test('PATCH: author_id が他施設 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(scopeRow(null));
  const res = await PATCH(makeRequest('PATCH', { author_id: VALID_AUTHOR }), makeProps());
  expect(res.status).toBe(400);
});
test('PATCH: author_id が自施設 → 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(scopeRow({ id: VALID_AUTHOR })).mockReturnValueOnce(updateFacilityChain({ id: POST_UUID }));
  const res = await PATCH(makeRequest('PATCH', { author_id: VALID_AUTHOR }), makeProps());
  expect(res.status).toBe(200);
});

const VALID_EXT_AUTHOR = '66666666-6666-4666-8666-666666666666';
test('PATCH: author_name_id が他施設 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(scopeRow(null));
  expect((await PATCH(makeRequest('PATCH', { author_name_id: VALID_EXT_AUTHOR }), makeProps())).status).toBe(400);
});
test('PATCH: author_name_id が自施設 → 200', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(scopeRow({ id: VALID_EXT_AUTHOR })).mockReturnValueOnce(updateFacilityChain({ id: POST_UUID }));
  expect((await PATCH(makeRequest('PATCH', { author_name_id: VALID_EXT_AUTHOR }), makeProps())).status).toBe(200);
});

test('PATCH: scheduled_at 指定 → 200（予約掲載・published_at=予約時刻で上書き）', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(updateFacilityChain({ id: POST_UUID }));
  expect((await PATCH(makeRequest('PATCH', { scheduled_at: '2026-07-01T00:00:00.000Z' }), makeProps())).status).toBe(200);
});
