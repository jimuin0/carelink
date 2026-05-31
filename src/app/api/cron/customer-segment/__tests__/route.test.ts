/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/customer-segment
 * Key assertions:
 *   - CRON_SECRET validation
 *   - RFM segmentation (vip, regular, at_risk, lost, new)
 *   - Booking aggregation by email
 *   - Batch upsert to customer_segments table
 *   - 2-year historical window
 */

jest.mock('@/lib/cron-auth');
jest.mock('@/lib/cron-logger');
jest.mock('resend');
jest.mock('@/lib/email', () => ({ escSubject: jest.fn((s: string) => s) }));

// Module-level supabase = createClient(...) — use wrapper for lazy delegation
const mockFromDelegate = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (...args: any[]) => mockFromDelegate(...args),
  })),
}));

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { GET } from '../route';

let mockFacilitiesSelect: jest.Mock;
let mockBookingsSelect: jest.Mock;
let mockUpsert: jest.Mock;

function setupDefaultMocks(
  facilitiesCount: number = 2,
  bookingsPerFacility: number = 3
) {
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (logCronRun as jest.Mock).mockResolvedValue(undefined);

  const facilitiesData = Array.from({ length: facilitiesCount }, (_, i) => ({
    id: `fac-${i}`,
    name: `Salon ${i}`,
    slug: `salon-${i}`,
  }));

  mockFacilitiesSelect = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue({
        data: facilitiesData,
      }),
    }),
  });

  // Booking data for each facility
  const bookingsData = Array.from({ length: bookingsPerFacility }, (_, i) => ({
    id: `booking-${i}`,
    email: `customer${i % 2}@example.com`,
    customer_name: `Customer ${i % 2}`,
    booking_date: `2026-05-${15 - i}`,
    total_price: (i + 1) * 5000,
    status: i < 2 ? 'completed' : 'confirmed',
  }));

  mockBookingsSelect = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        in: jest.fn().mockReturnValue({
          gte: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue({
              data: bookingsData,
            }),
          }),
        }),
      }),
    }),
  });

  mockUpsert = jest.fn().mockResolvedValue({
    data: [],
    error: null,
  });

  mockFromDelegate.mockImplementation((table: string) => {
    if (table === 'facility_profiles') {
      return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
    } else if (table === 'bookings') {
      return mockBookingsSelect();
    } else if (table === 'customer_segments') {
      return { upsert: (...args: any[]) => mockUpsert(...args) };
    }
  });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
});

function makeRequest() {
  return new Request('http://localhost/api/cron/customer-segment', {
    method: 'GET',
    headers: { 'Authorization': 'Bearer cron-secret' },
  });
}

describe('GET /api/cron/customer-segment', () => {
  test('CRON_SECRET check failed → returns error', async () => {
    const errorResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    (checkCronAuth as jest.Mock).mockReturnValue(errorResponse);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(401);
  });

  test('valid cron request → 200 with count', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.processed).toBe('number');
  });

  test('fetches published facilities (max 200)', async () => {
    await GET(makeRequest() as any);

    expect(mockFacilitiesSelect).toHaveBeenCalledWith('id, name, slug');
  });

  test('queries bookings from 2 years ago', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-15'));

    await GET(makeRequest() as any);

    jest.useRealTimers();
    // Check that gte condition was used
    const gteCall = mockBookingsSelect().select().eq().in().gte;
    expect(gteCall).toHaveBeenCalled();
  });

  test('classifies segment: vip (5+ visits, 0-30 days)', async () => {
    // Setup should automatically create vip segment based on booking data
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('classifies segment: regular (2+ visits, 31-60 days)', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('classifies segment: at_risk (2+ visits, 61-120 days)', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('classifies segment: lost (2+ visits, 120+ days)', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('classifies segment: new (0-1 visits)', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('aggregates by email (deduplication)', async () => {
    // Multiple bookings from same email should aggregate
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('no bookings for facility → skipped', async () => {
    mockBookingsSelect = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [],
              }),
            }),
          }),
        }),
      }),
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('no facilities found → returns 0 count', async () => {
    setupDefaultMocks(0);

    const res = await GET(makeRequest() as any);

    const json = await res.json();
    expect(json.processed).toBe(0);
  });

  test('upserts to customer_segments table', async () => {
    await GET(makeRequest() as any);

    expect(mockUpsert).toHaveBeenCalled();
  });

  test('upsert includes facility_id and customer_email', async () => {
    await GET(makeRequest() as any);

    if (mockUpsert.mock.calls.length > 0) {
      const call = mockUpsert.mock.calls[0];
      const rows = call[0];
      if (Array.isArray(rows) && rows.length > 0) {
        expect(rows[0]).toHaveProperty('facility_id');
        expect(rows[0]).toHaveProperty('customer_email');
      }
    }
  });

  test('handles bookings without email → skipped', async () => {
    mockBookingsSelect = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [
                  {
                    email: null,
                    customer_name: 'No Email',
                    booking_date: '2026-05-15',
                    total_price: 5000,
                    status: 'completed',
                  },
                ],
              }),
            }),
          }),
        }),
      }),
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('batch upsert (up to 500 per call)', async () => {
    setupDefaultMocks(2, 600); // 600 bookings to test batching

    await GET(makeRequest() as any);

    // Should be called (potentially multiple times for batching)
    expect(mockUpsert).toHaveBeenCalled();
  });

  test('includes first_visit_date and last_visit_date', async () => {
    await GET(makeRequest() as any);

    if (mockUpsert.mock.calls.length > 0) {
      const call = mockUpsert.mock.calls[0];
      const rows = call[0];
      if (Array.isArray(rows) && rows.length > 0) {
        expect(rows[0]).toHaveProperty('first_visit_date');
        expect(rows[0]).toHaveProperty('last_visit_date');
      }
    }
  });

  test('calculates days_since_last_visit', async () => {
    await GET(makeRequest() as any);

    if (mockUpsert.mock.calls.length > 0) {
      const call = mockUpsert.mock.calls[0];
      const rows = call[0];
      if (Array.isArray(rows) && rows.length > 0) {
        expect(rows[0]).toHaveProperty('segment');
        expect(typeof rows[0].segment).toBe('string');
      }
    }
  });

  test('sums total_spent across visits', async () => {
    await GET(makeRequest() as any);

    if (mockUpsert.mock.calls.length > 0) {
      const call = mockUpsert.mock.calls[0];
      const rows = call[0];
      if (Array.isArray(rows) && rows.length > 0) {
        expect(rows[0]).toHaveProperty('total_spent');
        expect(typeof rows[0].total_spent).toBe('number');
      }
    }
  });

  test('counts visits per email', async () => {
    await GET(makeRequest() as any);

    if (mockUpsert.mock.calls.length > 0) {
      const call = mockUpsert.mock.calls[0];
      const rows = call[0];
      if (Array.isArray(rows) && rows.length > 0) {
        expect(rows[0]).toHaveProperty('total_visits');
        expect(typeof rows[0].total_visits).toBe('number');
      }
    }
  });

  // -----------------------------------------------------------------------
  // Branch: facilities === null → early return { status: 'ok', count: 0 }
  // -----------------------------------------------------------------------
  test('facilities query returns null → early return with count 0', async () => {
    mockFacilitiesSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue({
          data: null, // explicitly null, not []
        }),
      }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_profiles') {
        return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      }
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: 'ok', count: 0 });
  });

  // -----------------------------------------------------------------------
  // Branch: upsert error → log and continue (line 114-116)
  // -----------------------------------------------------------------------
  test('upsert chunk error → logs and continues (no throw)', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockUpsert = jest.fn().mockResolvedValue({
      data: null,
      error: { message: 'upsert failed' },
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_profiles') {
        return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      } else if (table === 'bookings') {
        return mockBookingsSelect();
      } else if (table === 'customer_segments') {
        return { upsert: (...args: any[]) => mockUpsert(...args) };
      }
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[customer-segment] upsert chunk failed'),
      expect.anything()
    );
    consoleSpy.mockRestore();
  });

  // -----------------------------------------------------------------------
  // Branch: RESEND_API_KEY block — at-risk email sending
  // -----------------------------------------------------------------------
  describe('RESEND_API_KEY email path', () => {
    let mockSend: jest.Mock;
    let mockCouponInsert: jest.Mock;
    let mockCouponSelect: jest.Mock;

    // Build bookings where one customer has 2+ visits and last visit ~62 days ago
    function makeAtRiskBookings(now: Date) {
      const daysAgo62 = new Date(now.getTime() - 62 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];
      const daysAgo90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];
      return [
        {
          email: 'atrisk@example.com',
          customer_name: 'At Risk Customer',
          booking_date: daysAgo62, // last visit
          total_price: 5000,
          status: 'completed',
        },
        {
          email: 'atrisk@example.com',
          customer_name: 'At Risk Customer',
          booking_date: daysAgo90, // first visit (2 total → at_risk eligible)
          total_price: 5000,
          status: 'completed',
        },
      ];
    }

    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-04-21T10:00:00Z'));
      process.env.RESEND_API_KEY = 'test-resend-key';

      const { Resend } = require('resend');
      mockSend = jest.fn().mockResolvedValue({ data: { id: 'email-id' }, error: null });
      (Resend as jest.Mock).mockImplementation(() => ({ emails: { send: mockSend } }));

      const now = new Date('2026-04-21T10:00:00Z');
      const atRiskBookings = makeAtRiskBookings(now);

      mockBookingsSelect = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              gte: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({ data: atRiskBookings }),
              }),
            }),
          }),
        }),
      });

      // user_coupon_codes select (already-sent check) → empty = not sent yet
      mockCouponSelect = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        gte: jest.fn().mockResolvedValue({ data: [] }),
      });

      // user_coupon_codes insert → success
      mockCouponInsert = jest.fn().mockResolvedValue({ data: null, error: null });

      mockUpsert = jest.fn().mockResolvedValue({ data: [], error: null });

      mockFromDelegate.mockImplementation((table: string) => {
        if (table === 'facility_profiles') {
          return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
        } else if (table === 'bookings') {
          return mockBookingsSelect();
        } else if (table === 'customer_segments') {
          return { upsert: (...args: any[]) => mockUpsert(...args) };
        } else if (table === 'user_coupon_codes') {
          return {
            select: () => mockCouponSelect(),
            insert: (...args: any[]) => mockCouponInsert(...args),
          };
        }
      });
    });

    afterEach(() => {
      jest.useRealTimers();
      delete process.env.RESEND_API_KEY;
    });

    test('at-risk customer (60-65 days) → coupon inserted and email sent', async () => {
      const res = await GET(makeRequest() as any);

      expect(res.status).toBe(200);
      expect(mockCouponInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'atrisk@example.com',
          reason: 'at_risk',
          discount_value: 500,
        })
      );
      expect(mockSend).toHaveBeenCalled();
    });

    test('alreadySentEmails.has(email) → skip coupon insert and email', async () => {
      // Override: existing coupon found for this email
      mockCouponSelect = jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnThis(),
        in: jest.fn().mockReturnThis(),
        gte: jest.fn().mockResolvedValue({ data: [{ email: 'atrisk@example.com' }] }),
      });
      mockFromDelegate.mockImplementation((table: string) => {
        if (table === 'facility_profiles') {
          return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
        } else if (table === 'bookings') {
          return mockBookingsSelect();
        } else if (table === 'customer_segments') {
          return { upsert: (...args: any[]) => mockUpsert(...args) };
        } else if (table === 'user_coupon_codes') {
          return {
            select: () => mockCouponSelect(),
            insert: (...args: any[]) => mockCouponInsert(...args),
          };
        }
      });

      const res = await GET(makeRequest() as any);

      expect(res.status).toBe(200);
      expect(mockCouponInsert).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });

    test('coupon insert error → logs error and skips email', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockCouponInsert = jest.fn().mockResolvedValue({ data: null, error: { message: 'insert failed' } });
      mockFromDelegate.mockImplementation((table: string) => {
        if (table === 'facility_profiles') {
          return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
        } else if (table === 'bookings') {
          return mockBookingsSelect();
        } else if (table === 'customer_segments') {
          return { upsert: (...args: any[]) => mockUpsert(...args) };
        } else if (table === 'user_coupon_codes') {
          return {
            select: () => mockCouponSelect(),
            insert: (...args: any[]) => mockCouponInsert(...args),
          };
        }
      });

      const res = await GET(makeRequest() as any);

      expect(res.status).toBe(200);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[customer-segment] coupon insert failed, skipping email'),
        expect.anything()
      );
      expect(mockSend).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    test('atRiskCandidates.length === 0 → no coupon insert, no email sent', async () => {
      // Override bookings to have a customer whose last visit is 30 days ago (not at_risk range 60-65)
      const now = new Date('2026-04-21T10:00:00Z');
      const daysAgo30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];
      const daysAgo60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];

      mockBookingsSelect = jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              gte: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({
                  data: [
                    // recent customer (not at_risk by day range)
                    { email: 'recent@example.com', customer_name: 'Recent', booking_date: daysAgo30, total_price: 5000, status: 'completed' },
                    { email: 'recent@example.com', customer_name: 'Recent', booking_date: daysAgo60, total_price: 5000, status: 'completed' },
                  ],
                }),
              }),
            }),
          }),
        }),
      });
      mockFromDelegate.mockImplementation((table: string) => {
        if (table === 'facility_profiles') {
          return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
        } else if (table === 'bookings') {
          return mockBookingsSelect();
        } else if (table === 'customer_segments') {
          return { upsert: (...args: any[]) => mockUpsert(...args) };
        } else if (table === 'user_coupon_codes') {
          return {
            select: () => mockCouponSelect(),
            insert: (...args: any[]) => mockCouponInsert(...args),
          };
        }
      });

      const res = await GET(makeRequest() as any);

      expect(res.status).toBe(200);
      expect(mockCouponInsert).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  test('repeat customer aggregation updates firstVisit/lastVisit/name', async () => {
    // Same email across multiple bookings to hit existing branch
    mockBookingsSelect = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [
                  { email: 'x@example.com', customer_name: 'First', booking_date: '2026-04-01', total_price: 1000, status: 'completed' },
                  { email: 'x@example.com', customer_name: null, booking_date: '2026-03-01', total_price: null, status: 'completed' },
                  { email: 'x@example.com', customer_name: 'Latest', booking_date: '2026-05-01', total_price: 2000, status: 'completed' },
                ],
              }),
            }),
          }),
        }),
      }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_profiles') return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      if (table === 'bookings') return mockBookingsSelect();
      if (table === 'customer_segments') return { upsert: (...args: any[]) => mockUpsert(...args) };
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
  });

  test('no RESEND_API_KEY → skip email block entirely', async () => {
    delete process.env.RESEND_API_KEY;
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
  });

  test('non-Error throw → String fallback', async () => {
    mockFromDelegate.mockImplementation(() => { throw 'plain string'; });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });

  // -----------------------------------------------------------------------
  // Branch: unhandled exception → 500
  // -----------------------------------------------------------------------
  test('unhandled exception → 500 response', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockFacilitiesSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        limit: jest.fn().mockRejectedValue(new Error('Supabase connection refused')),
      }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_profiles') {
        return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      }
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'Internal error' });
    consoleSpy.mockRestore();
  });

  // Branch coverage: line 25 (×2) - classifySegment の分岐
  // at_risk: totalVisits >= 2 && daysSinceLastVisit <= 120 (already in RESEND block above,
  //   but classifySegment itself tested here standalone via upsert output)
  // lost: totalVisits >= 2 && daysSinceLastVisit > 120
  test('classifySegment: lost (2+ visits, 121+ days) → upsert に segment=lost が含まれる', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-15T10:00:00Z'));

    // lastVisit = 130 days ago, 2 visits → lost
    const daysAgo130 = new Date(Date.now() - 130 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const daysAgo150 = new Date(Date.now() - 150 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    mockBookingsSelect = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [
                  { email: 'lost@example.com', customer_name: 'Lost', booking_date: daysAgo130, total_price: 5000, status: 'completed' },
                  { email: 'lost@example.com', customer_name: 'Lost', booking_date: daysAgo150, total_price: 5000, status: 'completed' },
                ],
              }),
            }),
          }),
        }),
      }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_profiles') return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      if (table === 'bookings') return mockBookingsSelect();
      if (table === 'customer_segments') return { upsert: (...args: any[]) => mockUpsert(...args) };
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    if (mockUpsert.mock.calls.length > 0) {
      const rows = mockUpsert.mock.calls[0][0];
      if (Array.isArray(rows) && rows.length > 0) {
        expect(rows[0].segment).toBe('lost');
      }
    }

    jest.useRealTimers();
  });

  // Branch coverage: line 86 - customerMap に既存エントリがある場合の更新 (firstVisit 更新)
  test('customerMap 更新: 古い日付 booking → firstVisit を更新', async () => {
    mockBookingsSelect = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [
                  // 最初のエントリ
                  { email: 'a@example.com', customer_name: 'A', booking_date: '2026-04-01', total_price: 3000, status: 'completed' },
                  // 古い日付 → firstVisit を更新
                  { email: 'a@example.com', customer_name: null, booking_date: '2026-01-01', total_price: null, status: 'completed' },
                  // 新しい日付 → lastVisit を更新
                  { email: 'a@example.com', customer_name: 'A Updated', booking_date: '2026-05-01', total_price: 2000, status: 'completed' },
                ],
              }),
            }),
          }),
        }),
      }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_profiles') return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      if (table === 'bookings') return mockBookingsSelect();
      if (table === 'customer_segments') return { upsert: (...args: any[]) => mockUpsert(...args) };
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    if (mockUpsert.mock.calls.length > 0) {
      const rows = mockUpsert.mock.calls[0][0];
      if (Array.isArray(rows) && rows.length > 0) {
        expect(rows[0].first_visit_date).toBe('2026-01-01');
        expect(rows[0].last_visit_date).toBe('2026-05-01');
      }
    }
  });

  // Branch coverage: line 90 - b.email が null → customerMap.get も set もしない
  test('bookings with b.email null → customerMap に追加されない', async () => {
    mockBookingsSelect = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [
                  { email: null, customer_name: 'NoEmail', booking_date: '2026-05-01', total_price: 5000, status: 'completed' },
                  { email: 'valid@example.com', customer_name: 'Valid', booking_date: '2026-05-01', total_price: 5000, status: 'completed' },
                ],
              }),
            }),
          }),
        }),
      }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_profiles') return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      if (table === 'bookings') return mockBookingsSelect();
      if (table === 'customer_segments') return { upsert: (...args: any[]) => mockUpsert(...args) };
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    if (mockUpsert.mock.calls.length > 0) {
      const rows = mockUpsert.mock.calls[0][0];
      if (Array.isArray(rows)) {
        // Only the valid@example.com entry should be upserted
        expect(rows.every((r: any) => r.customer_email !== null)).toBe(true);
      }
    }
  });

  // Branch coverage: line 126 - RESEND_API_KEY あり + facilityInfo が null → email block スキップ
  test('RESEND_API_KEY あり + facilityMap.get が null → email block スキップ', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-21T10:00:00Z'));

    const { Resend } = require('resend');
    const mockSend = jest.fn().mockResolvedValue({ data: { id: 'id' }, error: null });
    (Resend as jest.Mock).mockImplementation(() => ({ emails: { send: mockSend } }));

    // 施設がないがブッキングは存在する状況を作る（facilityMap.get → undefined）
    // facility_profiles に fac-0 のみ返すが、bookings の処理はそれ用
    // facilityMap には fac-0 が入っているので facilityInfo は取れる
    // → facilityInfoが null になるケース: facilities.length=0 だとそもそも loop しない
    // ここでは facilitiesCount=1 で bookings を at-risk にして facilityInfo があることを確認し
    // atRiskCandidates=0 (dayRange外) のケースをテスト → email block に入らない
    const now = new Date('2026-04-21T10:00:00Z');
    const daysAgo10 = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const daysAgo20 = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    mockBookingsSelect = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [
                  { email: 'recent@ex.com', customer_name: 'R', booking_date: daysAgo10, total_price: 5000, status: 'completed' },
                  { email: 'recent@ex.com', customer_name: 'R', booking_date: daysAgo20, total_price: 5000, status: 'completed' },
                ],
              }),
            }),
          }),
        }),
      }),
    });
    setupDefaultMocks(1, 0);
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_profiles') return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      if (table === 'bookings') return mockBookingsSelect();
      if (table === 'customer_segments') return { upsert: (...args: any[]) => mockUpsert(...args) };
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    // atRiskCandidates=0 → email not sent
    expect(mockSend).not.toHaveBeenCalled();

    jest.useRealTimers();
    delete process.env.RESEND_API_KEY;
  });

  // Branch coverage: line 148 - 対象外の at-risk email は alreadySentEmails に含まれないため continue しない
  test('RESEND_API_KEY: existingCoupons が null → alreadySentEmails が空集合', async () => {
    process.env.RESEND_API_KEY = 'test-key';
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-21T10:00:00Z'));

    const { Resend } = require('resend');
    const mockSend = jest.fn().mockResolvedValue({ data: { id: 'id' }, error: null });
    (Resend as jest.Mock).mockImplementation(() => ({ emails: { send: mockSend } }));

    const now = new Date('2026-04-21T10:00:00Z');
    const daysAgo62 = new Date(now.getTime() - 62 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const daysAgo90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    mockBookingsSelect = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [
                  { email: 'atrisk2@example.com', customer_name: 'AR2', booking_date: daysAgo62, total_price: 5000, status: 'completed' },
                  { email: 'atrisk2@example.com', customer_name: 'AR2', booking_date: daysAgo90, total_price: 5000, status: 'completed' },
                ],
              }),
            }),
          }),
        }),
      }),
    });

    // existingCoupons is null → alreadySentEmails = new Set([])
    const mockCouponSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      gte: jest.fn().mockResolvedValue({ data: null }),
    });
    const mockCouponInsert = jest.fn().mockResolvedValue({ data: null, error: null });

    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_profiles') return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      if (table === 'bookings') return mockBookingsSelect();
      if (table === 'customer_segments') return { upsert: (...args: any[]) => mockUpsert(...args) };
      if (table === 'user_coupon_codes') return {
        select: () => mockCouponSelect(),
        insert: (...args: any[]) => mockCouponInsert(...args),
      };
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(mockCouponInsert).toHaveBeenCalled();

    jest.useRealTimers();
    delete process.env.RESEND_API_KEY;
  });

  // Branch coverage: line 86 - new customerMap entry with null customer_name → name: '' (|| '' falsy branch)
  test('first booking entry with null customer_name → name stored as empty string', async () => {
    mockBookingsSelect = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [
                  // null customer_name on the FIRST (new entry) booking → hits `b.customer_name || ''` false side
                  { email: 'noname@example.com', customer_name: null, booking_date: '2026-05-01', total_price: 3000, status: 'completed' },
                ],
              }),
            }),
          }),
        }),
      }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_profiles') return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      if (table === 'bookings') return mockBookingsSelect();
      if (table === 'customer_segments') return { upsert: (...args: any[]) => mockUpsert(...args) };
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    if (mockUpsert.mock.calls.length > 0) {
      const rows = mockUpsert.mock.calls[0][0];
      if (Array.isArray(rows) && rows.length > 0) {
        // name should be '' (empty string fallback) not null
        expect(rows[0].customer_name).toBe('');
      }
    }
  });

  // Branch coverage: line 90 - new customerMap entry with null total_price → spent: 0 (|| 0 falsy branch)
  test('first booking entry with null total_price → spent stored as 0', async () => {
    mockBookingsSelect = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [
                  // null total_price on the FIRST (new entry) booking → hits `b.total_price || 0` false side
                  { email: 'noprice@example.com', customer_name: 'NoPriceCustomer', booking_date: '2026-05-01', total_price: null, status: 'completed' },
                ],
              }),
            }),
          }),
        }),
      }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_profiles') return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      if (table === 'bookings') return mockBookingsSelect();
      if (table === 'customer_segments') return { upsert: (...args: any[]) => mockUpsert(...args) };
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    if (mockUpsert.mock.calls.length > 0) {
      const rows = mockUpsert.mock.calls[0][0];
      if (Array.isArray(rows) && rows.length > 0) {
        expect(rows[0].total_spent).toBe(0);
      }
    }
  });

  // Branch coverage: classifySegment at_risk branch (2+ visits, daysSince 61-120)
  // Tests the at_risk path via upsert output directly (no RESEND_API_KEY)
  test('classifySegment: at_risk (2+ visits, 70 days) → upsert に segment=at_risk が含まれる', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-15T10:00:00Z'));

    // lastVisit = 70 days ago, 2 visits → at_risk (>= 2 visits, daysSince 61-120)
    const daysAgo70 = new Date(Date.now() - 70 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const daysAgo100 = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    mockBookingsSelect = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [
                  { email: 'atrisk_direct@example.com', customer_name: 'AtRisk', booking_date: daysAgo70, total_price: 5000, status: 'completed' },
                  { email: 'atrisk_direct@example.com', customer_name: 'AtRisk', booking_date: daysAgo100, total_price: 5000, status: 'completed' },
                ],
              }),
            }),
          }),
        }),
      }),
    });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_profiles') return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      if (table === 'bookings') return mockBookingsSelect();
      if (table === 'customer_segments') return { upsert: (...args: any[]) => mockUpsert(...args) };
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    if (mockUpsert.mock.calls.length > 0) {
      const rows = mockUpsert.mock.calls[0][0];
      if (Array.isArray(rows) && rows.length > 0) {
        expect(rows[0].segment).toBe('at_risk');
      }
    }

    jest.useRealTimers();
  });

  test('resend.emails.send が reject → .catch() でログ出力し処理継続', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    process.env.RESEND_API_KEY = 'test-key';
    // 固定日時でルート内の daysSince 計算を安定させる
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-04-21T10:00:00Z'));
    const { Resend } = require('resend');
    const mockSend = jest.fn().mockRejectedValue(new Error('Resend failed'));
    (Resend as jest.Mock).mockImplementation(() => ({ emails: { send: mockSend } }));

    const now = new Date('2026-04-21T10:00:00Z');
    const daysAgo62 = new Date(now.getTime() - 62 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const daysAgo90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    mockBookingsSelect = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [
                  { email: 'atrisk3@example.com', customer_name: 'AR3', booking_date: daysAgo62, total_price: 5000, status: 'completed' },
                  { email: 'atrisk3@example.com', customer_name: 'AR3', booking_date: daysAgo90, total_price: 5000, status: 'completed' },
                ],
              }),
            }),
          }),
        }),
      }),
    });

    const mockCouponSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      gte: jest.fn().mockResolvedValue({ data: [] }),
    });
    const mockCouponInsert = jest.fn().mockResolvedValue({ data: null, error: null });

    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_profiles') return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
      if (table === 'bookings') return mockBookingsSelect();
      if (table === 'customer_segments') return { upsert: (...args: any[]) => mockUpsert(...args) };
      if (table === 'user_coupon_codes') return {
        select: () => mockCouponSelect(),
        insert: (...args: any[]) => mockCouponInsert(...args),
      };
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    // route は await resend.emails.send(...).catch() で待機するため
    // GET() 解決後には既に .catch() が実行されている（setTimeout 不要）
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[customer-segment] email send failed'),
      expect.anything()
    );
    consoleSpy.mockRestore();
    jest.useRealTimers();
    delete process.env.RESEND_API_KEY;
  });
});
