/**
 * @jest-environment node
 *
 * Tests for GET /api/liff/bookings
 * Key assertions:
 *   - Rate limiting (30 req/min per IP)
 *   - LINE Bearer token required
 *   - LINE API validation call
 *   - LINE user_id → DB user_id lookup
 *   - Single booking by booking_id (UUID validation, ownership)
 *   - List user's bookings (last 20, ordered desc)
 *   - Error handling
 */

jest.mock('@/lib/rate-limit', () => ({
  inMemoryRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/line', () => ({
  verifyLineAccessToken: jest.fn(() => Promise.resolve({ ok: true, userId: 'line-user-verified' })),
}));
jest.mock('@/lib/supabase-server');

global.fetch = jest.fn();

import { inMemoryRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

// Helper to create chainable mock
function createChainableMock(resolveValue: any) {
  const chainable: any = {
    eq: jest.fn(),
    order: jest.fn(),
    limit: jest.fn(),
    single: jest.fn(),
    select: jest.fn(),
  };

  chainable.eq.mockReturnValue(chainable);
  chainable.order.mockReturnValue(chainable);
  chainable.limit.mockResolvedValue(resolveValue);
  chainable.single.mockResolvedValue(resolveValue);
  chainable.select.mockReturnValue(chainable);

  return chainable;
}

function setupDefaultMocks(
  lineValid: boolean = true,
  profileFound: boolean = true,
  bookingFound: boolean = true,
  isList: boolean = false
) {
  // LINE API mock
  (global.fetch as jest.Mock).mockResolvedValue(
    lineValid
      ? new Response(
          JSON.stringify({ userId: 'line-user-123' }),
          { ok: true, status: 200 }
        )
      : new Response(
          JSON.stringify({ message: 'Invalid access token' }),
          { ok: false, status: 401 }
        )
  );

  // Profile data
  const profileData = profileFound ? { data: { id: 'db-user-123' }, error: null } : { data: null, error: null };

  // Booking data
  const bookingData = isList
    ? {
        data: [
          {
            id: 'booking-1',
            booking_date: '2026-05-10',
            start_time: '10:00',
            end_time: '11:00',
            menu_name: 'Eyelash',
            status: 'confirmed',
            total_price: 5000,
            facility_profiles: { name: 'Salon A' },
          },
        ],
        error: null,
      }
    : bookingFound
    ? {
        data: {
          id: 'booking-123',
          booking_date: '2026-05-05',
          start_time: '10:00',
          end_time: '11:00',
          menu_name: 'Eyelash',
          status: 'confirmed',
          total_price: 5000,
          facility_profiles: { name: 'Test Salon' },
        },
        error: null,
      }
    : { data: null, error: null };

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'profiles') {
        return createChainableMock(profileData);
      } else if (table === 'bookings') {
        return createChainableMock(bookingData);
      }
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (global.fetch as jest.Mock).mockClear();
  setupDefaultMocks();
});

function makeRequest(
  bookingId?: string,
  authToken: string = 'valid-token',
  ip = '192.168.1.1'
) {
  const url = bookingId
    ? `http://localhost/api/liff/bookings?booking_id=${bookingId}`
    : 'http://localhost/api/liff/bookings';

  const req = new Request(url, {
    method: 'GET',
    headers: {
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      'x-forwarded-for': ip,
    },
  });

  // Provide nextUrl for NextRequest compatibility
  Object.defineProperty(req, 'nextUrl', { get: () => new URL(url) });

  return req;
}

const BOOKING_UUID = '11111111-1111-1111-1111-111111111111';

describe('GET /api/liff/bookings', () => {
  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(429);
  });

  test('missing Authorization header → 401', async () => {
    const res = await GET(makeRequest(undefined, '') as any);

    expect(res.status).toBe(401);
  });



  test('user profile not found → 404', async () => {
    setupDefaultMocks(true, false);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(404);
  });




  test('calls LINE API with access token', async () => {
    await GET(makeRequest(undefined, 'test-line-token') as any);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.line.me/v2/profile',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-line-token' },
      })
    );
  });

  test('rate limit params (30 req/min per IP)', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    GET(makeRequest(undefined, 'token', '192.168.1.1') as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('192.168.1.1');
    expect(call[1]).toBe(30);
    expect(call[2]).toBe(60_000);
    expect(call[3]).toBe('liff-bookings');
  });

  test('extracts last (trusted) IP from x-forwarded-for', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    GET(makeRequest(undefined, 'token', '10.0.0.1, 192.168.1.1') as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('192.168.1.1');
  });

  test('uses unknown IP when x-forwarded-for missing', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    const req = new Request('http://localhost/api/liff/bookings', {
      method: 'GET',
      headers: { Authorization: 'Bearer token' },
    });

    GET(req as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('unknown');
  });

  test('invalid LINE token → 401', async () => {
    setupDefaultMocks(false);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  test('no booking_id → returns list of bookings', async () => {
    setupDefaultMocks(true, true, true, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.bookings)).toBe(true);
    expect(json.bookings).toHaveLength(1);
    expect(json.bookings[0].id).toBe('booking-1');
  });

  test('no bookings found → returns empty array', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'profiles') return createChainableMock({ data: { id: 'db-user-123' }, error: null });
        return createChainableMock({ data: null, error: null });
      }),
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bookings).toEqual([]);
  });

  test('booking_id (valid UUID) → returns single booking', async () => {
    const res = await GET(makeRequest(BOOKING_UUID) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.booking).toBeDefined();
    expect(json.booking.id).toBe('booking-123');
  });

  test('booking_id not found → returns booking=null', async () => {
    setupDefaultMocks(true, true, false);

    const res = await GET(makeRequest(BOOKING_UUID) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.booking).toBeNull();
  });

  test('booking_id invalid UUID → 400', async () => {
    const res = await GET(makeRequest('not-a-uuid') as any);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid booking_id');
  });

  test('unexpected error → 500', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network failure'));

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
  });

  // R2 audience検証: 他チャネル発行トークン（client_id不一致）→ 401（!tokenCheck.ok 分岐）
  test('verifyLineAccessToken fails (audience mismatch) → 401', async () => {
    const { verifyLineAccessToken } = require('@/lib/line');
    (verifyLineAccessToken as jest.Mock).mockResolvedValueOnce({ ok: false });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

});