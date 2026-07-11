/**
 * @jest-environment node
 *
 * Tests for PATCH/DELETE /api/review/[id]（投稿者本人のみ編集・削除可能）
 * Key assertions:
 *   - 未ログイン → 401
 *   - 不正なUUID → 400
 *   - WHEREにuser_idが含まれる（IDOR防止：他人のレビューを更新/削除できない）
 *   - 対象が見つからない（他人のレビュー含む）→ 404
 *   - DB失敗 → 500
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false), mutationRateLimit: 'mutationLimit' }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [] }) }));

const REVIEW_UUID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '33333333-3333-3333-3333-333333333333';

const mockAdminFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAdminFrom }),
}));

import { PATCH, DELETE } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeRequest(method: string, body?: object) {
  return new Request(`http://localhost/api/review/1`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function makeProps(id = REVIEW_UUID) {
  return { params: Promise.resolve({ id }) };
}

function validBody() {
  return {
    rating_skill: 5,
    rating_service: 4,
    rating_atmosphere: 5,
    rating_cleanliness: 4,
    rating_explanation: 5,
    comment: '更新後のコメント',
  };
}

// ルートは .select().maybeSingle() を使う（0行=他人/存在しないレビュー を not found として扱い、
// PGRST116→500 化を防ぐ根治）。モックも maybeSingle を終端にする。maybeSingle の0行は現実に
// { data: null, error: null } を返すため、not found テスト（data:null,error:null→404）は現実的。
function updateChain(data: unknown, error: unknown = null) {
  const eq2 = jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ maybeSingle: jest.fn(() => Promise.resolve({ data, error })) }) });
  const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
  return { update: jest.fn().mockReturnValue({ eq: eq1 }), _eq1: eq1, _eq2: eq2 };
}

function deleteChain(data: unknown, error: unknown = null) {
  const eq2 = jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ maybeSingle: jest.fn(() => Promise.resolve({ data, error })) }) });
  const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
  return { delete: jest.fn().mockReturnValue({ eq: eq1 }), _eq1: eq1, _eq2: eq2 };
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── PATCH ────────────────────────────────────────────────────────────────

test('PATCH: 未ログイン → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(makeRequest('PATCH', validBody()), makeProps());
  expect(res.status).toBe(401);
});

test('PATCH: 不正なUUID → 400', async () => {
  const res = await PATCH(makeRequest('PATCH', validBody()), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('PATCH: 評価が範囲外 → 400', async () => {
  const res = await PATCH(makeRequest('PATCH', { ...validBody(), rating_skill: 6 }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: 正常更新 → 200、WHEREにuser_idが含まれる', async () => {
  const chain = updateChain({ id: REVIEW_UUID });
  mockAdminFrom.mockReturnValue(chain);
  const res = await PATCH(makeRequest('PATCH', validBody()), makeProps());
  expect(res.status).toBe(200);
  expect(chain._eq1).toHaveBeenCalledWith('id', REVIEW_UUID);
  expect(chain._eq2).toHaveBeenCalledWith('user_id', USER_ID);
});

test('PATCH: 他人のレビュー(該当なし) → 404', async () => {
  mockAdminFrom.mockReturnValue(updateChain(null));
  const res = await PATCH(makeRequest('PATCH', validBody()), makeProps());
  expect(res.status).toBe(404);
});

test('PATCH: comment省略時はnullとして保存', async () => {
  const chain = updateChain({ id: REVIEW_UUID });
  mockAdminFrom.mockReturnValue(chain);
  const { comment: _omit, ...bodyWithoutComment } = validBody();
  const res = await PATCH(makeRequest('PATCH', bodyWithoutComment), makeProps());
  expect(res.status).toBe(200);
  const updateArg = chain.update.mock.calls[0][0];
  expect(updateArg.comment).toBeNull();
});

test('PATCH: DB更新失敗 → 500', async () => {
  mockAdminFrom.mockReturnValue(updateChain(null, { message: 'DB error' }));
  const res = await PATCH(makeRequest('PATCH', validBody()), makeProps());
  expect(res.status).toBe(500);
});

test('PATCH: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await PATCH(makeRequest('PATCH', validBody()), makeProps());
  expect(res).toBe(csrfRes);
});

test('PATCH: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(makeRequest('PATCH', validBody()), makeProps());
  expect(res.status).toBe(429);
});

// ─── DELETE ───────────────────────────────────────────────────────────────

test('DELETE: 未ログイン → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(401);
});

test('DELETE: 不正なUUID → 400', async () => {
  const res = await DELETE(makeRequest('DELETE'), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('DELETE: 正常削除 → 200、WHEREにuser_idが含まれる', async () => {
  const chain = deleteChain({ id: REVIEW_UUID });
  mockAdminFrom.mockReturnValue(chain);
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(200);
  expect(chain._eq1).toHaveBeenCalledWith('id', REVIEW_UUID);
  expect(chain._eq2).toHaveBeenCalledWith('user_id', USER_ID);
});

test('DELETE: 他人のレビュー(該当なし) → 404', async () => {
  mockAdminFrom.mockReturnValue(deleteChain(null));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(404);
});

test('DELETE: DB削除失敗 → 500', async () => {
  mockAdminFrom.mockReturnValue(deleteChain(null, { message: 'DB error' }));
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(500);
});

test('DELETE: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res).toBe(csrfRes);
});

test('DELETE: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await DELETE(makeRequest('DELETE'), makeProps());
  expect(res.status).toBe(429);
});
