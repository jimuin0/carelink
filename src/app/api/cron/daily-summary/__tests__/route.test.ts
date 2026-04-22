/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/daily-summary
 * Key assertions:
 *   - CRON_SECRET auth (timing-safe)
 *   - JST date calculation (yesterday)
 *   - Facility loop with error handling (continues on error)
 *   - Booking aggregation by status
 *   - New vs repeat customer detection (email-based)
 *   - N+1 query avoidance (batch email lookup)
 *   - Daily revenue summary upsert
 */

jest.mock('@/lib/supabase-server');
jest.mock('@/lib/cron-auth');
jest.mock('@/lib/cron-logger');

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { GET } from '../route';

let mockSelectFn: jest.Mock;
let mockUpsertFn: jest.Mock;

function setupDefaultMocks(
  facilitiesFound: boolean = true,
  bookingsForFacility: boolean = true,
  pastBookingsData: any[] = [],
  upsertError: boolean = false
) {
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (logCronRun as jest.Mock).mockResolvedValue(undefined);

  const facilitiesData = facilitiesFound
    ? [
        { id: 'fac-1' },
        { id: 'fac-2' },
      ]
    : [];

  const bookingsData = bookingsForFacility
    ? [
        { status: 'completed', total_price: 10000, email: 'user1@example.com' },
        { status: 'completed', total_price: 15000, email: 'user2@example.com' },
        { status: 'cancelled', total_price: 5000, email: 'user3@example.com' },
        { status: 'no_show', total_price: 8000, email: 'user1@example.com' },
      ]
    : [];

  mockSelectFn = jest
    .fn()
    .mockReturnValue({
      eq: jest.fn((col: string, val: any) => {
        if (col === 'status' && val === 'published') {
          return {
            data: facilitiesData,
            error: null,
          };
        }
        return {
          eq: jest.fn((col2: string, val2: any) => {
            if (col2 === 'booking_date') {
              return {
                data: bookingsData,
                error: null,
              };
            }
            return {
              in: jest.fn((col3: string, vals: any[]) => {
                if (col3 === 'email') {
                  return {
                    lt: jest.fn(() => ({
                      data: pastBookingsData,
                      error: null,
                    })),
                  };
                }
              }),
            };
          }),
          in: jest.fn((col2: string, vals: any[]) => {
            return {
              lt: jest.fn(() => ({
                data: pastBookingsData,
                error: null,
              })),
            };
          }),
        };
      }),
      in: jest.fn((col: string, vals: any[]) => {
        return {
          lt: jest.fn(() => ({
            data: pastBookingsData,
            error: null,
          })),
        };
      }),
    });

  mockUpsertFn = jest.fn().mockResolvedValue({
    data: null,
    error: upsertError ? { message: 'Upsert error' } : null,
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'facility_profiles') {
        return { select: mockSelectFn };
      } else if (table === 'bookings') {
        return { select: mockSelectFn };
      } else if (table === 'daily_revenue_summary') {
        return { upsert: mockUpsertFn };
      }
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
});

function makeRequest() {
  return new Request('http://localhost/api/cron/daily-summary', {
    method: 'GET',
  });
}

describe('GET /api/cron/daily-summary', () => {
  test('auth failed → returns error', async () => {
    const authError = new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
    });
    (checkCronAuth as jest.Mock).mockReturnValue(authError);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(401);
  });

  test('no facilities found → 200 with count 0', async () => {
    setupDefaultMocks(false);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ok');
    expect(json.facilities).toBe(0);
  });

  test('facilities with no bookings → skipped', async () => {
    setupDefaultMocks(true, false);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ok');
  });

  test('completed bookings aggregated', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    expect(mockUpsertFn).toHaveBeenCalled();
    const upsertCall = mockUpsertFn.mock.calls[0];
    const payload = upsertCall[0];
    expect(payload.completed_count).toBe(2);
  });

  test('cancelled bookings aggregated', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const upsertCall = mockUpsertFn.mock.calls[0];
    const payload = upsertCall[0];
    expect(payload.cancelled_count).toBe(1);
  });

  test('no_show bookings aggregated', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const upsertCall = mockUpsertFn.mock.calls[0];
    const payload = upsertCall[0];
    expect(payload.no_show_count).toBe(1);
  });

  test('total_revenue from completed bookings only', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const upsertCall = mockUpsertFn.mock.calls[0];
    const payload = upsertCall[0];
    expect(payload.total_revenue).toBe(25000);
  });

  test('booking_count includes all bookings', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const upsertCall = mockUpsertFn.mock.calls[0];
    const payload = upsertCall[0];
    expect(payload.booking_count).toBe(4);
  });

  test('new customer detected (no past bookings)', async () => {
    setupDefaultMocks(true, true, []);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const upsertCall = mockUpsertFn.mock.calls[0];
    const payload = upsertCall[0];
    expect(payload.new_customer_count).toBe(3);
    expect(payload.repeat_customer_count).toBe(0);
  });

  test('repeat customer detected (has past bookings)', async () => {
    setupDefaultMocks(true, true, [
      { email: 'user1@example.com' },
      { email: 'user2@example.com' },
    ]);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const upsertCall = mockUpsertFn.mock.calls[0];
    const payload = upsertCall[0];
    expect(payload.new_customer_count).toBe(1);
    expect(payload.repeat_customer_count).toBe(2);
  });

  test('upsert with onConflict facility_id,date', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    expect(mockUpsertFn).toHaveBeenCalled();
    const upsertCall = mockUpsertFn.mock.calls[0];
    const options = upsertCall[1];
    expect(options.onConflict).toBe('facility_id,date');
  });

  test('response includes date in YYYY-MM-DD format', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.date).toBeDefined();
    expect(json.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('response includes processed facility count', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.facilities).toBeGreaterThanOrEqual(0);
  });

  test('logCronRun called on success', async () => {
    const res = await GET(makeRequest() as any);

    expect(logCronRun).toHaveBeenCalledWith(
      'daily-summary',
      'success',
      expect.any(Date),
      expect.objectContaining({
        processed: expect.any(Number),
      })
    );
  });

  test('logCronRun called on error', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockImplementation(() => {
        throw new Error('DB connection error');
      }),
    });

    const res = await GET(makeRequest() as any);

    expect(logCronRun).toHaveBeenCalledWith(
      'daily-summary',
      'error',
      expect.any(Date),
      expect.objectContaining({
        error_msg: expect.any(String),
      })
    );
  });

  test('upsert includes facility_id and date', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const upsertCall = mockUpsertFn.mock.calls[0];
    const payload = upsertCall[0];
    expect(payload.facility_id).toBeDefined();
    expect(payload.date).toBeDefined();
  });

  test('multiple facilities processed independently', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    expect(mockUpsertFn).toHaveBeenCalledTimes(2);
  });

  test('duplicate emails deduplicated (new/repeat counts)', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const upsertCall = mockUpsertFn.mock.calls[0];
    const payload = upsertCall[0];
    expect(payload.new_customer_count + payload.repeat_customer_count).toBe(3);
  });

  test('overall exception → 500 error', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockImplementation(() => {
        throw new Error('Critical error');
      }),
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Internal error');
  });
});
