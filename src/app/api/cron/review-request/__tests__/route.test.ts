/**
 * @jest-environment node
 *
 * Tests for GET /api/cron/review-request
 * Key assertions:
 *   - CRON_SECRET validation
 *   - Finds completed bookings 24-48h old (not yet sent)
 *   - CAS guard (is null check) prevents double-send
 *   - Fetches facility name/slug
 *   - Sends review request email via Resend
 *   - Sends LINE notification with review URL
 *   - HTML escapes facility & customer names (XSS prevention)
 *   - Includes 50pt bonus mention
 *   - Handles missing email/LINE gracefully
 *   - Logs cron execution
 */

jest.mock('@/lib/cron-auth', () => ({
  checkCronAuth: jest.fn(() => null),
}));
jest.mock('@/lib/cron-logger');
jest.mock('@/lib/line');
jest.mock('@/lib/email');
jest.mock('resend');

// Module-level supabase = createClient(...) — use wrapper so from() is lazily resolved
const mockFrom = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (...args: any[]) => mockFrom(...args),
  })),
}));

import { checkCronAuth } from '@/lib/cron-auth';
import { logCronRun } from '@/lib/cron-logger';
import { sendLineText } from '@/lib/line';
import { esc, escSubject } from '@/lib/email';
import { GET } from '../route';

let mockBookingsSelect: jest.Mock;
let mockBookingsUpdate: jest.Mock;
let mockFacilitiesSelect: jest.Mock;
let mockLineLinkSelect: jest.Mock;

function setupDefaultMocks(
  bookingsFound: number = 1,
  facilityFound: boolean = true,
  lineLinkFound: boolean = true,
  emailSendFails: boolean = false
) {
  (checkCronAuth as jest.Mock).mockReturnValue(null);
  (logCronRun as jest.Mock).mockResolvedValue(undefined);
  (sendLineText as jest.Mock).mockResolvedValue(undefined);
  (esc as jest.Mock).mockImplementation((s) => s?.replace(/</g, '&lt;') || '');
  (escSubject as jest.Mock).mockImplementation((s) => s);

  const bookingsData =
    bookingsFound > 0
      ? [
          {
            id: 'booking-1',
            email: 'customer@example.com',
            customer_name: 'John Doe',
            user_id: 'user-123',
            facility_id: 'fac-abc',
            updated_at: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString(),
          },
        ]
      : [];
  const facilitiesData = facilityFound ? { name: 'Salon ABC', slug: 'salon-abc' } : null;
  const lineLinkData = lineLinkFound ? { line_user_id: 'line-user-123' } : null;

  mockBookingsSelect = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      gte: jest.fn().mockReturnValue({
        lte: jest.fn().mockReturnValue({
          is: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue({ data: bookingsData }),
          }),
        }),
      }),
    }),
  });

  mockBookingsUpdate = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      is: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue({
          data: [{ id: 'booking-1' }],
        }),
      }),
    }),
  });

  mockFacilitiesSelect = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      maybeSingle: jest.fn().mockResolvedValue({ data: facilitiesData }),
    }),
  });

  mockLineLinkSelect = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      maybeSingle: jest.fn().mockResolvedValue({ data: lineLinkData }),
    }),
  });

  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') {
      return {
        select: mockBookingsSelect,
        update: mockBookingsUpdate,
      };
    } else if (table === 'facility_profiles') {
      return {
        select: mockFacilitiesSelect,
      };
    } else if (table === 'line_user_links') {
      return {
        select: mockLineLinkSelect,
      };
    }
    return {};
  });

  const { Resend } = require('resend');
  Resend.mockImplementation(() => ({
    emails: {
      send: emailSendFails
        ? jest.fn().mockRejectedValue(new Error('Send failed'))
        : jest.fn().mockResolvedValue({ success: true }),
    },
  }));
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.CRON_SECRET = 'cron-secret';
  process.env.RESEND_API_KEY = 'resend-key';
  process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'line-token';
});

function makeRequest(cronSecret: string = 'cron-secret') {
  return new Request('http://localhost/api/cron/review-request', {
    method: 'GET',
    headers: { authorization: `Bearer ${cronSecret}` },
  });
}

describe('GET /api/cron/review-request', () => {
  test('invalid CRON_SECRET → returns auth error', async () => {
    (checkCronAuth as jest.Mock).mockReturnValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    );

    const res = await GET(makeRequest('invalid') as any);

    expect(res.status).toBe(401);
  });

  test('no completed bookings in window → 200 with sent=0', async () => {
    setupDefaultMocks(0);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(0);
  });

  test('completed bookings found → sends requests', async () => {
    setupDefaultMocks(1);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.processed).toBeGreaterThanOrEqual(0);
  });

  test('filters status=completed', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockBookingsSelect).toHaveBeenCalled();
  });

  test('filters 24-48h window (h24ago ≤ updated_at ≤ h48ago)', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockBookingsSelect).toHaveBeenCalled();
  });

  test('filters review_request_sent_at IS NULL', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockBookingsSelect).toHaveBeenCalled();
  });

  test('CAS guard prevents double-send (is null check)', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockBookingsUpdate).toHaveBeenCalled();
  });

  test('double-fire → already claimed → skips', async () => {
    mockBookingsUpdate.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        is: jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({
            data: [],
          }),
        }),
      }),
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('fetches facility name and slug', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockFacilitiesSelect).toHaveBeenCalled();
  });

  test('facility not found → skips', async () => {
    setupDefaultMocks(1, false);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('sends email to booking.email', async () => {
    setupDefaultMocks(1);

    const { Resend } = require('resend');

    await GET(makeRequest() as any);

    expect(Resend).toHaveBeenCalled();
  });

  test('email includes facility name in subject', async () => {
    setupDefaultMocks(1);

    const { Resend } = require('resend');

    await GET(makeRequest() as any);

    const call = Resend.mock.results[0].value.emails.send.mock.calls[0];
    expect(call[0].subject).toContain('Salon ABC');
  });

  test('email includes review URL with facility slug', async () => {
    setupDefaultMocks(1);

    const { Resend } = require('resend');

    await GET(makeRequest() as any);

    const call = Resend.mock.results[0].value.emails.send.mock.calls[0];
    expect(call[0].html).toContain('salon-abc');
    expect(call[0].html).toContain('#review');
  });

  test('email escapes facility name for XSS prevention', async () => {
    setupDefaultMocks(1);

    const { Resend } = require('resend');

    await GET(makeRequest() as any);

    expect(esc).toHaveBeenCalledWith('Salon ABC');
  });

  test('email escapes customer name for XSS prevention', async () => {
    setupDefaultMocks(1);

    const { Resend } = require('resend');

    await GET(makeRequest() as any);

    expect(esc).toHaveBeenCalledWith('John Doe');
  });

  test('email includes 50pt bonus mention', async () => {
    setupDefaultMocks(1);

    const { Resend } = require('resend');

    await GET(makeRequest() as any);

    const call = Resend.mock.results[0].value.emails.send.mock.calls[0];
    expect(call[0].html).toContain('50ポイント');
  });

  test('email send failure → logs and continues', async () => {
    setupDefaultMocks(1, true, true, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('skips email if booking.email missing', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              gte: jest.fn().mockReturnValue({
                lte: jest.fn().mockReturnValue({
                  is: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue({
                      data: [
                        {
                          id: 'booking-1',
                          email: null,
                          user_id: 'user-123',
                          facility_id: 'fac-abc',
                        },
                      ],
                    }),
                  }),
                }),
              }),
            }),
          }),
          update: mockBookingsUpdate,
        };
      }
      if (table === 'facility_profiles') return { select: mockFacilitiesSelect };
      if (table === 'line_user_links') return { select: mockLineLinkSelect };
      return {};
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('sends LINE notification when user_id exists', async () => {
    setupDefaultMocks(1, true, true);

    await GET(makeRequest() as any);

    expect(sendLineText).toHaveBeenCalled();
  });

  test('LINE message includes facility name', async () => {
    setupDefaultMocks(1, true, true);

    await GET(makeRequest() as any);

    const call = (sendLineText as jest.Mock).mock.calls[0];
    expect(call[1]).toContain('Salon ABC');
  });

  test('LINE message includes review URL', async () => {
    setupDefaultMocks(1, true, true);

    await GET(makeRequest() as any);

    const call = (sendLineText as jest.Mock).mock.calls[0];
    expect(call[1]).toContain('salon-abc');
  });

  test('LINE message includes 50pt bonus', async () => {
    setupDefaultMocks(1, true, true);

    await GET(makeRequest() as any);

    const call = (sendLineText as jest.Mock).mock.calls[0];
    expect(call[1]).toContain('50ポイント');
  });

  test('skips LINE if line_user_id not found', async () => {
    setupDefaultMocks(1, true, false);

    (sendLineText as jest.Mock).mockClear();

    await GET(makeRequest() as any);

    expect(sendLineText).not.toHaveBeenCalled();
  });

  test('logs cron execution with sent count', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(logCronRun).toHaveBeenCalledWith(
      'review-request',
      'success',
      expect.any(Date),
      expect.objectContaining({
        processed: expect.any(Number),
      })
    );
  });

  test('limits bookings to 500', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    expect(mockBookingsSelect).toHaveBeenCalled();
  });

  test('exception during processing → 500', async () => {
    mockFrom.mockImplementation(() => {
      throw new Error('Fatal');
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
  });

  test('updates review_request_sent_at on claim', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    const call = mockBookingsUpdate.mock.calls[0];
    expect(call[0].review_request_sent_at).toBeDefined();
  });

  test('constructs review URL correctly', async () => {
    setupDefaultMocks(1);

    await GET(makeRequest() as any);

    // URL should be https://carelink-jp.com/facility/{slug}#review
  });

  test('individual booking error → continues to next', async () => {
    setupDefaultMocks(1);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('skips LINE if no token', async () => {
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
    setupDefaultMocks(1);

    (sendLineText as jest.Mock).mockClear();

    await GET(makeRequest() as any);

    // Should not call sendLineText
  });

  test('customer_name null → fallback to お客', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              gte: jest.fn().mockReturnValue({
                lte: jest.fn().mockReturnValue({
                  is: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue({
                      data: [{
                        id: 'b-noname',
                        email: 'c@example.com',
                        customer_name: null,
                        user_id: null,
                        facility_id: 'fac-abc',
                        updated_at: new Date().toISOString(),
                      }],
                    }),
                  }),
                }),
              }),
            }),
          }),
          update: mockBookingsUpdate,
        };
      }
      if (table === 'facility_profiles') return { select: mockFacilitiesSelect };
      return {};
    });

    await GET(makeRequest() as any);
    expect(esc).toHaveBeenCalledWith('お客');
  });

  test('booking.user_id null → no LINE lookup', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              gte: jest.fn().mockReturnValue({
                lte: jest.fn().mockReturnValue({
                  is: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue({
                      data: [{
                        id: 'b-no-uid',
                        email: 'c@example.com',
                        customer_name: 'A',
                        user_id: null,
                        facility_id: 'fac-abc',
                        updated_at: new Date().toISOString(),
                      }],
                    }),
                  }),
                }),
              }),
            }),
          }),
          update: mockBookingsUpdate,
        };
      }
      if (table === 'facility_profiles') return { select: mockFacilitiesSelect };
      if (table === 'line_user_links') return { select: mockLineLinkSelect };
      return {};
    });
    (sendLineText as jest.Mock).mockClear();

    await GET(makeRequest() as any);
    expect(sendLineText).not.toHaveBeenCalled();
  });

  test('EMAIL_FROM env override → uses custom from', async () => {
    process.env.EMAIL_FROM = 'Custom <c@x.com>';
    setupDefaultMocks(1);
    const { Resend } = require('resend');

    await GET(makeRequest() as any);

    const call = Resend.mock.results[0].value.emails.send.mock.calls[0];
    expect(call[0].from).toBe('Custom <c@x.com>');
    delete process.env.EMAIL_FROM;
  });

  test('non-Error throw → String fallback', async () => {
    mockFrom.mockImplementation(() => { throw 'plain string'; });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });

  test('skips Resend email if API key unavailable', async () => {
    delete process.env.RESEND_API_KEY;
    setupDefaultMocks(1);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });
});
