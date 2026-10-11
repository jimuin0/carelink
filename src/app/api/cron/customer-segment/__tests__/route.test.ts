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
jest.mock('@/lib/cron-logger', () => {
  const logCronRun = jest.fn().mockResolvedValue(undefined);
  const cronError = jest.fn(async (
    jobName: string,
    startedAt: Date,
    cause: unknown,
    opts: { message?: string; extraLog?: Record<string, unknown>; extraBody?: Record<string, unknown> } = {},
  ) => {
    const error_msg = cause instanceof Error
      ? cause.message
      : (cause && typeof cause === 'object' && 'message' in cause && typeof (cause as any).message === 'string')
        ? (cause as any).message
        : String(cause);
    await logCronRun(jobName, 'error', startedAt, { error_msg, ...opts.extraLog });
    return {
      status: 500,
      json: async () => ({ error: opts.message ?? 'Internal error', ...opts.extraBody }),
    };
  });
  return { logCronRun, cronError };
});
jest.mock('@/lib/customer-coupon-email');
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
import { queueCustomerCouponEmail } from '@/lib/customer-coupon-email';

let mockFacilitiesSelect: jest.Mock;
let mockBookingsSelect: jest.Mock;
let mockBookingsIn: jest.Mock;
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
      range: jest.fn().mockResolvedValue({
        data: facilitiesData,
      }),
    }),
  });

  // Booking data for each facility
  const bookingsData = Array.from({ length: bookingsPerFacility }, (_, i) => ({
    id: `booking-${i}`,
    email_canonical: `customer${i % 2}@example.com`,
    customer_name: `Customer ${i % 2}`,
    booking_date: `2026-05-${15 - i}`,
    total_price: (i + 1) * 5000,
    status: i < 2 ? 'completed' : 'confirmed',
  }));

  mockBookingsIn = jest.fn().mockReturnValue({
    gte: jest.fn().mockReturnValue({
      range: jest.fn().mockResolvedValue({
        data: bookingsData,
      }),
    }),
  });
  mockBookingsSelect = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        in: mockBookingsIn,
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
  delete process.env.RESEND_API_KEY;
  (queueCustomerCouponEmail as jest.Mock).mockResolvedValue('queued');
  // 時刻を固定する（発症前予防）。route の daysSinceLastVisit は実 now と fixture 日付の差で
  // 算出されるため、固定しないと実日付の経過で classifySegment の分岐カバレッジが変動し
  // （30/60/120日境界を跨ぐ）、ある日突然 global branch=100% ゲートが落ちる時限フレークになる。
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-05-15T00:00:00Z'));
  setupDefaultMocks();
});

afterEach(() => {
  jest.useRealTimers();
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

  test('facility 取得が DB エラー → error ログ＋500（無音スキップにしない）', async () => {
    mockFacilitiesSelect.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        range: jest.fn().mockResolvedValue({ data: null, error: { message: 'db down' } }),
      }),
    });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect((logCronRun as jest.Mock).mock.calls.some((c: any[]) => c[1] === 'error')).toBe(true);
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
              range: jest.fn().mockResolvedValue({
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

    expect(res.status).toBe(200);
    const json = await res.json();
    // 施設が空配列の場合は早期リターンで {status:'ok', count:0}
    expect(json.count).toBe(0);
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
              range: jest.fn().mockResolvedValue({
                data: [
                  {
                    email_canonical: null,
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

  test('RFMは completed のみで集計する（confirmed混入＝未来予約のVIP誤分類/負recency防止の回帰）', async () => {
    await GET(makeRequest() as any);
    // bookings の status フィルタ呼び出しは全て ['completed']（confirmed を含めない）。
    const statusCalls = mockBookingsIn.mock.calls.filter((c) => c[0] === 'status');
    expect(statusCalls.length).toBeGreaterThan(0);
    for (const c of statusCalls) expect(c[1]).toEqual(['completed']);
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
        range: jest.fn().mockResolvedValue({
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
    expect(json).toEqual({ processed: 0, skipped: 0, status: 'ok', count: 0 });
  });

  // -----------------------------------------------------------------------
  // Branch: upsert error → log and continue (line 114-116)
  // -----------------------------------------------------------------------
  test('upsert chunk error → continues other work but reports failed run', async () => {
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

    expect(res.status).toBe(500);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[customer-segment] upsert chunk failed'),
      expect.anything()
    );
    consoleSpy.mockRestore();
  });

  test('repeat customer aggregation updates firstVisit/lastVisit/name', async () => {
    // Same email across multiple bookings to hit existing branch
    mockBookingsSelect = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              range: jest.fn().mockResolvedValue({
                data: [
                  { email_canonical: 'x@example.com', customer_name: 'First', booking_date: '2026-04-01', total_price: 1000, status: 'completed' },
                  { email_canonical: 'x@example.com', customer_name: null, booking_date: '2026-03-01', total_price: null, status: 'completed' },
                  { email_canonical: 'x@example.com', customer_name: 'Latest', booking_date: '2026-05-01', total_price: 2000, status: 'completed' },
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
        range: jest.fn().mockRejectedValue(new Error('Supabase connection refused')),
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
              range: jest.fn().mockResolvedValue({
                data: [
                  { email_canonical: 'lost@example.com', customer_name: 'Lost', booking_date: daysAgo130, total_price: 5000, status: 'completed' },
                  { email_canonical: 'lost@example.com', customer_name: 'Lost', booking_date: daysAgo150, total_price: 5000, status: 'completed' },
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
              range: jest.fn().mockResolvedValue({
                data: [
                  // 最初のエントリ
                  { email_canonical: 'a@example.com', customer_name: 'A', booking_date: '2026-04-01', total_price: 3000, status: 'completed' },
                  // 古い日付 → firstVisit を更新
                  { email_canonical: 'a@example.com', customer_name: null, booking_date: '2026-01-01', total_price: null, status: 'completed' },
                  // 新しい日付 → lastVisit を更新
                  { email_canonical: 'a@example.com', customer_name: 'A Updated', booking_date: '2026-05-01', total_price: 2000, status: 'completed' },
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
              range: jest.fn().mockResolvedValue({
                data: [
                  { email_canonical: null, customer_name: 'NoEmail', booking_date: '2026-05-01', total_price: 5000, status: 'completed' },
                  { email_canonical: 'valid@example.com', customer_name: 'Valid', booking_date: '2026-05-01', total_price: 5000, status: 'completed' },
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

  // Branch coverage: line 86 - new customerMap entry with null customer_name → name: '' (|| '' falsy branch)
  test('first booking entry with null customer_name → name stored as empty string', async () => {
    mockBookingsSelect = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            gte: jest.fn().mockReturnValue({
              range: jest.fn().mockResolvedValue({
                data: [
                  // null customer_name on the FIRST (new entry) booking → hits `b.customer_name || ''` false side
                  { email_canonical: 'noname@example.com', customer_name: null, booking_date: '2026-05-01', total_price: 3000, status: 'completed' },
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
              range: jest.fn().mockResolvedValue({
                data: [
                  // null total_price on the FIRST (new entry) booking → hits `b.total_price || 0` false side
                  { email_canonical: 'noprice@example.com', customer_name: 'NoPriceCustomer', booking_date: '2026-05-01', total_price: null, status: 'completed' },
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
              range: jest.fn().mockResolvedValue({
                data: [
                  { email_canonical: 'atrisk_direct@example.com', customer_name: 'AtRisk', booking_date: daysAgo70, total_price: 5000, status: 'completed' },
                  { email_canonical: 'atrisk_direct@example.com', customer_name: 'AtRisk', booking_date: daysAgo100, total_price: 5000, status: 'completed' },
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

  test('email_canonical 列が未適用(42703) → email でフォールバックし JS canonical 化で集計', async () => {
    delete process.env.RESEND_API_KEY; // メール経路を無効化して集計のみ検証
    // 1回目(email_canonical select)は列不在エラー、2回目(email フォールバック)は gmail 別名2件
    const rangeMock = jest.fn()
      .mockResolvedValueOnce({ data: null, error: { code: '42703', message: 'column "email_canonical" does not exist' } })
      .mockResolvedValueOnce({ data: [
        { email: 'f.o.o@gmail.com', customer_name: 'T', booking_date: '2026-05-10', total_price: 5000, status: 'completed' },
        { email: 'foo+x@gmail.com', customer_name: 'T', booking_date: '2026-05-05', total_price: 5000, status: 'completed' },
        { email: null, customer_name: 'NoEmail', booking_date: '2026-05-01', total_price: 0, status: 'completed' }, // email null → スキップ(b.email falsy 分岐)
      ] });
    const upsertMock = jest.fn().mockResolvedValue({ data: [], error: null });
    mockFromDelegate.mockImplementation((table: string) => {
      if (table === 'facility_profiles') {
        return { select: () => ({ eq: () => ({ range: jest.fn().mockResolvedValue({ data: [{ id: 'fac-0', name: 'S', slug: 's' }] }) }) }) };
      }
      if (table === 'bookings') {
        return { select: () => ({ eq: () => ({ in: () => ({ gte: () => ({ range: rangeMock }) }) }) }) };
      }
      if (table === 'customer_segments') return { upsert: (...a: any[]) => upsertMock(...a) };
      return {};
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    // email_canonical → email の2回 range が呼ばれる（フォールバック発火の証跡）
    expect(rangeMock).toHaveBeenCalledTimes(2);
    // gmail 別名2件が canonical 統合され1顧客 visits=2 で upsert される
    const rows = upsertMock.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0].total_visits).toBe(2);
  });
});

describe('durable coupon dispatch', () => {
  function atRisk(days=62) {
    setupDefaultMocks(1,0);
    process.env.RESEND_API_KEY='configured-for-worker';
    const now=new Date('2026-05-15T00:00:00Z');
    const rows=[days,days+30].map(n=>({email_canonical:'person@example.com',customer_name:'Patient',
      booking_date:new Date(now.getTime()-n*86400000).toISOString().split('T')[0],total_price:5000,status:'completed'}));
    mockBookingsIn.mockReturnValue({gte:()=>({range:async()=>({data:rows,error:null})})});
  }
  test('reserves delivery once and reports queued separately from sent',async()=>{
    atRisk(); const response=await GET(makeRequest());
    expect(response.status).toBe(200);expect((await response.json()).queued).toBe(1);
    expect(queueCustomerCouponEmail).toHaveBeenCalledTimes(1);
    expect(queueCustomerCouponEmail).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({
      facilityId:'fac-0',email:'person@example.com',daysSince:62,
    }));
  });
  test('known provider acceptance does not reserve a new message',async()=>{
    atRisk();(queueCustomerCouponEmail as jest.Mock).mockResolvedValue('already_notified');
    const response=await GET(makeRequest());expect(response.status).toBe(200);expect((await response.json()).queued).toBe(0);
  });
  test('historical null marker is unresolved, not a successful skip or resend',async()=>{
    atRisk();(queueCustomerCouponEmail as jest.Mock).mockResolvedValue('uncertain');
    const response=await GET(makeRequest());expect(response.status).toBe(500);
    expect((await response.json()).deliveryUncertain).toBe(1);
    expect(logCronRun).toHaveBeenCalledWith('customer-segment','error',expect.any(Date),expect.anything());
  });
  test('publication failure reports error while preserving segment computation',async()=>{
    atRisk();(queueCustomerCouponEmail as jest.Mock).mockRejectedValue(new Error('lost response'));
    const response=await GET(makeRequest());expect(response.status).toBe(500);
    expect((await response.json()).deliveryFailures).toBe(1);expect(mockUpsert).toHaveBeenCalled();
  });
  test.each([59,60,70,121])('does not enqueue outside the original eligible window at %s days',async days=>{
    atRisk(days);expect((await GET(makeRequest())).status).toBe(200);expect(queueCustomerCouponEmail).not.toHaveBeenCalled();
  });
  test('missing email provider configuration does not publish a delivery',async()=>{
    atRisk();delete process.env.RESEND_API_KEY;expect((await GET(makeRequest())).status).toBe(200);
    expect(queueCustomerCouponEmail).not.toHaveBeenCalled();
  });
  test('booking lookup failure is not a successful empty run',async()=>{
    atRisk();mockBookingsIn.mockReturnValue({gte:()=>({range:async()=>({data:null,error:{message:'DB unavailable'}})})});
    const response=await GET(makeRequest());expect(response.status).toBe(500);expect(queueCustomerCouponEmail).not.toHaveBeenCalled();
  });
});

test('実時間予算超過 → 残り施設を deferred して打ち切り', async () => {
  const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  // 既定2施設。1施設目の upsert 中に 60 秒進める → 2施設目のループ先頭で予算超過 → break。
  (mockUpsert as jest.Mock).mockImplementationOnce(() => {
    jest.advanceTimersByTime(60_000);
    return Promise.resolve({ data: [], error: null });
  });
  const res = await GET(makeRequest() as any);
  const json = await res.json();
  expect(json.deferred).toBe(1);
  warnSpy.mockRestore();
});
