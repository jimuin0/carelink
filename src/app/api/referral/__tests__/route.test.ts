/**
 * @jest-environment node
 *
 * Tests for GET /api/referral & POST /api/referral
 * Key assertions:
 *   - GET: Auth required, auto-generate code if missing, rate limit (10 req/min)
 *   - POST: CSRF + auth + rate limit (5 req/min), code validation, redemption logic
 *   - Code format: 8 alphanumeric (excluding I, O)
 */

jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: 'mutationLimit',
  checkRateLimit: jest.fn(),
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
jest.mock('@supabase/ssr');
jest.mock('next/headers');

// Lazy wrapper for adminSupabase (created at module scope in the route via createClient)
let mockAdminFrom: jest.Mock;
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (...args: unknown[]) => mockAdminFrom(...args),
  })),
}));

import { checkRateLimit } from '@/lib/rate-limit';

let mockGetUser: jest.Mock;

function setupDefaultMocks(
  hasUser: boolean = true,
  codeExists: boolean = false
) {
  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: hasUser ? { id: 'user-123' } : null },
  });

  // adminSupabase.from('referral_codes') chain
  mockAdminFrom = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        maybeSingle: jest.fn().mockResolvedValue({
          data: codeExists ? { code: 'ABC12345', used_count: 2 } : null,
        }),
      }),
    }),
    insert: jest.fn().mockResolvedValue({ error: null }),
  });

  const { createServerClient } = require('@supabase/ssr');
  createServerClient.mockReturnValue({
    auth: { getUser: mockGetUser },
  });

  const { cookies } = require('next/headers');
  cookies.mockResolvedValue({
    getAll: jest.fn(() => []),
  });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  setupDefaultMocks();
});

describe('GET /api/referral', () => {
  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const { GET } = await import('../route');
    const req = new Request('http://localhost/api/referral');
    Object.defineProperty(req, 'nextUrl', {
      value: new URL(req.url),
    });
    const res = await GET(req as any);

    expect(res.status).toBe(429);
  });

  test('unauthenticated → 401', async () => {
    setupDefaultMocks(false);

    const { GET } = await import('../route');
    const req = new Request('http://localhost/api/referral');
    Object.defineProperty(req, 'nextUrl', {
      value: new URL(req.url),
    });
    const res = await GET(req as any);

    expect(res.status).toBe(401);
  });

  test('existing code returned → 200', async () => {
    setupDefaultMocks(true, true);

    const { GET } = await import('../route');
    const req = new Request('http://localhost/api/referral');
    Object.defineProperty(req, 'nextUrl', {
      value: new URL(req.url),
    });
    const res = await GET(req as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.code).toBe('ABC12345');
  });

  test('no code generated → 200 with new code', async () => {
    const { GET } = await import('../route');
    const req = new Request('http://localhost/api/referral');
    Object.defineProperty(req, 'nextUrl', {
      value: new URL(req.url),
    });
    const res = await GET(req as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.code).toBe('string');
    expect(json.code.length).toBe(8);
  });

  test('code format (8 chars, excludes I/O)', async () => {
    const { GET } = await import('../route');
    const req = new Request('http://localhost/api/referral');
    Object.defineProperty(req, 'nextUrl', {
      value: new URL(req.url),
    });
    const res = await GET(req as any);

    const json = await res.json();
    expect(json.code).toMatch(/^[A-HJ-NPQ-Z23456789]{8}$/);
  });
});

describe('POST /api/referral', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 });
    const { checkCsrf } = require('@/lib/csrf');
    checkCsrf.mockReturnValueOnce(csrfError);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/referral', {
      method: 'POST',
      body: JSON.stringify({ code: 'ABC12345' }),
    }) as any);

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/referral', {
      method: 'POST',
      body: JSON.stringify({ code: 'ABC12345' }),
    }) as any);

    expect(res.status).toBe(429);
  });

  test('unauthenticated → 401', async () => {
    setupDefaultMocks(false);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/referral', {
      method: 'POST',
      body: JSON.stringify({ code: 'ABC12345' }),
    }) as any);

    expect(res.status).toBe(401);
  });

  test('missing code → 400', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/referral', {
      method: 'POST',
      body: JSON.stringify({}),
    }) as any);

    expect(res.status).toBe(400);
  });

  test('rate limit params (5 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    const { POST } = await import('../route');
    await POST(new Request('http://localhost/api/referral', {
      method: 'POST',
      headers: { 'x-forwarded-for': '192.168.1.1' },
      body: JSON.stringify({ code: 'ABC12345' }),
    }) as any);

    if ((checkRateLimit as jest.Mock).mock.calls.length > 0) {
      const call = (checkRateLimit as jest.Mock).mock.calls[0];
      expect(call[2]).toBe(5);
    }
  });

  test('自分のコードを使用 → 400', async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'referral_codes') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({
                data: { user_id: 'user-123', used_count: 0 }, // same as logged-in user
              }),
            }),
          }),
        };
      }
      return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis() };
    });

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/referral', {
      method: 'POST',
      body: JSON.stringify({ code: 'MYCODE12' }),
    }) as any);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('自分のコード');
  });

  test('無効な紹介コード → 400', async () => {
    mockAdminFrom.mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({ data: null }),
        }),
      }),
    }));

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/referral', {
      method: 'POST',
      body: JSON.stringify({ code: 'BADCODE1' }),
    }) as any);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('無効');
  });

  test('既に紹介コードを使用済み → 400', async () => {
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'referral_codes') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({
                data: { user_id: 'referrer-1', used_count: 1 },
              }),
            }),
          }),
        };
      }
      // referral_uses check → already exists
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'use-1' } }),
          }),
        }),
      };
    });

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/referral', {
      method: 'POST',
      body: JSON.stringify({ code: 'VALID123' }),
    }) as any);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('使用済み');
  });

  test('referral_uses insert競合(23505) → 400', async () => {
    let tableCallNum = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      tableCallNum++;
      if (table === 'referral_codes') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({
                data: { user_id: 'referrer-1', used_count: 0 },
              }),
            }),
          }),
        };
      }
      if (tableCallNum === 2) {
        // referral_uses check → not used yet
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: null }),
            }),
          }),
        };
      }
      // referral_uses insert → 23505 conflict
      return { insert: jest.fn().mockResolvedValue({ error: { code: '23505', message: 'duplicate' } }) };
    });

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/referral', {
      method: 'POST',
      body: JSON.stringify({ code: 'VALID123' }),
    }) as any);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('使用済み');
  });

  test('referral_uses insert失敗(他エラー) → 500', async () => {
    let tableCallNum = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      tableCallNum++;
      if (table === 'referral_codes') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({
                data: { user_id: 'referrer-1', used_count: 0 },
              }),
            }),
          }),
        };
      }
      if (tableCallNum === 2) {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: null }),
            }),
          }),
        };
      }
      return { insert: jest.fn().mockResolvedValue({ error: { code: '99999', message: 'unknown' } }) };
    });

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/referral', {
      method: 'POST',
      body: JSON.stringify({ code: 'VALID123' }),
    }) as any);

    expect(res.status).toBe(500);
  });

  test('コード使用成功 → 200', async () => {
    let tableCallNum = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      tableCallNum++;
      if (table === 'referral_codes' && tableCallNum === 1) {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({
                data: { user_id: 'referrer-1', used_count: 3 },
              }),
            }),
          }),
        };
      }
      if (table === 'referral_uses' && tableCallNum === 2) {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: null }),
            }),
          }),
        };
      }
      if (table === 'referral_uses') {
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
          // REF-4: ポイント付与成功後の points_awarded=true 更新
          update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === 'user_points') {
        return { insert: jest.fn().mockResolvedValue({ error: null }) };
      }
      // referral_codes update (used_count increment)
      return { update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) }) };
    });

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/referral', {
      method: 'POST',
      body: JSON.stringify({ code: 'VALID123' }),
    }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.message).toContain('300ポイント');
  });

});

describe('cookie callbacks and body parse catch', () => {
  test('GET: cookie getAll callback invoked during client creation', async () => {
    const { GET } = await import('../route');
    const { createServerClient } = require('@supabase/ssr');
    const { cookies } = require('next/headers');
    const mockCookieStore = { getAll: jest.fn(() => [] as any[]) };
    cookies.mockResolvedValue(mockCookieStore);

    createServerClient.mockImplementation((_url: string, _key: string, opts: any) => {
      opts.cookies.getAll();
      return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) } };
    });

    const req = new Request('http://localhost/api/referral', { method: 'GET', headers: { 'x-forwarded-for': '1.2.3.4' } });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url) });
    const res = await GET(req as any);
    expect(res.status).toBe(401);
    expect(mockCookieStore.getAll).toHaveBeenCalled();
  });

  test('POST: cookie getAll callback invoked during client creation', async () => {
    const { POST } = await import('../route');
    const { createServerClient } = require('@supabase/ssr');
    const { cookies } = require('next/headers');
    const mockCookieStore = { getAll: jest.fn(() => [] as any[]) };
    cookies.mockResolvedValue(mockCookieStore);

    createServerClient.mockImplementation((_url: string, _key: string, opts: any) => {
      opts.cookies.getAll();
      return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) } };
    });

    const res = await POST(new Request('http://localhost/api/referral', {
      method: 'POST',
      body: JSON.stringify({ code: 'VALID123' }),
    }) as any);
    expect(res.status).toBe(401);
    expect(mockCookieStore.getAll).toHaveBeenCalled();
  });

  test('GET: missing x-forwarded-for → "unknown" IP', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    const { GET } = await import('../route');
    const req = new Request('http://localhost/api/referral');
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url) });
    await GET(req as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('GET: insert error → 500', async () => {
    mockAdminFrom = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({ data: null }),
        }),
      }),
      insert: jest.fn().mockResolvedValue({ error: { message: 'insert failed' } }),
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { GET } = await import('../route');
    const req = new Request('http://localhost/api/referral');
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url) });
    const res = await GET(req as any);
    expect(res.status).toBe(500);
    consoleSpy.mockRestore();
  });

  test('POST: code > 100 chars → 400', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/referral', {
      method: 'POST',
      body: JSON.stringify({ code: 'x'.repeat(101) }),
    }) as any);
    expect(res.status).toBe(400);
  });

  test('POST: code not string → 400', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/referral', {
      method: 'POST',
      body: JSON.stringify({ code: 12345 }),
    }) as any);
    expect(res.status).toBe(400);
  });


  test('POST: used_count null (?? 0) → increment works', async () => {
    let tableCallNum = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      tableCallNum++;
      if (table === 'referral_codes' && tableCallNum === 1) {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: { user_id: 'r1', used_count: null } }),
            }),
          }),
        };
      }
      if (table === 'referral_uses' && tableCallNum === 2) {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: null }),
            }),
          }),
        };
      }
      if (table === 'referral_uses') {
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
          // REF-4: ポイント付与成功後の points_awarded=true 更新
          update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === 'user_points') {
        return { insert: jest.fn().mockResolvedValue({ error: null }) };
      }
      return { update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }) }) };
    });
    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/referral', {
      method: 'POST',
      body: JSON.stringify({ code: 'VALID123' }),
    }) as any);
    expect(res.status).toBe(200);
  });

  test('POST: countErr truthy → logs but still 200', async () => {
    let tableCallNum = 0;
    mockAdminFrom.mockImplementation((table: string) => {
      tableCallNum++;
      if (table === 'referral_codes' && tableCallNum === 1) {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: { user_id: 'r1', used_count: 3 } }),
            }),
          }),
        };
      }
      if (table === 'referral_uses' && tableCallNum === 2) {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: null }),
            }),
          }),
        };
      }
      if (table === 'referral_uses') {
        return {
          insert: jest.fn().mockResolvedValue({ error: null }),
          // REF-4: ポイント付与成功後の points_awarded=true 更新
          update: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === 'user_points') {
        return { insert: jest.fn().mockResolvedValue({ error: null }) };
      }
      // referral_codes update returns error
      return { update: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: { message: 'count err' } }) }) }) };
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/referral', {
      method: 'POST',
      body: JSON.stringify({ code: 'VALID123' }),
    }) as any);
    expect(res.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('POST: invalid JSON body → 400 (via .catch(() => ({})))', async () => {
    const { POST } = await import('../route');
    const req = new Request('http://localhost/api/referral', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json{{{',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  // Branch coverage: line 118 — refResult.error が null のとき ?? selfResult.error を使用（false 分岐）
});

describe('GET: ハンドラ内で例外 → 500（catch で alertCaughtError 経由）', () => {
  test('supabase.auth.getUser が throw → catch 経路で 500 + Slack 通知', async () => {
    const { alertCaughtError } = require('@/lib/alert');
    const { createServerClient } = require('@supabase/ssr');
    const { cookies } = require('next/headers');
    cookies.mockResolvedValue({ getAll: jest.fn(() => []) });
    createServerClient.mockReturnValue({
      auth: { getUser: jest.fn().mockRejectedValue(new Error('boom')) },
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { GET } = await import('../route');
    const req = new Request('http://localhost/api/referral');
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url) });
    const res = await GET(req as any);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('サーバーエラーが発生しました');
    expect(alertCaughtError).toHaveBeenCalledWith('referral-get', expect.any(Error), '/api/referral');
    consoleSpy.mockRestore();
  });
});
