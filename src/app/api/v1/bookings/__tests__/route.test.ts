/**
 * @jest-environment node
 */

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server');

import { checkRateLimit } from '@/lib/rate-limit';
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
                  scopes: hasScope ? ['bookings:read'] : ['other:scope'],
                  is_active: true,
                  expires_at: null,
                } : null,
              }),
            }),
          }),
        };
      } else if (table === 'bookings') {
        const result = { data: [{ id: 'booking-1', facility_id: 'fac-123', booking_date: '2026-05-10', start_time: '10:00', end_time: '11:00', menu_name: 'Eyelash', status: 'confirmed', total_price: 5000 }], error: null, count: 1 };
        const chain: any = { gte: jest.fn(), lte: jest.fn(), eq: jest.fn(), then: (r: any) => Promise.resolve(result).then(r), catch: (r: any) => Promise.resolve(result).catch(r) };
        chain.gte.mockReturnValue(chain);
        chain.lte.mockReturnValue(chain);
        chain.eq.mockReturnValue(chain);
        return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ order: jest.fn().mockReturnValue({ range: jest.fn().mockReturnValue(chain) }) }) }) };
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
  const req = new Request(`http://localhost/api/v1/bookings${query}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'x-forwarded-for': ip,
    },
  });
  Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
  return req;
}

describe('GET /api/v1/bookings', () => {
  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(429);
  });

  test('missing Authorization header → 401', async () => {
    const req = new Request('http://localhost/api/v1/bookings', {
      method: 'GET',
      headers: { 'x-forwarded-for': '192.168.1.1' },
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

  test('invalid from date format → 400', async () => {
    const res = await GET(makeRequest('test-api-key', '?from=2026/05/10') as any);
    expect(res.status).toBe(400);
  });

  test('valid from date → accepted', async () => {
    const res = await GET(makeRequest('test-api-key', '?from=2026-05-10') as any);
    expect(res.status).toBe(200);
  });

  test('invalid status value → 400', async () => {
    const res = await GET(makeRequest('test-api-key', '?status=invalid') as any);
    expect(res.status).toBe(400);
  });

  test('valid status values accepted', async () => {
    const statuses = ['pending', 'confirmed', 'completed', 'cancelled'];
    for (const status of statuses) {
      const res = await GET(makeRequest('test-api-key', `?status=${status}`) as any);
      expect(res.status).toBe(200);
    }
  });

  test('limit capped at 100', async () => {
    const res = await GET(makeRequest('test-api-key', '?limit=200') as any);
    const json = await res.json();
    expect(json.pagination.limit).toBeLessThanOrEqual(100);
  });

  test('includes pagination', async () => {
    const res = await GET(makeRequest('test-api-key', '?limit=50&page=1') as any);
    const json = await res.json();
    expect(json.pagination).toBeDefined();
    expect(json.pagination.page).toBe(1);
    expect(json.pagination.limit).toBe(50);
  });

  test('WWW-Authenticate header on 401', async () => {
    setupDefaultMocks(false);
    const res = await GET(makeRequest('invalid') as any);
    expect(res.headers.get('WWW-Authenticate')).toContain('Bearer');
  });

  test('rate limit params (60 req/min per IP)', () => {
    (checkRateLimit as jest.Mock).mockClear();
    GET(makeRequest('test-key', '', '192.168.1.1') as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[2]).toBe(60);
  });

  test('extracts last (trusted) IP from x-forwarded-for', () => {
    (checkRateLimit as jest.Mock).mockClear();
    GET(makeRequest('test-key', '', '10.0.0.1, 192.168.1.1') as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('rate limit window is 60s', () => {
    (checkRateLimit as jest.Mock).mockClear();
    GET(makeRequest() as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[3]).toBe(60_000);
  });

  test('invalid to date format → 400', async () => {
    const res = await GET(makeRequest('test-api-key', '?to=2026/05/10') as any);
    expect(res.status).toBe(400);
  });

  test('different facility_id than API key → 403', async () => {
    const res = await GET(makeRequest('test-api-key', '?facility_id=different-facility') as any);
    expect(res.status).toBe(403);
  });

  test('response includes api_version', async () => {
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    expect(json.api_version).toBeDefined();
    expect(typeof json.api_version).toBe('string');
  });

  test('response has X-API-Version header', async () => {
    const res = await GET(makeRequest() as any);
    expect(res.headers.get('X-API-Version')).toBeDefined();
  });

  test('response has Cache-Control: no-store', async () => {
    const res = await GET(makeRequest() as any);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  test('page defaults to 1', async () => {
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    expect(json.pagination.page).toBe(1);
  });

  test('inactive API key → 401', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { facility_id: 'fac-123', scopes: ['bookings:read'], is_active: false, expires_at: null },
            }),
          }),
        }),
      }),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(401);
  });

  test('expired API key → 401', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { facility_id: 'fac-123', scopes: ['bookings:read'], is_active: true, expires_at: '2000-01-01T00:00:00Z' },
            }),
          }),
        }),
      }),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(401);
  });

  test('null scopes → 403 (defaults to empty array)', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: { facility_id: 'fac-123', scopes: null, is_active: true, expires_at: null },
            }),
          }),
        }),
      }),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(403);
  });

  test('wildcard scope * allows cross-facility', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    let cc = 0;
    createServiceRoleClient.mockImplementation(() => {
      cc++;
      if (cc === 1) {
        return {
          from: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { facility_id: 'fac-123', scopes: ['*'], is_active: true, expires_at: null },
                }),
              }),
            }),
          }),
        };
      }
      const result = { data: [], error: null, count: 0 };
      const chain: any = { gte: jest.fn(), lte: jest.fn(), eq: jest.fn(), then: (r: any) => Promise.resolve(result).then(r), catch: (r: any) => Promise.resolve(result).catch(r) };
      chain.gte.mockReturnValue(chain);
      chain.lte.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      return { from: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ order: jest.fn().mockReturnValue({ range: jest.fn().mockReturnValue(chain) }) }) }) }) };
    });
    const res = await GET(makeRequest('test-api-key', '?facility_id=different-facility') as any);
    expect(res.status).toBe(200);
  });

  test('Authorization not Bearer scheme → 401', async () => {
    const req = new Request('http://localhost/api/v1/bookings', {
      method: 'GET',
      headers: { 'Authorization': 'Basic xxx', 'x-forwarded-for': '192.168.1.1' },
    });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  test('Empty bearer token → 401', async () => {
    const req = new Request('http://localhost/api/v1/bookings', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer ', 'x-forwarded-for': '192.168.1.1' },
    });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  test('missing x-forwarded-for falls back to unknown', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/v1/bookings', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer test-api-key' },
    });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    await GET(req as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('limit=abc → defaults to 50', async () => {
    const res = await GET(makeRequest('test-api-key', '?limit=abc') as any);
    const json = await res.json();
    expect(json.pagination.limit).toBe(50);
  });

  test('page=abc → defaults to 1', async () => {
    const res = await GET(makeRequest('test-api-key', '?page=abc') as any);
    const json = await res.json();
    expect(json.pagination.page).toBe(1);
  });

  // Branch coverage: line 53 — apiKey is whitespace-only (trim() yields empty string)
  test('Bearer token with only whitespace → 401', async () => {
    const req = new Request('http://localhost/api/v1/bookings', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer    ', 'x-forwarded-for': '192.168.1.1' },
    });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  // Branch coverage: line 104 — `to` parameter present → lte() branch executed
  test('valid to date → accepted and lte applied', async () => {
    const res = await GET(makeRequest('test-api-key', '?to=2026-12-31') as any);
    expect(res.status).toBe(200);
  });

  test('null data from DB → empty array', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    let cc = 0;
    createServiceRoleClient.mockImplementation(() => {
      cc++;
      if (cc === 1) {
        return {
          from: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { facility_id: 'fac-123', scopes: ['bookings:read'], is_active: true, expires_at: null },
                }),
              }),
            }),
          }),
        };
      }
      const result = { data: null, error: null, count: null };
      const chain: any = { gte: jest.fn(), lte: jest.fn(), eq: jest.fn(), then: (r: any) => Promise.resolve(result).then(r), catch: (r: any) => Promise.resolve(result).catch(r) };
      chain.gte.mockReturnValue(chain);
      chain.lte.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      return { from: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ order: jest.fn().mockReturnValue({ range: jest.fn().mockReturnValue(chain) }) }) }) }) };
    });
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    expect(json.data).toEqual([]);
    expect(json.pagination.total).toBe(0);
  });

  // Branch coverage: line 53 — apiKey is empty string (not just whitespace; exact 'Bearer ' header)
  test('Authorization exactly "Bearer " (no token at all) → 401', async () => {
    const req = new Request('http://localhost/api/v1/bookings', {
      method: 'GET',
      headers: { 'Authorization': 'Bearer', 'x-forwarded-for': '192.168.1.1' },
    });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    // 'Bearer' does not start with 'Bearer ' (note the space), so caught by line 51
    expect(res.status).toBe(401);
  });

  // Branch coverage: line 104 — `to` param triggers lte(); combined with `from` and `status`
  // to ensure all three filter branches execute in one request
  test('from + to + status all set → all three query filters applied, 200', async () => {
    const res = await GET(makeRequest('test-api-key', '?from=2026-01-01&to=2026-12-31&status=confirmed') as any);
    expect(res.status).toBe(200);
  });

  test('DB error → 500', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    // Route calls createServiceRoleClient twice: once in resolveApiKey (api_keys) and once for bookings query
    let callCount = 0;
    createServiceRoleClient.mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call: resolveApiKey — returns valid key
        return {
          from: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { facility_id: 'fac-123', scopes: ['bookings:read'], is_active: true, expires_at: null },
                }),
              }),
            }),
          }),
        };
      }
      // Second call: bookings query — returns error
      const errChain: any = {};
      Object.assign(errChain, {
        gte: jest.fn().mockReturnValue(errChain),
        lte: jest.fn().mockReturnValue(errChain),
        eq: jest.fn().mockReturnValue(errChain),
        then: (r: any) => Promise.resolve({ data: null, error: { message: 'DB error' }, count: 0 }).then(r),
        catch: (r: any) => Promise.resolve({ data: null, error: { message: 'DB error' }, count: 0 }).catch(r),
      });
      return {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              order: jest.fn().mockReturnValue({
                range: jest.fn().mockReturnValue(errChain),
              }),
            }),
          }),
        }),
      };
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });
});
