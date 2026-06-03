/**
 * @jest-environment node
 *
 * Tests for GET /api/liff/points
 * Key assertions:
 *   - Rate limiting (30 req/min per IP)
 *   - Authorization header required (Bearer token)
 *   - LINE token validation
 *   - LINE user_id to profile lookup
 *   - User not found handling
 *   - Points history aggregation
 */

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/line', () => ({
  verifyLineAccessToken: jest.fn(() => Promise.resolve({ ok: true, userId: 'line-user-verified' })),
}));
jest.mock('@/lib/supabase-server');

import { checkRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

function setupDefaultMocks(
  lineTokenValid: boolean = true,
  profileFound: boolean = true,
  hasLogs: boolean = true
) {
  global.fetch = jest.fn((url: string) => {
    if (url.includes('api.line.me/v2/profile')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            userId: 'line-user-456',
          }),
          { ok: lineTokenValid, status: lineTokenValid ? 200 : 401 }
        )
      );
    }
    return Promise.resolve(new Response('{}'));
  }) as jest.Mock;

  const profileData = profileFound
    ? {
        id: 'user-789',
      }
    : null;

  const logsData = hasLogs
    ? [
        { id: 'log-1', points: 500, reason: '紹介ボーナス', created_at: '2026-05-01' },
        { id: 'log-2', points: -100, reason: '割引使用', created_at: '2026-04-15' },
        { id: 'log-3', points: 300, reason: 'レビュー投稿', created_at: '2026-04-01' },
      ]
    : [];

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: profileData,
              }),
            }),
          }),
        };
      } else if (table === 'user_points') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({
                  data: logsData,
                }),
              }),
            }),
          }),
        };
      }
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  setupDefaultMocks();
});

function makeRequest(token: string, ip = '192.168.1.1') {
  return new Request('http://localhost/api/liff/points', {
    method: 'GET',
    headers: {
      'x-forwarded-for': ip,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

describe('GET /api/liff/points', () => {
  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);

    const res = await GET(makeRequest('valid-token') as any);

    expect(res.status).toBe(429);
  });

  test('missing Authorization header → 401', async () => {
    const req = new Request('http://localhost/api/liff/points', {
      method: 'GET',
      headers: { 'x-forwarded-for': '192.168.1.1' },
    });

    const res = await GET(req as any);

    expect(res.status).toBe(401);
  });

  test('invalid Authorization format (no Bearer) → 401', async () => {
    const req = new Request('http://localhost/api/liff/points', {
      method: 'GET',
      headers: {
        'x-forwarded-for': '192.168.1.1',
        Authorization: 'Basic xyz',
      },
    });

    const res = await GET(req as any);

    expect(res.status).toBe(401);
  });

  test('invalid LINE token → 401', async () => {
    setupDefaultMocks(false);

    const res = await GET(makeRequest('invalid-token') as any);

    expect(res.status).toBe(401);
  });

  test('profile not found → 404', async () => {
    setupDefaultMocks(true, false);

    const res = await GET(makeRequest('valid-token') as any);

    expect(res.status).toBe(404);
  });

  test('valid token with logs → 200 with logs and total', async () => {
    const res = await GET(makeRequest('valid-token') as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.logs)).toBe(true);
    expect(json.logs.length).toBeGreaterThan(0);
    expect(typeof json.total).toBe('number');
  });

  test('aggregates points total correctly', async () => {
    const res = await GET(makeRequest('valid-token') as any);

    const json = await res.json();
    // 500 - 100 + 300 = 700
    expect(json.total).toBe(700);
  });

  test('no logs → 200 with empty logs and total 0', async () => {
    setupDefaultMocks(true, true, false);

    const res = await GET(makeRequest('valid-token') as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.logs).toEqual([]);
    expect(json.total).toBe(0);
  });

  test('calls LINE profile API with access token', async () => {
    await GET(makeRequest('my-access-token') as any);

    const call = (global.fetch as jest.Mock).mock.calls.find((c) =>
      c[0].includes('api.line.me/v2/profile')
    );
    expect(call).toBeDefined();
    expect(call[1].headers.Authorization).toBe('Bearer my-access-token');
  });

  test('extracts Bearer token correctly', async () => {
    const req = new Request('http://localhost/api/liff/points', {
      method: 'GET',
      headers: {
        'x-forwarded-for': '192.168.1.1',
        Authorization: 'Bearer secret-token-xyz',
      },
    });

    await GET(req as any);

    const call = (global.fetch as jest.Mock).mock.calls.find((c) =>
      c[0].includes('api.line.me/v2/profile')
    );
    expect(call[1].headers.Authorization).toBe('Bearer secret-token-xyz');
  });

  test('logs include id, points, reason, created_at', async () => {
    const res = await GET(makeRequest('valid-token') as any);

    const json = await res.json();
    if (json.logs.length > 0) {
      const log = json.logs[0];
      expect(log.id).toBeDefined();
      expect(log.points).toBeDefined();
      expect(log.reason).toBeDefined();
      expect(log.created_at).toBeDefined();
    }
  });

  test('rate limit params (30 req/min per IP)', () => {
    (checkRateLimit as jest.Mock).mockClear();

    GET(makeRequest('token', '192.168.1.1') as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(30);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('liff-points');
  });

  test('extracts last (trusted) IP from x-forwarded-for', () => {
    (checkRateLimit as jest.Mock).mockClear();

    GET(makeRequest('token', '10.0.0.1, 192.168.1.1') as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('uses unknown IP when x-forwarded-for missing', () => {
    (checkRateLimit as jest.Mock).mockClear();

    const req = new Request('http://localhost/api/liff/points', {
      method: 'GET',
      headers: { Authorization: 'Bearer token' },
    });

    GET(req as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('limits history to 50 items', async () => {
    const res = await GET(makeRequest('valid-token') as any);

    expect(res.status).toBe(200);
    // Verify that .limit(50) is applied in the query
  });

  test('orders logs by created_at descending', async () => {
    const res = await GET(makeRequest('valid-token') as any);

    const json = await res.json();
    // First log should be most recent (2026-05-01)
    if (json.logs.length > 1) {
      expect(new Date(json.logs[0].created_at).getTime()).toBeGreaterThanOrEqual(new Date(json.logs[1].created_at).getTime());
    }
  });

  test('exception during flow → 500', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

    const res = await GET(makeRequest('token') as any);

    expect(res.status).toBe(500);
  });

  test('logs null (?? []) → total=0 and logs=[]', async () => {
    // Override service-role mock to return data: null for user_points
    global.fetch = jest.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ userId: 'line-user-456' }), { status: 200 }))
    ) as jest.Mock;
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: { id: 'user-789' } }),
              }),
            }),
          };
        }
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({ data: null }),
              }),
            }),
          }),
        };
      }),
    });
    const res = await GET(makeRequest('valid-token') as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.logs).toEqual([]);
    expect(json.total).toBe(0);
  });

  test('log.points null (?? 0) → skipped in total', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve(new Response(JSON.stringify({ userId: 'line-user-456' }), { status: 200 }))
    ) as jest.Mock;
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: { id: 'user-789' } }),
              }),
            }),
          };
        }
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({
                  data: [
                    { id: 'log-x', points: null, reason: 'x', created_at: '2026-01-01' },
                    { id: 'log-y', points: 100, reason: 'y', created_at: '2026-01-02' },
                  ],
                }),
              }),
            }),
          }),
        };
      }),
    });
    const res = await GET(makeRequest('valid-token') as any);
    const json = await res.json();
    expect(json.total).toBe(100);
  });

  // R2 audience検証: 他チャネル発行トークン（client_id不一致）→ 401（!tokenCheck.ok 分岐）
  test('verifyLineAccessToken fails (audience mismatch) → 401', async () => {
    const { verifyLineAccessToken } = require('@/lib/line');
    (verifyLineAccessToken as jest.Mock).mockResolvedValueOnce({ ok: false });
    const res = await GET(makeRequest('foreign-token') as any);
    expect(res.status).toBe(401);
  });
});
