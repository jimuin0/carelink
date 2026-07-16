/**
 * @jest-environment node
 */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server-auth');
jest.mock('@/lib/supabase-server');

import { checkRateLimit } from '@/lib/rate-limit';
import { POST, GET } from '../route';

let mockGetUser: jest.Mock;
let mockInsert: jest.Mock;

function setupDefaultMocks(hasUser: boolean = false, isAdmin: boolean = false) {
  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: hasUser ? { id: 'user-123' } : null },
  });

  mockInsert = jest.fn().mockResolvedValue({
    data: { id: 'event-123' },
    error: null,
  });

  const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
  createServerSupabaseAuthClient.mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: jest.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: isAdmin ? { id: 'user-123', is_platform_admin: true } : null,
              }),
            }),
          }),
        };
      } else if (table === 'ab_test_events') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [
                { variant: 'control', event_type: 'impression' },
                { variant: 'control', event_type: 'conversion' },
                { variant: 'treatment', event_type: 'impression' },
              ],
            }),
          }),
        };
      }
    }),
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn().mockReturnValue({
      insert: mockInsert,
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({
          data: [
            { variant: 'control', event_type: 'impression' },
            { variant: 'control', event_type: 'conversion' },
            { variant: 'treatment', event_type: 'impression' },
            { variant: 'treatment', event_type: 'conversion' },
          ],
        }),
      }),
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  setupDefaultMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

function makePostRequest(body: object, ip = '192.168.1.1') {
  return new Request('http://localhost/api/ab-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(key: string = 'exp-123', ip = '192.168.1.1') {
  const req = new Request(`http://localhost/api/ab-test?key=${key}`, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
  Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
  return req;
}

const validEvent = {
  experiment_key: 'exp-button-color',
  variant: 'control',
  event_type: 'impression',
};

describe('POST /api/ab-test', () => {
  test('rate limiting → silent 200 ok=true', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);
    const res = await POST(makePostRequest(validEvent) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  test('invalid schema → silent 200 ok=true', async () => {
    const res = await POST(makePostRequest({ invalid: 'data' }) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  test('missing experiment_key → 200 (silently ignored)', async () => {
    const res = await POST(makePostRequest({ variant: 'control', event_type: 'impression' }) as any);
    expect(res.status).toBe(200);
  });

  test('invalid variant → 200 (silently ignored)', async () => {
    const res = await POST(makePostRequest({ ...validEvent, variant: 'invalid' }) as any);
    expect(res.status).toBe(200);
  });

  test('invalid event_type → 200 (silently ignored)', async () => {
    const res = await POST(makePostRequest({ ...validEvent, event_type: 'invalid' }) as any);
    expect(res.status).toBe(200);
  });

  test('valid event → 200 ok=true', async () => {
    const res = await POST(makePostRequest(validEvent) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  test('user_id taken from session, not body', async () => {
    setupDefaultMocks(true);
    await POST(makePostRequest(validEvent) as any);
    const call = mockInsert.mock.calls[0];
    expect(call[0].user_id).toBe('user-123');
  });

  test('anonymous event allowed (user_id null)', async () => {
    const res = await POST(makePostRequest(validEvent) as any);
    expect(res.status).toBe(200);
  });

  test('rate limit params (100 req/min per IP)', () => {
    (checkRateLimit as jest.Mock).mockClear();
    POST(makePostRequest(validEvent, '192.168.1.1') as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[2]).toBe(100);
  });

  test('invalid JSON body → 200 (silently ignored via .catch)', async () => {
    const req = new Request('http://localhost/api/ab-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: 'not-valid-json{{{',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  // 【2026年7月16日 恒久根治】metadata 無制限だった欠陥の回帰テスト（intake/route.ts の
  // responses 50000字上限と同水準の防御・キー数上限とJSON文字列化サイズ上限）。
  test('metadata: キー数上限(20)超過 → silent 200 ok=true・挿入されない', async () => {
    const oversizedKeys: Record<string, string> = {};
    for (let i = 0; i < 21; i++) oversizedKeys[`k${i}`] = 'v';
    const res = await POST(makePostRequest({ ...validEvent, metadata: oversizedKeys }) as any);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('metadata: JSON文字列化サイズ上限(50000字)超過 → silent 200 ok=true・挿入されない', async () => {
    const oversizedValue = 'x'.repeat(60_000);
    const res = await POST(makePostRequest({ ...validEvent, metadata: { big: oversizedValue } }) as any);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('metadata: 上限内なら従来通り挿入される（回帰・成功経路は変えない）', async () => {
    const metadata = { source: 'homepage', variant_group: 'A' };
    const res = await POST(makePostRequest({ ...validEvent, metadata }) as any);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const call = mockInsert.mock.calls[0];
    expect(call[0].metadata).toEqual(metadata);
  });

  test('metadata 省略時は従来通り {} で挿入される（回帰）', async () => {
    const res = await POST(makePostRequest(validEvent) as any);
    expect(res.status).toBe(200);
    const call = mockInsert.mock.calls[0];
    expect(call[0].metadata).toEqual({});
  });

  // 【2026年7月16日 恒久根治】try/catch欠落だった欠陥の回帰テスト（withRoute標準形と同様に
  // catch経路を500化しSlack通知する。/api/profile 級の観測不能500の再発防止）。
  test('POST: 想定外の例外（insert失敗）→ 500 + サーバーエラーJSON', async () => {
    mockInsert.mockImplementationOnce(() => {
      throw new Error('db insert failed');
    });
    const res = await POST(makePostRequest(validEvent) as any);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });
});

describe('GET /api/ab-test', () => {
  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);
    const res = await GET(makeGetRequest() as any);
    expect(res.status).toBe(429);
  });

  test('unauthenticated → 401', async () => {
    setupDefaultMocks(false);
    const res = await GET(makeGetRequest() as any);
    expect(res.status).toBe(401);
  });

  test('authenticated but not admin → 403', async () => {
    setupDefaultMocks(true, false);
    const res = await GET(makeGetRequest() as any);
    expect(res.status).toBe(403);
  });

  test('missing key parameter → 400', async () => {
    setupDefaultMocks(true, true);
    const req = new Request('http://localhost/api/ab-test', {
      method: 'GET',
      headers: { 'x-forwarded-for': '192.168.1.1' },
    });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    expect(res.status).toBe(400);
  });

  test('admin can retrieve results → 200', async () => {
    setupDefaultMocks(true, true);
    const res = await GET(makeGetRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.experiment_key).toBe('exp-123');
  });

  test('results include control and treatment', async () => {
    setupDefaultMocks(true, true);
    const res = await GET(makeGetRequest() as any);
    const json = await res.json();
    expect(json.control).toBeDefined();
    expect(json.treatment).toBeDefined();
  });

  test('conversion rate calculated', async () => {
    setupDefaultMocks(true, true);
    const res = await GET(makeGetRequest() as any);
    const json = await res.json();
    expect(json.control.conversion_rate).toBeDefined();
    expect(json.treatment.conversion_rate).toBeDefined();
  });

  test('lift calculated (treatment - control)', async () => {
    setupDefaultMocks(true, true);
    const res = await GET(makeGetRequest() as any);
    const json = await res.json();
    expect(json.lift).toBeDefined();
  });

  test('rate limit params (20 req/min per IP)', () => {
    (checkRateLimit as jest.Mock).mockClear();
    setupDefaultMocks(true, true);
    GET(makeGetRequest('exp-123', '192.168.1.1') as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[2]).toBe(20);
  });

  test('CSRF check failed → returns CSRF error response', async () => {
    const { checkCsrf } = require('@/lib/csrf');
    const csrfResp = new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 });
    checkCsrf.mockReturnValueOnce(csrfResp);
    const res = await POST(makePostRequest(validEvent) as any);
    expect(res.status).toBe(403);
  });

  test('POST: missing x-forwarded-for → uses "unknown" IP', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/ab-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validEvent),
    });
    await POST(req as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('GET: missing x-forwarded-for → uses "unknown" IP', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    setupDefaultMocks(true, true);
    const req = new Request('http://localhost/api/ab-test?key=exp-123', { method: 'GET' });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    await GET(req as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('GET: key longer than 100 chars → 400', async () => {
    setupDefaultMocks(true, true);
    const longKey = 'x'.repeat(101);
    const req = new Request(`http://localhost/api/ab-test?key=${longKey}`, {
      method: 'GET',
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    expect(res.status).toBe(400);
  });

  test('GET: data null from ab_test_events → results: null', async () => {
    setupDefaultMocks(true, true);
    // Override service-role client to return data: null
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ data: null }),
        }),
      }),
    });
    const res = await GET(makeGetRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results).toBeNull();
  });

  test('GET: zero impressions → conversion_rate=0', async () => {
    setupDefaultMocks(true, true);
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: [
              { variant: 'control', event_type: 'conversion' },
              { variant: 'treatment', event_type: 'click' },
            ],
          }),
        }),
      }),
    });
    const res = await GET(makeGetRequest() as any);
    const json = await res.json();
    expect(json.control.conversion_rate).toBe(0);
    expect(json.treatment.conversion_rate).toBe(0);
    expect(json.lift).toBe(0);
  });

  test('GET: unknown variant in event ignored (defensive)', async () => {
    setupDefaultMocks(true, true);
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({
            data: [
              { variant: 'control', event_type: 'impression' },
              { variant: 'unknown_variant', event_type: 'impression' },
            ],
          }),
        }),
      }),
    });
    const res = await GET(makeGetRequest() as any);
    expect(res.status).toBe(200);
  });

  // 【2026年7月16日 恒久根治】try/catch欠落だった欠陥の回帰テスト（withRoute標準形と同様に
  // catch経路を500化しSlack通知する）。
  test('GET: 想定外の例外（DB取得失敗）→ 500 + サーバーエラーJSON', async () => {
    setupDefaultMocks(true, true);
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockImplementation(() => {
            throw new Error('db down');
          }),
        }),
      }),
    });
    const res = await GET(makeGetRequest() as any);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });
});
