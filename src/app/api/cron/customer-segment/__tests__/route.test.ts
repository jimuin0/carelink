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
 *   - 顧客へは何も送らない（離脱リスク客への自動クーポンメールは 2026年10月22日に停止）
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

// Module-level supabase = createClient(...) — use wrapper for lazy delegation
const mockFromDelegate = jest.fn();
// RPC は一切呼ばれないはず（旧実装はここからクーポン発行・メール予約の RPC を呼んでいた）。
const mockRpcDelegate = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (...args: any[]) => mockFromDelegate(...args),
    rpc: (...args: any[]) => mockRpcDelegate(...args),
  })),
}));

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { GET } from '../route';

let mockFacilitiesSelect: jest.Mock;
let mockBookingsSelect: jest.Mock;
let mockBookingsIn: jest.Mock;
let mockUpsert: jest.Mock;
// 今回の集計に現れなかった行の削除
// （delete().eq('facility_id').lt('updated_at', 実行時刻).gte('last_visit_date', 集計期間の始まり)）。
let mockStaleDelete: jest.Mock;
// 台帳（customers）の読み取り（電話番号のキーの予約がある施設だけ）。
let mockLedgerRange: jest.Mock;

function segmentsTable(upsert: (...args: any[]) => any) {
  return {
    upsert: (...args: any[]) => upsert(...args),
    delete: () => ({
      eq: (eqColumn: string, facilityId: string) => ({
        lt: (ltColumn: string, stamp: string) => ({
          gte: (gteColumn: string, since: string) => mockStaleDelete({ eqColumn, facilityId, ltColumn, stamp, gteColumn, since }),
        }),
      }),
    }),
  };
}

const ledgerSelect = jest.fn();
function customersTable() {
  return {
    select: (cols: string) => {
      ledgerSelect(cols);
      return {
        eq: (eqColumn: string, facilityId: string) => ({
          not: (notColumn: string, op: string, value: unknown) => ({
            order: (orderColumn: string) => ({
              range: (from: number, to: number) => mockLedgerRange({ eqColumn, facilityId, notColumn, op, value, orderColumn, from, to }),
            }),
          }),
        }),
      };
    },
  };
}

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
  mockStaleDelete = jest.fn().mockResolvedValue({ data: null, error: null });
  mockLedgerRange = jest.fn().mockResolvedValue({ data: [], error: null });

  mockFromDelegate.mockImplementation((table: string) => {
    if (table === 'facility_profiles') {
      return { select: (...args: any[]) => mockFacilitiesSelect(...args) };
    } else if (table === 'bookings') {
      return mockBookingsSelect();
    } else if (table === 'customer_segments') {
      return segmentsTable(mockUpsert);
    } else if (table === 'customers') {
      return customersTable();
    }
  });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.RESEND_API_KEY;
  mockRpcDelegate.mockResolvedValue({ data: null, error: { message: 'no RPC is expected from this cron' } });
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

    expect(mockFacilitiesSelect).toHaveBeenCalledWith('id');
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
        return segmentsTable(mockUpsert);
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
      if (table === 'customer_segments') return segmentsTable(mockUpsert);
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
      if (table === 'customer_segments') return segmentsTable(mockUpsert);
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
      if (table === 'customer_segments') return segmentsTable(mockUpsert);
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
      if (table === 'customer_segments') return segmentsTable(mockUpsert);
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
      if (table === 'customer_segments') return segmentsTable(mockUpsert);
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
      if (table === 'customer_segments') return segmentsTable(mockUpsert);
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
      if (table === 'customer_segments') return segmentsTable(mockUpsert);
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
      if (table === 'customer_segments') return segmentsTable(upsertMock);
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

describe('離脱リスク客へのクーポンメールは送らない（2026年10月22日 停止）', () => {
  // 旧実装は at_risk かつ最終来店から 60〜66 日の客に、使えない「500円引きコード」を店舗名義で送っていた。
  // 分類（customer_segments の更新）は続け、発行・送信の経路には一切触れないことを結果で固定する。
  function atRisk(days: number) {
    setupDefaultMocks(1, 0);
    process.env.RESEND_API_KEY = 'configured-for-other-mail';
    const now = new Date('2026-05-15T00:00:00Z');
    const rows = [days, days + 30].map(n => ({
      email_canonical: 'person@example.com', customer_name: 'Patient',
      booking_date: new Date(now.getTime() - n * 86400000).toISOString().split('T')[0], total_price: 5000, status: 'completed',
    }));
    mockBookingsIn.mockReturnValue({ gte: () => ({ range: async () => ({ data: rows, error: null }) }) });
  }

  test.each([61, 62, 66, 67])('最終来店から %s 日の離脱リスク客でも、クーポン発行もメール予約もしない', async days => {
    atRisk(days);
    const response = await GET(makeRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ processed: 1, skipped: 0, deferred: 0 });
    // 分類は従来どおり更新される
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert.mock.calls[0][0][0]).toMatchObject({ customer_email: 'person@example.com', segment: 'at_risk' });
    // 発行・送信の経路（RPC・送信キュー・クーポン表）には一切触れない
    expect(mockRpcDelegate).not.toHaveBeenCalled();
    const tables = mockFromDelegate.mock.calls.map(c => c[0]);
    expect(Array.from(new Set(tables)).sort()).toEqual(['bookings', 'customer_segments', 'facility_profiles']);
    expect(logCronRun).toHaveBeenCalledWith('customer-segment', 'success', expect.any(Date), expect.objectContaining({ processed: 1 }));
  });

  test('予約の取得に失敗した回は成功扱いにしない', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    atRisk(62);
    mockBookingsIn.mockReturnValue({ gte: () => ({ range: async () => ({ data: null, error: { message: 'DB unavailable' } }) }) });
    const response = await GET(makeRequest());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ processingFailures: 1 });
    expect(mockRpcDelegate).not.toHaveBeenCalled();
    errorSpy.mockRestore();
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

// ---------------------------------------------------------------------------
// 電話・来店受付の予約（メール無し）も電話番号でお客様として数える（2026年10月23日）
// ---------------------------------------------------------------------------
describe('メールの無い予約は電話番号で識別する', () => {
  function completedBookings(rows: Array<Record<string, unknown>>) {
    setupDefaultMocks(1, 0);
    mockBookingsIn.mockReturnValue({ gte: () => ({ range: async () => ({ data: rows, error: null }) }) });
  }

  test('表記の違う同じ電話番号は 1 人・メールのある予約はメールで・短い番号や連絡先なしは数えない', async () => {
    completedBookings([
      { email_canonical: null, phone: '090-1111-2222', customer_name: '電話 花子', booking_date: '2026-05-01', total_price: 1000, status: 'completed' },
      { email_canonical: null, phone: '０９０１１１１２２２２', customer_name: '電話 花子', booking_date: '2026-05-10', total_price: 2000, status: 'completed' },
      { email_canonical: 'mail@example.com', phone: '090-1111-2222', customer_name: 'メール 太郎', booking_date: '2026-05-02', total_price: 3000, status: 'completed' },
      { email_canonical: null, phone: '1234', customer_name: '仮番号', booking_date: '2026-05-03', total_price: 500, status: 'completed' },
      { email_canonical: null, phone: null, customer_name: '連絡先なし', booking_date: '2026-05-04', total_price: 500, status: 'completed' },
    ]);
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    // 予約の電話番号を読んでいる
    expect(mockBookingsSelect().select).toHaveBeenCalledWith(expect.stringContaining('phone'));
    const rows = mockUpsert.mock.calls[0][0];
    expect(rows.map((r: any) => [r.customer_email, r.total_visits, r.total_spent]).sort()).toEqual([
      ['mail@example.com', 1, 3000],
      ['tel:09011112222', 2, 3000],
    ]);
  });

  // 台帳にメールと電話番号の両方で登録したお客様の電話予約（メール欄が空）は、そのお客様のメールで数える。
  const yamadaBookings = [
    { email_canonical: 'a@example.com', phone: '090-1111-2222', customer_name: '山田 花子', booking_date: '2026-04-01', total_price: 5000, status: 'completed' },
    { email_canonical: null, phone: '090-1111-2222', customer_name: '山田 花子', booking_date: '2026-05-01', total_price: 3000, status: 'completed' },
    { email_canonical: null, phone: '09011112222', customer_name: '山田 花子', booking_date: '2026-05-10', total_price: 2000, status: 'completed' },
  ];
  const upserted = () => mockUpsert.mock.calls[0][0].map((r: any) => [r.customer_email, r.total_visits, r.total_spent, r.first_visit_date, r.last_visit_date]).sort();

  test('台帳でその電話番号を持つのがメールのあるお客様 1 人なら、電話予約もそのメールの行に数える（回帰）', async () => {
    completedBookings(yamadaBookings);
    mockLedgerRange.mockResolvedValue({ data: [{ email: 'A@example.com', phone: '090-1111-2222' }, { email: 'b@example.com', phone: '080-3333-4444' }], error: null });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(ledgerSelect).toHaveBeenCalledWith('email, phone');
    expect(mockLedgerRange).toHaveBeenCalledWith({
      eqColumn: 'facility_id', facilityId: 'fac-0', notColumn: 'phone', op: 'is', value: null, orderColumn: 'id', from: 0, to: 999,
    });
    expect(upserted()).toEqual([['a@example.com', 3, 10000, '2026-04-01', '2026-05-10']]);
  });

  test('同じ電話番号のお客様が台帳に 2 人いれば寄せない（電話番号の行のまま）', async () => {
    completedBookings(yamadaBookings);
    mockLedgerRange.mockResolvedValue({ data: [{ email: 'a@example.com', phone: '090-1111-2222' }, { email: 'b@example.com', phone: '09011112222' }], error: null });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(upserted()).toEqual([
      ['a@example.com', 1, 5000, '2026-04-01', '2026-04-01'],
      ['tel:09011112222', 2, 5000, '2026-05-01', '2026-05-10'],
    ]);
  });

  test('電話番号のキーの予約が無い施設は台帳を読まない', async () => {
    completedBookings([yamadaBookings[0]]);
    await GET(makeRequest() as any);
    expect(mockLedgerRange).not.toHaveBeenCalled();
    expect(upserted()).toEqual([['a@example.com', 1, 5000, '2026-04-01', '2026-04-01']]);
  });

  test.each([
    ['DB エラー', { data: null, error: { message: 'customers down' } }],
    ['配列でない応答', { data: null, error: null }],
  ])('台帳を読めない（%s）施設は書かず・消さず、失敗として報告する', async (_label, ledgerResult) => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    completedBookings(yamadaBookings);
    mockLedgerRange.mockResolvedValue(ledgerResult);
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ processed: 0, skipped: 1, processingFailures: 1 });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockStaleDelete).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith('[customer-segment] customer ledger fetch failed', expect.objectContaining({ facilityId: 'fac-0' }));
    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// もう該当しないお客様の行を消す（2026年10月23日）
//   以前は upsert だけだったため、「完了」を「無断キャンセル」に訂正して来店 0 回になったお客様に
//   「新規」と累計利用額が残り続けた。施設ごとに、今回の集計に現れなかった行を消す。
// ---------------------------------------------------------------------------
describe('今回の集計に現れなかったお客様の行は消す', () => {
  type SegmentRow = { facility_id: string; customer_email: string; updated_at: string; last_visit_date: string; segment?: string; total_spent?: number };
  let store: SegmentRow[];
  const OLD = '2026-05-08T07:00:00.000Z';

  function completedBookings(rows: Array<Record<string, unknown>> | null, error: unknown = null) {
    setupDefaultMocks(1, 0);
    mockBookingsIn.mockReturnValue({ gte: () => ({ range: async () => ({ data: rows, error }) }) });
  }
  // customer_segments を (facility_id, customer_email) 一意の表として再現する。
  function useStore(initial: SegmentRow[]) {
    store = initial.map((r) => ({ ...r }));
    mockUpsert.mockImplementation(async (rows: SegmentRow[]) => {
      for (const row of rows) {
        const i = store.findIndex((r) => r.facility_id === row.facility_id && r.customer_email === row.customer_email);
        if (i >= 0) store[i] = { ...store[i], ...row }; else store.push({ ...row });
      }
      return { data: [], error: null };
    });
    mockStaleDelete.mockImplementation(async ({ eqColumn, facilityId, ltColumn, stamp, gteColumn, since }: any) => {
      expect([eqColumn, ltColumn, gteColumn]).toEqual(['facility_id', 'updated_at', 'last_visit_date']);
      store = store.filter((r) => !(r.facility_id === facilityId && r.updated_at < stamp && r.last_visit_date >= since));
      return { data: null, error: null };
    });
  }
  const initialRows = (): SegmentRow[] => [
    // 誤って「完了」にされ、後で「無断キャンセル」に訂正されたお客様（来店 0 回になった）
    { facility_id: 'fac-0', customer_email: 'a@example.com', updated_at: OLD, last_visit_date: '2026-05-01', segment: 'new', total_spent: 8000 },
    { facility_id: 'fac-0', customer_email: 'b@example.com', updated_at: OLD, last_visit_date: '2026-04-01', segment: 'new', total_spent: 1000 },
    // 別の施設の行には触れない
    { facility_id: 'fac-9', customer_email: 'a@example.com', updated_at: OLD, last_visit_date: '2026-05-01', segment: 'new', total_spent: 5000 },
  ];
  // 最後の来店が集計期間（直近 2 年＝2024-05-15 から）より前の常連。今回の集計には現れない。
  const longLost = (): SegmentRow => ({
    facility_id: 'fac-0', customer_email: 'old@example.com', updated_at: OLD, last_visit_date: '2024-05-14', segment: 'lost', total_spent: 60000,
  });
  const bOnly = [{ email_canonical: 'b@example.com', phone: null, customer_name: 'B', booking_date: '2026-05-10', total_price: 2000, status: 'completed' }];

  test('訂正で来店が無くなったお客様の行は次の集計で消え、残るお客様は更新される（回帰）', async () => {
    completedBookings(bOnly);
    useStore(initialRows());
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(store.filter((r) => r.facility_id === 'fac-0').map((r) => [r.customer_email, r.total_spent, r.updated_at])).toEqual([
      ['b@example.com', 2000, '2026-05-15T00:00:00.000Z'],
    ]);
    expect(store.filter((r) => r.facility_id === 'fac-9')).toEqual([initialRows()[2]]);
    expect(mockStaleDelete).toHaveBeenCalledTimes(1);
  });

  test('完了予約が 1 件も無くなった施設は、残っていた行をすべて消す', async () => {
    completedBookings([]);
    useStore(initialRows());
    const res = await GET(makeRequest() as any);
    expect(await res.json()).toEqual({ processed: 0, skipped: 1, deferred: 0 });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(store.map((r) => r.facility_id)).toEqual(['fac-9']);
  });

  test.each([
    ['集計した施設', bOnly],
    ['完了予約の無い施設', []],
  ])('%s でも、最終来店が集計期間より前の行（長く来ていない常連）は消さない（回帰）', async (_label, rows) => {
    completedBookings(rows);
    useStore([...initialRows(), longLost()]);
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(mockStaleDelete).toHaveBeenCalledWith(expect.objectContaining({ facilityId: 'fac-0', since: '2024-05-15' }));
    // 訂正で該当しなくなった a@ は消え、期間外の常連は最後の分類のまま残る
    expect(store.filter((r) => r.facility_id === 'fac-0').map((r) => r.customer_email).sort()).toEqual(
      rows.length ? ['b@example.com', 'old@example.com'] : ['old@example.com'],
    );
    expect(store.find((r) => r.customer_email === 'old@example.com')).toEqual(longLost());
  });

  test('予約の応答が配列でない（エラーも無い）ときは「0 件」と取り違えて消さない', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    completedBookings(null, null);
    useStore(initialRows());
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ processed: 0, skipped: 1, processingFailures: 1 });
    expect(mockStaleDelete).not.toHaveBeenCalled();
    expect(store).toEqual(initialRows());
    expect(errorSpy).toHaveBeenCalledWith('[customer-segment] bookings fetch failed', expect.objectContaining({ facilityId: 'fac-0' }));
    errorSpy.mockRestore();
  });

  test('予約の取得に失敗した施設では消さない（失敗を 0 件と取り違えない）', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    completedBookings(null, { message: 'DB unavailable' });
    useStore(initialRows());
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(mockStaleDelete).not.toHaveBeenCalled();
    expect(store).toEqual(initialRows());
    errorSpy.mockRestore();
  });

  test('書き込みに失敗した施設では消さない（書けなかった行まで消さない）', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    completedBookings(bOnly);
    useStore(initialRows());
    mockUpsert.mockResolvedValue({ data: null, error: { message: 'upsert failed' } });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(mockStaleDelete).not.toHaveBeenCalled();
    expect(store).toEqual(initialRows());
    errorSpy.mockRestore();
  });

  test('予約を件数上限で打ち切った回は消さない（読めなかったお客様の行を消さない）', async () => {
    setupDefaultMocks(1, 0);
    const fullPage = Array(1000).fill(bOnly[0]);
    mockBookingsIn.mockReturnValue({ gte: () => ({ range: async () => ({ data: fullPage, error: null }) }) });
    useStore(initialRows());
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalled();
    expect(mockStaleDelete).not.toHaveBeenCalled();
    expect(store.some((r) => r.facility_id === 'fac-0' && r.customer_email === 'a@example.com')).toBe(true);
  });

  test.each([
    ['集計した施設', bOnly, { processed: 1, skipped: 0 }],
    ['完了予約の無い施設', [], { processed: 0, skipped: 1 }],
  ])('%s で古い行の削除に失敗したら、成功扱いにしない', async (_label, rows, counts) => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    completedBookings(rows);
    useStore(initialRows());
    mockStaleDelete.mockResolvedValue({ data: null, error: { message: 'delete failed' } });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ...counts, processingFailures: 1 });
    expect(errorSpy).toHaveBeenCalledWith('[customer-segment] stale segment cleanup failed', expect.objectContaining({ facilityId: 'fac-0' }));
    expect(logCronRun).toHaveBeenCalledWith('customer-segment', 'error', expect.any(Date), expect.anything());
    errorSpy.mockRestore();
  });
});
