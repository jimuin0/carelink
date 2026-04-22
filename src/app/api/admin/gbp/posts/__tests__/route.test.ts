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

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
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
import { inMemoryRateLimit } from '@/lib/rate-limit';

// Membership check: limit(1).single() → Promise
function membershipSingle(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn(() => Promise.resolve({ data, error: null })),
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

// Update: update().eq().eq() → Promise
function updateEqEq(error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error })),
      }),
    }),
  };
}

// Delete: delete().eq().eq() → Promise
function deleteEqEq(error: unknown = null) {
  return {
    delete: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error })),
      }),
    }),
  };
}

const MEMBER_DATA = { facility_id: FACILITY_UUID };

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
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
  (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'GET' }));
  expect(res.status).toBe(429);
});

test('GET: 非管理者 → 403', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle(null));
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'GET' }));
  expect(res.status).toBe(403);
});

test('GET: DB失敗 → 500', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return postListChain([], { message: 'DB error' });
  });
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'GET' }));
  expect(res.status).toBe(500);
});

test('GET: 正常取得 → 200 with posts', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return postListChain([{ id: POST_UUID }]);
  });
  const res = await GET(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'GET' }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.posts).toBeDefined();
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
  mockAnonFrom.mockReturnValue(membershipSingle(null));
  const res = await POST(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: 'テスト投稿' }),
  }));
  expect(res.status).toBe(403);
});

test('POST: body が空 → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle(MEMBER_DATA));
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
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
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
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
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

// ─── PATCH ────────────────────────────────────────────────────────────────────

test('PATCH: id なし → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle(MEMBER_DATA));
  const res = await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '更新' }),
  }));
  expect(res.status).toBe(400);
});

test('PATCH: id が不正UUID → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle(MEMBER_DATA));
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
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return updateEqEq(null);
  });
  const res = await PATCH(new NextRequest('http://localhost/api/admin/gbp/posts', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: POST_UUID, title: '更新タイトル' }),
  }));
  expect(res.status).toBe(200);
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

test('DELETE: id なし → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle(MEMBER_DATA));
  const res = await DELETE(new NextRequest('http://localhost/api/admin/gbp/posts', { method: 'DELETE' }));
  expect(res.status).toBe(400);
});

test('DELETE: id が不正UUID → 400', async () => {
  mockAnonFrom.mockReturnValue(membershipSingle(MEMBER_DATA));
  const res = await DELETE(new NextRequest('http://localhost/api/admin/gbp/posts?id=bad-uuid', { method: 'DELETE' }));
  expect(res.status).toBe(400);
});

test('DELETE: 正常削除 → 200', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return deleteEqEq(null);
  });
  const res = await DELETE(new NextRequest(`http://localhost/api/admin/gbp/posts?id=${POST_UUID}`, { method: 'DELETE' }));
  expect(res.status).toBe(200);
});

test('DELETE: DB失敗 → 500', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return deleteEqEq({ message: 'DB error' });
  });
  const res = await DELETE(new NextRequest(`http://localhost/api/admin/gbp/posts?id=${POST_UUID}`, { method: 'DELETE' }));
  expect(res.status).toBe(500);
});

test('PATCH: DB失敗 → 500', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return updateEqEq({ message: 'DB error' });
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
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
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
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
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
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
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
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return updateEqEq(null);
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
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return {
      update: (data: unknown) => {
        capturedUpdate(data);
        return { eq: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) }) };
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
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return {
      update: (data: unknown) => {
        capturedUpdate(data);
        return { eq: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) }) };
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
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return {
      update: (data: unknown) => {
        capturedUpdate(data);
        return { eq: jest.fn().mockReturnValue({ eq: jest.fn(() => Promise.resolve({ error: null })) }) };
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

test('GET: data が null のとき [] を返す', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return membershipSingle(MEMBER_DATA);
    return postListChain([], null); // null data, no error
  });
  // Override postListChain to return data: null
  mockAnonFrom.mockImplementation(() => {
    callNum++;
    if (callNum <= 1) return membershipSingle(MEMBER_DATA);
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
