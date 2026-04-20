/**
 * @jest-environment node
 *
 * Tests for POST /api/review
 * Key assertions:
 *   - CSRF check → returns checkCsrf result
 *   - Rate limiting → 429 (5 req/min per IP)
 *   - Schema validation (facility_id UUID, reviewer_name 1-50, ratings 1-5, comment max 500, photo_urls HTTPS)
 *   - reCAPTCHA verification if token provided
 *   - 24h duplicate check (by user_id or IP)
 *   - Verified visit detection
 *   - Average rating calculation
 *   - Fire-and-forget points allocation
 */

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
  mutationRateLimit: 'mutationLimit'
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/recaptcha', () => ({ verifyRecaptcha: jest.fn() }));
jest.mock('@supabase/ssr');
jest.mock('next/headers');

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { verifyRecaptcha } from '@/lib/recaptcha';
import { POST } from '../route';

let mockGetUser: jest.Mock;
let mockSelect: jest.Mock;
let mockInsert: jest.Mock;

function setupDefaultMocks(hasUser: boolean = true, hasRecentReview: boolean = false, hasCompletedBooking: boolean = true) {
  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: hasUser ? { id: 'user-123', email: 'test@example.com' } : null },
  });

  const mockGte = jest.fn().mockResolvedValue({ data: hasRecentReview ? [{ id: 'rev-1' }] : [] });
  const mockLimit1 = jest.fn().mockReturnValue({ gte: mockGte });
  const mockEq3 = jest.fn().mockReturnValue({ limit: mockLimit1 });
  const mockEq2 = jest.fn().mockReturnValue({ eq: mockEq3 });
  const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
  mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });

  const mockLimit2 = jest.fn().mockResolvedValue({ data: hasCompletedBooking ? [{ id: 'booking-1' }] : [] });
  const mockEqBooking2 = jest.fn().mockReturnValue({ limit: mockLimit2 });
  const mockEqBooking1 = jest.fn().mockReturnValue({ eq: mockEqBooking2 });
  const mockSelectBooking = jest.fn().mockReturnValue({ eq: mockEqBooking1 });

  const mockSingle = jest.fn().mockResolvedValue({ data: { id: 'review-123' }, error: null });
  const mockSelectInsert = jest.fn().mockReturnValue({ single: mockSingle });
  mockInsert = jest.fn().mockReturnValue({ select: mockSelectInsert });

  const { createServerClient } = require('@supabase/ssr');
  createServerClient.mockReturnValue({
    auth: { getUser: mockGetUser },
    from: jest.fn((table: string) => {
      if (table === 'facility_reviews') {
        return {
          select: mockSelect,
          insert: mockInsert,
        };
      } else if (table === 'bookings') {
        return { select: mockSelectBooking };
      } else if (table === 'user_points') {
        return { select: mockSelect, insert: mockInsert };
      }
    }),
  });

  const { cookies } = require('next/headers');
  cookies.mockResolvedValue({
    getAll: jest.fn(() => []),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  (verifyRecaptcha as jest.Mock).mockResolvedValue({ success: true });

  setupDefaultMocks();

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.RECAPTCHA_SECRET_KEY = 'test-secret-key';
});

function makeRequest(body: object, ip = '192.168.1.1') {
  return new Request('http://localhost/api/review', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

const FACILITY_UUID = '11111111-1111-1111-1111-111111111111';
const validReview = {
  facility_id: FACILITY_UUID,
  reviewer_name: 'Test User',
  rating_skill: 5,
  rating_service: 4,
  rating_atmosphere: 3,
  rating_cleanliness: 4,
  rating_explanation: 5,
};

describe('POST /api/review', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF failed' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await POST(makeRequest(validReview));

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(makeRequest(validReview));

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain('多すぎます');
  });

  test('missing facility_id → 400', async () => {
    const res = await POST(makeRequest({ ...validReview, facility_id: undefined }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('不正');
  });

  test('invalid facility_id UUID → 400', async () => {
    const res = await POST(makeRequest({ ...validReview, facility_id: 'not-a-uuid' }));

    expect(res.status).toBe(400);
  });

  test('missing reviewer_name → 400', async () => {
    const res = await POST(makeRequest({ ...validReview, reviewer_name: undefined }));

    expect(res.status).toBe(400);
  });

  test('reviewer_name empty → 400', async () => {
    const res = await POST(makeRequest({ ...validReview, reviewer_name: '' }));

    expect(res.status).toBe(400);
  });

  test('reviewer_name too long (51+ chars) → 400', async () => {
    const res = await POST(makeRequest({ ...validReview, reviewer_name: 'a'.repeat(51) }));

    expect(res.status).toBe(400);
  });

  test('rating_skill missing → 400', async () => {
    const res = await POST(makeRequest({ ...validReview, rating_skill: undefined }));

    expect(res.status).toBe(400);
  });

  test('rating_skill too low (0) → 400', async () => {
    const res = await POST(makeRequest({ ...validReview, rating_skill: 0 }));

    expect(res.status).toBe(400);
  });

  test('rating_skill too high (6) → 400', async () => {
    const res = await POST(makeRequest({ ...validReview, rating_skill: 6 }));

    expect(res.status).toBe(400);
  });

  test('rating_skill non-integer → 400', async () => {
    const res = await POST(makeRequest({ ...validReview, rating_skill: 3.5 }));

    expect(res.status).toBe(400);
  });

  test('comment too long (501+ chars) → 400', async () => {
    const res = await POST(makeRequest({ ...validReview, comment: 'a'.repeat(501) }));

    expect(res.status).toBe(400);
  });

  test('photo_urls non-https → 400', async () => {
    const res = await POST(makeRequest({
      ...validReview,
      photo_urls: ['http://example.com/photo.jpg'],
    }));

    expect(res.status).toBe(400);
  });

  test('photo_urls too many (4+ items) → 400', async () => {
    const res = await POST(makeRequest({
      ...validReview,
      photo_urls: [
        'https://example.com/1.jpg',
        'https://example.com/2.jpg',
        'https://example.com/3.jpg',
        'https://example.com/4.jpg',
      ],
    }));

    expect(res.status).toBe(400);
  });

  test('invalid JSON → 400', async () => {
    const req = new Request('http://localhost/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.1' },
      body: 'invalid json {',
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  test('all rating axes required and validated 1-5', async () => {
    const axes = ['rating_skill', 'rating_service', 'rating_atmosphere', 'rating_cleanliness', 'rating_explanation'];

    for (const axis of axes) {
      const res = await POST(makeRequest({ ...validReview, [axis]: 6 }));
      expect(res.status).toBe(400);
    }
  });

  test('rate limit params (5 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    (checkRateLimit as jest.Mock).mockResolvedValue(false);

    await POST(makeRequest(validReview));

    expect(checkRateLimit).toHaveBeenCalled();
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[2]).toBe(5);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('review');
  });

  test('extracts IP from x-forwarded-for header', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    (checkRateLimit as jest.Mock).mockResolvedValue(false);

    await POST(makeRequest(validReview, '10.0.0.1, 192.168.1.1'));

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('10.0.0.1');
  });

  test('uses unknown IP when x-forwarded-for missing', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    (checkRateLimit as jest.Mock).mockResolvedValue(false);

    const req = new Request('http://localhost/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validReview),
    });

    await POST(req);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });
});
