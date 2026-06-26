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
      }
      return { select: jest.fn() };
    }),
    // get_facility_customers_v1 RPC: ユニーク顧客＋total_count(ウィンドウ集計)を返す
    rpc: jest.fn().mockResolvedValue({
      data: [
        { name: 'John Doe', phone: '09012345678', email: 'john@example.com', total_count: 2 },
        { name: 'Jane Smith', phone: '09087654321', email: 'jane@example.com', total_count: 2 },
      ],
      error: null,
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

  test('total はユニーク顧客総数(RPCのtotal_count)を返す(ページ行数ではない)', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { facility_id: 'fac-123', scopes: ['customers:read'], is_active: true, expires_at: null },
            }),
          }),
        }),
      })),
      // 1ページに2行だが、ユニーク顧客総数は 50（COUNT(*) OVER() 同梱）
      rpc: jest.fn().mockResolvedValue({
        data: [
          { name: 'A', phone: '1', email: 'a@x.com', total_count: 50 },
          { name: 'B', phone: '2', email: 'b@x.com', total_count: 50 },
        ],
        error: null,
      }),
    });
    const res = await GET(makeRequest('test-api-key', '?page=1&limit=2') as any);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.pagination.total).toBe(50); // 行数(2)ではなくユニーク総数(50)
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
        }
        return { select: jest.fn() };
      }),
      rpc: jest.fn().mockResolvedValue({ data: [], error: null }),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.pagination.total).toBe(0); // 空結果なら total=0
  });

  test('DB error (RPC) → 500', async () => {
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
        return { select: jest.fn() };
      }),
      rpc: jest.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
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

  // dedup（user_id ?? phone ?? name）と検索は RPC(get_facility_customers_v1)が DB 側で行うため、
  // route 層では RPC へ正しいパラメータを渡すこと・RPC 結果を正しく整形することを検証する。
  function setupRpcMock(rpcImpl: jest.Mock) {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { facility_id: 'fac-123', scopes: ['customers:read'], is_active: true, expires_at: null },
            }),
          }),
        }),
      })),
      rpc: rpcImpl,
    });
    return rpcImpl;
  }

  test('search パラメータをサニタイズして RPC の p_search に渡す', async () => {
    const rpc = setupRpcMock(jest.fn().mockResolvedValue({ data: [], error: null }));
    const res = await GET(makeRequest('test-api-key', '?search=tanaka') as any);
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('get_facility_customers_v1', expect.objectContaining({
      p_facility_id: 'fac-123', p_search: 'tanaka',
    }));
  });

  test('search の LIKE ワイルドカード/区切り文字をエスケープ・除去して渡す', async () => {
    const rpc = setupRpcMock(jest.fn().mockResolvedValue({ data: [], error: null }));
    await GET(makeRequest('test-api-key', '?search=' + encodeURIComponent('a%_,(b)')) as any);
    const passed = rpc.mock.calls[0][1].p_search as string;
    expect(passed).toContain('\\%');   // % はエスケープ
    expect(passed).toContain('\\_');   // _ はエスケープ
    expect(passed).not.toContain('(');  // 区切り文字は除去
    expect(passed).not.toContain(',');
  });

  test('RPC 結果を {name,phone,email} に整形して返す', async () => {
    setupRpcMock(jest.fn().mockResolvedValue({
      data: [{ name: 'A', phone: '090', email: 'a@b.com', total_count: 1 }],
      error: null,
    }));
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    expect(json.data).toEqual([{ name: 'A', phone: '090', email: 'a@b.com' }]);
    expect(json.pagination.total).toBe(1);
  });

  test('page/limit から p_limit・p_offset を正しく算出して渡す', async () => {
    const rpc = setupRpcMock(jest.fn().mockResolvedValue({ data: [], error: null }));
    await GET(makeRequest('test-api-key', '?page=3&limit=10') as any);
    expect(rpc).toHaveBeenCalledWith('get_facility_customers_v1', expect.objectContaining({
      p_limit: 10, p_offset: 20, // (3-1)*10
    }));
  });

  test('data が null → 空配列・total 0 を返す', async () => {
    setupRpcMock(jest.fn().mockResolvedValue({ data: null, error: null }));
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

  test('search 未指定時は p_search に null を渡す', async () => {
    const rpc = setupRpcMock(jest.fn().mockResolvedValue({ data: [], error: null }));
    await GET(makeRequest() as any);
    expect(rpc).toHaveBeenCalledWith('get_facility_customers_v1', expect.objectContaining({ p_search: null }));
  });
});
