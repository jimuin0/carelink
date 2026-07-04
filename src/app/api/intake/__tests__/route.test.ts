/**
 * @jest-environment node
 *
 * Tests for GET /api/intake & POST /api/intake
 * Key assertions:
 *   - GET: Rate limit (30 req/min), facility_id required, template retrieval
 *   - POST: CSRF + rate limit (5 req/min), required fields, UUID validation, IDOR prevention
 *   - responses JSON size limit (50KB)
 */

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => false),
}));
jest.mock('@supabase/ssr');
jest.mock('next/headers');
// POST の DB 書き込み・参照は service_role に集約されたため、その経路を
// 既存の createServerClient モックに委譲する（auth 判定は anon クライアント）。
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(),
}));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';

let mockSelectTemplate: jest.Mock;
let mockInsert: jest.Mock;

function setupDefaultMocks(templateExists: boolean = true) {
  (checkCsrf as jest.Mock).mockReturnValue(null);

  mockSelectTemplate = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        maybeSingle: jest.fn().mockResolvedValue({
          data: templateExists ? {
            id: 'template-123',
            title: 'Medical History',
            description: 'Please fill out your medical history',
            fields: [{ name: 'condition', type: 'text' }],
          } : null,
        }),
      }),
    }),
  });

  mockInsert = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      single: jest.fn().mockResolvedValue({ data: { id: 'response-123' }, error: null }),
    }),
  });

  const { createServerClient } = require('@supabase/ssr');
  createServerClient.mockReturnValue({
    from: jest.fn().mockReturnValue({
      select: mockSelectTemplate,
      insert: mockInsert,
    }),
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-123' } } }) },
  });

  const { cookies } = require('next/headers');
  cookies.mockResolvedValue({
    getAll: jest.fn(() => []),
  });

  // service_role クライアントは現行の createServerClient モックへ委譲する
  // （cookies は無関係なのでダミーを渡す）。これにより POST の booking 確認・
  // insert チェーンは各テストが createServerClient に組んだ from チェーンを共有する。
  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockImplementation(() =>
    require('@supabase/ssr').createServerClient('url', 'key', { cookies: { getAll: () => [] } })
  );

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  setupDefaultMocks();
});

describe('GET /api/intake', () => {
  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);

    const { GET } = await import('../route');
    const req = new Request('http://localhost/api/intake?facility_id=11111111-1111-1111-1111-111111111111');
    Object.defineProperty(req, 'nextUrl', {
      value: new URL(req.url),
    });
    const res = await GET(req as any);

    expect(res.status).toBe(429);
  });

  test('missing facility_id → 400', async () => {
    const { GET } = await import('../route');
    const req = new Request('http://localhost/api/intake');
    Object.defineProperty(req, 'nextUrl', {
      value: new URL(req.url),
    });
    const res = await GET(req as any);

    expect(res.status).toBe(400);
  });

  test('invalid facility_id UUID → 400', async () => {
    const { GET } = await import('../route');
    const req = new Request('http://localhost/api/intake?facility_id=not-uuid');
    Object.defineProperty(req, 'nextUrl', {
      value: new URL(req.url),
    });
    const res = await GET(req as any);

    expect(res.status).toBe(400);
  });

  test('template found → 200 with template', async () => {
    const { GET } = await import('../route');
    const req = new Request('http://localhost/api/intake?facility_id=11111111-1111-1111-1111-111111111111');
    Object.defineProperty(req, 'nextUrl', {
      value: new URL(req.url),
    });
    const res = await GET(req as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.template).toBeDefined();
  });

  test('template not found → 200 with null', async () => {
    setupDefaultMocks(false);

    const { GET } = await import('../route');
    const req = new Request('http://localhost/api/intake?facility_id=11111111-1111-1111-1111-111111111111');
    Object.defineProperty(req, 'nextUrl', {
      value: new URL(req.url),
    });
    const res = await GET(req as any);

    const json = await res.json();
    expect(json.template).toBeNull();
  });
});

describe('POST /api/intake', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/intake', {
      method: 'POST',
      body: JSON.stringify({
        template_id: '11111111-1111-1111-1111-111111111111',
        customer_name: 'Test',
        facility_id: '11111111-1111-1111-1111-111111111111',
      }),
    }) as any);

    expect(res.status).toBe(403);
  });

  test('missing template_id → 400', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/intake', {
      method: 'POST',
      body: JSON.stringify({
        customer_name: 'Test',
        facility_id: '11111111-1111-1111-1111-111111111111',
      }),
    }) as any);

    expect(res.status).toBe(400);
  });

  test('missing customer_name → 400', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/intake', {
      method: 'POST',
      body: JSON.stringify({
        template_id: '11111111-1111-1111-1111-111111111111',
        facility_id: '11111111-1111-1111-1111-111111111111',
      }),
    }) as any);

    expect(res.status).toBe(400);
  });

  test('missing facility_id → 400', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/intake', {
      method: 'POST',
      body: JSON.stringify({
        template_id: '11111111-1111-1111-1111-111111111111',
        customer_name: 'Test',
      }),
    }) as any);

    expect(res.status).toBe(400);
  });

  test('customer_name が50文字超 → 400（監査F9・サイレント切り詰め廃止）', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/intake', {
      method: 'POST',
      body: JSON.stringify({
        template_id: '11111111-1111-1111-1111-111111111111',
        facility_id: '11111111-1111-1111-1111-111111111111',
        customer_name: 'あ'.repeat(51),
      }),
    }) as any);

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('お名前は50文字以内で入力してください');
  });

  test('invalid template_id UUID → 400', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/intake', {
      method: 'POST',
      body: JSON.stringify({
        template_id: 'not-uuid',
        customer_name: 'Test',
        facility_id: '11111111-1111-1111-1111-111111111111',
      }),
    }) as any);

    expect(res.status).toBe(400);
  });

  test('invalid facility_id UUID → 400', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/intake', {
      method: 'POST',
      body: JSON.stringify({
        template_id: '11111111-1111-1111-1111-111111111111',
        customer_name: 'Test',
        facility_id: 'not-uuid',
      }),
    }) as any);

    expect(res.status).toBe(400);
  });

  test('invalid booking_id UUID → 400', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/intake', {
      method: 'POST',
      body: JSON.stringify({
        template_id: '11111111-1111-1111-1111-111111111111',
        customer_name: 'Test',
        facility_id: '11111111-1111-1111-1111-111111111111',
        booking_id: 'not-uuid',
      }),
    }) as any);

    expect(res.status).toBe(400);
  });

  test('responses > 50KB → 400', async () => {
    const { POST } = await import('../route');
    const largeResponses = { field: 'x'.repeat(51000) };
    const res = await POST(new Request('http://localhost/api/intake', {
      method: 'POST',
      body: JSON.stringify({
        template_id: '11111111-1111-1111-1111-111111111111',
        customer_name: 'Test',
        facility_id: '11111111-1111-1111-1111-111111111111',
        responses: largeResponses,
      }),
    }) as any);

    expect(res.status).toBe(400);
  });

  test('valid request → 200', async () => {
    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/intake', {
      method: 'POST',
      body: JSON.stringify({
        template_id: '11111111-1111-1111-1111-111111111111',
        customer_name: 'Test User',
        facility_id: '11111111-1111-1111-1111-111111111111',
        responses: { condition: 'healthy' },
      }),
    }) as any);

    expect([200, 201]).toContain(res.status);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/intake', {
      method: 'POST',
      body: JSON.stringify({
        template_id: '11111111-1111-1111-1111-111111111111',
        customer_name: 'Test',
        facility_id: '11111111-1111-1111-1111-111111111111',
      }),
    }) as any);

    expect(res.status).toBe(429);
  });

  test('booking_id あり + 未認証 → 401', async () => {
    const { createServerClient } = require('@supabase/ssr');
    createServerClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
      from: jest.fn().mockReturnValue({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockResolvedValue({ data: null }) }),
    });

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/intake', {
      method: 'POST',
      body: JSON.stringify({
        template_id: '11111111-1111-1111-1111-111111111111',
        customer_name: 'Test',
        facility_id: '11111111-1111-1111-1111-111111111111',
        booking_id: '22222222-2222-2222-2222-222222222222',
      }),
    }) as any);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('認証');
  });

  test('booking_id あり + 予約が見つからない → 403 (IDOR防止)', async () => {
    const { createServerClient } = require('@supabase/ssr');
    const maybeSingleFn = jest.fn().mockResolvedValue({ data: null });
    const eqFn = jest.fn().mockReturnThis();
    const chain: any = { select: jest.fn().mockReturnThis(), eq: eqFn, maybeSingle: maybeSingleFn };
    createServerClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-123' } } }) },
      from: jest.fn(() => chain),
    });

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/intake', {
      method: 'POST',
      body: JSON.stringify({
        template_id: '11111111-1111-1111-1111-111111111111',
        customer_name: 'Test',
        facility_id: '11111111-1111-1111-1111-111111111111',
        booking_id: '22222222-2222-2222-2222-222222222222',
      }),
    }) as any);

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain('予約が見つかりません');
  });

  test('booking_id あり + 予約あり → 200', async () => {
    const { createServerClient } = require('@supabase/ssr');
    const singleFn = jest.fn().mockResolvedValue({ data: { id: 'resp-1' }, error: null });
    const selectInsert = jest.fn().mockReturnValue({ single: singleFn });
    const insertFn = jest.fn().mockReturnValue({ select: selectInsert });
    const maybeSingleFn = jest.fn().mockResolvedValue({ data: { id: 'booking-1' } });
    const eqFn = jest.fn().mockReturnThis();
    const chain: any = { select: jest.fn().mockReturnThis(), eq: eqFn, maybeSingle: maybeSingleFn, insert: insertFn };
    createServerClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-123' } } }) },
      from: jest.fn(() => chain),
    });

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/intake', {
      method: 'POST',
      body: JSON.stringify({
        template_id: '11111111-1111-1111-1111-111111111111',
        customer_name: 'Test',
        facility_id: '11111111-1111-1111-1111-111111111111',
        booking_id: '22222222-2222-2222-2222-222222222222',
      }),
    }) as any);

    expect(res.status).toBe(200);
  });

  test('insert error → 500', async () => {
    const { createServerClient } = require('@supabase/ssr');
    const singleFn = jest.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } });
    const selectFn = jest.fn().mockReturnValue({ single: singleFn });
    const insertFn = jest.fn().mockReturnValue({ select: selectFn });
    createServerClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-123' } } }) },
      from: jest.fn(() => ({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'tpl-1' } }), insert: insertFn })),
    });

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/intake', {
      method: 'POST',
      body: JSON.stringify({
        template_id: '11111111-1111-1111-1111-111111111111',
        customer_name: 'Test',
        facility_id: '11111111-1111-1111-1111-111111111111',
      }),
    }) as any);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('送信に失敗');
  });

  test('POST: invalid JSON body → 400 (via .catch(() => null))', async () => {
    const { POST } = await import('../route');
    const req = new Request('http://localhost/api/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid-json{{{',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  test('template が指定施設に属さない → 403（越境テンプレ参照防止）', async () => {
    const { createServerClient } = require('@supabase/ssr');
    // booking_id なし。template 所属チェックの maybeSingle が null（=他施設テンプレ）を返す。
    createServerClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null }),
        insert: jest.fn(),
      })),
    });

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/intake', {
      method: 'POST',
      body: JSON.stringify({
        template_id: '11111111-1111-1111-1111-111111111111',
        customer_name: 'Test',
        facility_id: '99999999-9999-9999-9999-999999999999',
      }),
    }) as any);

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toContain('テンプレートが見つかりません');
  });

  test('ハンドラ内で例外 → 500（catch で alertCaughtError 経由）', async () => {
    const { createServerClient } = require('@supabase/ssr');
    const { alertCaughtError } = require('@/lib/alert');
    createServerClient.mockReturnValue({
      // getUser が throw → catch 経路に入る
      auth: { getUser: jest.fn().mockRejectedValue(new Error('boom')) },
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'tpl-1' } }),
        insert: jest.fn(),
      })),
    });

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/intake', {
      method: 'POST',
      body: JSON.stringify({
        template_id: '11111111-1111-1111-1111-111111111111',
        customer_name: 'Test',
        facility_id: '11111111-1111-1111-1111-111111111111',
      }),
    }) as any);

    expect(res.status).toBe(500);
    expect(alertCaughtError).toHaveBeenCalledWith('intake-post', expect.any(Error), '/api/intake');
  });
});

describe('GET /api/intake – cookie callback invocable', () => {
  test('GET: cookie getAll callback invoked during client creation', async () => {
    const { createServerClient } = require('@supabase/ssr');
    const { cookies } = require('next/headers');
    const mockCookieStore = { getAll: jest.fn(() => [] as any[]) };
    cookies.mockResolvedValue(mockCookieStore);

    createServerClient.mockImplementation((_url: string, _key: string, opts: any) => {
      opts.cookies.getAll();
      return {
        from: jest.fn(() => ({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: null }),
        })),
        auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
      };
    });

    const { GET } = await import('../route');
    const req = new Request('http://localhost/api/intake?facility_id=11111111-1111-1111-1111-111111111111');
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url) });
    const res = await GET(req as any);
    expect([200, 400]).toContain(res.status);
    expect(mockCookieStore.getAll).toHaveBeenCalled();
  });

  test('POST: cookie getAll callback invoked during client creation', async () => {
    const { createServerClient } = require('@supabase/ssr');
    const { cookies } = require('next/headers');
    const mockCookieStore = { getAll: jest.fn(() => [] as any[]) };
    cookies.mockResolvedValue(mockCookieStore);

    // chain: .insert(...).select(...).single() → returns data
    const singleFn = jest.fn().mockResolvedValue({ data: { id: 'resp-1' }, error: null });
    const selectInsert = jest.fn().mockReturnValue({ single: singleFn });
    const insertFn = jest.fn().mockReturnValue({ select: selectInsert });
    const fromChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { id: 'tpl-1' } }),
      insert: insertFn,
    };

    createServerClient.mockImplementation((_url: string, _key: string, opts: any) => {
      opts.cookies.getAll();
      return {
        auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
        from: jest.fn(() => fromChain),
      };
    });

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/intake', {
      method: 'POST',
      body: JSON.stringify({
        template_id: '11111111-1111-1111-1111-111111111111',
        customer_name: 'Test',
        facility_id: '11111111-1111-1111-1111-111111111111',
      }),
    }) as any);
    expect([200, 201, 400, 500]).toContain(res.status);
    expect(mockCookieStore.getAll).toHaveBeenCalled();
  });
});
