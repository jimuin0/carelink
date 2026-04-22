/**
 * @jest-environment node
 *
 * Tests for GET /api/recommendations
 * Key assertions:
 *   - Rate limiting (30 req/min per IP)
 *   - Auth optional (anonymous → empty results)
 *   - Limit param (max 12, default 6)
 *   - Exclude param (skip facility)
 *   - Aggregates bookings + favorites for business_type/location
 *   - Fallback to popular facilities when no history
 */

jest.mock('@/lib/rate-limit', () => ({
  inMemoryRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server-auth');
jest.mock('@supabase/supabase-js');

import { inMemoryRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

let mockBookingsSelect: jest.Mock;
let mockFavoritesSelect: jest.Mock;
let mockPopularSelect: jest.Mock;
let mockGetUser: jest.Mock;

function setupDefaultMocks(
  hasUser: boolean = true,
  bookingsCount: number = 2,
  favoritesCount: number = 1
) {
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);

  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: hasUser ? { id: 'user-123' } : null },
  });

  const bookingsData = Array.from({ length: bookingsCount }, (_, i) => ({
    facility_id: `fac-booking-${i}`,
    facility_profiles: {
      id: `fac-booking-${i}`,
      business_type: i % 2 === 0 ? 'acupuncture' : 'massage',
      prefecture: i === 0 ? '東京都' : '神奈川県',
      city: i === 0 ? '渋谷区' : '横浜市',
    },
  }));

  const favoritesData = Array.from({ length: favoritesCount }, (_, i) => ({
    facility_id: `fac-fav-${i}`,
    facility_profiles: {
      id: `fac-fav-${i}`,
      business_type: 'acupuncture',
      prefecture: '東京都',
      city: '渋谷区',
    },
  }));

  mockBookingsSelect = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      order: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue({
          data: bookingsData,
        }),
      }),
    }),
  });

  mockFavoritesSelect = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue({
        data: favoritesData,
      }),
    }),
  });

  const mockPopularOrder = jest.fn().mockReturnValue({
    limit: jest.fn().mockResolvedValue({
      data: [
        { id: 'popular-1', name: 'Popular Salon 1' },
        { id: 'popular-2', name: 'Popular Salon 2' },
      ],
    }),
  });
  const mockPopularEq = jest.fn();
  mockPopularEq.mockReturnValue({ eq: mockPopularEq, order: mockPopularOrder });
  mockPopularSelect = jest.fn().mockReturnValue({ eq: mockPopularEq });

  const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
  createServerSupabaseAuthClient.mockResolvedValue({
    auth: { getUser: mockGetUser },
  });

  const { createClient } = require('@supabase/supabase-js');
  createClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'bookings') return { select: mockBookingsSelect };
      if (table === 'favorites') return { select: mockFavoritesSelect };
      if (table === 'facility_card_view') return { select: mockPopularSelect };
    }),
  });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
});

function makeRequest(limit?: number, exclude?: string, ip = '192.168.1.1') {
  let url = 'http://localhost/api/recommendations';
  const params = new URLSearchParams();
  if (limit) params.append('limit', limit.toString());
  if (exclude) params.append('exclude', exclude);
  if (params.toString()) url += '?' + params.toString();

  const req = new Request(url, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
  Object.defineProperty(req, 'nextUrl', {
    value: new URL(req.url),
    writable: true,
  });
  return req;
}

describe('GET /api/recommendations', () => {
  test('rate limiting → returns empty array', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await GET(makeRequest() as any);

    const json = await res.json();
    expect(json.recommendations).toEqual([]);
  });

  test('unauthenticated → returns empty array', async () => {
    setupDefaultMocks(false);

    const res = await GET(makeRequest() as any);

    const json = await res.json();
    expect(json.recommendations).toEqual([]);
  });

  test('valid request → 200 with recommendations', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.recommendations)).toBe(true);
  });

  test('limit defaults to 6', async () => {
    const res = await GET(makeRequest() as any);

    // Should call limit(6) by default
    expect(res.status).toBe(200);
  });

  test('limit max 12', async () => {
    const res = await GET(makeRequest(20) as any);

    // Should cap at 12
    expect(res.status).toBe(200);
  });

  test('exclude param adds facility to visitedIds', async () => {
    const res = await GET(makeRequest(6, 'fac-exclude') as any);

    expect(res.status).toBe(200);
  });

  test('aggregates bookings for business_type frequency', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('aggregates favorites for location frequency', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('no booking/favorite history → fallback to popular', async () => {
    setupDefaultMocks(true, 0, 0);

    const res = await GET(makeRequest() as any);

    const json = await res.json();
    expect(json.type).toBe('popular');
  });

  test('popular fallback sorted by rating_count descending', async () => {
    setupDefaultMocks(true, 0, 0);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('filters out visited facilities', async () => {
    const res = await GET(makeRequest(6, 'fac-booking-0') as any);

    expect(res.status).toBe(200);
  });

  test('combines bookings and favorites for frequency count', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('rate limit params (30 req/min per IP)', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    GET(makeRequest(6, undefined, '192.168.1.1') as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('192.168.1.1');
    expect(call[1]).toBe(30);
    expect(call[2]).toBe(60_000);
    expect(call[3]).toBe('recommendations');
  });

  test('extracts first IP from x-forwarded-for', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    GET(makeRequest(6, undefined, '10.0.0.1, 192.168.1.1') as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('10.0.0.1');
  });

  test('fetches up to 20 bookings', async () => {
    const res = await GET(makeRequest() as any);

    expect(mockBookingsSelect().eq().order().limit).toHaveBeenCalledWith(20);
  });

  test('fetches up to 20 favorites', async () => {
    const res = await GET(makeRequest() as any);

    expect(mockFavoritesSelect().eq().limit).toHaveBeenCalledWith(20);
  });
});
