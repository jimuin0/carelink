/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/booking-reminder
 * Key assertions:
 *   - CRON_SECRET validation
 *   - JST date calculation (UTC+9)
 *   - Tomorrow's confirmed bookings query
 *   - Idempotency via sent_reminders upsert
 *   - Race condition handling (30-second window)
 *   - Email sending (fire-and-forget)
 *   - Facility name lookup
 */

jest.mock('@/lib/cron-auth');
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/cron-logger');
jest.mock('@/lib/email');
jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
}), { virtual: true });

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { GET } from '../route';

let mockBookingsSelect: jest.Mock;
let mockFacilitiesSelect: jest.Mock;
let mockRemindersUpsert: jest.Mock;
let mockRemindersSelect: jest.Mock;
let mockSendBookingReminder: jest.Mock;

function setupDefaultMocks(
  bookingsCount: number = 2,
  upsertSucceeds: boolean = true,
  reminderClaimed: boolean = true
) {
  (checkCronAuth as jest.Mock).mockReturnValue(null);

  const bookingsData = Array.from({ length: bookingsCount }, (_, i) => ({
    id: `booking-${i}`,
    customer_name: `Customer ${i}`,
    email: `customer${i}@example.com`,
    booking_date: '2026-05-16',
    start_time: `${9 + i}:00`,
    end_time: `${10 + i}:00`,
    facility_id: `fac-${i % 2}`,
    total_price: 5000 + i * 1000,
  }));

  const bookingsMockEq = jest.fn();
  bookingsMockEq.mockReturnValue({
    eq: bookingsMockEq,
    limit: jest.fn().mockResolvedValue({ data: bookingsData, error: null }),
  });
  mockBookingsSelect = jest.fn().mockReturnValue({ eq: bookingsMockEq });

  const facilitiesData = [
    { id: 'fac-0', name: 'Salon A' },
    { id: 'fac-1', name: 'Salon B' },
  ];

  mockFacilitiesSelect = jest.fn().mockReturnValue({
    in: jest.fn().mockResolvedValue({
      data: facilitiesData,
      error: null,
    }),
  });

  mockRemindersUpsert = jest.fn().mockResolvedValue({
    error: upsertSucceeds ? null : { message: 'Upsert failed' },
  });

  mockRemindersSelect = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: reminderClaimed
            ? { sent_at: '2026-05-14T23:59:55.000Z' }
            : null,
        }),
      }),
    }),
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'bookings') {
        return { select: mockBookingsSelect };
      } else if (table === 'facility_profiles') {
        return { select: mockFacilitiesSelect };
      } else if (table === 'sent_reminders') {
        return {
          upsert: mockRemindersUpsert,
          select: mockRemindersSelect,
        };
      }
    }),
  });

  mockSendBookingReminder = jest.fn().mockResolvedValue(undefined);
  const emailModule = require('@/lib/email');
  emailModule.sendBookingReminder = mockSendBookingReminder;

  (logCronRun as jest.Mock).mockResolvedValue(undefined);
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-05-15T00:00:00Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

function makeRequest() {
  return new Request('http://localhost/api/cron/booking-reminder', {
    method: 'GET',
    headers: { 'Authorization': 'Bearer cron-secret' },
  });
}

describe('GET /api/cron/booking-reminder', () => {
  test('CRON_SECRET check failed → returns error', async () => {
    const errorResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    (checkCronAuth as jest.Mock).mockReturnValue(errorResponse);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(401);
  });

  test('valid cron request → 200 with sent count', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(typeof json.processed).toBe('number');
    expect(typeof json.skipped).toBe('number');
    expect(typeof json.total).toBe('number');
  });

  test("calculates tomorrow's date in JST", async () => {
    // Mock time: 2026-05-15T00:00:00Z = 2026-05-15T09:00:00 JST
    // Tomorrow JST = 2026-05-16

    await GET(makeRequest() as any);

    const call = mockBookingsSelect().eq.mock.calls[0];
    expect(call[1]).toBe('2026-05-16');
  });

  test('no bookings for tomorrow → skipped with 0', async () => {
    setupDefaultMocks(0);

    const res = await GET(makeRequest() as any);

    const json = await res.json();
    expect(json.sent).toBe(0);
  });

  test('booking without email → skipped', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'bookings') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'booking-no-email',
                        customer_name: 'No Email',
                        email: null,
                        booking_date: '2026-05-16',
                        start_time: '09:00',
                        end_time: '10:00',
                        facility_id: 'fac-0',
                        total_price: 5000,
                      },
                    ],
                  }),
                }),
              }),
            }),
          };
        } else if (table === 'facility_profiles') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({
                data: [{ id: 'fac-0', name: 'Salon A' }],
              }),
            }),
          };
        } else if (table === 'sent_reminders') {
          return { upsert: mockRemindersUpsert, select: mockRemindersSelect };
        }
      }),
    });

    const res = await GET(makeRequest() as any);

    const json = await res.json();
    expect(json.skipped).toBeGreaterThan(0);
  });

  test('sends reminder email for claimed bookings', async () => {
    await GET(makeRequest() as any);

    expect(mockSendBookingReminder).toHaveBeenCalled();
    const call = mockSendBookingReminder.mock.calls[0];
    expect(call[0]).toEqual(
      expect.objectContaining({
        customerName: expect.any(String),
        customerEmail: expect.any(String),
        facilityName: expect.any(String),
        bookingDate: '2026-05-16',
        totalPrice: expect.any(Number),
      })
    );
  });

  test('upsert sent_reminders for idempotency', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockRemindersUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        booking_id: 'booking-0',
        reminder_date: '2026-05-16',
      }),
      { onConflict: 'booking_id,reminder_date', ignoreDuplicates: true }
    );
  });

  test('upsert error → skipped', async () => {
    setupDefaultMocks(1, false);

    const res = await GET(makeRequest() as any);

    const json = await res.json();
    expect(json.skipped).toBeGreaterThan(0);
  });

  test('race condition: reminder claimed >30s ago → skipped', async () => {
    mockRemindersSelect = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { sent_at: new Date(Date.now() - 40000).toISOString() },
          }),
        }),
      }),
    });

    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'bookings') return { select: mockBookingsSelect };
        if (table === 'facility_profiles') return { select: mockFacilitiesSelect };
        if (table === 'sent_reminders') {
          return { upsert: mockRemindersUpsert, select: mockRemindersSelect };
        }
      }),
    });

    const res = await GET(makeRequest() as any);

    const json = await res.json();
    expect(json.skipped).toBeGreaterThan(0);
  });

  test('facility name lookup by facility_id', async () => {
    setupDefaultMocks(2);

    await GET(makeRequest() as any);

    const facilityCall = mockFacilitiesSelect().in.mock.calls[0];
    expect(facilityCall[0]).toBe('id');
    expect(facilityCall[1]).toContain('fac-0');
    expect(facilityCall[1]).toContain('fac-1');
  });

  test('booking lookup filters by tomorrow and confirmed status', async () => {
    await GET(makeRequest() as any);

    const firstCall = mockBookingsSelect().eq.mock.calls[0];
    expect(firstCall[0]).toBe('booking_date');
    expect(firstCall[1]).toBe('2026-05-16');

    const secondCall = mockBookingsSelect().eq.mock.calls[1];
    expect(secondCall[0]).toBe('status');
    expect(secondCall[1]).toBe('confirmed');
  });

  test('logs success with processed count', async () => {
    setupDefaultMocks(3);

    await GET(makeRequest() as any);

    expect(logCronRun).toHaveBeenCalledWith(
      'booking-reminder',
      'success',
      expect.any(Date),
      expect.objectContaining({
        processed: expect.any(Number),
        skipped: expect.any(Number),
      })
    );
  });

  test('email send exception → skipped', async () => {
    mockSendBookingReminder.mockRejectedValue(new Error('Email API error'));

    const res = await GET(makeRequest() as any);

    const json = await res.json();
    expect(json.skipped).toBeGreaterThan(0);
  });

  test('database error during booking lookup → 500', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockImplementation(() => { throw new Error('Database error'); }),
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
  });

  test('includes facility name in email params', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    const emailCall = mockSendBookingReminder.mock.calls[0];
    expect(emailCall[0].facilityName).toBe('Salon A');
  });
});
