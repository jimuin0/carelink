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

// mutation は .select().maybeSingle()（0行=存在しないid を not found として扱う根治）。
function updateChain(data: unknown, error: unknown = null) {
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

// ─── href/image_url スキーム検証（2026年7月29日）─────────────────────────
test('PATCH: image_url が http://（非https） → 400', async () => {
  const res = await PATCH(makeRequest('PATCH', { image_url: 'http://example.com/img.jpg' }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: href が javascript: スキーム → 400', async () => {
  const res = await PATCH(makeRequest('PATCH', { href: 'javascript:alert(1)' }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: href がプロトコル相対URL(//evil.com) → 400（ホスト差し替え防止）', async () => {
  const res = await PATCH(makeRequest('PATCH', { href: '//evil.com/phish' }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: href が https:// → 200', async () => {
  mockAdminFrom.mockReturnValue(updateChain({ id: FEATURE_UUID, href: 'https://example.com/campaign' }));
  const res = await PATCH(makeRequest('PATCH', { href: 'https://example.com/campaign' }), makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: href がサイト内相対パス(/search?...) → 200', async () => {
  mockAdminFrom.mockReturnValue(updateChain({ id: FEATURE_UUID, href: '/search?keyword=春カラー' }));
  const res = await PATCH(makeRequest('PATCH', { href: '/search?keyword=春カラー' }), makeProps());
  expect(res.status).toBe(200);
});

test('PATCH: href 未指定 → 200（optional維持）', async () => {
  mockAdminFrom.mockReturnValue(updateChain({ id: FEATURE_UUID, title: 'test' }));
  const res = await PATCH(makeRequest('PATCH', { title: 'test' }), makeProps());
  expect(res.status).toBe(200);
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

// ─── ストック写真ガード（2026年8月11日・src/lib/stock-image-guard.ts）─────────
// 「既存値と同一なら素通し」が本体。これが無いと、ストック画像が残っている記事の
// タイトル修正すら 400 になり、本番データの差し替え前にガードを入れられなくなる。
const STOCK_A = 'https://images.unsplash.com/photo-1560066984?w=800';
const STOCK_B = 'https://images.unsplash.com/photo-9999999?w=800';

/** ガードが現在値を読む `.select('image_url').eq('id',…).maybeSingle()` の口。 */
function currentImageChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error: null })),
  };
}

test('PATCH: 既存と異なるストック写真へ差し替え → 400', async () => {
  let call = 0;
  mockAdminFrom.mockImplementation(() => {
    call++;
    if (call === 1) return currentImageChain({ image_url: STOCK_A });
    return updateChain({ id: FEATURE_UUID });
  });
  const res = await PATCH(makeRequest('PATCH', { title: 't', image_url: STOCK_B }), makeProps());
  expect(res.status).toBe(400);
  expect((await res.json()).error).toContain('ストック写真');
});

test('PATCH: 既存値と同一のストック写真は素通し → 200（差し替え前でも編集できる）', async () => {
  let call = 0;
  mockAdminFrom.mockImplementation(() => {
    call++;
    if (call === 1) return currentImageChain({ image_url: STOCK_A });
    return updateChain({ id: FEATURE_UUID, title: '直したタイトル', image_url: STOCK_A });
  });
  const res = await PATCH(
    makeRequest('PATCH', { title: '直したタイトル', image_url: STOCK_A }),
    makeProps()
  );
  expect(res.status).toBe(200);
});

test('PATCH: 該当記事が無い状態でストック写真 → 400（現在値を読めなくても素通ししない）', async () => {
  mockAdminFrom.mockImplementation(() => currentImageChain(null));
  const res = await PATCH(makeRequest('PATCH', { title: 't', image_url: STOCK_A }), makeProps());
  expect(res.status).toBe(400);
});

test('PATCH: 現在値が null の記事へストック写真 → 400', async () => {
  mockAdminFrom.mockImplementation(() => currentImageChain({ image_url: null }));
  const res = await PATCH(makeRequest('PATCH', { title: 't', image_url: STOCK_A }), makeProps());
  expect(res.status).toBe(400);
});

// ─── 部分更新で画像が消える回帰（2026年8月11日 恒久根治）─────────────────────
// 管理画面の公開/非公開トグルは `{ is_active }` だけを PATCH する。旧実装は
// `{ ...parsed.data, image_url: parsed.data.image_url || null }` だったため、
// トグルするだけで image_url が null 上書きされ、特集記事の画像が無言で消えていた。
function captureUpdate(data: unknown = { id: FEATURE_UUID }) {
  const update = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        maybeSingle: jest.fn(() => Promise.resolve({ data, error: null })),
      }),
    }),
  });
  mockAdminFrom.mockReturnValue({ update });
  return update;
}

test('PATCH: image_url を送らない更新は image_url を書き換えない', async () => {
  const update = captureUpdate();
  const res = await PATCH(makeRequest('PATCH', { is_active: false }), makeProps());
  expect(res.status).toBe(200);
  expect(update).toHaveBeenCalledWith({ is_active: false });
  expect(Object.keys(update.mock.calls[0][0])).not.toContain('image_url');
});

test('PATCH: image_url に空文字を送ったときだけ null で消す', async () => {
  const update = captureUpdate();
  const res = await PATCH(makeRequest('PATCH', { image_url: '' }), makeProps());
  expect(res.status).toBe(200);
  expect(update).toHaveBeenCalledWith({ image_url: null });
});

test('PATCH: image_url に null を送ったら null で消す', async () => {
  const update = captureUpdate();
  const res = await PATCH(makeRequest('PATCH', { image_url: null }), makeProps());
  expect(res.status).toBe(200);
  expect(update).toHaveBeenCalledWith({ image_url: null });
});

test('PATCH: レスポンスが { feature.id } 形式', async () => {
  mockAdminFrom.mockReturnValue(updateChain({ id: FEATURE_UUID, title: 'test' }));
  const res = await PATCH(makeRequest('PATCH', { title: 'test' }), makeProps());
  const json = await res.json();
  expect(json.feature.id).toBe(FEATURE_UUID);
});
