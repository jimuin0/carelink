/**
 * @jest-environment node
 *
 * Tests for PATCH/DELETE /api/admin/platform-blog/[id]
 * Key assertions:
 *   - Platform-admin only → 403
 *   - UUID_REGEX validation for [id]
 *   - PATCH data null → 404
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const POST_UUID = '11111111-1111-1111-1111-111111111111';
const USER_ID   = '33333333-3333-3333-3333-333333333333';

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
import { checkRateLimit } from '@/lib/rate-limit';

function makeProps(id = POST_UUID) {
  return { params: Promise.resolve({ id }) };
}

function makePatchRequest(body: object) {
  return new NextRequest(`http://localhost/api/admin/platform-blog/${POST_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest() {
  return new NextRequest(`http://localhost/api/admin/platform-blog/${POST_UUID}`, {
    method: 'DELETE',
  });
}

function profileSingle(isAdmin: boolean) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: { is_platform_admin: isAdmin }, error: null })),
  };
}

// mutation は .select().maybeSingle()（0行=存在しないid を not found として扱う根治）。
function updateSingle(data: unknown, error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          maybeSingle: jest.fn(() => Promise.resolve({ data, error })),
        }),
      }),
    }),
  };
}

function deleteEq(error: unknown = null, data: unknown = [{ id: 'post-1' }]) {
  return {
    delete: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        select: jest.fn(() => Promise.resolve({ data: error ? null : data, error })),
      }),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── PATCH ────────────────────────────────────────────────────────────────────

test('PATCH: 未認証 → 403', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makePatchRequest({ title: '新しいタイトル' }), makeProps());
  expect(res.status).toBe(403);
});

test('PATCH: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makePatchRequest({ title: '新しいタイトル' }), makeProps());
  expect(res.status).toBe(429);
});

test('PATCH: 不正UUID → 400', async () => {
  const res = await PATCH(makePatchRequest({ title: '新しいタイトル' }), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('PATCH: 一般ユーザー → 403', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(false));
  const res = await PATCH(makePatchRequest({ title: '新しいタイトル' }), makeProps());
  expect(res.status).toBe(403);
});

test('PATCH: slug が不正形式 → 400', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  const res = await PATCH(makePatchRequest({ slug: 'Invalid_Slug' }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(updateSingle(null, { message: 'DB error' }));
  const res = await PATCH(makePatchRequest({ title: '新しいタイトル' }), makeProps());
  expect(res.status).toBe(500);
});

test('PATCH: データなし → 404', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(updateSingle(null));
  const res = await PATCH(makePatchRequest({ title: '新しいタイトル' }), makeProps());
  expect(res.status).toBe(404);
});

test('PATCH: 正常更新 → 200 with post', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(updateSingle({ id: POST_UUID, title: '新しいタイトル' }));
  const res = await PATCH(makePatchRequest({ title: '新しいタイトル' }), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.post).toBeDefined();
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

test('DELETE: 未認証 → 403', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await DELETE(makeDeleteRequest(), makeProps());
  expect(res.status).toBe(403);
});

test('DELETE: 不正UUID → 400', async () => {
  const res = await DELETE(makeDeleteRequest(), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('DELETE: 一般ユーザー → 403', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(false));
  const res = await DELETE(makeDeleteRequest(), makeProps());
  expect(res.status).toBe(403);
});

test('DELETE: DB失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(deleteEq({ message: 'DB error' }));
  const res = await DELETE(makeDeleteRequest(), makeProps());
  expect(res.status).toBe(500);
});

// 【2026年7月10日 恒久根治の回帰】存在しないIDの削除試行（0件削除）が「成功」と偽装されない
// ことを検証する（phantom success の再発防止）。
test('DELETE: 0件削除（存在しないID）→ 404（成功と偽装しない）', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(deleteEq(null, []));
  const res = await DELETE(makeDeleteRequest(), makeProps());
  expect(res.status).toBe(404);
});

test('DELETE: 正常削除 → 200', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(deleteEq(null));
  const res = await DELETE(makeDeleteRequest(), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.ok).toBe(true);
});

test('PATCH: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await PATCH(makePatchRequest({ title: 'test' }), makeProps());
  expect(res.status).toBe(403);
});

test('PATCH: レートリミット params (20/60s)', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(updateSingle({ id: POST_UUID, title: 'test' }));
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkRateLimit as jest.Mock).mockClear();
  await PATCH(makePatchRequest({ title: 'test' }), makeProps());
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(20);
  expect(call[3]).toBe(60_000);
});

test('DELETE: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await DELETE(makeDeleteRequest(), makeProps());
  expect(res.status).toBe(403);
});

test('PATCH: レスポンスが { post } 形式', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(updateSingle({ id: POST_UUID, title: 'Updated' }));
  const res = await PATCH(makePatchRequest({ title: 'Updated' }), makeProps());
  const json = await res.json();
  expect(json.post.id).toBe(POST_UUID);
});

// ─── 追加ブランチカバレッジ ───────────────────────────────────────────

test('DELETE: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await DELETE(makeDeleteRequest(), makeProps());
  expect(res.status).toBe(429);
});

test('PATCH: is_published=true → published_at が設定される', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  let captured: Record<string, unknown> | undefined;
  mockAdminFrom.mockReturnValue({
    update: jest.fn((u: Record<string, unknown>) => { captured = u; return {
      eq: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          maybeSingle: jest.fn(() => Promise.resolve({ data: { id: POST_UUID }, error: null })),
        }),
      }),
    };}),
  });
  await PATCH(makePatchRequest({ is_published: true }), makeProps());
  expect(captured?.published_at).toBeDefined();
  expect(captured?.published_at).not.toBeNull();
});

test('PATCH: is_published=false → published_at が null', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  let captured: Record<string, unknown> | undefined;
  mockAdminFrom.mockReturnValue({
    update: jest.fn((u: Record<string, unknown>) => { captured = u; return {
      eq: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          maybeSingle: jest.fn(() => Promise.resolve({ data: { id: POST_UUID }, error: null })),
        }),
      }),
    };}),
  });
  await PATCH(makePatchRequest({ is_published: false }), makeProps());
  expect(captured?.published_at).toBeNull();
});

test('PATCH: is_published 未指定 → published_at 設定なし', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  let captured: Record<string, unknown> | undefined;
  mockAdminFrom.mockReturnValue({
    update: jest.fn((u: Record<string, unknown>) => { captured = u; return {
      eq: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          maybeSingle: jest.fn(() => Promise.resolve({ data: { id: POST_UUID }, error: null })),
        }),
      }),
    };}),
  });
  await PATCH(makePatchRequest({ title: 'x' }), makeProps());
  expect(captured?.published_at).toBeUndefined();
});

test('PATCH: profile=null → 403', async () => {
  mockAnonFrom.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: null, error: null })),
  });
  const res = await PATCH(makePatchRequest({ title: 'x' }), makeProps());
  expect(res.status).toBe(403);
});

test('PATCH: 不正な JSON body → 400', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  const req = new NextRequest(`http://localhost/api/admin/platform-blog/${POST_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json',
  });
  const res = await PATCH(req, makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: x-forwarded-for ヘッダから IP 取得', async () => {
  mockAnonFrom.mockReturnValue(profileSingle(true));
  mockAdminFrom.mockReturnValue(updateSingle({ id: POST_UUID, title: 'x' }));
  const req = new NextRequest(`http://localhost/api/admin/platform-blog/${POST_UUID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4, 5.6.7.8' },
    body: JSON.stringify({ title: 'x' }),
  });
  const res = await PATCH(req, makeProps());
  expect(res.status).toBe(200);
});
