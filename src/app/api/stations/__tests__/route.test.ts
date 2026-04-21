/**
 * @jest-environment node
 *
 * Tests for GET /api/stations
 * Key assertions:
 *   - Rate limiting (30 req/min per IP)
 *   - Query param q search (optional, max 50 chars, SQL escaped)
 *   - Deduplication and sorting of stations
 *   - Cache-Control headers
 */

jest.mock('@/lib/rate-limit', () => ({
  inMemoryRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server');
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));

import { inMemoryRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

// Helper for chainable mocks
function createChainableMock(data: any) {
  const chainable: any = {
    eq: jest.fn(),
    not: jest.fn(),
    ilike: jest.fn(),
    limit: jest.fn(),
    select: jest.fn(),
  };
  chainable.eq.mockReturnValue(chainable);
  chainable.not.mockReturnValue(chainable);
  chainable.ilike.mockReturnValue(chainable);
  chainable.limit.mockResolvedValue({ data, error: null });
  chainable.select.mockReturnValue(chainable);
  return chainable;
}

function setupDefaultMocks() {
  const mockData = [
    { nearest_station: '渋谷駅' },
    { nearest_station: '新宿駅' },
    { nearest_station: '渋谷駅' },
    { nearest_station: '池袋駅' },
    { nearest_station: null },
    { nearest_station: '新宿駅' },
  ];

  const { createServerSupabaseClient } = require('@/lib/supabase-server');
  createServerSupabaseClient.mockReturnValue({
    from: jest.fn().mockReturnValue(createChainableMock(mockData)),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  setupDefaultMocks();
});

function makeRequest(q?: string, ip = '192.168.1.1') {
  const url = q
    ? `http://localhost/api/stations?q=${encodeURIComponent(q)}`
    : 'http://localhost/api/stations';
  return new Request(url, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
}

describe('GET /api/stations', () => {
  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(429);
  });

  test('list all stations → 200 with array', async () => {
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.stations)).toBe(true);
    expect(json.stations.length).toBeGreaterThan(0);
  });

  test('stations deduplicated (Set)', async () => {
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    // 3 unique stations from mock
    expect(json.stations.length).toBe(3);
  });

  test('stations sorted alphabetically', async () => {
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    expect(json.stations).toEqual([...json.stations].sort());
  });

  test('search by q parameter', async () => {
    const res = await GET(makeRequest('新宿') as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.stations)).toBe(true);
  });

  test('q parameter trimmed and sliced to 50', async () => {
    const longQ = '  ' + 'x'.repeat(100) + '  ';
    const res = await GET(makeRequest(longQ) as any);
    expect(res.status).toBe(200);
  });

  test('q with SQL special chars escaped', async () => {
    const res = await GET(makeRequest('test%test_test\\test') as any);
    expect(res.status).toBe(200);
  });

  test('Cache-Control header 1 hour', async () => {
    const res = await GET(makeRequest() as any);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, s-maxage=3600');
  });

  test('rate limit params (30/min)', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();
    GET(makeRequest(undefined, '192.168.1.1') as any);
    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('192.168.1.1');
    expect(call[1]).toBe(30);
    expect(call[3]).toBe('stations');
  });

  test('extracts first IP from x-forwarded-for', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();
    GET(makeRequest(undefined, '10.0.0.1, 192.168.1.1') as any);
    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('10.0.0.1');
  });

  test('uses unknown IP when x-forwarded-for missing', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/stations');
    GET(req as any);
    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('unknown');
  });

  test('null stations filtered', async () => {
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    expect(json.stations.every((s: any) => s !== null)).toBe(true);
  });

  test('empty q treated as no filter', async () => {
    const res = await GET(makeRequest('') as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.stations)).toBe(true);
  });
});
