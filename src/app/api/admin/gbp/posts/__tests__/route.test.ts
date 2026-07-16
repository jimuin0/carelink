/**
 * @jest-environment node
 *
 * Tests for GET/POST/PATCH/DELETE /api/admin/gbp/posts
 * Key assertions:
 *   - Non-member → 403 (all methods)
 *   - POST: body content required
 *   - PATCH: id required and must be UUID
 *   - DELETE: id in query param required and must be UUID
 *   - DB failure → 500
 * Note: All operations use the SSR (anon) Supabase client, not service role.
 */

jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const POST_UUID     = '11111111-1111-1111-1111-111111111111';
const USER_ID       = '33333333-3333-3333-3333-333333333333';

const mockGetUser = jest.fn();
const mockAnonFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: jest.fn() }),
}));

import { NextRequest } from 'next/server';
import { GET, POST, PATCH, DELETE } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

// 監査A2: getAdminFacilityIds は .select().eq().in() が直接配列Promiseを返す形（single()なし）。
// GET/POSTはこれのみ使う。
function membershipSingle(members: { facility_id: string }[]) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn(() => Promise.resolve({ data: members })),
  };
}

// PATCH/DELETEはid起点のため、投稿の実所属施設を select().eq().single() で取得する。
function postFacilitySingle(facilityId: string | null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data: facilityId ? { facility_id: facilityId } : null, error: null })),
  };
}

// GBP posts list: limit(N) → Promise
function postListChain(data: unknown[], error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn(() => Promise.resolve({ data, error })),
  };
}

// Insert: insert().select().single()
function insertSingle(data: unknown, error: unknown = null) {
  return {
    insert: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn(() => Promise.resolve({ data, error })),
      }),
    }),
  };
}

// Update: update().eq().eq().select() → Promise（0行更新のphantom successを404にするため.select()で影響行を受け取る）
function updateChain(data: unknown[] | null, error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn(() => Promise.resolve({ data, error })),
        }),
      }),
    }),
  };
}

// Delete: delete().eq().eq().select() → Promise（同上）
function deleteChain(data: unknown[] | null, error: unknown = null) {
  return {
    delete: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          select: jest.fn(() => Promise.resolve({ data, error })),
        }),
      }),
    }),
  };
}

const MEMBER_DATA = { facility_id: FACILITY_UUID };

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── GET ──────────────────────────────────────────────────────────────────────

test('GET: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'GET' }));
  expect(res.status).toBe(401);
});

test('GET: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'GET' }));
  expect(res.status).toBe(429);
});

test('GET: 非管理者 → 403', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([]));
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'GET' }));
  expect(res.status).toBe(403);
});

test('GET: DB失敗 → 500', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    return postListChain([], { message: 'DB error' });
  });
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'GET' }));
  expect(res.status).toBe(500);
});

test('GET: 正常取得 → 200 with posts', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    return postListChain([{ id: POST_UUID }]);
  });
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'GET' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.posts).toBeDefined();
});

// ─── 監査A2: 複数施設所有者の非決定的施設選択の根治確認 ────────────────────────

const FACILITY_UUID_2 = '44444444-4444-4444-4444-444444444444';

test('GET: 複数施設所有・facility_id未指定 → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA, { facility_id: FACILITY_UUID_2 }]));
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'GET' }));
  expect(res.status).toBe(400);
});

test('GET: 複数施設所有・所属していないfacility_id指定 → 403（越境防止）', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA, { facility_id: FACILITY_UUID_2 }]));
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/posts?facility_id=99999999-9999-9999-9999-999999999999', { method: 'GET' }));
  expect(res.status).toBe(403);
});

// ─── POST ─────────────────────────────────────────────────────────────────────

test('POST: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'テスト投稿' }),
  }));
  expect(res.status).toBe(401);
});

test('POST: 非管理者 → 403', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([]));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'テスト投稿' }),
  }));
  expect(res.status).toBe(403);
});

test('POST: body が空 → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA]));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: '' }),
  }));
  expect(res.status).toBe(400);
});

test('POST: DB失敗 → 500', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    return insertSingle(null, { message: 'DB error' });
  });
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'テスト投稿' }),
  }));
  expect(res.status).toBe(500);
});

test('POST: 正常作成 → 200 with post', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    return insertSingle({ id: POST_UUID, body: 'テスト投稿' });
  });
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'テスト投稿' }),
  }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.post).toBeDefined();
});

test('POST: 複数施設所有・facility_id未指定 → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA, { facility_id: FACILITY_UUID_2 }]));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'テスト投稿' }),
  }));
  expect(res.status).toBe(400);
});

test('POST: 複数施設所有・所属していないfacility_id指定 → 403（越境防止）', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA, { facility_id: FACILITY_UUID_2 }]));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'テスト投稿', facility_id: '99999999-9999-9999-9999-999999999999' }),
  }));
  expect(res.status).toBe(403);
});

// ─── PATCH ────────────────────────────────────────────────────────────────────

test('PATCH: id なし → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA]));
  const res = await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '更新' }),
  }));
  expect(res.status).toBe(400);
});

test('PATCH: id が不正UUID → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA]));
  const res = await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'bad-uuid', title: '更新' }),
  }));
  expect(res.status).toBe(400);
});

test('PATCH: 正常更新 → 200', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return postFacilitySingle(FACILITY_UUID);
    return updateChain([{ id: POST_UUID }]);
  });
  const res = await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: POST_UUID, title: '更新タイトル' }),
  }));
  expect(res.status).toBe(200);
});

// 存在チェック通過後にレコードが消える TOCTOU：0行更新でも 200 を返す phantom success の根治確認
test('PATCH: 存在チェック後に削除され更新0行（TOCTOU） → 404', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return postFacilitySingle(FACILITY_UUID);
    return updateChain([]);
  });
  const res = await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: POST_UUID, title: '更新' }),
  }));
  expect(res.status).toBe(404);
});

test('PATCH: 更新結果 data が null → 404', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return postFacilitySingle(FACILITY_UUID);
    return updateChain(null);
  });
  const res = await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: POST_UUID, title: '更新' }),
  }));
  expect(res.status).toBe(404);
});

test('PATCH: 投稿が見つからない → 404', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    return postFacilitySingle(null);
  });
  const res = await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: POST_UUID, title: '更新' }),
  }));
  expect(res.status).toBe(404);
});

test('PATCH: 投稿は存在するが所属していない施設 → 403（越境防止・監査A2）', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    return postFacilitySingle('99999999-9999-9999-9999-999999999999');
  });
  const res = await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: POST_UUID, title: '更新' }),
  }));
  expect(res.status).toBe(403);
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

test('DELETE: id なし → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA]));
  const res = await DELETE(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'DELETE' }));
  expect(res.status).toBe(400);
});

test('DELETE: id が不正UUID → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA]));
  const res = await DELETE(new NextRequest('http://localhost/api/admin/gbp/posts?id=bad-uuid', { method: 'DELETE' }));
  expect(res.status).toBe(400);
});

test('DELETE: 正常削除 → 200', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return postFacilitySingle(FACILITY_UUID);
    return deleteChain([{ id: POST_UUID }]);
  });
  const res = await DELETE(new NextRequest(`http://localhost/api/admin/gbp/posts?id=${POST_UUID}`, { method: 'DELETE' }));
  expect(res.status).toBe(200);
});

// 存在チェック通過後にレコードが消える TOCTOU：0行削除でも 200 を返す phantom success の根治確認
test('DELETE: 存在チェック後に削除され削除0行（TOCTOU） → 404', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return postFacilitySingle(FACILITY_UUID);
    return deleteChain([]);
  });
  const res = await DELETE(new NextRequest(`http://localhost/api/admin/gbp/posts?id=${POST_UUID}`, { method: 'DELETE' }));
  expect(res.status).toBe(404);
});

test('DELETE: 削除結果 data が null → 404', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return postFacilitySingle(FACILITY_UUID);
    return deleteChain(null);
  });
  const res = await DELETE(new NextRequest(`http://localhost/api/admin/gbp/posts?id=${POST_UUID}`, { method: 'DELETE' }));
  expect(res.status).toBe(404);
});

test('DELETE: 投稿が見つからない → 404', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    return postFacilitySingle(null);
  });
  const res = await DELETE(new NextRequest(`http://localhost/api/admin/gbp/posts?id=${POST_UUID}`, { method: 'DELETE' }));
  expect(res.status).toBe(404);
});

test('DELETE: 投稿は存在するが所属していない施設 → 403（越境防止・監査A2）', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    return postFacilitySingle('99999999-9999-9999-9999-999999999999');
  });
  const res = await DELETE(new NextRequest(`http://localhost/api/admin/gbp/posts?id=${POST_UUID}`, { method: 'DELETE' }));
  expect(res.status).toBe(403);
});

test('DELETE: DB失敗 → 500', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return postFacilitySingle(FACILITY_UUID);
    return deleteChain(null, { message: 'DB error' });
  });
  const res = await DELETE(new NextRequest(`http://localhost/api/admin/gbp/posts?id=${POST_UUID}`, { method: 'DELETE' }));
  expect(res.status).toBe(500);
});

test('PATCH: DB失敗 → 500', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return postFacilitySingle(FACILITY_UUID);
    return updateChain(null, { message: 'DB error' });
  });
  const res = await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: POST_UUID, title: '更新' }),
  }));
  expect(res.status).toBe(500);
});

test('POST: title あり・photo_url有効・cta_type有効・scheduled_at あり', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    return insertSingle({ id: POST_UUID, body: '詳細', status: 'scheduled' });
  });
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'キャンペーン',
      body: '詳細内容',
      post_type: 'EVENT',
      photo_url: 'https://example.com/photo.jpg',
      cta_type: 'BOOK',
      cta_url: 'https://example.com/book',
      scheduled_at: '2026-05-01T10:00:00Z',
    }),
  }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.post).toBeDefined();
});

test('POST: 無効なphoto_url → nullに変換', async () => {
  let callNum = 0;
  const capturedInsert = jest.fn();
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    return {
      insert: (data: unknown) => {
        capturedInsert(data);
        return { select: jest.fn().mockReturnValue({ single: jest.fn(() => Promise.resolve({ data: { id: POST_UUID }, error: null })) }) };
      },
    };
  });
  await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: '内容', photo_url: 'not-https-url' }),
  }));
  const insertedData = capturedInsert.mock.calls[0][0];
  expect(insertedData.photo_url).toBeNull();
});

test('POST: 無効なpost_type → STANDARDにフォールバック', async () => {
  let callNum = 0;
  const capturedInsert = jest.fn();
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    return {
      insert: (data: unknown) => {
        capturedInsert(data);
        return { select: jest.fn().mockReturnValue({ single: jest.fn(() => Promise.resolve({ data: { id: POST_UUID }, error: null })) }) };
      },
    };
  });
  await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: '内容', post_type: 'INVALID_TYPE' }),
  }));
  const insertedData = capturedInsert.mock.calls[0][0];
  expect(insertedData.post_type).toBe('STANDARD');
});

test('PATCH: body, post_type, photo_url, cta_type, cta_url, status, scheduled_at, published_at を全部更新', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return postFacilitySingle(FACILITY_UUID);
    return updateChain([{ id: POST_UUID }]);
  });
  const res = await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: POST_UUID,
      title: 'New Title',
      body: 'New body',
      post_type: 'OFFER',
      photo_url: 'https://example.com/img.jpg',
      cta_type: 'LEARN_MORE',
      cta_url: 'https://example.com/learn',
      status: 'published',
      scheduled_at: '2026-06-01T00:00:00Z',
      published_at: '2026-05-01T00:00:00Z',
    }),
  }));
  expect(res.status).toBe(200);
});

test('PATCH: 無効なpost_type → 更新されない（条件false）', async () => {
  let callNum = 0;
  const capturedUpdate = jest.fn();
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return postFacilitySingle(FACILITY_UUID);
    return {
      update: (data: unknown) => {
        capturedUpdate(data);
        return { eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn(() => Promise.resolve({ data: [{ id: POST_UUID }], error: null })) }) }) };
      },
    };
  });
  await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: POST_UUID, post_type: 'INVALID', status: 'INVALID_STATUS' }),
  }));
  const updated = capturedUpdate.mock.calls[0][0] as Record<string, unknown>;
  expect(updated.post_type).toBeUndefined();
  expect(updated.status).toBeUndefined();
});

test('PATCH: photo_url 無効 → null に変換', async () => {
  let callNum = 0;
  const capturedUpdate = jest.fn();
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return postFacilitySingle(FACILITY_UUID);
    return {
      update: (data: unknown) => {
        capturedUpdate(data);
        return { eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn(() => Promise.resolve({ data: [{ id: POST_UUID }], error: null })) }) }) };
      },
    };
  });
  await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: POST_UUID, photo_url: 'not-https', cta_url: 'also-invalid' }),
  }));
  const updated = capturedUpdate.mock.calls[0][0] as Record<string, unknown>;
  expect(updated.photo_url).toBeNull();
  expect(updated.cta_url).toBeNull();
});

test('PATCH: title=null → null に変換', async () => {
  let callNum = 0;
  const capturedUpdate = jest.fn();
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return postFacilitySingle(FACILITY_UUID);
    return {
      update: (data: unknown) => {
        capturedUpdate(data);
        return { eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn(() => Promise.resolve({ data: [{ id: POST_UUID }], error: null })) }) }) };
      },
    };
  });
  await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: POST_UUID, title: null }),
  }));
  const updated = capturedUpdate.mock.calls[0][0] as Record<string, unknown>;
  expect(updated.title).toBeNull();
});

test('POST: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'x' }),
  }));
  expect(res).toBe(csrfRes);
});

test('PATCH: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: POST_UUID }),
  }));
  expect(res).toBe(csrfRes);
});

test('DELETE: CSRFエラー → そのまま返却', async () => {
  const csrfRes = new Response('csrf', { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValueOnce(csrfRes);
  const res = await DELETE(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'DELETE' }));
  expect(res).toBe(csrfRes);
});

test('POST: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: 'x' }),
  }));
  expect(res.status).toBe(429);
});

test('PATCH: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: POST_UUID }),
  }));
  expect(res.status).toBe(429);
});

test('DELETE: レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await DELETE(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'DELETE' }));
  expect(res.status).toBe(429);
});

// Branch coverage: line 103 — cta_type が VALID_CTA_TYPES に含まれない場合 → null に変換
test('PATCH: 無効な cta_type → null に変換（false分岐）', async () => {
  let callNum = 0;
  const capturedUpdate = jest.fn();
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return postFacilitySingle(FACILITY_UUID);
    return {
      update: (data: unknown) => {
        capturedUpdate(data);
        return { eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn(() => Promise.resolve({ data: [{ id: POST_UUID }], error: null })) }) }) };
      },
    };
  });
  await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: POST_UUID, cta_type: 'INVALID_CTA' }),
  }));
  const updated = capturedUpdate.mock.calls[0][0] as Record<string, unknown>;
  expect(updated.cta_type).toBeNull();
});

test('PATCH: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: POST_UUID }),
  }));
  expect(res.status).toBe(401);
});

test('DELETE: 未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await DELETE(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'DELETE' }));
  expect(res.status).toBe(401);
});

test('PATCH: 非管理者 → 403', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([]);
    return postFacilitySingle(FACILITY_UUID);
  });
  const res = await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: POST_UUID }),
  }));
  expect(res.status).toBe(403);
});

test('DELETE: 非管理者 → 403', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([]);
    return postFacilitySingle(FACILITY_UUID);
  });
  const res = await DELETE(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'DELETE' }));
  expect(res.status).toBe(403);
});

test('POST: body 未指定 → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA]));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  }));
  expect(res.status).toBe(400);
});

test('POST: 不正な JSON body → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA]));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not-json',
  }));
  expect(res.status).toBe(400);
});

test('POST: scheduled_at なし → status=draft, invalid cta_type → null', async () => {
  let callNum = 0;
  const capturedInsert = jest.fn();
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    return {
      insert: (d: unknown) => { capturedInsert(d); return { select: jest.fn().mockReturnValue({ single: jest.fn(() => Promise.resolve({ data: { id: POST_UUID }, error: null })) }) }; },
    };
  });
  await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'x', cta_type: 'INVALID', cta_url: 'not-https' }),
  }));
  const d = capturedInsert.mock.calls[0][0] as Record<string, unknown>;
  expect(d.status).toBe('draft');
  expect(d.cta_type).toBeNull();
  expect(d.cta_url).toBeNull();
  expect(d.title).toBeNull();
});

test('PATCH: scheduled_at と published_at が falsy → null に変換', async () => {
  let callNum = 0;
  const capturedUpdate = jest.fn();
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    if (callNum === 2) return postFacilitySingle(FACILITY_UUID);
    return {
      update: (d: unknown) => { capturedUpdate(d); return { eq: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ select: jest.fn(() => Promise.resolve({ data: [{ id: POST_UUID }], error: null })) }) }) }; },
    };
  });
  await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: POST_UUID, scheduled_at: '', published_at: '' }),
  }));
  const d = capturedUpdate.mock.calls[0][0] as Record<string, unknown>;
  expect(d.scheduled_at).toBeNull();
  expect(d.published_at).toBeNull();
});

test('PATCH: 不正な JSON body → id なしで 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle([MEMBER_DATA]));
  const res = await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: 'not-json',
  }));
  expect(res.status).toBe(400);
});

test('GET: data が null のとき [] を返す', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle([MEMBER_DATA]);
    return postListChain([], null); // null data, no error
  });
  // Override postListChain to return data: null
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum <= 1) return membershipSingle([MEMBER_DATA]);
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: null, error: null })),
    };
  });
  callNum = 0;
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'GET' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.posts).toEqual([]);
});
