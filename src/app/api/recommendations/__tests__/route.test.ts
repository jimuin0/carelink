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
  checkRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server-auth');
jest.mock('@supabase/supabase-js');

import { checkRateLimit } from '@/lib/rate-limit';
import { clearPopularFacilitiesCache } from '@/lib/popular-facilities-cache';
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
  (checkRateLimit as jest.Mock).mockReturnValue(false);

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
  // 監査P1: 人気施設キャッシュ(limit別)がテスト間で漏れないよう毎回クリアする
  clearPopularFacilitiesCache();
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
    (checkRateLimit as jest.Mock).mockReturnValue(true);

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

  test('limit が非数値 → 既定6にフォールバック（Number.isFinite false 分岐）', async () => {
    const url = 'http://localhost/api/recommendations?limit=abc';
    const req = new Request(url, { method: 'GET', headers: { 'x-forwarded-for': '192.168.1.1' } });
    Object.defineProperty(req, 'nextUrl', { value: new URL(url), writable: true });
    const res = await GET(req as any);
    // NaN は弾かれ既定 6 で正常応答（不正クエリ化による 500 を予防）
    expect(res.status).toBe(200);
  });

  test('limit が負数 → 1にクランプ（Math.max 分岐）', async () => {
    const url = 'http://localhost/api/recommendations?limit=-5';
    const req = new Request(url, { method: 'GET', headers: { 'x-forwarded-for': '192.168.1.1' } });
    Object.defineProperty(req, 'nextUrl', { value: new URL(url), writable: true });
    const res = await GET(req as any);
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

  test('popular 経路は status=published で絞る（is_published 列は存在しない・回帰防止）', async () => {
    setupDefaultMocks(true, 0, 0); // 履歴なし → popular fallback
    await GET(makeRequest() as any);
    const eqMock = mockPopularSelect().eq as jest.Mock;
    const eqColumns = eqMock.mock.calls.map((c) => c[0]);
    expect(eqMock).toHaveBeenCalledWith('status', 'published');
    expect(eqColumns).not.toContain('is_published');
  });

  test('personalized 経路も status=published で絞る（is_published 不使用・回帰防止）', async () => {
    await GET(makeRequest() as any); // 履歴あり → personalized
    const eqMock = mockPopularSelect().eq as jest.Mock;
    const eqColumns = eqMock.mock.calls.map((c) => c[0]);
    expect(eqMock).toHaveBeenCalledWith('status', 'published');
    expect(eqColumns).not.toContain('is_published');
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
    (checkRateLimit as jest.Mock).mockClear();

    GET(makeRequest(6, undefined, '192.168.1.1') as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(30);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('recommendations');
  });

  test('extracts last (trusted) IP from x-forwarded-for', () => {
    (checkRateLimit as jest.Mock).mockClear();

    GET(makeRequest(6, undefined, '10.0.0.1, 192.168.1.1') as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('fetches up to 20 bookings', async () => {
    const res = await GET(makeRequest() as any);

    expect(mockBookingsSelect().eq().order().limit).toHaveBeenCalledWith(20);
  });

  test('fetches up to 20 favorites', async () => {
    const res = await GET(makeRequest() as any);

    expect(mockFavoritesSelect().eq().limit).toHaveBeenCalledWith(20);
  });

  test('x-forwarded-for ヘッダーなし → "unknown" を使用', () => {
    (checkRateLimit as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/recommendations', { method: 'GET' });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    GET(req as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('facility_profiles が null → processEntry で早期 return', async () => {
    const { createClient } = require('@supabase/supabase-js');
    const bookingsWithNullProfile = [{ facility_id: 'fac-1', facility_profiles: null }];
    const mockBkSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue({ data: bookingsWithNullProfile }),
        }),
      }),
    });
    const mockFavSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ data: [] }) }),
    });
    const mockPopEq = jest.fn();
    const mockPopOrder = jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue({ data: [{ id: 'pop-1' }] }),
    });
    mockPopEq.mockReturnValue({ eq: mockPopEq, order: mockPopOrder });
    const mockPopSel = jest.fn().mockReturnValue({ eq: mockPopEq });

    createClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'bookings') return { select: mockBkSelect };
        if (table === 'favorites') return { select: mockFavSelect };
        if (table === 'facility_card_view') return { select: mockPopSel };
      }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    // Null profile → no type/pref collected → popular fallback
    expect(json.type).toBe('popular');
  });

  test('bookings が null → ?? [] フォールバック', async () => {
    const { createClient } = require('@supabase/supabase-js');
    const mockBkSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue({ data: null }), // null bookings
        }),
      }),
    });
    const mockFavSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ data: null }) }), // null favorites
    });
    const mockPopEq = jest.fn();
    const mockPopOrder = jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue({ data: null }), // null popular data
    });
    mockPopEq.mockReturnValue({ eq: mockPopEq, order: mockPopOrder });
    const mockPopSel = jest.fn().mockReturnValue({ eq: mockPopEq });

    createClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'bookings') return { select: mockBkSelect };
        if (table === 'favorites') return { select: mockFavSelect };
        if (table === 'facility_card_view') return { select: mockPopSel };
      }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    // null bookings/favorites → no history → popular fallback → null data → ?? []
    expect(json.recommendations).toEqual([]);
    expect(json.type).toBe('popular');
  });

  test('topType あり・topPref なし → prefecture eq をスキップ', async () => {
    const { createClient } = require('@supabase/supabase-js');
    // Bookings with business_type but missing prefecture/city
    const bookingsTypeOnly = [
      { facility_id: 'fac-1', facility_profiles: { id: 'fac-1', business_type: 'acupuncture', prefecture: '', city: '' } },
    ];
    const mockBkSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue({ data: bookingsTypeOnly }),
        }),
      }),
    });
    const mockFavSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ data: [] }) }),
    });
    const mockPopEq = jest.fn();
    const mockPopOrder = jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue({ data: null }), // null type matches
    });
    mockPopEq.mockReturnValue({ eq: mockPopEq, order: mockPopOrder });
    const mockPopSel = jest.fn().mockReturnValue({ eq: mockPopEq });

    createClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'bookings') return { select: mockBkSelect };
        if (table === 'favorites') return { select: mockFavSelect };
        if (table === 'facility_card_view') return { select: mockPopSel };
      }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.type).toBe('personalized');
  });

  test('topType なし・topPref あり → business_type eq をスキップ', async () => {
    const { createClient } = require('@supabase/supabase-js');
    // Booking with empty-string business_type (falsy) but valid prefecture
    const bookingsPrefOnly = [
      { facility_id: 'fac-1', facility_profiles: { id: 'fac-1', business_type: '', prefecture: '東京都', city: '渋谷区' } },
    ];
    const mockBkSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue({ data: bookingsPrefOnly }),
        }),
      }),
    });
    const mockFavSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ data: [] }) }),
    });
    const mockPopEq = jest.fn();
    const mockPopOrder = jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue({ data: [] }),
    });
    mockPopEq.mockReturnValue({ eq: mockPopEq, order: mockPopOrder });
    const mockPopSel = jest.fn().mockReturnValue({ eq: mockPopEq });

    createClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'bookings') return { select: mockBkSelect };
        if (table === 'favorites') return { select: mockFavSelect };
        if (table === 'facility_card_view') return { select: mockPopSel };
      }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.type).toBe('personalized');
  });

  test('filtered が limit 以上 → 補完クエリをスキップ', async () => {
    const { createClient } = require('@supabase/supabase-js');
    // Bookings with type+pref
    const bookingsData = [
      { facility_id: 'fac-1', facility_profiles: { id: 'fac-1', business_type: 'acupuncture', prefecture: '東京都', city: '渋谷区' } },
    ];
    // 6 unique results (>= limit of 6)
    const manyResults = Array.from({ length: 6 }, (_, i) => ({ id: `rec-${i}` }));
    const mockBkSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        order: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue({ data: bookingsData }),
        }),
      }),
    });
    const mockFavSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue({ data: [] }) }),
    });
    const mockPopEq = jest.fn();
    const mockPopOrder = jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue({ data: manyResults }),
    });
    mockPopEq.mockReturnValue({ eq: mockPopEq, order: mockPopOrder });
    const mockPopSel = jest.fn().mockReturnValue({ eq: mockPopEq });

    createClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'bookings') return { select: mockBkSelect };
        if (table === 'favorites') return { select: mockFavSelect };
        if (table === 'facility_card_view') return { select: mockPopSel };
      }),
    });

    const res = await GET(makeRequest(6) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recommendations.length).toBe(6);
  });
});
