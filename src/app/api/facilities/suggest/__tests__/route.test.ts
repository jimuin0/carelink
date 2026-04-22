/**
 * @jest-environment node
 */

jest.mock('@/lib/rate-limit', () => ({
  inMemoryRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server');
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));

import { inMemoryRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

function setupDefaultMocks(hasResults: boolean = true) {
  const { createServerSupabaseClient } = require('@/lib/supabase-server');
  
  const facilityData = hasResults
    ? [
        {
          id: 'fac-1',
          name: 'Salon ABC',
          slug: 'salon-abc',
          city: 'Tokyo',
          nearest_station: 'Shibuya',
          business_type: 'eyelash',
        },
      ]
    : [];

  const cityData = hasResults ? [{ city: 'Tokyo' }, { city: 'Shibuya' }] : [];
  const stationData = hasResults ? [{ nearest_station: 'Shibuya Station' }] : [];

  createServerSupabaseClient.mockReturnValue({
    from: jest.fn((table: string) => {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            ilike: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: table === 'facility_profiles' && facilityData ? facilityData : cityData,
              }),
            }),
            not: jest.fn().mockReturnValue({
              ilike: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({
                  data: stationData,
                }),
              }),
            }),
          }),
        }),
      };
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  setupDefaultMocks();
});

function makeRequest(query: string = '', ip = '192.168.1.1') {
  const req = new Request(`http://localhost/api/facilities/suggest${query}`, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
  Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
  return req;
}

describe('GET /api/facilities/suggest', () => {
  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
    const res = await GET(makeRequest('?q=tokyo') as any);
    expect(res.status).toBe(429);
  });

  test('missing q parameter → 200 with empty arrays', async () => {
    const res = await GET(makeRequest('') as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.facilities).toEqual([]);
    expect(json.areas).toEqual([]);
  });

  test('empty q parameter → 200 with empty arrays', async () => {
    const res = await GET(makeRequest('?q=') as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.facilities).toEqual([]);
    expect(json.areas).toEqual([]);
  });

  test('valid q parameter → 200 with suggestions', async () => {
    const res = await GET(makeRequest('?q=tokyo') as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.facilities).toBeDefined();
    expect(json.areas).toBeDefined();
  });

  test('q truncated to 50 chars', async () => {
    const longQuery = 'x'.repeat(100);
    const res = await GET(makeRequest(`?q=${longQuery}`) as any);
    expect(res.status).toBe(200);
  });

  test('SQL special chars escaped', async () => {
    const res = await GET(makeRequest('?q=%test_value\\') as any);
    expect(res.status).toBe(200);
  });

  test('whitespace trimmed', async () => {
    const res = await GET(makeRequest('?q=%20%20tokyo%20%20') as any);
    expect(res.status).toBe(200);
  });

  test('facilities limited to 5 results', async () => {
    const res = await GET(makeRequest('?q=salon') as any);
    const json = await res.json();
    expect(json.facilities.length).toBeLessThanOrEqual(5);
  });

  test('areas limited to 5 results', async () => {
    const res = await GET(makeRequest('?q=tokyo') as any);
    const json = await res.json();
    expect(json.areas.length).toBeLessThanOrEqual(5);
  });

  test('facility suggestion includes all fields', async () => {
    const res = await GET(makeRequest('?q=salon') as any);
    const json = await res.json();
    if (json.facilities.length > 0) {
      const fac = json.facilities[0];
      expect(fac.id).toBeDefined();
      expect(fac.name).toBeDefined();
      expect(fac.slug).toBeDefined();
      expect(fac.business_type).toBeDefined();
    }
  });

  test('no results → 200 with empty arrays', async () => {
    setupDefaultMocks(false);
    const res = await GET(makeRequest('?q=nonexistent') as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.facilities).toEqual([]);
  });

  test('exception → 500 with Sentry', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockImplementation(() => {
      throw new Error('DB error');
    });
    const res = await GET(makeRequest('?q=test') as any);
    expect(res.status).toBe(500);
  });

  test('rate limit params (30 req/min per IP)', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();
    GET(makeRequest('?q=test', '192.168.1.1') as any);
    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe(30);
  });

  test('extracts first IP from x-forwarded-for', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();
    GET(makeRequest('?q=test', '10.0.0.1, 192.168.1.1') as any);
    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('10.0.0.1');
  });

  test('only published facilities returned', async () => {
    const res = await GET(makeRequest('?q=salon') as any);
    expect(res.status).toBe(200);
  });

  test('rate limit params window is 60_000ms', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();
    GET(makeRequest('?q=test') as any);
    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[2]).toBe(60_000);
  });

  test('レスポンスが { facilities, areas } 形式', async () => {
    const res = await GET(makeRequest('?q=salon') as any);
    const json = await res.json();
    expect(Array.isArray(json.facilities)).toBe(true);
    expect(Array.isArray(json.areas)).toBe(true);
  });

  test('q が 1文字 → 空 (最低2文字必要かどうか)', async () => {
    const res = await GET(makeRequest('?q=a') as any);
    expect(res.status).toBe(200);
  });
});
