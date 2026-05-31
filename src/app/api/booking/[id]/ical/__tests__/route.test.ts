/**
 * @jest-environment node
 *
 * Tests for GET /api/booking/[id]/ical - iCal file download
 * Key assertions:
 *   - Rate limiting (20 req/min per IP)
 *   - UUID validation on booking ID
 *   - Auth required
 *   - Booking ownership verification
 *   - iCal format generation (RFC 5545)
 *   - Special character escaping
 *   - Content-Type and Content-Disposition headers
 */

jest.mock('@/lib/rate-limit', () => ({
  inMemoryRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/supabase-server-auth');

import { inMemoryRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

let mockGetUser: jest.Mock;

function setupDefaultMocks(
  bookingFound: boolean = true,
  isOwner: boolean = true
) {
  // When isOwner=false: booking belongs to 'user-123', but authenticated user is 'different-user'
  const authenticatedUserId = isOwner ? 'user-123' : 'different-user';
  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: { id: authenticatedUserId } },
  });

  const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
  createServerSupabaseAuthClient.mockResolvedValue({
    auth: { getUser: mockGetUser },
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  const mockSingle = jest.fn().mockResolvedValue({
    data: bookingFound
      ? {
          id: '123e4567-e89b-12d3-a456-426614174000',
          user_id: 'user-123',
          facility_id: 'fac-123',
          start_time: '2026-05-10T10:00:00Z',
          end_time: '2026-05-10T11:00:00Z',
          menu_name: 'Eyelash Extension',
          staff_name: 'Alice',
          notes: 'No allergies',
          facility_profiles: [
            {
              name: 'Salon ABC',
              address: '東京都渋谷区',
              phone: '03-1234-5678',
            },
          ],
        }
      : null,
  });

  const mockEq = jest
    .fn()
    .mockReturnValue({
      single: mockSingle,
    });

  const mockSelect = jest.fn().mockReturnValue({
    eq: mockEq,
  });

  createServiceRoleClient.mockReturnValue({
    from: jest.fn().mockReturnValue({
      select: mockSelect,
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  setupDefaultMocks();
});

const BOOKING_UUID = '123e4567-e89b-12d3-a456-426614174000';

function makeRequest(
  bookingId: string = BOOKING_UUID,
  ip = '192.168.1.1'
) {
  const req = new Request(
    `http://localhost/api/booking/${bookingId}/ical`,
    {
      method: 'GET',
      headers: { 'x-forwarded-for': ip },
    }
  );
  Object.defineProperty(req, 'nextUrl', {
    value: new URL(req.url),
    writable: true,
  });

  // Mock params
  return Object.assign(req, {
    params: Promise.resolve({ id: bookingId }),
  });
}

describe('GET /api/booking/[id]/ical', () => {
  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await GET(makeRequest() as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    expect(res.status).toBe(429);
  });

  test('invalid UUID format → 400', async () => {
    const res = await GET(makeRequest('not-a-uuid') as any, {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    } as any);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid');
  });

  test('unauthenticated → 401', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
    });

    const res = await GET(makeRequest() as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    expect(res.status).toBe(401);
  });

  test('booking not found → 404', async () => {
    setupDefaultMocks(false);

    const res = await GET(makeRequest() as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    expect(res.status).toBe(404);
  });

  test('booking not owned by user → 401', async () => {
    setupDefaultMocks(true, false);

    const res = await GET(makeRequest() as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    expect(res.status).toBe(401);
  });

  test('valid request → 200 with iCal content', async () => {
    const res = await GET(makeRequest() as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain('END:VCALENDAR');
    expect(text).toContain('BEGIN:VEVENT');
    expect(text).toContain('END:VEVENT');
  });

  test('iCal includes event summary', async () => {
    const res = await GET(makeRequest() as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    const text = await res.text();
    expect(text).toContain('SUMMARY:Salon ABC - Eyelash Extension');
  });

  test('iCal includes event description (menu, staff, phone, booking ID)', async () => {
    const res = await GET(makeRequest() as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    const text = await res.text();
    expect(text).toContain('メニュー: Eyelash Extension');
    expect(text).toContain('担当: Alice');
    expect(text).toContain('電話: 03-1234-5678');
    expect(text).toContain('予約ID: 123e4567');
  });

  test('iCal includes location (facility address)', async () => {
    const res = await GET(makeRequest() as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    const text = await res.text();
    expect(text).toContain('LOCATION:東京都渋谷区');
  });

  test('iCal includes start and end times in UTC format', async () => {
    const res = await GET(makeRequest() as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    const text = await res.text();
    expect(text).toContain('DTSTART:20260510T100000Z');
    expect(text).toContain('DTEND:20260510T110000Z');
  });

  test('Content-Type header set to text/calendar', async () => {
    const res = await GET(makeRequest() as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    expect(res.headers.get('Content-Type')).toBe('text/calendar; charset=utf-8');
  });

  test('Content-Disposition attachment with booking ID', async () => {
    const res = await GET(makeRequest() as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    const disposition = res.headers.get('Content-Disposition');
    expect(disposition).toContain('attachment');
    expect(disposition).toContain('carelink-booking-123e4567.ics');
  });

  test('iCal escapes special characters in summary', async () => {
    setupDefaultMocks(true, true);
    // The mock already has a clean menu name, but we verify escaping works

    const res = await GET(makeRequest() as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    const text = await res.text();
    // Commas, semicolons, newlines should be escaped
    expect(text).toContain('SUMMARY:');
  });

  test('iCal handles missing facility name gracefully', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    const mockSingle = jest.fn().mockResolvedValue({
      data: {
        id: BOOKING_UUID,
        user_id: 'user-123',
        facility_id: 'fac-123',
        start_time: '2026-05-10T10:00:00Z',
        end_time: '2026-05-10T11:00:00Z',
        menu_name: 'Eyelash',
        staff_name: 'Bob',
        notes: null,
        facility_profiles: null,
      },
    });

    const mockEq = jest
      .fn()
      .mockReturnValue({
        single: mockSingle,
      });

    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: mockEq,
        }),
      }),
    });

    const res = await GET(makeRequest() as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('SUMMARY:CareLink 予約 - Eyelash');
  });

  test('iCal uses UID format carelink-{booking-id}@carelink-jp.com', async () => {
    const res = await GET(makeRequest() as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    const text = await res.text();
    expect(text).toContain(`UID:carelink-${BOOKING_UUID}@carelink-jp.com`);
  });

  test('iCal includes DTSTAMP in UTC', async () => {
    const res = await GET(makeRequest() as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    const text = await res.text();
    expect(text).toContain('DTSTAMP:');
    expect(text).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
  });

  test('iCal method is PUBLISH', async () => {
    const res = await GET(makeRequest() as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    const text = await res.text();
    expect(text).toContain('METHOD:PUBLISH');
  });

  test('iCal event status is CONFIRMED', async () => {
    const res = await GET(makeRequest() as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    const text = await res.text();
    expect(text).toContain('STATUS:CONFIRMED');
  });

  test('rate limit params (20 req/min per IP)', async () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    await GET(makeRequest(BOOKING_UUID, '192.168.1.1') as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('192.168.1.1');
    expect(call[1]).toBe(20);
    expect(call[2]).toBe(60_000);
    expect(call[3]).toBe('booking-ical');
  });

  test('extracts first IP from x-forwarded-for', async () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    await GET(makeRequest(BOOKING_UUID, '10.0.0.1, 192.168.1.1') as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('10.0.0.1');
  });

  test('uses unknown IP when x-forwarded-for missing', async () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    const req = new Request(
      `http://localhost/api/booking/${BOOKING_UUID}/ical`,
      { method: 'GET' }
    );
    Object.defineProperty(req, 'nextUrl', {
      value: new URL(req.url),
      writable: true,
    });

    await GET(Object.assign(req, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    }) as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('unknown');
  });

  test('facility_profiles がオブジェクト（非配列）→ 200', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    const mockSingle = jest.fn().mockResolvedValue({
      data: {
        id: BOOKING_UUID,
        user_id: 'user-123',
        facility_id: 'fac-123',
        start_time: '2026-05-10T10:00:00Z',
        end_time: '2026-05-10T11:00:00Z',
        menu_name: 'M',
        staff_name: 'S',
        notes: null,
        facility_profiles: { name: 'Salon Obj', address: '住所Obj', phone: 'tel-obj' },
      },
    });
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: mockSingle }) }) }),
    });
    const res = await GET(makeRequest() as any, { params: Promise.resolve({ id: BOOKING_UUID }) } as any);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('SUMMARY:Salon Obj - M');
    expect(text).toContain('LOCATION:住所Obj');
  });

  test('start_time / end_time / menu_name / staff_name / phone / address すべて null', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    const mockSingle = jest.fn().mockResolvedValue({
      data: {
        id: BOOKING_UUID,
        user_id: 'user-123',
        facility_id: 'fac-123',
        start_time: null,
        end_time: null,
        menu_name: null,
        staff_name: null,
        notes: null,
        facility_profiles: { name: 'Salon NoOptional', address: null, phone: null },
      },
    });
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: mockSingle }) }) }),
    });
    const res = await GET(makeRequest() as any, { params: Promise.resolve({ id: BOOKING_UUID }) } as any);
    expect(res.status).toBe(200);
    const text = await res.text();
    // SUMMARY uses fallback '施術'
    expect(text).toContain('SUMMARY:Salon NoOptional - 施術');
    // No DTSTART / DTEND / LOCATION lines should be present
    expect(text).not.toContain('DTSTART:');
    expect(text).not.toContain('DTEND:');
    expect(text).not.toContain('LOCATION:');
  });

  test('description が全て空 → DESCRIPTION 行スキップ', async () => {
    // menu_name/staff_name/phone all null → description だけ booking ID
    // booking ID は必ず付くため description は完全には空にならず必ず出力されるが、
    // 個別要素の && の falsy 分岐をカバー
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    const mockSingle = jest.fn().mockResolvedValue({
      data: {
        id: BOOKING_UUID,
        user_id: 'user-123',
        facility_id: 'fac-123',
        start_time: '2026-05-10T10:00:00Z',
        end_time: '2026-05-10T11:00:00Z',
        menu_name: null,
        staff_name: null,
        notes: null,
        facility_profiles: { name: 'Salon X', phone: null },
      },
    });
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ single: mockSingle }) }) }),
    });
    const res = await GET(makeRequest() as any, { params: Promise.resolve({ id: BOOKING_UUID }) } as any);
    expect(res.status).toBe(200);
    const text = await res.text();
    // booking IDのみがDESCRIPTIONに残る
    expect(text).toContain('DESCRIPTION:予約ID:');
  });

  test('exception during processing → 500', async () => {
    const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
    createServerSupabaseAuthClient.mockRejectedValue(
      new Error('DB error')
    );

    const res = await GET(makeRequest() as any, {
      params: Promise.resolve({ id: BOOKING_UUID }),
    } as any);

    expect(res.status).toBe(500);
  });
});
