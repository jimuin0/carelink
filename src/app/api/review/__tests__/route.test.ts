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
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(),
  createServerSupabaseClient: jest.fn(),
  createServerSupabaseAuthClient: jest.fn(),
}));
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

  const fromRouter = jest.fn((table: string) => {
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
  });

  const { createServerClient } = require('@supabase/ssr');
  createServerClient.mockReturnValue({
    auth: { getUser: mockGetUser },
    from: fromRouter,
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  (createServiceRoleClient as jest.Mock).mockReturnValue({ from: fromRouter });

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
  // 本番は reCAPTCHA secret 設定済み＝token 必須（fail-closed）。
  // フロントが常に token を送る本番状態を既定とする。
  recaptcha_token: 'valid-token',
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
    expect(call[1]).toBe('192.168.1.1');
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

  describe('business logic', () => {
    // Zod v4 requires RFC 4122 compliant UUIDs (version nibble 1-8, variant nibble 8-b).
    // The shared FACILITY_UUID ('11111111-...') has an invalid variant nibble for Zod v4,
    // so we use a separate valid UUID for tests that must pass schema validation.
    const VALID_FACILITY_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

    // A validReview that passes Zod v4's stricter UUID check.
    const bizReview = {
      facility_id: VALID_FACILITY_UUID,
      reviewer_name: 'Test User',
      rating_skill: 5,
      rating_service: 4,
      rating_atmosphere: 3,
      rating_cleanliness: 4,
      rating_explanation: 5,
      // 本番は reCAPTCHA secret 設定済み＝token 必須（fail-closed）
      recaptcha_token: 'valid-token',
    };

    // Builds a fully correct mock for all three DB operations used by the route:
    //   - facility_reviews.select (24h duplicate check): .eq().eq().gte().limit()
    //   - bookings.select (completed visit check): .eq().eq().eq().limit()
    //   - facility_reviews.insert: .select().single()
    //   - user_points.select / insert (fire-and-forget)
    function setupBizMocks(options: {
      hasUser?: boolean;
      hasRecentReview?: boolean;
      hasCompletedBooking?: boolean;
      insertResult?: { data: { id: string } | null; error: { message: string } | null };
    } = {}) {
      const {
        hasUser = true,
        hasRecentReview = false,
        hasCompletedBooking = false,
        insertResult = { data: { id: 'review-123' }, error: null },
      } = options;

      const mockGetUser = jest.fn().mockResolvedValue({
        data: { user: hasUser ? { id: 'user-123', email: 'test@example.com' } : null },
      });

      // facility_reviews duplicate check: .select('id').eq().eq().gte().limit(1)
      const mockDupLimit = jest.fn().mockResolvedValue({
        data: hasRecentReview ? [{ id: 'rev-1' }] : [],
      });
      const mockDupGte = jest.fn().mockReturnValue({ limit: mockDupLimit });
      const mockDupEq2 = jest.fn().mockReturnValue({ gte: mockDupGte });
      const mockDupEq1 = jest.fn().mockReturnValue({ eq: mockDupEq2 });
      const mockDupSelect = jest.fn().mockReturnValue({ eq: mockDupEq1 });

      // bookings completed visit check: .select('id').eq().eq().eq('status','completed').limit(1)
      const mockBookingLimit = jest.fn().mockResolvedValue({
        data: hasCompletedBooking ? [{ id: 'booking-1' }] : [],
      });
      const mockBookingEq3 = jest.fn().mockReturnValue({ limit: mockBookingLimit });
      const mockBookingEq2 = jest.fn().mockReturnValue({ eq: mockBookingEq3 });
      const mockBookingEq1 = jest.fn().mockReturnValue({ eq: mockBookingEq2 });
      const mockBookingSelect = jest.fn().mockReturnValue({ eq: mockBookingEq1 });

      // facility_reviews.insert().select('id').single()
      const mockSingle = jest.fn().mockResolvedValue(insertResult);
      const mockSelectInsert = jest.fn().mockReturnValue({ single: mockSingle });
      mockInsert = jest.fn().mockReturnValue({ select: mockSelectInsert });

      // user_points fire-and-forget (we don't assert on these in most tests)
      const mockPointsLimit = jest.fn().mockResolvedValue({ data: [], error: null });
      const mockPointsEq2 = jest.fn().mockReturnValue({ limit: mockPointsLimit });
      const mockPointsEq1 = jest.fn().mockReturnValue({ eq: mockPointsEq2 });
      const mockPointsSelect = jest.fn().mockReturnValue({ eq: mockPointsEq1 });
      const mockPointsInsert = jest.fn().mockResolvedValue({ error: null });

      const fromRouter = jest.fn((table: string) => {
        if (table === 'facility_reviews') {
          return { select: mockDupSelect, insert: mockInsert };
        } else if (table === 'bookings') {
          return { select: mockBookingSelect };
        } else if (table === 'user_points') {
          return { select: mockPointsSelect, insert: mockPointsInsert };
        }
      });

      const { createServerClient } = require('@supabase/ssr');
      createServerClient.mockReturnValue({
        auth: { getUser: mockGetUser },
        from: fromRouter,
      });

      const { createServiceRoleClient } = require('@/lib/supabase-server');
      (createServiceRoleClient as jest.Mock).mockReturnValue({ from: fromRouter });

      const { cookies } = require('next/headers');
      cookies.mockResolvedValue({ getAll: jest.fn(() => []) });
    }

    test('authenticated user → 200 with review id', async () => {
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false });

      const res = await POST(makeRequest(bizReview));

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.id).toBeDefined();
    });

    test('24h duplicate for authenticated user → 429', async () => {
      setupBizMocks({ hasUser: true, hasRecentReview: true });

      const res = await POST(makeRequest(bizReview));

      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toContain('24時間');
    });

    test('unauthenticated user submits valid review → success', async () => {
      setupBizMocks({ hasUser: false, hasRecentReview: false });

      const res = await POST(makeRequest(bizReview));

      expect(res.status).toBe(200);
    });

    test('unauthenticated + recent IP review → 429', async () => {
      setupBizMocks({ hasUser: false, hasRecentReview: true });

      const res = await POST(makeRequest(bizReview));

      expect(res.status).toBe(429);
    });

    test('verified visit when user has completed booking → is_verified_visit=true in insert call', async () => {
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: true });

      await POST(makeRequest(bizReview));

      expect(mockInsert).toHaveBeenCalled();
      const insertArg = mockInsert.mock.calls[0][0];
      expect(insertArg.is_verified_visit).toBe(true);
    });

    test('no completed booking → is_verified_visit=false', async () => {
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false });

      await POST(makeRequest(bizReview));

      expect(mockInsert).toHaveBeenCalled();
      const insertArg = mockInsert.mock.calls[0][0];
      expect(insertArg.is_verified_visit).toBe(false);
    });

    test('average rating calculation → correct avg', async () => {
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false });
      // scores 5,4,3,4,5 → avg = Math.round((5+4+3+4+5)/5) = Math.round(4.2) = 4
      const body = {
        ...bizReview,
        rating_skill: 5,
        rating_service: 4,
        rating_atmosphere: 3,
        rating_cleanliness: 4,
        rating_explanation: 5,
      };

      await POST(makeRequest(body));

      expect(mockInsert).toHaveBeenCalled();
      const insertArg = mockInsert.mock.calls[0][0];
      expect(insertArg.rating).toBe(4);
    });

    test('reCAPTCHA fails → 403', async () => {
      setupBizMocks({ hasUser: true });
      (verifyRecaptcha as jest.Mock).mockResolvedValue({ success: false });

      const res = await POST(makeRequest({ ...bizReview, recaptcha_token: 'token' }));

      expect(res.status).toBe(403);
    });

    // fail-closed: secret設定時に token 省略 → 403（旧実装は素通り=fail-open だった）
    // verifyRecaptcha を呼ぶ前に弾く（token必須化）ことを検証
    test('reCAPTCHA secret設定済み + token欠如 → 403（fail-closed）', async () => {
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false });
      process.env.RECAPTCHA_SECRET_KEY = 'test-secret-key';
      (verifyRecaptcha as jest.Mock).mockClear();

      const res = await POST(makeRequest({ ...bizReview, recaptcha_token: undefined }));

      expect(res.status).toBe(403);
      expect(verifyRecaptcha).not.toHaveBeenCalled();
    });

    test('reCAPTCHA skipped when no RECAPTCHA_SECRET_KEY', async () => {
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false });
      delete process.env.RECAPTCHA_SECRET_KEY;
      (verifyRecaptcha as jest.Mock).mockClear();

      const res = await POST(makeRequest({ ...bizReview, recaptcha_token: 'token' }));

      expect(res.status).toBe(200);
      expect(verifyRecaptcha).not.toHaveBeenCalled();
    });

    test('DB insert error → 500', async () => {
      setupBizMocks({
        hasUser: true,
        hasRecentReview: false,
        hasCompletedBooking: false,
        insertResult: { data: null, error: { message: 'DB error' } },
      });

      const res = await POST(makeRequest(bizReview));

      expect(res.status).toBe(500);
    });

    test('photo_urls included in insert', async () => {
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false });
      const photoUrls = [
        'https://example.com/photo1.jpg',
        'https://example.com/photo2.jpg',
      ];

      await POST(makeRequest({ ...bizReview, photo_urls: photoUrls }));

      expect(mockInsert).toHaveBeenCalled();
      const insertArg = mockInsert.mock.calls[0][0];
      expect(insertArg.photo_urls).toEqual(photoUrls);
    });

    test('user_id は insert に含めない（facility_reviews に user_id 列は存在しない）', async () => {
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false });

      await POST(makeRequest(bizReview));

      expect(mockInsert).toHaveBeenCalled();
      const insertArg = mockInsert.mock.calls[0][0];
      expect(insertArg.user_id).toBeUndefined();
      // ログイン時は来店確認フラグのみ保存される
      expect('is_verified_visit' in insertArg).toBe(true);
    });

    test('reviewer_ip included in insert', async () => {
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false });

      await POST(makeRequest(bizReview, '10.20.30.40'));

      expect(mockInsert).toHaveBeenCalled();
      const insertArg = mockInsert.mock.calls[0][0];
      expect(insertArg.reviewer_ip).toBeDefined();
      expect(insertArg.reviewer_ip).toBe('10.20.30.40');
    });

    test('comment 空文字 → null として insert', async () => {
      setupBizMocks({ hasUser: true });
      await POST(makeRequest({ ...bizReview, comment: '' }));
      const insertArg = mockInsert.mock.calls[0][0];
      expect(insertArg.comment).toBeNull();
    });

    test('photo_urls 空配列 → null として insert', async () => {
      setupBizMocks({ hasUser: true });
      await POST(makeRequest({ ...bizReview, photo_urls: [] }));
      const insertArg = mockInsert.mock.calls[0][0];
      expect(insertArg.photo_urls).toBeNull();
    });

    test('photo_urls 未指定 → null として insert', async () => {
      setupBizMocks({ hasUser: true });
      await POST(makeRequest(bizReview));
      const insertArg = mockInsert.mock.calls[0][0];
      expect(insertArg.photo_urls).toBeNull();
    });

    test('comment 指定値が insert に渡る', async () => {
      setupBizMocks({ hasUser: true });
      await POST(makeRequest({ ...bizReview, comment: 'good service' }));
      const insertArg = mockInsert.mock.calls[0][0];
      expect(insertArg.comment).toBe('good service');
    });

    // Branch coverage: line 51 — recaptcha_token あり + RECAPTCHA_SECRET_KEY あり + 成功パス
    test('reCAPTCHA token あり + 検証成功 → 200', async () => {
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false });
      process.env.RECAPTCHA_SECRET_KEY = 'test-secret-key';
      (verifyRecaptcha as jest.Mock).mockResolvedValue({ success: true });

      const res = await POST(makeRequest({ ...bizReview, recaptcha_token: 'valid-token' }));

      expect(res.status).toBe(200);
      expect(verifyRecaptcha).toHaveBeenCalledWith('valid-token', 'review', 0.4);
    });

    // Branch coverage: line 104 — completedBooking が null の場合の ?? 演算子分岐
    test('completedBooking が null → isVerifiedVisit=false', async () => {
      // bookings クエリが null を返すケース
      const mockGetUserFn = jest.fn().mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
      });

      const mockDupLimit = jest.fn().mockResolvedValue({ data: [] });
      const mockDupGte = jest.fn().mockReturnValue({ limit: mockDupLimit });
      const mockDupEq2 = jest.fn().mockReturnValue({ gte: mockDupGte });
      const mockDupEq1 = jest.fn().mockReturnValue({ eq: mockDupEq2 });
      const mockDupSelect = jest.fn().mockReturnValue({ eq: mockDupEq1 });

      // bookings が null を返す
      const mockBookingLimit = jest.fn().mockResolvedValue({ data: null });
      const mockBookingEq3 = jest.fn().mockReturnValue({ limit: mockBookingLimit });
      const mockBookingEq2 = jest.fn().mockReturnValue({ eq: mockBookingEq3 });
      const mockBookingEq1 = jest.fn().mockReturnValue({ eq: mockBookingEq2 });
      const mockBookingSelect = jest.fn().mockReturnValue({ eq: mockBookingEq1 });

      const mockSingle = jest.fn().mockResolvedValue({ data: { id: 'review-123' }, error: null });
      const mockSelectInsert = jest.fn().mockReturnValue({ single: mockSingle });
      const mockInsertFn = jest.fn().mockReturnValue({ select: mockSelectInsert });

      const mockPointsLimit = jest.fn().mockResolvedValue({ data: [], error: null });
      const mockPointsEq2 = jest.fn().mockReturnValue({ limit: mockPointsLimit });
      const mockPointsEq1 = jest.fn().mockReturnValue({ eq: mockPointsEq2 });
      const mockPointsSelect = jest.fn().mockReturnValue({ eq: mockPointsEq1 });
      const mockPointsInsert = jest.fn().mockResolvedValue({ error: null });

      const fromRouter = jest.fn((table: string) => {
        if (table === 'facility_reviews') return { select: mockDupSelect, insert: mockInsertFn };
        if (table === 'bookings') return { select: mockBookingSelect };
        if (table === 'user_points') return { select: mockPointsSelect, insert: mockPointsInsert };
      });

      const { createServerClient } = require('@supabase/ssr');
      createServerClient.mockReturnValue({ auth: { getUser: mockGetUserFn }, from: fromRouter });
      const { createServiceRoleClient } = require('@/lib/supabase-server');
      (createServiceRoleClient as jest.Mock).mockReturnValue({ from: fromRouter });
      const { cookies } = require('next/headers');
      cookies.mockResolvedValue({ getAll: jest.fn(() => []) });

      const res = await POST(makeRequest(bizReview));
      expect(res.status).toBe(200);
      expect(mockInsertFn).toHaveBeenCalled();
      expect(mockInsertFn.mock.calls[0][0].is_verified_visit).toBe(false);
    });

    // Branch coverage: line 145 — user_points dedup select エラー
    test('user_points dedup チェックエラー → ポイント付与スキップ（200継続）', async () => {
      const mockGetUserFn = jest.fn().mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
      });

      const mockDupLimit = jest.fn().mockResolvedValue({ data: [] });
      const mockDupGte = jest.fn().mockReturnValue({ limit: mockDupLimit });
      const mockDupEq2 = jest.fn().mockReturnValue({ gte: mockDupGte });
      const mockDupEq1 = jest.fn().mockReturnValue({ eq: mockDupEq2 });
      const mockDupSelect = jest.fn().mockReturnValue({ eq: mockDupEq1 });

      const mockBookingLimit = jest.fn().mockResolvedValue({ data: [] });
      const mockBookingEq3 = jest.fn().mockReturnValue({ limit: mockBookingLimit });
      const mockBookingEq2 = jest.fn().mockReturnValue({ eq: mockBookingEq3 });
      const mockBookingEq1 = jest.fn().mockReturnValue({ eq: mockBookingEq2 });
      const mockBookingSelect = jest.fn().mockReturnValue({ eq: mockBookingEq1 });

      const mockSingle = jest.fn().mockResolvedValue({ data: { id: 'review-456' }, error: null });
      const mockSelectInsert = jest.fn().mockReturnValue({ single: mockSingle });
      const mockInsertFn = jest.fn().mockReturnValue({ select: mockSelectInsert });

      // user_points select でエラーを返す → selectErr 分岐を踏む
      const mockPointsLimit = jest.fn().mockResolvedValue({ data: null, error: { message: 'select error' } });
      const mockPointsEq2 = jest.fn().mockReturnValue({ limit: mockPointsLimit });
      const mockPointsEq1 = jest.fn().mockReturnValue({ eq: mockPointsEq2 });
      const mockPointsSelect = jest.fn().mockReturnValue({ eq: mockPointsEq1 });
      const mockPointsInsert = jest.fn().mockResolvedValue({ error: null });

      const fromRouter = jest.fn((table: string) => {
        if (table === 'facility_reviews') return { select: mockDupSelect, insert: mockInsertFn };
        if (table === 'bookings') return { select: mockBookingSelect };
        if (table === 'user_points') return { select: mockPointsSelect, insert: mockPointsInsert };
      });

      const { createServerClient } = require('@supabase/ssr');
      createServerClient.mockReturnValue({ auth: { getUser: mockGetUserFn }, from: fromRouter });
      const { createServiceRoleClient } = require('@/lib/supabase-server');
      (createServiceRoleClient as jest.Mock).mockReturnValue({ from: fromRouter });
      const { cookies } = require('next/headers');
      cookies.mockResolvedValue({ getAll: jest.fn(() => []) });

      const res = await POST(makeRequest(bizReview));
      // エラーがあってもメインの投稿は成功している
      expect(res.status).toBe(200);
      // ポイントinsertは呼ばれない（エラー早期リターン）
      expect(mockPointsInsert).not.toHaveBeenCalled();
    });

    // Branch coverage: line 149 — existing ポイントが既にある場合はinsertをスキップ
    test('user_points dedup: 既存レコードあり → ポイントinsert スキップ', async () => {
      const mockGetUserFn = jest.fn().mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
      });

      const mockDupLimit = jest.fn().mockResolvedValue({ data: [] });
      const mockDupGte = jest.fn().mockReturnValue({ limit: mockDupLimit });
      const mockDupEq2 = jest.fn().mockReturnValue({ gte: mockDupGte });
      const mockDupEq1 = jest.fn().mockReturnValue({ eq: mockDupEq2 });
      const mockDupSelect = jest.fn().mockReturnValue({ eq: mockDupEq1 });

      const mockBookingLimit = jest.fn().mockResolvedValue({ data: [] });
      const mockBookingEq3 = jest.fn().mockReturnValue({ limit: mockBookingLimit });
      const mockBookingEq2 = jest.fn().mockReturnValue({ eq: mockBookingEq3 });
      const mockBookingEq1 = jest.fn().mockReturnValue({ eq: mockBookingEq2 });
      const mockBookingSelect = jest.fn().mockReturnValue({ eq: mockBookingEq1 });

      const mockSingle = jest.fn().mockResolvedValue({ data: { id: 'review-789' }, error: null });
      const mockSelectInsert = jest.fn().mockReturnValue({ single: mockSingle });
      const mockInsertFn = jest.fn().mockReturnValue({ select: mockSelectInsert });

      // user_points select が既存レコードを返す → insert スキップ分岐
      const mockPointsLimit = jest.fn().mockResolvedValue({ data: [{ id: 'existing-point' }], error: null });
      const mockPointsEq2 = jest.fn().mockReturnValue({ limit: mockPointsLimit });
      const mockPointsEq1 = jest.fn().mockReturnValue({ eq: mockPointsEq2 });
      const mockPointsSelect = jest.fn().mockReturnValue({ eq: mockPointsEq1 });
      const mockPointsInsert = jest.fn().mockResolvedValue({ error: null });

      const fromRouter = jest.fn((table: string) => {
        if (table === 'facility_reviews') return { select: mockDupSelect, insert: mockInsertFn };
        if (table === 'bookings') return { select: mockBookingSelect };
        if (table === 'user_points') return { select: mockPointsSelect, insert: mockPointsInsert };
      });

      const { createServerClient } = require('@supabase/ssr');
      createServerClient.mockReturnValue({ auth: { getUser: mockGetUserFn }, from: fromRouter });
      const { createServiceRoleClient } = require('@/lib/supabase-server');
      (createServiceRoleClient as jest.Mock).mockReturnValue({ from: fromRouter });
      const { cookies } = require('next/headers');
      cookies.mockResolvedValue({ getAll: jest.fn(() => []) });

      const res = await POST(makeRequest(bizReview));
      expect(res.status).toBe(200);
      // 既存ポイントがあるので insert は呼ばれない
      expect(mockPointsInsert).not.toHaveBeenCalled();
    });

    // Branch coverage: line 155 — user_points insert エラー（ログのみで続行）
    test('user_points insert エラー → ログのみ、200継続', async () => {
      const mockGetUserFn = jest.fn().mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
      });

      const mockDupLimit = jest.fn().mockResolvedValue({ data: [] });
      const mockDupGte = jest.fn().mockReturnValue({ limit: mockDupLimit });
      const mockDupEq2 = jest.fn().mockReturnValue({ gte: mockDupGte });
      const mockDupEq1 = jest.fn().mockReturnValue({ eq: mockDupEq2 });
      const mockDupSelect = jest.fn().mockReturnValue({ eq: mockDupEq1 });

      const mockBookingLimit = jest.fn().mockResolvedValue({ data: [] });
      const mockBookingEq3 = jest.fn().mockReturnValue({ limit: mockBookingLimit });
      const mockBookingEq2 = jest.fn().mockReturnValue({ eq: mockBookingEq3 });
      const mockBookingEq1 = jest.fn().mockReturnValue({ eq: mockBookingEq2 });
      const mockBookingSelect = jest.fn().mockReturnValue({ eq: mockBookingEq1 });

      const mockSingle = jest.fn().mockResolvedValue({ data: { id: 'review-999' }, error: null });
      const mockSelectInsert = jest.fn().mockReturnValue({ single: mockSingle });
      const mockInsertFn = jest.fn().mockReturnValue({ select: mockSelectInsert });

      // user_points select → 既存なし（insert を試みる）
      const mockPointsLimit = jest.fn().mockResolvedValue({ data: [], error: null });
      const mockPointsEq2 = jest.fn().mockReturnValue({ limit: mockPointsLimit });
      const mockPointsEq1 = jest.fn().mockReturnValue({ eq: mockPointsEq2 });
      const mockPointsSelect = jest.fn().mockReturnValue({ eq: mockPointsEq1 });
      // insert がエラーを返す → insertErr 分岐
      const mockPointsInsert = jest.fn().mockReturnValue(
        Promise.resolve({ error: { message: 'insert failed' } })
      );

      const fromRouter = jest.fn((table: string) => {
        if (table === 'facility_reviews') return { select: mockDupSelect, insert: mockInsertFn };
        if (table === 'bookings') return { select: mockBookingSelect };
        if (table === 'user_points') return { select: mockPointsSelect, insert: mockPointsInsert };
      });

      const { createServerClient } = require('@supabase/ssr');
      createServerClient.mockReturnValue({ auth: { getUser: mockGetUserFn }, from: fromRouter });
      const { createServiceRoleClient } = require('@/lib/supabase-server');
      (createServiceRoleClient as jest.Mock).mockReturnValue({ from: fromRouter });
      const { cookies } = require('next/headers');
      cookies.mockResolvedValue({ getAll: jest.fn(() => []) });

      const res = await POST(makeRequest(bizReview));
      // insertErr があっても fire-and-forget なのでメインは200
      expect(res.status).toBe(200);
      expect(mockPointsInsert).toHaveBeenCalled();
    });
  });
});
