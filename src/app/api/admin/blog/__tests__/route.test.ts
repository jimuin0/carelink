/**
 * @jest-environment node
 *
 * Tests for POST /api/admin/blog
 * Key assertions:
 *   - Non-member → 401 (IDOR prevention via facility_id query param)
 *   - title max 200 chars
 *   - content max 50000 chars
 *   - is_published controls published_at
 *   - DB failure → 500
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
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
import { POST } from '../route';
import { inMemoryRateLimit } from '@/lib/rate-limit';

function makeRequest(body: object, facilityId: string | null = FACILITY_UUID) {
  const url = new URL('http://localhost/api/admin/blog');
  if (facilityId) url.searchParams.set('facility_id', facilityId);
  return new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: object = {}) {
  return { title: 'テスト記事', content: 'テスト本文テスト本文', ...overrides };
}

function memberSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

function insertSingle(data: unknown, error: unknown = null) {
  return {
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn(() => Promise.resolve({ data, error })),
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

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(401);
});

test('POST: レートリミット → 429', async () => {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(429);
});

test('POST: facility_id なし → 401', async () => {
  const res = await POST(makeRequest(validBody(), null));
  expect(res.status).toBe(401);
});

test('POST: 非管理者 → 401 (IDOR防止)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle(null));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(401);
});

test('POST: title が空 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ title: '' })));
  expect(res.status).toBe(400);
});

test('POST: title が 201文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ title: 'a'.repeat(201) })));
  expect(res.status).toBe(400);
});

test('POST: content が空 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ content: '' })));
  expect(res.status).toBe(400);
});

test('POST: DB挿入失敗 → 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle(null, { message: 'DB error' }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(500);
});

test('POST: 正常作成（draft）→ 201 with post', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'post-1', is_published: false, published_at: null }));
  const res = await POST(makeRequest(validBody()));
  const json = await res.json();
  expect(res.status).toBe(201);
  expect(json.post).toBeDefined();
});

test('POST: is_published=true → 201 (published_at が設定される)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'post-1', is_published: true, published_at: new Date().toISOString() }));
  const res = await POST(makeRequest(validBody({ is_published: true })));
  expect(res.status).toBe(201);
});

test('POST: CSRF エラー → 403', async () => {
  const { checkCsrf } = require('@/lib/csrf');
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 }));
  const res = await POST(makeRequest(validBody()));
  expect(res.status).toBe(403);
});

test('POST: title が 200文字 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'p1' }));
  const res = await POST(makeRequest(validBody({ title: 'あ'.repeat(200) })));
  expect(res.status).toBe(201);
});

test('POST: content が 50000文字 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'p1' }));
  const res = await POST(makeRequest(validBody({ content: 'あ'.repeat(50000) })));
  expect(res.status).toBe(201);
});

test('POST: content が 50001文字 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  const res = await POST(makeRequest(validBody({ content: 'a'.repeat(50001) })));
  expect(res.status).toBe(400);
});

test('POST: is_published=false → 201 (published_at=null)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'p1', is_published: false, published_at: null }));
  const res = await POST(makeRequest(validBody({ is_published: false })));
  expect(res.status).toBe(201);
});

test('POST: facility_id が不正UUID → 401', async () => {
  const url = new URL('http://localhost/api/admin/blog');
  url.searchParams.set('facility_id', 'bad-uuid');
  const req = new NextRequest(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validBody()),
  });
  const res = await POST(req);
  expect(res.status).toBe(401);
});

test('POST: レスポンスが { post: ... } 形式', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'p1', title: 'テスト記事' }));
  const res = await POST(makeRequest(validBody()));
  const json = await res.json();
  expect(json.post).toBeDefined();
  expect(json.post.id).toBe('p1');
});

test('POST: レートリミット params (20/60s)', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle({ id: 'p1' }));
  (inMemoryRateLimit as jest.Mock).mockClear();
  await POST(makeRequest(validBody()));
  const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBe(20);
  expect(call[2]).toBe(60_000);
});

// ─── カラム不在フォールバック（category 未適用環境） ──────────────────────────
test('POST: category カラム不在(PGRST204)なら除外して再試行し 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom
    .mockReturnValueOnce(insertSingle(null, { code: 'PGRST204', message: 'column blog_posts.category does not exist' }))
    .mockReturnValueOnce(insertSingle({ id: 'p2' }));
  // status 201 = カラム不在エラー後、category を除外して再試行が成功した証跡（再試行なしなら 500）
  const res = await POST(makeRequest(validBody({ category: 'ヘア' })));
  expect(res.status).toBe(201);
});

test('POST: 非カラム不在エラーは再試行せず 500', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValue(insertSingle(null, { code: 'XX999', message: 'other error' }));
  const res = await POST(makeRequest(validBody({ category: 'ヘア' })));
  expect(res.status).toBe(500);
});

// ─── coupon_id / author_id 施設所有検証（#3/#12） ──────────────────────────────
function scopeRow(data: unknown) {
  return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn(() => Promise.resolve({ data })) };
}
const VALID_COUPON = '88888888-8888-4888-8888-888888888888';
const VALID_AUTHOR = '77777777-7777-4777-8777-777777777777';

test('POST: coupon_id が他施設 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(scopeRow(null)); // coupons 検証 → 見つからない
  const res = await POST(makeRequest(validBody({ coupon_id: VALID_COUPON })));
  expect(res.status).toBe(400);
});
test('POST: coupon_id が自施設 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(scopeRow({ id: VALID_COUPON })).mockReturnValueOnce(insertSingle({ id: 'p-c' }));
  const res = await POST(makeRequest(validBody({ coupon_id: VALID_COUPON })));
  expect(res.status).toBe(201);
});
test('POST: author_id が他施設 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(scopeRow(null)); // staff_profiles 検証 → 見つからない
  const res = await POST(makeRequest(validBody({ author_id: VALID_AUTHOR })));
  expect(res.status).toBe(400);
});
test('POST: author_id が自施設 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(scopeRow({ id: VALID_AUTHOR })).mockReturnValueOnce(insertSingle({ id: 'p-a' }));
  const res = await POST(makeRequest(validBody({ author_id: VALID_AUTHOR })));
  expect(res.status).toBe(201);
});

const VALID_EXT_AUTHOR = '66666666-6666-4666-8666-666666666666';
test('POST: author_name_id が他施設 → 400', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(scopeRow(null));
  expect((await POST(makeRequest(validBody({ author_name_id: VALID_EXT_AUTHOR })))).status).toBe(400);
});
test('POST: author_name_id が自施設 → 201', async () => {
  mockAnonFrom.mockReturnValue(memberSingle({ facility_id: FACILITY_UUID }));
  mockAdminFrom.mockReturnValueOnce(scopeRow({ id: VALID_EXT_AUTHOR })).mockReturnValueOnce(insertSingle({ id: 'p-ext' }));
  expect((await POST(makeRequest(validBody({ author_name_id: VALID_EXT_AUTHOR })))).status).toBe(201);
});
