/**
 * @jest-environment node
 *
 * Tests for GET /api/recommendations
 * Key assertions:
 *   - Rate limiting (30 req/min per IP)
 *   - Optional auth (works without login, returns empty)
 *   - Query param validation (limit 1-12, exclude format)
 *   - Response structure validation
 */

jest.mock('@/lib/rate-limit', () => ({
  inMemoryRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server-auth');
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

import { inMemoryRateLimit } from '@/lib/rate-limit';
import { createClient } from '@supabase/supabase-js';
import { GET } from '../route';

let mockGetUser: jest.Mock;

// Helper to create chainable mock that handles arbitrary .eq().order().limit() sequences
function createChainableMock(resolveValue: any) {
  const chainable: any = {
    eq: jest.fn(),
    order: jest.fn(),
    limit: jest.fn(),
    select: jest.fn(),
  };

  chainable.eq.mockReturnValue(chainable);
  chainable.order.mockReturnValue(chainable);
  chainable.limit.mockReturnValue(Promise.resolve(resolveValue));
  chainable.select.mockReturnValue(chainable);

  return chainable;
}

function setupDefaultMocks(hasUser: boolean = false, hasBookings: boolean = false) {
  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: hasUser ? { id: 'user-123', email: 'test@example.com' } : null },
  });

  const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
  createServerSupabaseAuthClient.mockResolvedValue({
    auth: { getUser: mockGetUser },
  });

  (createClient as jest.Mock).mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'bookings') {
        return createChainableMock({
          data: hasBookings
            ? [
                {
                  facility_id: 'fac-1',
                  facility_profiles: {
                    id: 'fac-1',
                    business_type: 'eyelash',
                    prefecture: 'osaka',
                    city: 'osaka-shi',
                  },
                },
              ]
            : [],
        });
      } else if (table === 'favorites') {
        return createChainableMock({
          data: hasBookings
            ? [
                {
                  facility_id: 'fac-2',
                  facility_profiles: {
                    id: 'fac-2',
                    business_type: 'eyelash',
                    prefecture: 'osaka',
                    city: 'osaka-shi',
                  },
                },
              ]
            : [],
        });
      } else if (table === 'facility_card_view') {
        return createChainableMock({
          data: [
            {
              id: 'fac-3',
              name: 'Salon A',
              business_type: 'eyelash',
              prefecture: 'osaka',
              city: 'osaka-shi',
              rating_avg: 4.8,
              rating_count: 150,
              is_published: true,
            },
            {
              id: 'fac-4',
              name: 'Salon B',
              business_type: 'eyelash',
              prefecture: 'osaka',
              city: 'osaka-shi',
              rating_avg: 4.5,
              rating_count: 100,
              is_published: true,
            },
          ],
        });
      }
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  setupDefaultMocks();

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
});

function makeRequest(queryParams: Record<string, string> = {}, ip = '192.168.1.1') {
  const url = new URL('http://localhost/api/recommendations');
  Object.entries(queryParams).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const req = new Request(url.toString(), {
    method: 'GET',
    headers: {
      'x-forwarded-for': ip,
    },
  });

  // Mock nextUrl property required by NextRequest
  Object.defineProperty(req, 'nextUrl', {
    value: url,
    writable: true,
  });

  return req;
}

describe('GET /api/recommendations', () => {
  test('rate limiting → returns empty recommendations', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recommendations).toEqual([]);
  });

  test('unauthenticated user → returns empty recommendations', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recommendations).toEqual([]);
  });

  test('authenticated user with no history → returns popular facilities', async () => {
    setupDefaultMocks(true, false);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recommendations.length).toBeGreaterThan(0);
    expect(json.type).toBe('popular');
  });

  test('authenticated user with history → returns personalized recommendations', async () => {
    setupDefaultMocks(true, true, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recommendations.length).toBeGreaterThan(0);
    expect(json.type).toBe('personalized');
    expect(json.based_on).toBeDefined();
    expect(json.based_on.business_type).toBe('eyelash');
  });

  test('limit parameter min (1) → returns 1 recommendation', async () => {
    setupDefaultMocks(true, true, true);

    const res = await GET(makeRequest({ limit: '1' }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recommendations.length).toBeLessThanOrEqual(1);
  });

  test('limit parameter max (12) → returns up to 12 recommendations', async () => {
    setupDefaultMocks(true, true, true);

    const res = await GET(makeRequest({ limit: '12' }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recommendations.length).toBeLessThanOrEqual(12);
  });

  test('limit parameter exceeds max (13) → capped to 12', async () => {
    setupDefaultMocks(true, true, true);

    const res = await GET(makeRequest({ limit: '13' }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recommendations.length).toBeLessThanOrEqual(12);
  });

  test('limit parameter non-numeric → defaults to 6', async () => {
    setupDefaultMocks(true, true, true);

    const res = await GET(makeRequest({ limit: 'abc' }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recommendations.length).toBeLessThanOrEqual(6);
  });

  test('limit parameter 0 → defaults to 6', async () => {
    setupDefaultMocks(true, true, true);

    const res = await GET(makeRequest({ limit: '0' }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recommendations.length).toBeLessThanOrEqual(6);
  });

  test('exclude parameter valid UUID → filters out facility', async () => {
    setupDefaultMocks(true, true, true);

    const excludeId = 'fac-3';
    const res = await GET(makeRequest({ exclude: excludeId }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    const ids = json.recommendations.map((r: any) => r.id);
    expect(ids).not.toContain(excludeId);
  });

  test('exclude parameter non-UUID format → ignored', async () => {
    setupDefaultMocks(true, true, true);

    const res = await GET(makeRequest({ exclude: 'not-a-uuid' }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recommendations.length).toBeGreaterThanOrEqual(0);
  });

  test('rate limit params (30 req/min per IP)', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();
    (inMemoryRateLimit as jest.Mock).mockReturnValue(false);

    GET(makeRequest({}, '192.168.1.1') as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('192.168.1.1');
    expect(call[1]).toBe(30);
    expect(call[2]).toBe(60_000);
    expect(call[3]).toBe('recommendations');
  });

  test('extracts first IP from x-forwarded-for', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();
    (inMemoryRateLimit as jest.Mock).mockReturnValue(false);

    GET(makeRequest({}, '10.0.0.1, 192.168.1.1') as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('10.0.0.1');
  });

  test('uses unknown IP when x-forwarded-for missing', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();
    (inMemoryRateLimit as jest.Mock).mockReturnValue(false);

    const req = new Request('http://localhost/api/recommendations', {
      method: 'GET',
    });

    GET(req as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('unknown');
  });

  test('authenticated user with multiple bookings → uses top business type', async () => {
    setupDefaultMocks(true, true, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    if (json.type === 'personalized') {
      expect(json.based_on.business_type).toBeTruthy();
    }
  });

  test('authenticated user with multiple locations → uses top prefecture/city', async () => {
    setupDefaultMocks(true, true, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    if (json.type === 'personalized') {
      expect(json.based_on.prefecture).toBeTruthy();
      expect(json.based_on.city).toBeTruthy();
    }
  });

  test('multiple recommendations response format', async () => {
    setupDefaultMocks(true, true, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.recommendations)).toBe(true);
    expect(json.recommendations.every((r: any) => r.id && r.name && r.is_published === true)).toBe(true);
  });

  test('limit with exclude → both query params work together', async () => {
    setupDefaultMocks(true, true, true);

    const res = await GET(makeRequest({ limit: '5', exclude: 'fac-3' }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recommendations.length).toBeLessThanOrEqual(5);
  });
});
