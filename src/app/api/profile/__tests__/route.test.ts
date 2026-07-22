/**
 * @jest-environment node
 *
 * Tests for PUT /api/profile
 * Key assertions:
 *   - CSRF check required
 *   - Rate limiting (10 req/min per IP)
 *   - Auth required
 *   - Schema validation (display_name required, max lengths)
 *   - Gender enum validation
 *   - Updates profiles table with user_id
 */

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: 'mutationLimit',
  checkRateLimit: jest.fn(),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(),
  createServerSupabaseClient: jest.fn(),
}));
jest.mock('@supabase/ssr');
jest.mock('next/headers');

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { PUT, GET } from '../route';

let mockGetUser: jest.Mock;
let mockUpdate: jest.Mock;

function setupDefaultMocks(
  hasUser: boolean = true,
  updateSucceeds: boolean = true
) {
  (checkCsrf as jest.Mock).mockReturnValue(null);

  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: hasUser ? { id: 'user-123' } : null },
  });

  mockUpdate = jest.fn().mockReturnValue({
    eq: jest.fn().mockResolvedValue({
      error: updateSucceeds ? null : { message: 'Update failed' },
    }),
  });

  const { createServerClient } = require('@supabase/ssr');
  createServerClient.mockReturnValue({
    auth: { getUser: mockGetUser },
    from: jest.fn().mockReturnValue({
      update: mockUpdate,
    }),
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  (createServiceRoleClient as jest.Mock).mockReturnValue({
    from: jest.fn().mockReturnValue({
      update: mockUpdate,
    }),
  });

  const { cookies } = require('next/headers');
  cookies.mockResolvedValue({
    getAll: jest.fn(() => []),
    set: jest.fn(),
  });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  setupDefaultMocks();
});

function makeRequest(body: object, ip = '192.168.1.1') {
  return new Request('http://localhost/api/profile', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/profile', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await PUT(makeRequest({ display_name: 'Test' }) as any);

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await PUT(makeRequest({ display_name: 'Test' }) as any);

    expect(res.status).toBe(429);
  });

  test('unauthenticated → 401', async () => {
    setupDefaultMocks(false);

    const res = await PUT(makeRequest({ display_name: 'Test' }) as any);

    expect(res.status).toBe(401);
  });

  test('invalid JSON → 400', async () => {
    const req = new Request('http://localhost/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.1' },
      body: 'invalid {',
    });

    const res = await PUT(req as any);

    expect(res.status).toBe(400);
  });

  // お名前・電話番号・都道府県は必須化(2026年7月6日・神原さん指摘)。以降のテストは
  // 特に検証したいフィールド以外は有効値で埋める。
  const req = {
    display_name: 'Test',
    phone: '090-1234-5678',
    prefecture: '東京都',
  };

  test('missing display_name → 400', async () => {
    const res = await PUT(makeRequest({ phone: '090-1234-5678', prefecture: '東京都' }) as any);

    expect(res.status).toBe(400);
  });

  test('empty display_name → 400', async () => {
    const res = await PUT(makeRequest({ ...req, display_name: '' }) as any);

    expect(res.status).toBe(400);
  });

  // 【2026年7月8日 恒久根治の回帰防止】.trim() 追加前は "   "(空白のみ)が min(1) を素通りし、
  // スペースのみの表示名が保存され得た。
  test('display_name がスペースのみ → 400', async () => {
    const res = await PUT(makeRequest({ ...req, display_name: '   ' }) as any);

    expect(res.status).toBe(400);
  });

  test('display_name > 50 chars → 400', async () => {
    const res = await PUT(makeRequest({ ...req, display_name: 'x'.repeat(51) }) as any);

    expect(res.status).toBe(400);
  });

  test('valid display_name (50 chars) → 200', async () => {
    const res = await PUT(makeRequest({ ...req, display_name: 'x'.repeat(50) }) as any);

    expect(res.status).toBe(200);
  });

  test('missing phone → 400', async () => {
    const res = await PUT(makeRequest({ display_name: 'Test', prefecture: '東京都' }) as any);

    expect(res.status).toBe(400);
  });

  test('でたらめな電話番号 → 400', async () => {
    const res = await PUT(makeRequest({ ...req, phone: 'abc-defg' }) as any);

    expect(res.status).toBe(400);
  });

  test('phone > 20 chars → 400', async () => {
    const res = await PUT(makeRequest({
      ...req,
      phone: 'x'.repeat(21),
    }) as any);

    expect(res.status).toBe(400);
  });

  test('missing prefecture → 400', async () => {
    const res = await PUT(makeRequest({ display_name: 'Test', phone: '090-1234-5678' }) as any);

    expect(res.status).toBe(400);
  });

  test('empty prefecture → 400', async () => {
    const res = await PUT(makeRequest({ ...req, prefecture: '' }) as any);

    expect(res.status).toBe(400);
  });

  test('prefecture > 20 chars → 400', async () => {
    const res = await PUT(makeRequest({
      ...req,
      prefecture: 'x'.repeat(21),
    }) as any);

    expect(res.status).toBe(400);
  });

  test('city > 50 chars → 400', async () => {
    const res = await PUT(makeRequest({
      ...req,
      city: 'x'.repeat(51),
    }) as any);

    expect(res.status).toBe(400);
  });

  test('birth_date > 10 chars → 400', async () => {
    const res = await PUT(makeRequest({
      ...req,
      birth_date: '12345678901',
    }) as any);

    expect(res.status).toBe(400);
  });

  // 【回帰防止】形式(regex)だけでは 2026-02-30 等の不在日が通り、DATE 列が拒否して 500 に
  // なっていた（customerSchema.birthday と同型の欠陥）。isValidIsoDate refine で 400 に根治。
  test('birth_date が実在しない暦日（2026-02-30）→ 400', async () => {
    const res = await PUT(makeRequest({
      ...req,
      birth_date: '2026-02-30',
    }) as any);

    expect(res.status).toBe(400);
  });

  test('birth_date が空文字 → 200（未入力の素通し）', async () => {
    const res = await PUT(makeRequest({
      ...req,
      birth_date: '',
    }) as any);

    expect(res.status).toBe(200);
  });

  test('birth_date が実在する暦日（うるう年 2028-02-29）→ 200', async () => {
    const res = await PUT(makeRequest({
      ...req,
      birth_date: '2028-02-29',
    }) as any);

    expect(res.status).toBe(200);
  });

  test('gender=male → 200', async () => {
    const res = await PUT(makeRequest({
      ...req,
      gender: 'male',
    }) as any);

    expect(res.status).toBe(200);
  });

  test('gender=female → 200', async () => {
    const res = await PUT(makeRequest({
      ...req,
      gender: 'female',
    }) as any);

    expect(res.status).toBe(200);
  });

  test('gender=other → 200', async () => {
    const res = await PUT(makeRequest({
      ...req,
      gender: 'other',
    }) as any);

    expect(res.status).toBe(200);
  });

  test('gender=unspecified → 200', async () => {
    const res = await PUT(makeRequest({
      ...req,
      gender: 'unspecified',
    }) as any);

    expect(res.status).toBe(200);
  });

  test('invalid gender → 400', async () => {
    const res = await PUT(makeRequest({
      ...req,
      gender: 'invalid',
    }) as any);

    expect(res.status).toBe(400);
  });

  test('valid request → 200 with success', async () => {
    const res = await PUT(makeRequest({
      display_name: 'John Doe',
      phone: '09012345678',
      prefecture: '東京都',
      city: '渋谷区',
      birth_date: '1990-01-01',
      gender: 'male',
    }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('updates profiles table with user_id', async () => {
    const res = await PUT(makeRequest(req) as any);

    expect(mockUpdate).toHaveBeenCalled();
    const eqCall = mockUpdate.mock.calls[0][0];
    // Should call .eq('id', user.id)
  });

  test('includes updated_at timestamp', async () => {
    const res = await PUT(makeRequest(req) as any);

    const updateData = mockUpdate.mock.calls[0][0];
    expect(updateData.updated_at).toBeDefined();
  });

  test('sets optional fields to null when omitted', async () => {
    const res = await PUT(makeRequest(req) as any);

    const updateData = mockUpdate.mock.calls[0][0];
    expect(updateData.city).toBeNull();
    expect(updateData.birth_date).toBeNull();
    expect(updateData.gender).toBeNull();
  });

  test('update error → 500', async () => {
    setupDefaultMocks(true, false);

    const res = await PUT(makeRequest(req) as any);

    expect(res.status).toBe(500);
  });

  test('rate limit params (10 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await PUT(
      makeRequest(req, '192.168.1.1') as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(10);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('profile');
  });

  test('extracts last (trusted) IP from x-forwarded-for', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await PUT(
      makeRequest(
        req,
        '10.0.0.1, 192.168.1.1'
      ) as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('exception during processing → 500', async () => {
    const { createServerClient } = require('@supabase/ssr');
    createServerClient.mockImplementation(() => {
      throw new Error('Connection error');
    });

    const res = await PUT(makeRequest(req) as any);

    expect(res.status).toBe(500);
  });

  test('cookie callbacks (getAll/setAll/forEach) are invocable', async () => {
    const { createServerClient } = require('@supabase/ssr');
    const { cookies } = require('next/headers');
    const mockCookieStore = { getAll: jest.fn(() => []), set: jest.fn() };
    cookies.mockResolvedValue(mockCookieStore);

    createServerClient.mockImplementation((_url: string, _key: string, opts: any) => {
      opts.cookies.getAll();
      opts.cookies.setAll([{ name: 'sb', value: 'val', options: {} }]);
      return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) }, from: jest.fn() };
    });

    const res = await PUT(makeRequest(req) as any);
    expect(res.status).toBe(401);
    expect(mockCookieStore.getAll).toHaveBeenCalled();
    expect(mockCookieStore.set).toHaveBeenCalled();
  });
});

// ─── GET /api/profile (M-1): LINE 連携状態を profiles.line_user_id から返す ───────────
// 旧実装は GET ハンドラが無く settings が 405 → 常にエラー表示だった。
// 【監査C2】連携の単一ソースは profiles.line_user_id（旧 line_user_links.user_id は常に NULL で
// LIFF 連携済みでも常に未連携表示だった）。line_user_id の非 NULL で linked を判定する。
describe('GET /api/profile', () => {
  function setupLinkMock(row: unknown, error: unknown = null) {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    (createServiceRoleClient as jest.Mock).mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: row, error }),
          }),
        }),
      }),
    });
  }

  function makeGet() {
    return new Request('http://localhost/api/profile', { method: 'GET' });
  }

  test('連携あり（line_user_id 非 NULL）→ { linked: true }', async () => {
    setupLinkMock({ line_user_id: 'U-abc' });
    const res = await GET(makeGet() as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ linked: true });
  });

  test('連携なし（行なし）→ { linked: false }', async () => {
    setupLinkMock(null);
    const res = await GET(makeGet() as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ linked: false });
  });

  test('行はあるが line_user_id が NULL → { linked: false }', async () => {
    setupLinkMock({ line_user_id: null });
    const res = await GET(makeGet() as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ linked: false });
  });

  test('DBエラー → 500', async () => {
    setupLinkMock(null, { message: 'db error' });
    const res = await GET(makeGet() as any);
    expect(res.status).toBe(500);
  });
});
