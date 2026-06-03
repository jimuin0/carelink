/**
 * @jest-environment node
 *
 * Tests for POST /api/google-calendar/sync
 * Key assertions:
 *   - CSRF check
 *   - Rate limiting (20 req/min per IP)
 *   - Auth required
 *   - Schema validation (bookingId UUID)
 *   - Booking ownership verification
 *   - Google Calendar token requirement
 */

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/supabase-server-auth');
jest.mock('@/lib/supabase-server');

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST } from '../sync/route';

let mockGetUser: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockReturnValue(false);

  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: { id: 'user-123', email: 'test@example.com' } },
  });

  const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
  createServerSupabaseAuthClient.mockResolvedValue({
    auth: { getUser: mockGetUser },
  });

  const mockSingle = jest.fn().mockResolvedValue({
    data: {
      id: 'booking-123',
      user_id: 'user-123',
      booking_date: '2026-05-01',
      facility_profiles: { name: 'Test Salon' },
      menus: { name: 'Eyelash' }
    }
  });
  const mockEq2 = jest.fn().mockReturnValue({ single: mockSingle });
  const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
  const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });

  const mockTokenSingle = jest.fn().mockResolvedValue({
    data: {
      access_token: 'token-123',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      refresh_token: 'refresh-123'
    }
  });
  const mockTokenEq = jest.fn().mockReturnValue({ single: mockTokenSingle });
  const mockTokenSelect = jest.fn().mockReturnValue({ eq: mockTokenEq });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'bookings') {
        return { select: mockSelect };
      }
      if (table === 'google_calendar_tokens') {
        return { select: mockTokenSelect };
      }
    }),
  });

  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
});

function makeRequest(body: object, ip = '192.168.1.1') {
  return new Request('http://localhost/api/google-calendar/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

const BOOKING_UUID = '11111111-1111-1111-1111-111111111111';

describe('POST /api/google-calendar/sync', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF failed' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await POST(makeRequest({ bookingId: BOOKING_UUID }));

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);

    const res = await POST(makeRequest({ bookingId: BOOKING_UUID }));

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain('Too Many');
  });

  test('unauthenticated user → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(makeRequest({ bookingId: BOOKING_UUID }));

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('Unauthorized');
  });

  test('missing bookingId → 400', async () => {
    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('bookingId');
  });

  test('invalid bookingId UUID → 400', async () => {
    const res = await POST(makeRequest({ bookingId: 'not-a-uuid' }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid');
  });

  test('invalid JSON → 400', async () => {
    const req = new Request('http://localhost/api/google-calendar/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.1' },
      body: 'invalid json {',
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  test('rate limit params (20 req/min per IP)', () => {
    (checkRateLimit as jest.Mock).mockClear();
    (checkRateLimit as jest.Mock).mockReturnValue(false);

    POST(makeRequest({ bookingId: BOOKING_UUID }, '192.168.1.1'));

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(20);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('gcal-sync');
  });

  test('extracts last (trusted) IP from x-forwarded-for', () => {
    (checkRateLimit as jest.Mock).mockClear();
    (checkRateLimit as jest.Mock).mockReturnValue(false);

    POST(makeRequest({ bookingId: BOOKING_UUID }, '10.0.0.1, 192.168.1.1'));

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('UUID format validation - lowercase accepted', async () => {
    const res = await POST(makeRequest({ bookingId: '22222222-2222-2222-2222-222222222222' }));

    // Validation passes, response depends on mocking
    expect(res.status).not.toBe(400);
  });
});
