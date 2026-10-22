/**
 * @jest-environment node
 *
 * Tests for GET /api/liff/bookings
 * Key assertions:
 *   - Rate limiting (30 req/min per IP)
 *   - LINE Bearer token required
 *   - LINE API validation call
 *   - LINE user_id → DB user_id lookup
 *   - Single booking by booking_id (UUID validation, ownership)
 *   - List user's bookings (last 20, ordered desc)
 *   - Error handling
 */

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/line', () => ({
  verifyLineAccessToken: jest.fn(() => Promise.resolve({ ok: true, userId: 'line-user-verified' })),
}));
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/alert', () => ({ ...jest.requireActual('@/lib/alert'), alertCaughtError: jest.fn() }));

global.fetch = jest.fn();

import { checkRateLimit } from '@/lib/rate-limit';
import { alertCaughtError } from '@/lib/alert';
import { GET } from '../route';

// Helper to create chainable mock
function createChainableMock(resolveValue: any) {
  const chainable: any = {
    eq: jest.fn(),
    order: jest.fn(),
    limit: jest.fn(),
    single: jest.fn(),
    maybeSingle: jest.fn(),
    select: jest.fn(),
  };

  chainable.eq.mockReturnValue(chainable);
  chainable.order.mockReturnValue(chainable);
  chainable.limit.mockResolvedValue(resolveValue);
  chainable.single.mockResolvedValue(resolveValue);
  chainable.maybeSingle.mockResolvedValue(resolveValue);
  chainable.select.mockReturnValue(chainable);

  return chainable;
}

let policyResult: { data: unknown; error: unknown } = { data: null, error: null };
let policyChain: any;
let bookingChain: any;
// 単体取得で返す施設の埋め込み（slug・電話・掲載状態つき）。
let singleFacility: unknown = { name: 'Test Salon' };

function setupDefaultMocks(
  lineValid: boolean = true,
  profileFound: boolean = true,
  bookingFound: boolean = true,
  isList: boolean = false
) {
  // LINE API mock
  (global.fetch as jest.Mock).mockResolvedValue(
    lineValid
      ? new Response(
          JSON.stringify({ userId: 'line-user-123' }),
          { ok: true, status: 200 }
        )
      : new Response(
          JSON.stringify({ message: 'Invalid access token' }),
          { ok: false, status: 401 }
        )
  );

  // Profile data
  const profileData = profileFound ? { data: { id: 'db-user-123' }, error: null } : { data: null, error: null };

  // Booking data
  const bookingData = isList
    ? {
        data: [
          {
            id: 'booking-1',
            booking_date: '2026-05-10',
            start_time: '10:00',
            end_time: '11:00',
            menu: [{ name: 'Eyelash' }], // 配列形 embed
            status: 'confirmed',
            total_price: 5000,
            facility_profiles: { name: 'Salon A' },
          },
        ],
        error: null,
      }
    : bookingFound
    ? {
        data: {
          id: 'booking-123',
          facility_id: 'facility-123',
          booking_date: '2026-05-05',
          start_time: '10:00',
          end_time: '11:00',
          menu: null, // menu 未設定（非配列・null）→ menu_name=null パスを検証
          status: 'confirmed',
          total_price: 5000,
          facility_profiles: singleFacility,
        },
        error: null,
      }
    : { data: null, error: null };

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'line_user_links') { const chain: any = {}; chain.select = jest.fn(() => chain); chain.eq = jest.fn(() => chain); chain.maybeSingle = jest.fn().mockResolvedValue({ data: { user_id: 'db-user-123', proof_version: 1, verified_at: '2026-10-09T00:00:00Z' }, error: null }); return chain; }
      if (table === 'profiles') {
        return createChainableMock(profileData);
      } else if (table === 'bookings') {
        bookingChain = createChainableMock(bookingData);
        return bookingChain;
      } else if (table === 'facility_cancel_policies') {
        policyChain = createChainableMock(policyResult);
        return policyChain;
      }
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  policyResult = { data: null, error: null };
  policyChain = undefined;
  bookingChain = undefined;
  singleFacility = { name: 'Test Salon' };
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (global.fetch as jest.Mock).mockClear();
  setupDefaultMocks();
});

function makeRequest(
  bookingId?: string,
  authToken: string = 'valid-token',
  ip = '192.168.1.1'
) {
  const url = bookingId
    ? `http://localhost/api/liff/bookings?booking_id=${bookingId}`
    : 'http://localhost/api/liff/bookings';

  const req = new Request(url, {
    method: 'GET',
    headers: {
      ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      'x-forwarded-for': ip,
    },
  });

  // Provide nextUrl for NextRequest compatibility
  Object.defineProperty(req, 'nextUrl', { get: () => new URL(url) });

  return req;
}

const BOOKING_UUID = '11111111-1111-1111-1111-111111111111';

describe('GET /api/liff/bookings', () => {
  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(429);
  });

  test('missing Authorization header → 401', async () => {
    const res = await GET(makeRequest(undefined, '') as any);

    expect(res.status).toBe(401);
  });



  test('user profile not found → 404', async () => {
    setupDefaultMocks(true, false);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(404);
  });




  test('calls LINE API with access token', async () => {
    await GET(makeRequest(undefined, 'test-line-token') as any);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.line.me/v2/profile',
      expect.objectContaining({
        headers: { Authorization: 'Bearer test-line-token' },
      })
    );
  });

  test('rate limit params (30 req/min per IP)', () => {
    (checkRateLimit as jest.Mock).mockClear();

    GET(makeRequest(undefined, 'token', '192.168.1.1') as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(30);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('liff-bookings');
  });

  test('extracts last (trusted) IP from x-forwarded-for', () => {
    (checkRateLimit as jest.Mock).mockClear();

    GET(makeRequest(undefined, 'token', '10.0.0.1, 192.168.1.1') as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('uses unknown IP when x-forwarded-for missing', () => {
    (checkRateLimit as jest.Mock).mockClear();

    const req = new Request('http://localhost/api/liff/bookings', {
      method: 'GET',
      headers: { Authorization: 'Bearer token' },
    });

    GET(req as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('invalid LINE token → 401', async () => {
    setupDefaultMocks(false);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

  test('no booking_id → returns list of bookings', async () => {
    setupDefaultMocks(true, true, true, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.bookings)).toBe(true);
    expect(json.bookings).toHaveLength(1);
    expect(json.bookings[0].id).toBe('booking-1');
  });

  test('no bookings found → returns empty array', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'line_user_links') { const chain: any = {}; chain.select = jest.fn(() => chain); chain.eq = jest.fn(() => chain); chain.maybeSingle = jest.fn().mockResolvedValue({ data: { user_id: 'db-user-123', proof_version: 1, verified_at: '2026-10-09T00:00:00Z' }, error: null }); return chain; }
      if (table === 'profiles') return createChainableMock({ data: { id: 'db-user-123' }, error: null });
        return createChainableMock({ data: null, error: null });
      }),
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.bookings).toEqual([]);
  });

  test('booking_id (valid UUID) → returns single booking', async () => {
    const res = await GET(makeRequest(BOOKING_UUID) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.booking).toBeDefined();
    expect(json.booking.id).toBe('booking-123');
  });

  // キャンセル画面がボタンの代わりに店舗への連絡を案内するための、店舗のキャンセルの受け付け方。
  test('single booking: ポリシー未設定の店舗はネットからキャンセルできる（online_cancel_allowed=true）', async () => {
    const json = await (await GET(makeRequest(BOOKING_UUID) as any)).json();
    expect(json.booking.online_cancel_allowed).toBe(true);
    expect(policyChain.eq).toHaveBeenCalledWith('facility_id', 'facility-123');
    expect(policyChain.select).toHaveBeenCalledWith('free_cancel_hours, late_cancel_rate, cancel_rule');
  });

  test.each([
    ['no_online', false], ['always_fee', true], ['free_window', true], [null, true],
  ])('single booking: cancel_rule=%s → online_cancel_allowed=%s', async (cancel_rule, allowed) => {
    policyResult = { data: { free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule }, error: null };
    setupDefaultMocks();
    const json = await (await GET(makeRequest(BOOKING_UUID) as any)).json();
    expect(json.booking.online_cancel_allowed).toBe(allowed);
  });

  // 回帰（レビュー指摘）: ポリシーが読めないだけで予約 1 件の取得全体を 500 にしていたため、
  // LIFF のキャンセル画面が「予約情報の取得に失敗しました」になっていた（マイページは予約を表示していた）。
  test('single booking: ポリシーの読み取り障害でも予約は返し、案内の判定は省いて障害を通知する', async () => {
    policyResult = { data: null, error: { message: 'column facility_cancel_policies.cancel_rule does not exist', code: '42703' } };
    setupDefaultMocks();
    const res = await GET(makeRequest(BOOKING_UUID) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.booking.id).toBe('booking-123');
    // 省く（=キャンセル画面はボタンを出す。ネットでのキャンセル不可の店舗はキャンセル RPC が必ず断る）。
    expect(json.booking).not.toHaveProperty('online_cancel_allowed');
    expect(alertCaughtError).toHaveBeenCalledWith('liff-bookings-cancel-policy', new Error('DATABASE_FAILURE:42703'), '/api/liff/bookings');
  });

  // キャンセル画面は「店舗へ直接ご連絡ください」と案内するときに、電話番号と店舗ページも出す（2026年10月23日）。
  // 以前は店名しか返しておらず、お客様は店名で検索し直すしかなかった。
  test('single booking: 公開中の店舗は連絡先（slug・電話）を返し、facility_profiles は従来どおり店名だけ', async () => {
    singleFacility = { name: 'Test Salon', slug: 'test-salon', phone: '03-1234-5678', status: 'published' };
    setupDefaultMocks();
    const json = await (await GET(makeRequest(BOOKING_UUID) as any)).json();
    expect(bookingChain.select).toHaveBeenCalledWith(expect.stringContaining('facility_profiles(name, slug, phone, status)'));
    expect(json.booking.facility_contact).toEqual({ slug: 'test-salon', phone: '03-1234-5678' });
    expect(json.booking.facility_profiles).toEqual({ name: 'Test Salon' });
  });

  test.each(['draft', 'suspended'])('single booking: 掲載が %s の店舗は連絡先を返さない（店舗ページは 404 になる）', async (status) => {
    singleFacility = { name: 'Test Salon', slug: 'test-salon', phone: '03-1234-5678', status };
    setupDefaultMocks();
    const json = await (await GET(makeRequest(BOOKING_UUID) as any)).json();
    expect(json.booking.facility_contact).toBeNull();
    expect(json.booking.facility_profiles).toEqual({ name: 'Test Salon' });
  });

  test('single booking: 施設を読めない予約は店名も連絡先も null', async () => {
    singleFacility = null;
    setupDefaultMocks();
    const json = await (await GET(makeRequest(BOOKING_UUID) as any)).json();
    expect(json.booking.facility_profiles).toBeNull();
    expect(json.booking.facility_contact).toBeNull();
  });

  test('一覧には連絡先を載せない（一覧の select は店名だけ）', async () => {
    setupDefaultMocks(true, true, true, true);
    const json = await (await GET(makeRequest() as any)).json();
    expect(bookingChain.select).toHaveBeenCalledWith(expect.stringContaining('facility_profiles(name)'));
    expect(json.bookings[0]).not.toHaveProperty('facility_contact');
  });

  // キャンセル画面がキャンセル API と同じ computeCancelFee でキャンセル料の見込みを出すためのポリシー。
  test('single booking: 店舗のポリシーをそのまま返す（未設定は null）', async () => {
    const none = await (await GET(makeRequest(BOOKING_UUID) as any)).json();
    expect(none.booking.cancel_policy).toBeNull();
    expect(none.booking.total_price).toBe(5000);

    policyResult = { data: { free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'always_fee' }, error: null };
    setupDefaultMocks();
    const json = await (await GET(makeRequest(BOOKING_UUID) as any)).json();
    expect(json.booking.cancel_policy).toEqual({ free_cancel_hours: 24, late_cancel_rate: 50, cancel_rule: 'always_fee' });
  });

  test('single booking: ポリシーを読めないときは cancel_policy を省く（画面は金額を推測しない）が、連絡先は返す', async () => {
    policyResult = { data: null, error: { message: 'synthetic', code: '57014' } };
    singleFacility = { name: 'Test Salon', slug: 'test-salon', phone: null, status: 'published' };
    setupDefaultMocks();
    const json = await (await GET(makeRequest(BOOKING_UUID) as any)).json();
    expect(json.booking).not.toHaveProperty('cancel_policy');
    expect(json.booking.facility_contact).toEqual({ slug: 'test-salon', phone: null });
  });

  test('booking_id not found → returns booking=null', async () => {
    setupDefaultMocks(true, true, false);

    const res = await GET(makeRequest(BOOKING_UUID) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.booking).toBeNull();
  });

  test('booking_id invalid UUID → 400', async () => {
    const res = await GET(makeRequest('not-a-uuid') as any);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid booking_id');
  });

  // 【2026年7月10日 恒久根治の回帰】DB障害時に「予約なし」と偽装表示せず、
  // 真の失敗として500を返すことを検証する（error握り潰しの再発防止）。
  test('bookings一覧: DB障害（error発生）→ 500（予約なしと偽装しない）', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'line_user_links') { const chain: any = {}; chain.select = jest.fn(() => chain); chain.eq = jest.fn(() => chain); chain.maybeSingle = jest.fn().mockResolvedValue({ data: { user_id: 'db-user-123', proof_version: 1, verified_at: '2026-10-09T00:00:00Z' }, error: null }); return chain; }
      if (table === 'profiles') return createChainableMock({ data: { id: 'db-user-123' }, error: null });
        return createChainableMock({ data: null, error: { message: 'DB error' } });
      }),
    });

    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(500);
  });

  test('単体booking取得: DB障害（error発生）→ 500（未発見と偽装しない）', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'line_user_links') { const chain: any = {}; chain.select = jest.fn(() => chain); chain.eq = jest.fn(() => chain); chain.maybeSingle = jest.fn().mockResolvedValue({ data: { user_id: 'db-user-123', proof_version: 1, verified_at: '2026-10-09T00:00:00Z' }, error: null }); return chain; }
      if (table === 'profiles') return createChainableMock({ data: { id: 'db-user-123' }, error: null });
        return createChainableMock({ data: null, error: { message: 'DB error' } });
      }),
    });

    const res = await GET(makeRequest(BOOKING_UUID) as any);
    expect(res.status).toBe(500);
  });

  test('profile transport error → 503', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network failure'));

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(503);
  });

  // R2 audience検証: 他チャネル発行トークン（client_id不一致）→ 401（!tokenCheck.ok 分岐）
  test('verifyLineAccessToken fails (audience mismatch) → 401', async () => {
    const { verifyLineAccessToken } = require('@/lib/line');
    (verifyLineAccessToken as jest.Mock).mockResolvedValueOnce({ ok: false });
    const res = await GET(makeRequest() as any);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorized');
  });

});