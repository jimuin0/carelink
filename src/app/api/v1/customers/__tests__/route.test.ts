/**
 * @jest-environment node
 */

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));

import { checkRateLimit } from '@/lib/rate-limit';
import { alertCaughtError } from '@/lib/alert';
import { GET } from '../route';

function setupDefaultMocks(keyValid: boolean = true, hasScope: boolean = true) {
  const { createServiceRoleClient } = require('@/lib/supabase-server');
  
  createServiceRoleClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'api_keys') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: keyValid ? {
                  facility_id: 'fac-123',
                  scopes: hasScope ? ['customers:read'] : ['other:scope'],
                  is_active: true,
                  expires_at: null,
                } : null,
              }),
            }),
          }),
        };
      } else if (table === 'bookings') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              not: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  range: jest.fn().mockResolvedValue({
                    data: [
                      { customer_name: 'John Doe', customer_phone: '09012345678', customer_email: 'john@example.com', user_id: 'user-1' },
                      { customer_name: 'Jane Smith', customer_phone: '09087654321', customer_email: 'jane@example.com', user_id: 'user-2' },
                    ],
                    error: null,
                    count: 2,
                  }),
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

function makeRequest(apiKey: string = 'test-api-key', query: string = '', ip = '192.168.1.1') {
  const req = new Request(`http://localhost/api/v1/customers${query}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'x-forwarded-for': ip,
    },
  });
  Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
  return req;
}

describe('GET /api/v1/customers', () => {
  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(429);
  });

  test('missing Authorization header → 401', async () => {
    const req = new Request('http://localhost/api/v1/customers', {
      method: 'GET',
      headers: { 'x-forwarded-for': '192.168.1.1' },
    });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  test('invalid Authorization format (no Bearer) → 401', async () => {
    const req = new Request('http://localhost/api/v1/customers', {
      method: 'GET',
      headers: {
        'Authorization': 'Basic xyz',
        'x-forwarded-for': '192.168.1.1',
      },
    });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  test('invalid API key → 401', async () => {
    setupDefaultMocks(false);
    const res = await GET(makeRequest('invalid-key') as any);
    expect(res.status).toBe(401);
  });

  test('insufficient scope → 403', async () => {
    setupDefaultMocks(true, false);
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(403);
  });

  test('valid key with scope → 200', async () => {
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toBeDefined();
    expect(Array.isArray(json.data)).toBe(true);
  });

  test('includes pagination info', async () => {
    const res = await GET(makeRequest('test-api-key', '?page=1&limit=50') as any);
    const json = await res.json();
    expect(json.pagination).toBeDefined();
    expect(json.pagination.page).toBe(1);
    expect(json.pagination.limit).toBe(50);
  });

  test('includes API version header', async () => {
    const res = await GET(makeRequest() as any);
    expect(res.headers.get('X-API-Version')).toBe('1.0.0');
  });

  test('limit capped at 100', async () => {
    const res = await GET(makeRequest('test-api-key', '?limit=200') as any);
    const json = await res.json();
    expect(json.pagination.limit).toBeLessThanOrEqual(100);
  });

  test('rate limit params (60 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(false);
    (checkRateLimit as jest.Mock).mockClear();
    await GET(makeRequest('test-key', '', '192.168.1.1') as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[2]).toBe(60);
    expect(call[3]).toBe(60_000);
  });

  test('extracts last (trusted) IP from x-forwarded-for', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(false);
    (checkRateLimit as jest.Mock).mockClear();
    await GET(makeRequest('test-key', '', '10.0.0.1, 192.168.1.1') as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('expired API key → 401', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'api_keys') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    facility_id: 'fac-123',
                    scopes: ['customers:read'],
                    is_active: true,
                    expires_at: '2020-01-01T00:00:00Z',
                  },
                }),
              }),
            }),
          };
        }
      }),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(401);
  });

  test('wildcard scope (*) → 200', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'api_keys') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { facility_id: 'fac-123', scopes: ['*'], is_active: true, expires_at: null },
                }),
              }),
            }),
          };
        } else if (table === 'bookings') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                not: jest.fn().mockReturnValue({
                  order: jest.fn().mockReturnValue({
                    range: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
                  }),
                }),
              }),
            }),
          };
        }
      }),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
  });

  test('DB error → 500', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'api_keys') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { facility_id: 'fac-123', scopes: ['customers:read'], is_active: true, expires_at: null },
                }),
              }),
            }),
          };
        } else if (table === 'bookings') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                not: jest.fn().mockReturnValue({
                  order: jest.fn().mockReturnValue({
                    range: jest.fn().mockResolvedValue({ data: null, error: { message: 'DB error' }, count: null }),
                  }),
                }),
              }),
            }),
          };
        }
      }),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });

  test('api_version フィールドがレスポンスに含まれる', async () => {
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    expect(json.api_version).toBe('1.0.0');
  });

  test('Cache-Control: no-store ヘッダーが付く', async () => {
    const res = await GET(makeRequest() as any);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  test('page=0 は 1 にクランプされる', async () => {
    const res = await GET(makeRequest('test-api-key', '?page=0') as any);
    const json = await res.json();
    expect(json.pagination.page).toBeGreaterThanOrEqual(1);
  });

  test('inactive API key → 401', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { facility_id: 'fac-123', scopes: ['customers:read'], is_active: false, expires_at: null },
            }),
          }),
        }),
      })),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(401);
  });

  test('null scopes → 403', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { facility_id: 'fac-123', scopes: null, is_active: true, expires_at: null },
            }),
          }),
        }),
      })),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(403);
  });

  test('missing x-forwarded-for → unknown IP', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/v1/customers', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer test-api-key' },
    });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    await GET(req as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('limit=abc → デフォルト50', async () => {
    const res = await GET(makeRequest('test-api-key', '?limit=abc') as any);
    const json = await res.json();
    expect(json.pagination.limit).toBe(50);
  });

  test('page=abc → デフォルト1', async () => {
    const res = await GET(makeRequest('test-api-key', '?page=abc') as any);
    const json = await res.json();
    expect(json.pagination.page).toBe(1);
  });

  test('search パラメータでフィルタ追加', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    const orMock = jest.fn().mockReturnValue({
      range: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
    });
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'api_keys') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { facility_id: 'fac-123', scopes: ['customers:read'], is_active: true, expires_at: null },
                }),
              }),
            }),
          };
        }
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              not: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  or: orMock,
                  range: jest.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
                }),
              }),
            }),
          }),
        };
      }),
    });
    const res = await GET(makeRequest('test-api-key', '?search=tanaka') as any);
    expect(res.status).toBe(200);
    expect(orMock).toHaveBeenCalled();
  });

  test('user_id null + customer_phone あり → phone で dedup', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'api_keys') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { facility_id: 'fac-123', scopes: ['customers:read'], is_active: true, expires_at: null },
                }),
              }),
            }),
          };
        }
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              not: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  range: jest.fn().mockResolvedValue({
                    data: [
                      { customer_name: 'X', customer_phone: '0901', customer_email: null, user_id: null },
                      { customer_name: 'X', customer_phone: '0901', customer_email: null, user_id: null },
                      // 全部 null → スキップ
                      { customer_name: null, customer_phone: null, customer_email: null, user_id: null },
                    ],
                    error: null,
                    count: 3,
                  }),
                }),
              }),
            }),
          }),
        };
      }),
    });
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    expect(json.data.length).toBe(1);
  });

  test('data が null → 空配列を返す', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'api_keys') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { facility_id: 'fac-123', scopes: ['customers:read'], is_active: true, expires_at: null },
                }),
              }),
            }),
          };
        }
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              not: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  range: jest.fn().mockResolvedValue({ data: null, error: null, count: null }),
                }),
              }),
            }),
          }),
        };
      }),
    });
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    expect(json.data).toEqual([]);
    expect(json.pagination.total).toBe(0);
  });

  test('想定外 throw → JSON 500（契約維持）+ alertCaughtError で Slack 通報', async () => {
    (checkRateLimit as jest.Mock).mockImplementation(() => {
      throw new Error('unexpected boom');
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Internal Server Error');
    expect(alertCaughtError).toHaveBeenCalledTimes(1);
    expect(alertCaughtError).toHaveBeenCalledWith(
      'v1-customers',
      expect.any(Error),
      '/api/v1/customers'
    );
  });

  test('重複 user_id は dedup される', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'api_keys') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { facility_id: 'fac-123', scopes: ['customers:read'], is_active: true, expires_at: null },
                }),
              }),
            }),
          };
        } else if (table === 'bookings') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                not: jest.fn().mockReturnValue({
                  order: jest.fn().mockReturnValue({
                    range: jest.fn().mockResolvedValue({
                      data: [
                        { customer_name: 'A', customer_phone: '090', customer_email: 'a@b.com', user_id: 'same-user' },
                        { customer_name: 'A', customer_phone: '090', customer_email: 'a@b.com', user_id: 'same-user' },
                      ],
                      error: null,
                      count: 2,
                    }),
                  }),
                }),
              }),
            }),
          };
        }
      }),
    });
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    expect(json.data.length).toBe(1);
  });
});
