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
jest.mock('@/lib/push', () => ({ sendPushToFacilityOwners: jest.fn(() => Promise.resolve()) }));
jest.mock('@/lib/notification-settings', () => ({ getFacilityNotificationSettings: jest.fn() }));
jest.mock('@/lib/email', () => ({ sendNewReviewNotification: jest.fn(() => Promise.resolve(true)) }));

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { verifyRecaptcha } from '@/lib/recaptcha';
import { sendNewReviewNotification } from '@/lib/email';
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

  // role フィルタは .eq('role','owner')→.in('role',['owner','admin']) に変わった（2026年7月17日
  // admin ロールへのメール通知統一）ため、.eq/.in どちらで終端されても同じ結果に解決する。
  const mockMembersEq2 = jest.fn().mockResolvedValue({ data: [{ user_id: 'owner-1' }] });
  const mockMembersEq1 = jest.fn().mockReturnValue({ eq: mockMembersEq2, in: mockMembersEq2 });
  const mockMembersSelect = jest.fn().mockReturnValue({ eq: mockMembersEq1 });

  const mockProfilesIn = jest.fn().mockResolvedValue({ data: [{ email: 'owner@example.invalid' }] });
  const mockProfilesSelect = jest.fn().mockReturnValue({ in: mockProfilesIn });

  const mockFacilitySingle = jest.fn().mockResolvedValue({ data: { name: 'テスト施設' } });
  const mockFacilityEq = jest.fn().mockReturnValue({ single: mockFacilitySingle });
  const mockFacilitySelect = jest.fn().mockReturnValue({ eq: mockFacilityEq });

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
    } else if (table === 'facility_members') {
      return { select: mockMembersSelect };
    } else if (table === 'profiles') {
      return { select: mockProfilesSelect };
    } else if (table === 'facility_profiles') {
      return { select: mockFacilitySelect };
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
  // 既定は口コミPush ON（既存挙動＋新機能）
  const { getFacilityNotificationSettings } = require('@/lib/notification-settings');
  (getFacilityNotificationSettings as jest.Mock).mockResolvedValue({
    pushOnNewBooking: true, pushOnCancel: true, pushOnReview: true,
    emailDailySummary: false, emailWeeklyReport: true,
  });

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

  // 【2026年7月8日 恒久根治の回帰防止】.trim() 追加前は "   "(空白のみ)が min(1) を素通りし、
  // スペースのみの投稿者名が保存され得た。
  test('reviewer_name がスペースのみ → 400', async () => {
    const res = await POST(makeRequest({ ...validReview, reviewer_name: '   ' }));

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
      ownerUserIds?: string[];
      ownerEmails?: (string | null)[];
    } = {}) {
      const {
        hasUser = true,
        hasRecentReview = false,
        hasCompletedBooking = false,
        insertResult = { data: { id: 'review-123' }, error: null },
        ownerUserIds = ['owner-1'],
        ownerEmails = ['owner@example.invalid'],
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

      // facility_members.select('user_id').eq('facility_id',...).in('role',['owner','admin'])
      // role フィルタは .eq('role','owner')→.in('role',['owner','admin']) に変わった（2026年7月17日
      // admin ロールへのメール通知統一）ため、.eq/.in どちらで終端されても同じ結果に解決する共有
      // モックにし、呼び出し引数を検証できるよう外に返す。
      const mockMembersRoleFilter = jest.fn().mockResolvedValue({ data: ownerUserIds.map((id) => ({ user_id: id })) });
      const mockMembersEq1 = jest.fn().mockReturnValue({ eq: mockMembersRoleFilter, in: mockMembersRoleFilter });
      const mockMembersSelect = jest.fn().mockReturnValue({ eq: mockMembersEq1 });

      // profiles.select('email').in('id', [...])
      const mockProfilesIn = jest.fn().mockResolvedValue({ data: ownerEmails.map((e) => ({ email: e })) });
      const mockProfilesSelect = jest.fn().mockReturnValue({ in: mockProfilesIn });

      // facility_profiles.select('name').eq('id',...).single()
      const mockFacilitySingle = jest.fn().mockResolvedValue({ data: { name: 'テスト施設' } });
      const mockFacilityEq = jest.fn().mockReturnValue({ single: mockFacilitySingle });
      const mockFacilitySelect = jest.fn().mockReturnValue({ eq: mockFacilityEq });

      const fromRouter = jest.fn((table: string) => {
        if (table === 'facility_reviews') {
          return { select: mockDupSelect, insert: mockInsert };
        } else if (table === 'bookings') {
          return { select: mockBookingSelect };
        } else if (table === 'user_points') {
          return { select: mockPointsSelect, insert: mockPointsInsert };
        } else if (table === 'facility_members') {
          return { select: mockMembersSelect };
        } else if (table === 'profiles') {
          return { select: mockProfilesSelect };
        } else if (table === 'facility_profiles') {
          return { select: mockFacilitySelect };
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

      return { mockMembersRoleFilter };
    }

    test('authenticated user → 200 with review id', async () => {
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false });

      const res = await POST(makeRequest(bizReview));

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.id).toBeDefined();
    });

    test('口コミ投稿成功時 push_on_review=true → 施設オーナーへ Push を送る', async () => {
      const { sendPushToFacilityOwners } = require('@/lib/push');
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false });
      const res = await POST(makeRequest(bizReview));
      expect(res.status).toBe(200);
      await new Promise(r => setTimeout(r, 10));
      expect(sendPushToFacilityOwners).toHaveBeenCalledWith(VALID_FACILITY_UUID, expect.objectContaining({ title: expect.stringContaining('口コミ') }));
    });

    test('push_on_review=false → 施設オーナーへ Push を送らない', async () => {
      const { sendPushToFacilityOwners } = require('@/lib/push');
      const { getFacilityNotificationSettings } = require('@/lib/notification-settings');
      (getFacilityNotificationSettings as jest.Mock).mockResolvedValue({
        pushOnNewBooking: true, pushOnCancel: true, pushOnReview: false,
        emailDailySummary: false, emailWeeklyReport: true,
      });
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false });
      const res = await POST(makeRequest(bizReview));
      expect(res.status).toBe(200);
      expect(sendPushToFacilityOwners).not.toHaveBeenCalled();
    });

    test('Push 設定取得が例外でも投稿成功を返す（防御 catch）', async () => {
      const { getFacilityNotificationSettings } = require('@/lib/notification-settings');
      (getFacilityNotificationSettings as jest.Mock).mockRejectedValue(new Error('settings down'));
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false });
      const res = await POST(makeRequest(bizReview));
      expect(res.status).toBe(200);
      expect((await res.json()).success).toBe(true);
    });

    test('口コミ投稿成功時 push_on_review=true → 施設オーナーへメールを送る', async () => {
      const { sendNewReviewNotification } = require('@/lib/email');
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false, ownerEmails: ['owner@example.invalid'] });
      const res = await POST(makeRequest(bizReview));
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 10));
      expect(sendNewReviewNotification).toHaveBeenCalledWith(expect.objectContaining({ facilityEmail: 'owner@example.invalid' }));
    });

    test('施設にオーナーがいない場合はメールを送らない', async () => {
      const { sendNewReviewNotification } = require('@/lib/email');
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false, ownerUserIds: [] });
      const res = await POST(makeRequest(bizReview));
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 10));
      expect(sendNewReviewNotification).not.toHaveBeenCalled();
    });

    // 【2026年7月17日 admin ロールへのメール通知統一】facility_members の admin ロールは
    // push.ts(sendPushToFacilityOwners) では通知対象だが、口コミ通知メールは .eq('role','owner')
    // のため対象外という非対称があった。role フィルタが push.ts と同じ .in('role',['owner','admin'])
    // で呼ばれること（.eq('role','owner') に戻す退行があれば失敗する）と、admin ロールのメンバーにも
    // 実際にメールが届くこと（owner・admin混在で重複排除も維持されること）を検証する。
    test('owner+adminが混在 → 両ロールへメール通知が送られ、role フィルタは owner/admin 両方を含む', async () => {
      const { sendNewReviewNotification } = require('@/lib/email');
      const { mockMembersRoleFilter } = setupBizMocks({
        hasUser: true, hasRecentReview: false, hasCompletedBooking: false,
        ownerUserIds: ['owner-1', 'admin-1'],
        ownerEmails: ['owner1@example.invalid', 'admin1@example.invalid'],
      });
      const res = await POST(makeRequest(bizReview));
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 10));
      expect(mockMembersRoleFilter).toHaveBeenCalledWith('role', ['owner', 'admin']);
      expect(sendNewReviewNotification).toHaveBeenCalledTimes(2);
      const sentEmails = (sendNewReviewNotification as jest.Mock).mock.calls.map((c) => c[0].facilityEmail).sort();
      expect(sentEmails).toEqual(['admin1@example.invalid', 'owner1@example.invalid']);
    });

    test('owner+adminが同じメールアドレス → 重複排除で1通のみ', async () => {
      const { sendNewReviewNotification } = require('@/lib/email');
      const { mockMembersRoleFilter } = setupBizMocks({
        hasUser: true, hasRecentReview: false, hasCompletedBooking: false,
        ownerUserIds: ['owner-1', 'admin-1'],
        ownerEmails: ['shared@example.invalid', 'shared@example.invalid'],
      });
      const res = await POST(makeRequest(bizReview));
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 10));
      expect(mockMembersRoleFilter).toHaveBeenCalledWith('role', ['owner', 'admin']);
      expect(sendNewReviewNotification).toHaveBeenCalledTimes(1);
      expect((sendNewReviewNotification as jest.Mock).mock.calls[0][0].facilityEmail).toBe('shared@example.invalid');
    });

    test('メール送信が失敗(false)を返しても投稿成功を返す（防御）', async () => {
      const { sendNewReviewNotification } = require('@/lib/email');
      (sendNewReviewNotification as jest.Mock).mockResolvedValueOnce(false);
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false });
      const res = await POST(makeRequest(bizReview));
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 10));
      expect((await res.json()).success).toBe(true);
    });

    // 恒久根治の回帰防止（2026年7月7日）: 通知メール送信は fire-and-forget(waitUntil)ではなく
    // レスポンス返却前に await で確実に完了させる。Fluid Compute 無効の本番では waitUntil の
    // 後処理が凍結され、ローンチ以来 waitUntil 経由の通知メールが1通も送信されていなかった
    // （Resend 送信履歴の実データで確定）。送信が未完了の間はレスポンスも確定しないことを保証する。
    test('メール送信が完了するまでレスポンスを確定させない（awaitで確実に完了）', async () => {
      const { sendNewReviewNotification } = require('@/lib/email');
      let resolveSend: (() => void) | undefined;
      (sendNewReviewNotification as jest.Mock).mockReturnValueOnce(
        new Promise<boolean>((resolve) => {
          resolveSend = () => resolve(true);
        })
      );
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false, ownerEmails: ['owner@example.invalid'] });

      const postPromise = POST(makeRequest(bizReview));
      let settled = false;
      void postPromise.then(() => { settled = true; });

      // 送信 Promise が未解決の間はレスポンスも確定しない（＝fire-and-forget でない）。
      await new Promise((r) => setTimeout(r, 20));
      expect(settled).toBe(false);
      expect(sendNewReviewNotification).toHaveBeenCalledWith(expect.objectContaining({ facilityEmail: 'owner@example.invalid' }));

      // 送信完了でレスポンスが確定する。
      resolveSend!();
      const res = await postPromise;
      expect(settled).toBe(true);
      expect(res.status).toBe(200);
      expect((await res.json()).success).toBe(true);
    });

    // facility_reviews(24h重複チェック)/bookings(来店確認)の基本チェーンを共通化。
    function baseDupAndBookingHandlers() {
      const dupLimit = jest.fn().mockResolvedValue({ data: [] });
      const dupGte = jest.fn().mockReturnValue({ limit: dupLimit });
      const dupEq2 = jest.fn().mockReturnValue({ gte: dupGte });
      const dupEq1 = jest.fn().mockReturnValue({ eq: dupEq2 });
      const dupSelect = jest.fn().mockReturnValue({ eq: dupEq1 });

      const bookingLimit = jest.fn().mockResolvedValue({ data: [] });
      const bookingEq3 = jest.fn().mockReturnValue({ limit: bookingLimit });
      const bookingEq2 = jest.fn().mockReturnValue({ eq: bookingEq3 });
      const bookingEq1 = jest.fn().mockReturnValue({ eq: bookingEq2 });
      const bookingSelect = jest.fn().mockReturnValue({ eq: bookingEq1 });

      return { dupSelect, bookingSelect };
    }

    test('ownerRowsがnull → メール送信自体が発生しない（防御）', async () => {
      const { sendNewReviewNotification } = require('@/lib/email');
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false });

      const { createServiceRoleClient } = require('@/lib/supabase-server');
      const { dupSelect, bookingSelect } = baseDupAndBookingHandlers();
      const insertSingle = jest.fn().mockResolvedValue({ data: { id: 'review-123' }, error: null });
      const insertSelect = jest.fn().mockReturnValue({ single: insertSingle });
      const insertFn = jest.fn().mockReturnValue({ select: insertSelect });
      const nullMembersRoleFilter = jest.fn().mockResolvedValue({ data: null });
      const nullMembersEq1 = jest.fn().mockReturnValue({ eq: nullMembersRoleFilter, in: nullMembersRoleFilter });
      const nullMembersSelect = jest.fn().mockReturnValue({ eq: nullMembersEq1 });
      const overrideFrom = jest.fn((table: string) => {
        if (table === 'facility_reviews') return { select: dupSelect, insert: insertFn };
        if (table === 'bookings') return { select: bookingSelect };
        if (table === 'facility_members') return { select: nullMembersSelect };
        return { select: jest.fn() };
      });
      (createServiceRoleClient as jest.Mock).mockReturnValue({ from: overrideFrom });

      const res = await POST(makeRequest(bizReview));
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 10));
      expect(sendNewReviewNotification).not.toHaveBeenCalled();
    });

    test('ownerProfilesがnull → メール送信自体が発生しない（防御）', async () => {
      const { sendNewReviewNotification } = require('@/lib/email');
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false, ownerUserIds: ['owner-1'] });

      const { createServiceRoleClient } = require('@/lib/supabase-server');
      const { dupSelect, bookingSelect } = baseDupAndBookingHandlers();
      const insertSingle = jest.fn().mockResolvedValue({ data: { id: 'review-123' }, error: null });
      const insertSelect = jest.fn().mockReturnValue({ single: insertSingle });
      const insertFn = jest.fn().mockReturnValue({ select: insertSelect });
      const membersRoleFilter = jest.fn().mockResolvedValue({ data: [{ user_id: 'owner-1' }] });
      const membersEq1 = jest.fn().mockReturnValue({ eq: membersRoleFilter, in: membersRoleFilter });
      const membersSelect = jest.fn().mockReturnValue({ eq: membersEq1 });
      const nullProfilesIn = jest.fn().mockResolvedValue({ data: null });
      const nullProfilesSelect = jest.fn().mockReturnValue({ in: nullProfilesIn });

      const overrideFrom = jest.fn((table: string) => {
        if (table === 'facility_reviews') return { select: dupSelect, insert: insertFn };
        if (table === 'bookings') return { select: bookingSelect };
        if (table === 'facility_members') return { select: membersSelect };
        if (table === 'profiles') return { select: nullProfilesSelect };
        return { select: jest.fn() };
      });
      (createServiceRoleClient as jest.Mock).mockReturnValue({ from: overrideFrom });

      const res = await POST(makeRequest(bizReview));
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 10));
      expect(sendNewReviewNotification).not.toHaveBeenCalled();
    });

    test('facilityRowがnull → メールは空文字の施設名で送信される（防御）', async () => {
      const { sendNewReviewNotification } = require('@/lib/email');
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false, ownerUserIds: ['owner-1'], ownerEmails: ['owner@example.invalid'] });

      const { createServiceRoleClient } = require('@/lib/supabase-server');
      const { dupSelect, bookingSelect } = baseDupAndBookingHandlers();
      const insertSingle = jest.fn().mockResolvedValue({ data: { id: 'review-123' }, error: null });
      const insertSelect = jest.fn().mockReturnValue({ single: insertSingle });
      const insertFn = jest.fn().mockReturnValue({ select: insertSelect });
      const membersRoleFilter = jest.fn().mockResolvedValue({ data: [{ user_id: 'owner-1' }] });
      const membersEq1 = jest.fn().mockReturnValue({ eq: membersRoleFilter, in: membersRoleFilter });
      const membersSelect = jest.fn().mockReturnValue({ eq: membersEq1 });
      const profilesIn = jest.fn().mockResolvedValue({ data: [{ email: 'owner@example.invalid' }] });
      const profilesSelect = jest.fn().mockReturnValue({ in: profilesIn });
      const nullFacilitySingle = jest.fn().mockResolvedValue({ data: null });
      const nullFacilityEq = jest.fn().mockReturnValue({ single: nullFacilitySingle });
      const nullFacilitySelect = jest.fn().mockReturnValue({ eq: nullFacilityEq });

      const overrideFrom = jest.fn((table: string) => {
        if (table === 'facility_reviews') return { select: dupSelect, insert: insertFn };
        if (table === 'bookings') return { select: bookingSelect };
        if (table === 'facility_members') return { select: membersSelect };
        if (table === 'profiles') return { select: profilesSelect };
        if (table === 'facility_profiles') return { select: nullFacilitySelect };
        return { select: jest.fn() };
      });
      (createServiceRoleClient as jest.Mock).mockReturnValue({ from: overrideFrom });

      const res = await POST(makeRequest(bizReview));
      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 10));
      expect(sendNewReviewNotification).toHaveBeenCalledWith(expect.objectContaining({ facilityName: '' }));
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
      // 2026年7月8日の恒久根治(review-photos バケットの自Storage公開URLプレフィックス限定
      // チェック)後は、任意ドメインのURL（旧: https://example.com/...）は 400 で拒否されるため、
      // 実際にアップロード先となる review-photos バケットの公開URL形式に合わせる。
      const photoUrls = [
        'https://test.supabase.co/storage/v1/object/public/review-photos/facility-1/photo1.jpg',
        'https://test.supabase.co/storage/v1/object/public/review-photos/facility-1/photo2.jpg',
      ];

      await POST(makeRequest({ ...bizReview, photo_urls: photoUrls }));

      expect(mockInsert).toHaveBeenCalled();
      const insertArg = mockInsert.mock.calls[0][0];
      expect(insertArg.photo_urls).toEqual(photoUrls);
    });

    // 【2026年7月8日 恒久根治の回帰防止】review-photos バケット以外のURL（自Storage以外の
    // 任意ドメイン・別バケット）は 400 で拒否されることを固定する。
    test('photo_urls が自Storage(review-photos)以外のドメイン → 400', async () => {
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false });
      const res = await POST(makeRequest({
        ...bizReview,
        photo_urls: ['https://evil.example.com/photo1.jpg'],
      }));
      expect(res.status).toBe(400);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    test('photo_urls が自Storageの別バケット(carelink-uploads) → 400', async () => {
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false });
      const res = await POST(makeRequest({
        ...bizReview,
        photo_urls: ['https://test.supabase.co/storage/v1/object/public/carelink-uploads/x.jpg'],
      }));
      expect(res.status).toBe(400);
      expect(mockInsert).not.toHaveBeenCalled();
    });

    test('ログイン時はuser_idと来店確認フラグをinsertに含める（2026年7月6日DDLでuser_id列追加・投稿者本人によるレビュー編集削除の前提）', async () => {
      setupBizMocks({ hasUser: true, hasRecentReview: false, hasCompletedBooking: false });

      await POST(makeRequest(bizReview));

      expect(mockInsert).toHaveBeenCalled();
      const insertArg = mockInsert.mock.calls[0][0];
      expect(insertArg.user_id).toBe('user-123');
      expect('is_verified_visit' in insertArg).toBe(true);
    });

    test('未ログイン時はuser_id/is_verified_visitともにinsertに含めない', async () => {
      setupBizMocks({ hasUser: false, hasRecentReview: false, hasCompletedBooking: false });

      await POST(makeRequest(bizReview));

      expect(mockInsert).toHaveBeenCalled();
      const insertArg = mockInsert.mock.calls[0][0];
      expect(insertArg.user_id).toBeUndefined();
      expect('is_verified_visit' in insertArg).toBe(false);
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

      // 来店確認済み(completed 予約あり) = is_verified_visit=true。付与ロジック内の分岐を検証するため。
      const mockBookingLimit = jest.fn().mockResolvedValue({ data: [{ id: 'booking-1' }] });
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

      // 来店確認済み(completed 予約あり) = is_verified_visit=true。付与ロジック内の分岐を検証するため。
      const mockBookingLimit = jest.fn().mockResolvedValue({ data: [{ id: 'booking-1' }] });
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

      // 来店確認済み(completed 予約あり) = is_verified_visit=true。ポイント付与は来店者限定のため。
      const mockBookingLimit = jest.fn().mockResolvedValue({ data: [{ id: 'booking-1' }] });
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
      // insert が実DBエラー(23505以外)を返す → insertErr 分岐（Sentry/Slack通知）
      const mockPointsInsert = jest.fn().mockReturnValue(
        Promise.resolve({ error: { message: 'insert failed', code: '500' } })
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

    // uq_user_points_review（部分UNIQUEインデックス）が23505を返すTOCTOU想定内の重複ケース。
    // select→insert が非原子なため、同時多重投稿で先に別リクエストが成立していても
    // 異常ログ・Sentry通知を出さず静かに終える（正常系として扱う）ことを保証する。
    test('user_points insert が23505(一意制約違反) → 想定内の重複としてログ・通知なしで200', async () => {
      const mockGetUserFn = jest.fn().mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
      });

      const mockDupLimit = jest.fn().mockResolvedValue({ data: [] });
      const mockDupGte = jest.fn().mockReturnValue({ limit: mockDupLimit });
      const mockDupEq2 = jest.fn().mockReturnValue({ gte: mockDupGte });
      const mockDupEq1 = jest.fn().mockReturnValue({ eq: mockDupEq2 });
      const mockDupSelect = jest.fn().mockReturnValue({ eq: mockDupEq1 });

      const mockBookingLimit = jest.fn().mockResolvedValue({ data: [{ id: 'booking-1' }] });
      const mockBookingEq3 = jest.fn().mockReturnValue({ limit: mockBookingLimit });
      const mockBookingEq2 = jest.fn().mockReturnValue({ eq: mockBookingEq3 });
      const mockBookingEq1 = jest.fn().mockReturnValue({ eq: mockBookingEq2 });
      const mockBookingSelect = jest.fn().mockReturnValue({ eq: mockBookingEq1 });

      const mockSingle = jest.fn().mockResolvedValue({ data: { id: 'review-999' }, error: null });
      const mockSelectInsert = jest.fn().mockReturnValue({ single: mockSingle });
      const mockInsertFn = jest.fn().mockReturnValue({ select: mockSelectInsert });

      const mockPointsLimit = jest.fn().mockResolvedValue({ data: [], error: null });
      const mockPointsEq2 = jest.fn().mockReturnValue({ limit: mockPointsLimit });
      const mockPointsEq1 = jest.fn().mockReturnValue({ eq: mockPointsEq2 });
      const mockPointsSelect = jest.fn().mockReturnValue({ eq: mockPointsEq1 });
      const mockPointsInsert = jest.fn().mockReturnValue(
        Promise.resolve({ error: { message: 'duplicate key value violates unique constraint "uq_user_points_review"', code: '23505' } })
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

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const res = await POST(makeRequest(bizReview));
      expect(res.status).toBe(200);
      expect(mockPointsInsert).toHaveBeenCalled();
      // 23505 は想定内の重複のため、insertErr 用の console.error は呼ばれない
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        '[review] points insert failed',
        expect.anything()
      );

      consoleErrorSpy.mockRestore();
    });

    // A-8 根治の回帰防止: 未来店(completed 予約なし)ユーザーはポイント付与されない
    // （来店検証なしで 50pt×施設数 を稼ぐポイントファーミングを防ぐ）。
    test('未来店ユーザー(completed予約なし) → ポイント付与されない', async () => {
      const mockGetUserFn = jest.fn().mockResolvedValue({
        data: { user: { id: 'user-123', email: 'test@example.com' } },
      });

      const mockDupLimit = jest.fn().mockResolvedValue({ data: [] });
      const mockDupGte = jest.fn().mockReturnValue({ limit: mockDupLimit });
      const mockDupEq2 = jest.fn().mockReturnValue({ gte: mockDupGte });
      const mockDupEq1 = jest.fn().mockReturnValue({ eq: mockDupEq2 });
      const mockDupSelect = jest.fn().mockReturnValue({ eq: mockDupEq1 });

      // 未来店 = completed 予約なし → is_verified_visit=false
      const mockBookingLimit = jest.fn().mockResolvedValue({ data: [] });
      const mockBookingEq3 = jest.fn().mockReturnValue({ limit: mockBookingLimit });
      const mockBookingEq2 = jest.fn().mockReturnValue({ eq: mockBookingEq3 });
      const mockBookingEq1 = jest.fn().mockReturnValue({ eq: mockBookingEq2 });
      const mockBookingSelect = jest.fn().mockReturnValue({ eq: mockBookingEq1 });

      const mockSingle = jest.fn().mockResolvedValue({ data: { id: 'review-nofarm' }, error: null });
      const mockSelectInsert = jest.fn().mockReturnValue({ single: mockSingle });
      const mockInsertFn = jest.fn().mockReturnValue({ select: mockSelectInsert });

      const mockPointsSelect = jest.fn();
      const mockPointsInsert = jest.fn();

      const mockMembersRoleFilter = jest.fn().mockResolvedValue({ data: [{ user_id: 'owner-1' }] });
      const mockMembersEq1 = jest.fn().mockReturnValue({ eq: mockMembersRoleFilter, in: mockMembersRoleFilter });
      const mockMembersSelect = jest.fn().mockReturnValue({ eq: mockMembersEq1 });
      const mockProfilesIn = jest.fn().mockResolvedValue({ data: [{ email: 'owner@example.invalid' }] });
      const mockProfilesSelect = jest.fn().mockReturnValue({ in: mockProfilesIn });
      const mockFacilitySingle = jest.fn().mockResolvedValue({ data: { name: 'テスト施設' } });
      const mockFacilityEq = jest.fn().mockReturnValue({ single: mockFacilitySingle });
      const mockFacilitySelect = jest.fn().mockReturnValue({ eq: mockFacilityEq });

      const fromRouter = jest.fn((table: string) => {
        if (table === 'facility_reviews') return { select: mockDupSelect, insert: mockInsertFn };
        if (table === 'bookings') return { select: mockBookingSelect };
        if (table === 'user_points') return { select: mockPointsSelect, insert: mockPointsInsert };
        if (table === 'facility_members') return { select: mockMembersSelect };
        if (table === 'profiles') return { select: mockProfilesSelect };
        if (table === 'facility_profiles') return { select: mockFacilitySelect };
      });

      const { createServerClient } = require('@supabase/ssr');
      createServerClient.mockReturnValue({ auth: { getUser: mockGetUserFn }, from: fromRouter });
      const { createServiceRoleClient } = require('@/lib/supabase-server');
      (createServiceRoleClient as jest.Mock).mockReturnValue({ from: fromRouter });
      const { cookies } = require('next/headers');
      cookies.mockResolvedValue({ getAll: jest.fn(() => []) });

      const res = await POST(makeRequest(bizReview));
      expect(res.status).toBe(200);
      // is_verified_visit=false のため付与ロジックに入らない（dedup select も insert も呼ばれない）。
      expect(mockPointsSelect).not.toHaveBeenCalled();
      expect(mockPointsInsert).not.toHaveBeenCalled();
    });
  });
});
