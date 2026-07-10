/**
 * @jest-environment node
 *
 * Tests for GET /api/liff/coupons
 * Key assertions:
 *   - Rate limiting (30 req/min per IP)
 *   - Auth required (LINE access token — 他 liff API と同一方式)
 *   - IDOR prevention (line_user_id は検証済みトークン由来・クライアント user_id を信頼しない)
 *   - Aggregates past bookings + favorites facilities
 *   - Returns valid, non-expired coupons only
 *   - Ordered by valid_until
 *   - Limited to 30 results
 */

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/line', () => ({
  verifyLineAccessToken: jest.fn(() => Promise.resolve({ ok: true, userId: 'line-user-verified' })),
}));
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/alert', () => ({
  alertCaughtError: jest.fn(),
}));

import { checkRateLimit } from '@/lib/rate-limit';
import { verifyLineAccessToken } from '@/lib/line';
import { GET } from '../route';

function setupDefaultMocks(
  lineTokenValid: boolean = true,
  profileFound: boolean = true,
  hasBookings: boolean = true,
  hasFavorites: boolean = true,
  hasCoupons: boolean = true
) {
  (verifyLineAccessToken as jest.Mock).mockResolvedValue({ ok: true, userId: 'line-user-verified' });

  global.fetch = jest.fn((url: string) => {
    if (url.includes('api.line.me/v2/profile')) {
      return Promise.resolve(
        new Response(JSON.stringify({ userId: 'line-user-456' }), {
          status: lineTokenValid ? 200 : 401,
        })
      );
    }
    return Promise.resolve(new Response('{}'));
  }) as jest.Mock;

  const profileData = profileFound ? { id: 'user-123' } : null;

  const bookingData = hasBookings
    ? [{ facility_id: 'fac-1' }, { facility_id: 'fac-2' }, { facility_id: 'fac-1' }]
    : [];

  const favData = hasFavorites ? [{ facility_id: 'fac-3' }, { facility_id: 'fac-2' }] : [];

  const couponData = hasCoupons
    ? [
        {
          id: 'coupon-1',
          name: 'Summer Sale',
          description: '20% off',
          discount_type: 'percentage',
          discount_value: 20,
          special_price: null,
          valid_until: '2026-07-01',
          coupon_type: 'general',
          facility_profiles: { name: 'Salon A' },
        },
        {
          id: 'coupon-2',
          name: '500pt Discount',
          description: 'Use 500 points',
          discount_type: 'points',
          discount_value: 500,
          special_price: null,
          valid_until: '2026-08-01',
          coupon_type: 'limited',
          facility_profiles: { name: 'Salon B' },
        },
      ]
    : [];

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: profileData }),
            }),
          }),
        };
      } else if (table === 'bookings') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({ data: bookingData }),
            }),
          }),
        };
      } else if (table === 'favorites') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({ data: favData }),
          }),
        };
      } else if (table === 'coupons') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              in: jest.fn().mockReturnValue({
                or: jest.fn().mockReturnValue({
                  or: jest.fn().mockReturnValue({
                    order: jest.fn().mockReturnValue({
                      limit: jest.fn().mockResolvedValue({ data: couponData }),
                    }),
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

function makeRequest(token: string | null = 'valid-token', ip = '192.168.1.1') {
  return new Request('http://localhost/api/liff/coupons', {
    method: 'GET',
    headers: {
      'x-forwarded-for': ip,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

describe('GET /api/liff/coupons', () => {
  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(429);
  });

  test('Authorization ヘッダ無し → 401（cookie 認証ではなく LINE トークン方式・回帰防止）', async () => {
    const res = await GET(makeRequest(null) as any);
    expect(res.status).toBe(401);
  });

  test('Bearer でないヘッダ → 401', async () => {
    const req = new Request('http://localhost/api/liff/coupons', {
      method: 'GET',
      headers: { 'x-forwarded-for': '192.168.1.1', Authorization: 'token-without-bearer' },
    });
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  test('LINE トークン検証失敗（audience不一致等）→ 401', async () => {
    (verifyLineAccessToken as jest.Mock).mockResolvedValue({ ok: false });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(401);
  });

  test('LINE Profile API が非200 → 401', async () => {
    setupDefaultMocks(false);
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(401);
  });

  test('line_user_id に対応する profile が無い → 404', async () => {
    setupDefaultMocks(true, false);
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(404);
  });

  test('認証成功・クーポンあり → 200 with coupons array', async () => {
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.coupons)).toBe(true);
    expect(json.coupons.length).toBeGreaterThan(0);
  });

  test('予約・お気に入りなし → 200 with empty coupons', async () => {
    setupDefaultMocks(true, true, false, false, false);
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.coupons).toEqual([]);
  });

  test('クライアント供給の user_id は使わない（IDOR防止・検証済みトークン由来で解決）', async () => {
    // user_id クエリを付けても無視され、profiles 解決の userId が使われる
    const req = new Request('http://localhost/api/liff/coupons?user_id=attacker', {
      method: 'GET',
      headers: { 'x-forwarded-for': '192.168.1.1', Authorization: 'Bearer valid-token' },
    });
    const res = await GET(req as any);
    expect(res.status).toBe(200);
  });

  test('includes coupon metadata (name, description, discount)', async () => {
    const res = await GET(makeRequest() as any);
    const json = await res.json();
    if (json.coupons.length > 0) {
      const coupon = json.coupons[0];
      expect(coupon.id).toBeDefined();
      expect(coupon.name).toBeDefined();
      expect(coupon.description).toBeDefined();
      expect(coupon.discount_type).toBeDefined();
    }
  });

  test('rate limit params (30 req/min per IP)', () => {
    (checkRateLimit as jest.Mock).mockClear();
    GET(makeRequest('valid-token', '192.168.1.1') as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(30);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('liff-coupons');
  });

  test('extracts last (trusted) IP from x-forwarded-for', () => {
    (checkRateLimit as jest.Mock).mockClear();
    GET(makeRequest('valid-token', '10.0.0.1, 192.168.1.1') as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('uses unknown IP when x-forwarded-for missing', () => {
    (checkRateLimit as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/liff/coupons', {
      headers: { Authorization: 'Bearer valid-token' },
    });
    GET(req as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('pastBookings が null → ?? [] フォールバック', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: { id: 'user-123' } }),
              }),
            }),
          };
        }
        if (table === 'bookings') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                in: jest.fn().mockResolvedValue({ data: null }),
              }),
            }),
          };
        }
        if (table === 'favorites') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: null }),
            }),
          };
        }
        return {};
      }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.coupons).toEqual([]);
  });

  test('予期しない例外 → 500（catch ブロック・Slack 通知）', async () => {
    const { alertCaughtError } = require('@/lib/alert');
    (verifyLineAccessToken as jest.Mock).mockRejectedValue(new Error('unexpected'));
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Internal Server Error');
    expect(alertCaughtError).toHaveBeenCalledWith('liff-coupons', expect.any(Error), '/api/liff/coupons');
  });

  // 【2026年7月10日 恒久根治の回帰】DB障害時に「クーポンなし」と偽装表示せず、
  // 真の失敗として500を返すことを検証する（error握り潰しの再発防止）。3クエリ全てを検証する。
  test('pastBookings取得: DB障害（error発生）→ 500（クーポンなしと偽装しない）', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'profiles') {
          return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'user-123' } }) }) }) };
        }
        if (table === 'bookings') {
          return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }) }) }) };
        }
        return {};
      }),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });

  test('favorites取得: DB障害（error発生）→ 500（クーポンなしと偽装しない）', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'profiles') {
          return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'user-123' } }) }) }) };
        }
        if (table === 'bookings') {
          return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ data: [], error: null }) }) }) };
        }
        if (table === 'favorites') {
          return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }) }) };
        }
        return {};
      }),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });

  test('coupons取得: DB障害（error発生）→ 500（クーポンなしと偽装しない）', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'profiles') {
          return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'user-123' } }) }) }) };
        }
        if (table === 'bookings') {
          return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ in: jest.fn().mockResolvedValue({ data: [{ facility_id: 'fac-1' }], error: null }) }) }) };
        }
        if (table === 'favorites') {
          return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockResolvedValue({ data: [], error: null }) }) };
        }
        if (table === 'coupons') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                in: jest.fn().mockReturnValue({
                  or: jest.fn().mockReturnValue({
                    or: jest.fn().mockReturnValue({
                      order: jest.fn().mockReturnValue({
                        limit: jest.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });

  test('coupons が null → ?? [] フォールバック', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({ data: { id: 'user-123' } }),
              }),
            }),
          };
        }
        if (table === 'bookings') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                in: jest.fn().mockResolvedValue({ data: [{ facility_id: 'fac-1' }] }),
              }),
            }),
          };
        }
        if (table === 'favorites') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: [] }),
            }),
          };
        }
        if (table === 'coupons') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                in: jest.fn().mockReturnValue({
                  or: jest.fn().mockReturnValue({
                    or: jest.fn().mockReturnValue({
                      order: jest.fn().mockReturnValue({
                        limit: jest.fn().mockResolvedValue({ data: null }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.coupons).toEqual([]);
  });
});
