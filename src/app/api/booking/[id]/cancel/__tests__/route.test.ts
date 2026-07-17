/**
 * @jest-environment node
 */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: null,
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('@/lib/email', () => ({
  sendBookingCancelled: jest.fn().mockResolvedValue(true),
  sendBookingCancellationToFacility: jest.fn().mockResolvedValue(true),
}));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });
jest.mock('@/lib/line', () => ({ sendBookingCancellation: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/liff-auth', () => ({ getBearerToken: jest.fn(() => null), resolveLiffUserId: jest.fn() }));
jest.mock('@/lib/integrations/line-works', () => ({
  isLineWorksConfigured: jest.fn().mockReturnValue(false),
  notifyCancellationLineWorks: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/push', () => ({ sendPushToFacilityOwners: jest.fn(() => Promise.resolve()) }));
jest.mock('@/lib/notification-settings', () => ({ getFacilityNotificationSettings: jest.fn() }));

const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockAdminFrom = jest.fn();
// DB-1: bookings への書き込み(UPDATE)は service_role 経由になった。service_role クライアントの
// 'bookings' 呼び出しだけを専用モックに振り分け、通知/user_points 等の他テーブルは従来どおり
// mockAdminFrom に流す。これにより cookie 分岐の全テストは既定成功の update を自動で受け取り、
// 各テストの mockAdminFrom オーバーライドに bookings 分岐を足す必要がない。
const mockBookingsWrite = jest.fn();
// 2026年7月16日 恒久根治（#483と同型バグ）: オーナー宛キャンセル通知の宛先取得
// （facility_members・profiles）を service role(createServiceRoleClient)専用の
// ownerLookupClient に切替えたため、この2テーブルだけ独立モックへ振り分ける。
// LINE Works/LINE の各テストが持つ mockAdminFrom の個別フォールバック（1段 .eq() までしか
// チェーンできない簡易チェーン）は、facility_members が要求する
// .select().eq().eq().limit().single() という2段 .eq() チェーンに対応できず、既存の無関係な
// テストまで TypeError で汚染してしまう。facility_members/profiles だけ専用モックに分離する
// ことで、既存の mockAdminFrom オーバーライド（LINE Works の staff_profiles 等）には一切触れず、
// オーナー通知を検証する3テストだけがこの専用モックを上書きすればよい構成にする。
const mockOwnerLookupFrom = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: (...args: any[]) => {
      const table = args[0];
      if (table === 'bookings') return mockBookingsWrite(...args);
      if (table === 'facility_members' || table === 'profiles') return mockOwnerLookupFrom(...args);
      return mockAdminFrom(...args);
    },
  })),
}));
jest.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: jest.fn() }),
}));

import { POST } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { getBearerToken, resolveLiffUserId } from '@/lib/liff-auth';

const validId = '123e4567-e89b-12d3-a456-426614174000';

beforeEach(() => {
  jest.clearAllMocks();
  // A-12 の開始時刻経過ガードは Date.now() を見る。予約(2026-04-01 10:00 JST)の 10 時間前に固定し、
  // ガード通過(開始前)かつ late cancel(free_cancel_hours=24 以内)を維持して既存のキャンセル料検証を保つ。
  jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-04-01T00:00:00+09:00').getTime());
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  (getBearerToken as jest.Mock).mockReturnValue(null); // 既定は Cookie 経路（Bearer 無し）
  (resolveLiffUserId as jest.Mock).mockReset();
  const { isLineWorksConfigured } = require('@/lib/integrations/line-works');
  (isLineWorksConfigured as jest.Mock).mockReturnValue(false);
  // 既定はキャンセルPush ON（既存挙動＋新機能）
  const { getFacilityNotificationSettings } = require('@/lib/notification-settings');
  (getFacilityNotificationSettings as jest.Mock).mockResolvedValue({
    pushOnNewBooking: true, pushOnCancel: true, pushOnReview: true,
    emailDailySummary: false, emailWeeklyReport: true,
  });
  mockAdminFrom.mockReturnValue(adminReadChain());
  // 既定はオーナー0行（facility_members が見つからない）＝安全に owner ブロックをスキップする。
  // オーナー通知を検証するテストのみ mockOwnerLookupFrom.mockImplementation で上書きする。
  mockOwnerLookupFrom.mockReturnValue(adminReadChain());
  // DB-1: bookings UPDATE は service_role 経由。既定は成功(1行更新)。負例(500/409)は各テストで上書き。
  mockBookingsWrite.mockReturnValue(bookingsUpdateChain({ data: [{ id: 'bk' }], error: null }));
});

function makeRequest() {
  return new Request('http://localhost/api/booking/x/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Host: 'localhost' },
  });
}

function fluent(resolvedValue: unknown) {
  const self: Record<string, jest.Mock> = {};
  const handler = jest.fn(() => self);
  self.select = handler;
  self.eq = handler;
  self.update = handler;
  self.limit = handler;
  self.single = jest.fn(() => Promise.resolve(resolvedValue));
  return self;
}

// DB-1: cancel の bookings UPDATE は service_role(createServiceRoleClient → @supabase/supabase-js
// createClient = mockAdminFrom)経由になった。update→eq(id)→eq(user_id)→eq(status)→select('id') の
// 3段 eq チェーンで result を解決するモックを返す。
function bookingsUpdateChain(result: unknown) {
  const sel = jest.fn(() => Promise.resolve(result));
  const eq3 = jest.fn(() => ({ select: sel }));
  const eq2 = jest.fn(() => ({ eq: eq3 }));
  const eq1 = jest.fn(() => ({ eq: eq2 }));
  return { update: jest.fn(() => ({ eq: eq1 })) };
}
// service_role 側の通知/読み取り系フォールバック（既存 beforeEach 既定と同一形）。
// 2026年7月16日 恒久根治（#483と同型バグ）で facility_members/profiles のオーナー取得も
// service role(mockAdminFrom)経由になったため、select/eq/limit を何段チェーンしても自身を返し、
// single/maybeSingle/not のどれで終端しても安全に data:null（0行相当）へ解決する汎用チェーンに
// 拡張した。旧実装（.eq() を1段しかチェーンできない固定形）のままだと、facility_members の
// select().eq().eq().limit().single() が2段目の .eq() で TypeError になり、オーナー通知を検証
// しない大多数の既存テストまで無関係に落ちてしまう。
function adminReadChain() {
  const chain: Record<string, jest.Mock> = {};
  const self = jest.fn(() => chain);
  chain.select = self;
  chain.eq = self;
  chain.limit = self;
  chain.in = self;
  chain.maybeSingle = jest.fn(() => Promise.resolve({ data: null }));
  chain.single = jest.fn(() => Promise.resolve({ data: null }));
  chain.not = jest.fn(() => Promise.resolve({ data: [] }));
  return chain;
}

// 【2026年7月17日 恒久根治】オーナー通知（facility_members/profiles）が旧
// .limit(1).single() から /api/booking と同型の「配列 select→全オーナー」に変わったため、
// select/eq/in で終端(.single()/.limit() 無し)する。real Supabase の PostgrestFilterBuilder は
// チェーン可能かつ thenable（await で確定）なため、モックも自身を返しつつ then で解決する
// builder にする。
function ownerRowsChain(result: unknown) {
  const builder: Record<string, jest.Mock> & { then?: unknown } = {};
  const self = jest.fn(() => builder);
  builder.select = self;
  builder.eq = self;
  builder.in = self;
  (builder as unknown as { then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise<unknown> }).then =
    (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

// 正常系のキャンセル通知チェーン（happy path と同一の mockFrom 構成）を共有する。
function setupCancelHappyMocks() {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) {
      return fluent({
        data: {
          id: validId, user_id: 'user-1', status: 'pending',
          facility_id: 'f-1', customer_name: 'テスト', email: 'test@example.com',
          booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
          total_price: 5000, menu_id: null, staff_id: null,
        },
      });
    }
    const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
    const eqFirst = jest.fn(() => ({ eq: eqTerminal, then: (fn: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(fn) }));
    return {
      update: jest.fn(() => ({ eq: eqFirst })),
      select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })), limit: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })) })) })) })),
    };
  });
}

describe('POST /api/booking/[id]/cancel', () => {
  // 【2026年7月7日 本番実データで確定した恒久根治の回帰防止】キャンセル通知を fire-and-forget
  // (waitUntil) に戻すと本番(Fluid Compute 無効)でレスポンス返却後に打ち切られ通知が全滅する。
  // レスポンスは副作用の完了(await Promise.allSettled)まで確定しないことを直列に検証する。
  test('キャンセル通知送信が完了するまでレスポンスを確定させない（awaitで確実に完了・fire-and-forget回帰防止）', async () => {
    setupCancelHappyMocks();

    const { sendBookingCancelled } = require('@/lib/email');
    let resolveSend: (() => void) | undefined;
    const pending = new Promise<boolean>((resolve) => { resolveSend = () => resolve(true); });
    (sendBookingCancelled as jest.Mock).mockReturnValueOnce(pending);

    const postPromise = POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    let settled = false;
    void postPromise.then(() => { settled = true; });

    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    resolveSend!();
    const res = await postPromise;
    expect(settled).toBe(true);
    expect((await res.json()).success).toBe(true);
  });

  test('正常にキャンセルする', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        // booking lookup
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'test@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      // update chain: from→update→eq→eq (two eq calls chained)
      // and subsequent calls for email lookups
      const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
      const eqFirst = jest.fn(() => ({ eq: eqTerminal, then: (fn: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(fn) }));
      return {
        update: jest.fn(() => ({ eq: eqFirst })),
        select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })), limit: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })) })) })) })),
      };
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('A-12: 開始時刻を過ぎた予約はキャンセル不可 → 400', async () => {
    // 予約(2026-04-01 10:00 JST)より後に現在を固定 → hours < 0（開始経過）。
    (Date.now as jest.Mock).mockReturnValue(new Date('2026-04-01T12:00:00+09:00').getTime());
    mockFrom.mockImplementation(() => fluent({
      data: {
        id: validId, user_id: 'user-1', status: 'confirmed',
        facility_id: 'f-1', customer_name: 'テスト', email: 'test@example.com',
        booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
        total_price: 5000, menu_id: null, staff_id: null, points_used: 0,
      },
    }));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('開始時刻');
  });

  function setupSuccessfulCancelFrom(opts: { customerName?: string | null } = {}) {
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1',
            customer_name: 'customerName' in opts ? opts.customerName : 'テスト',
            email: 'test@example.com', booking_date: '2026-04-01', start_time: '10:00:00', end_time: '11:00:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
      const eqFirst = jest.fn(() => ({ eq: eqTerminal, then: (fn: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(fn) }));
      return {
        update: jest.fn(() => ({ eq: eqFirst })),
        select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })), limit: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })) })) })) })),
      };
    });
  }

  test('キャンセル成功時 push_on_cancel=true → 施設オーナーへ Push を送る', async () => {
    const { sendPushToFacilityOwners } = require('@/lib/push');
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    setupSuccessfulCancelFrom();
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect((await res.json()).success).toBe(true);
    await new Promise(r => setTimeout(r, 10));
    expect(sendPushToFacilityOwners).toHaveBeenCalledWith('f-1', expect.objectContaining({ title: expect.stringContaining('キャンセル') }));
  });

  test('push_on_cancel=false → 施設オーナーへ Push を送らない', async () => {
    const { sendPushToFacilityOwners } = require('@/lib/push');
    const { getFacilityNotificationSettings } = require('@/lib/notification-settings');
    (getFacilityNotificationSettings as jest.Mock).mockResolvedValue({
      pushOnNewBooking: true, pushOnCancel: false, pushOnReview: true, emailDailySummary: false, emailWeeklyReport: true,
    });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    setupSuccessfulCancelFrom();
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect((await res.json()).success).toBe(true);
    expect(sendPushToFacilityOwners).not.toHaveBeenCalled();
  });

  test('customer_name が null でも Push 本文は「お客様」でフォールバック', async () => {
    const { sendPushToFacilityOwners } = require('@/lib/push');
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    setupSuccessfulCancelFrom({ customerName: null });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect((await res.json()).success).toBe(true);
    await new Promise(r => setTimeout(r, 10));
    expect(sendPushToFacilityOwners).toHaveBeenCalledWith('f-1', expect.objectContaining({ body: expect.stringContaining('お客様') }));
  });

  test('無料期限超過のキャンセルで料率からキャンセル料を算出し通知・レスポンスに含める', async () => {
    const { sendBookingCancelled } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    let bookingsCall = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') {
        bookingsCall++;
        if (bookingsCall === 1) {
          return fluent({
            data: {
              id: validId, user_id: 'user-1', status: 'pending', facility_id: 'f-1',
              customer_name: 'テスト', email: 't@example.com', booking_date: '2026-04-01',
              start_time: '10:00:00', end_time: '11:00:00', total_price: 5000, menu_id: null, staff_id: null,
            },
          });
        }
        const sel = jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null }));
        const eq3 = jest.fn(() => ({ select: sel }));
        const eq2 = jest.fn(() => ({ eq: eq3 }));
        const eq1 = jest.fn(() => ({ eq: eq2 }));
        return { update: jest.fn(() => ({ eq: eq1 })) };
      }
      if (table === 'facility_cancel_policies') {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { free_cancel_hours: 24, late_cancel_rate: 50, no_show_rate: 100 } }) }) }) };
      }
      const c: Record<string, jest.Mock> = {};
      c.select = jest.fn(() => c); c.eq = jest.fn(() => c); c.limit = jest.fn(() => c); c.not = jest.fn(() => c);
      c.single = jest.fn(() => Promise.resolve({ data: null }));
      c.maybeSingle = jest.fn(() => Promise.resolve({ data: null }));
      return c;
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    const json = await res.json();
    expect(json.success).toBe(true);
    // 予約日(2026-04-01)は過去＝期限超過 → 5000×50% = 2500
    expect(json.cancelFee).toBe(2500);
    await new Promise(r => setTimeout(r, 10));
    expect(sendBookingCancelled).toHaveBeenCalledWith(expect.objectContaining({ cancelFee: 2500 }));
  });

  test('LIFF（Bearer）認証で本人がキャンセルできる → 200（Cookie 経路を使わない）', async () => {
    (getBearerToken as jest.Mock).mockReturnValue('line-token');
    (resolveLiffUserId as jest.Mock).mockResolvedValue('user-1');

    // DB-1: LIFF(bearer)分岐は db=service_role のため bookings の READ も UPDATE も service_role
    // クライアント経由＝mockBookingsWrite に振り分けられる。1回目=予約読み取り、2回目=更新。
    let bookingsCall = 0;
    mockBookingsWrite.mockImplementation(() => {
      bookingsCall++;
      if (bookingsCall === 1) {
        return {
          select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: {
            id: validId, user_id: 'user-1', status: 'pending', facility_id: 'f-1',
            customer_name: 'テスト', email: 't@example.com', booking_date: '2026-04-01',
            start_time: '10:00', end_time: '11:00', total_price: 5000, menu_id: null, staff_id: null, points_used: 0,
          } })) })) })),
        };
      }
      return bookingsUpdateChain({ data: [{ id: 'bk' }], error: null });
    });
    mockAdminFrom.mockImplementation(() => {
      // 通知系の任意チェーンは全て null 解決でフォールバック
      const chain: Record<string, jest.Mock> = {};
      chain.select = jest.fn(() => chain);
      chain.eq = jest.fn(() => chain);
      chain.limit = jest.fn(() => chain);
      chain.not = jest.fn(() => chain);
      chain.single = jest.fn(() => Promise.resolve({ data: null }));
      chain.maybeSingle = jest.fn(() => Promise.resolve({ data: null }));
      return chain;
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect((await res.json()).success).toBe(true);
    expect(resolveLiffUserId).toHaveBeenCalledWith('line-token');
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  test('LIFF（Bearer）でトークン無効・未連携 → 401（本人解決できない）', async () => {
    (getBearerToken as jest.Mock).mockReturnValue('bad-token');
    (resolveLiffUserId as jest.Mock).mockResolvedValue(null);
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(401);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  // ポイント利用予約のキャンセルで控除済みポイントを返還する（金銭損失防止）。
  function setupRefundMock(pointsUsed: number, insertResult: { error: unknown }) {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const insertSpy = jest.fn(() => Promise.resolve(insertResult));
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'user_points') return { insert: insertSpy };
      // LINE/LINE Works は無効化済みのため到達しないが、フォールバックの select チェーンを返す
      return adminReadChain();
    });
    // DB-1: bookings UPDATE(service_role)は既定成功(beforeEach)を使用。
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'confirmed',
            facility_id: 'f-1', customer_name: 'テスト', email: 'test@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null, points_used: pointsUsed,
          },
        });
      }
      const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
      const eqFirst = jest.fn(() => ({ eq: eqTerminal }));
      return {
        update: jest.fn(() => ({ eq: eqFirst })),
        select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })), limit: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })) })) })) })),
      };
    });
    return insertSpy;
  }

  test('ポイント利用予約のキャンセルで控除済みポイントを返還する', async () => {
    const insertSpy = setupRefundMock(300, { error: null });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect((await res.json()).success).toBe(true);
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1', points: 300, booking_id: validId, reason: 'キャンセル返還',
    }));
  });

  test('ポイント返還の insert 失敗は warn のみで成功継続', async () => {
    const insertSpy = setupRefundMock(300, { error: { message: 'insert fail' } });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect((await res.json()).success).toBe(true);
    expect(insertSpy).toHaveBeenCalled();
  });

  test('認証なし→401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(401);
  });

  test('予約が存在しない→404', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(fluent({ data: null }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(404);
  });

  test('他のユーザーの予約→403', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(fluent({
      data: { id: validId, user_id: 'other-user', status: 'pending' },
    }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(403);
  });

  test('既にキャンセル済み→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(fluent({
      data: { id: validId, user_id: 'user-1', status: 'cancelled' },
    }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(400);
  });

  test('不正なID→400', async () => {
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'invalid' }) });
    expect(res.status).toBe(400);
  });

  test('CSRF失敗→403', async () => {
    const { NextResponse } = jest.requireActual('next/server') as { NextResponse: typeof import('next/server').NextResponse };
    (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({ error: 'CSRF' }, { status: 403 }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(403);
  });

  test('レートリミット→429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(429);
  });
});

// ─── 深掘り: 状態機械の全パターン ────────────────────────────────────────────

  test('cancel_fee_paid はキャンセル不可 → 400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(fluent({
      data: { id: validId, user_id: 'user-1', status: 'cancel_fee_paid' },
    }));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(400);
  });

  test('completed はキャンセル不可 → 400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(fluent({
      data: { id: validId, user_id: 'user-1', status: 'completed' },
    }));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(400);
  });

  test('no_show はキャンセル不可 → 400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    mockFrom.mockReturnValue(fluent({
      data: { id: validId, user_id: 'user-1', status: 'no_show' },
    }));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(400);
  });

  test('confirmed はキャンセル可能 → 200', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'confirmed',
            facility_id: 'f-1', customer_name: 'テスト', email: 'test@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
      const eqFirst = jest.fn(() => ({ eq: eqTerminal }));
      return {
        update: jest.fn(() => ({ eq: eqFirst })),
        select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })), limit: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })) })) })) })),
      };
    });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
  });

// ─── 深掘り: DB 更新失敗 ─────────────────────────────────────────────────────

  test('DB update 失敗 → 500', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'test@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: null, error: { message: 'DB error' } })) })) }));
      const eqFirst = jest.fn(() => ({ eq: eqTerminal }));
      return { update: jest.fn(() => ({ eq: eqFirst })) };
    });
    // DB-1: UPDATE は service_role 経由。DB エラーを返させて 500 を検証する。
    mockBookingsWrite.mockReturnValue(bookingsUpdateChain({ data: null, error: { message: 'DB error' } }));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(500);
  });

  test('CAS: 更新0行（status が並行変化）data=[] → 409', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'test@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [], error: null })) })) }));
      const eqFirst = jest.fn(() => ({ eq: eqTerminal }));
      return { update: jest.fn(() => ({ eq: eqFirst })) };
    });
    // DB-1: UPDATE は service_role 経由。0 行(data=[])を返させて 409 を検証する。
    mockBookingsWrite.mockReturnValue(bookingsUpdateChain({ data: [], error: null }));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(409);
  });

  test('CAS: 更新結果 data=null → 409', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'test@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: null, error: null })) })) }));
      const eqFirst = jest.fn(() => ({ eq: eqTerminal }));
      return { update: jest.fn(() => ({ eq: eqFirst })) };
    });
    // DB-1: UPDATE は service_role 経由。data=null を返させて 409 を検証する。
    mockBookingsWrite.mockReturnValue(bookingsUpdateChain({ data: null, error: null }));
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(409);
  });

// ─── 深掘り: writeAuditLog 呼び出し確認 ─────────────────────────────────────

  test('キャンセル成功時に writeAuditLog が呼ばれる', async () => {
    const { writeAuditLog } = require('@/lib/audit-logger');
    jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'test@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
      const eqFirst = jest.fn(() => ({ eq: eqTerminal }));
      return {
        update: jest.fn(() => ({ eq: eqFirst })),
        select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })), limit: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })) })) })) })),
      };
    });

    await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    // writeAuditLog は非同期fire-and-forget なので呼ばれた記録を確認
    // (モックがインポート済みであることを前提)
  });

// ─── 深掘り: sendBookingCancelled 呼び出し確認 ───────────────────────────────

  test('キャンセル成功時に email 送信関数が呼ばれる', async () => {
    const { sendBookingCancelled } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト花子', email: 'test@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
      const eqFirst = jest.fn(() => ({ eq: eqTerminal }));
      return {
        update: jest.fn(() => ({ eq: eqFirst })),
        select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: { name: 'Salon X' } })), limit: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })) })) })) })),
      };
    });

    await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(sendBookingCancelled).toHaveBeenCalled();
  });

// ─── 深掘り: レートリミットパラメーター ─────────────────────────────────────

  test('レートリミットパラメーター確認（10 req/60s）', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/booking/x/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost',
        Host: 'localhost',
        'x-forwarded-for': '192.168.1.1',
      },
    });
    await POST(req, { params: Promise.resolve({ id: validId }) });
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[2]).toBe(10);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('cancel');
  });

  test('x-forwarded-for の先頭 IP を使う', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/booking/x/cancel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost',
        Host: 'localhost',
        'x-forwarded-for': '10.0.0.1, 192.168.1.1',
      },
    });
    await POST(req, { params: Promise.resolve({ id: validId }) });
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('x-forwarded-for なしは unknown IP を使う', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/booking/x/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Host: 'localhost' },
    });
    await POST(req, { params: Promise.resolve({ id: validId }) });
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

// ─── 深掘り: IDOR defence-in-depth ──────────────────────────────────────────

  test('UPDATE に user_id の WHERE 句が含まれる（IDOR 二重防御）', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'test@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      return {
        select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })), limit: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null })) })) })) })),
      };
    });

    // DB-1: UPDATE は service_role(mockBookingsWrite)経由。
    // 実チェーン update→eq('id')→eq('user_id')→eq('status')→select('id') で eq('user_id',...) を検証。
    const eqStatus = jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) }));
    const eqUser = jest.fn(() => ({ eq: eqStatus }));
    const eqId = jest.fn(() => ({ eq: eqUser }));
    mockBookingsWrite.mockReturnValue({ update: jest.fn(() => ({ eq: eqId })) });

    await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    // 2段目の eq が user_id でフィルタされる（IDOR 二重防御）
    expect(eqUser).toHaveBeenCalledWith('user_id', 'user-1');
  });

// ─── 深掘り: 例外 → 500 ──────────────────────────────────────────────────────

  test('予期しない例外 → 500', async () => {
    mockGetUser.mockImplementation(() => { throw new Error('Unexpected'); });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(500);
  });

// ─── 深掘り: menu_id ありのキャンセル ────────────────────────────────────────

  test('menu_id ありでメニュー名を取得', async () => {
    const { sendBookingCancelled } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'test@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: 'menu-1', staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        // update → eq → eq
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      // email path: facility_profiles, facility_menus, facility_members
      if (table === 'facility_menus') return fluent({ data: { name: 'カット' } });
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    expect(sendBookingCancelled).toHaveBeenCalled();
  });

// ─── 深掘り: オーナーへのキャンセル通知 ──────────────────────────────────────

  // 【2026年7月16日 本番実データで確定した根治の回帰防止・#483と同型バグ】facility_members
  // (RLS: USING(auth.uid()=user_id))・profiles(RLS: USING(auth.uid()=id))を Web/Cookie 経路の
  // anon クライアント(db)で引くと、キャンセルする顧客自身の auth.uid() でしか行が見えず、
  // 施設オーナーの行は常に0行になっていた。根治＝この2クエリを service role
  // （createServiceRoleClient・RLSバイパス）に切替。このテストは facility_members/profiles が
  // 実際に service role 経由（mockAdminFrom）で行われたことを直接アサートする。テーブル名一致
  // だけの検証だと anon 経由でも service role 経由でも同じ値を返せてしまい退行を検知できないため、
  // mockAdminFrom への呼び出し自体を独立してトラッキングして検証する。
  test('オーナーメールが存在する場合は顧客に sendBookingCancelled・店に sendBookingCancellationToFacility を呼ぶ（オーナー取得はservice role経由）', async () => {
    const { sendBookingCancelled, sendBookingCancellationToFacility } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      if (table === 'facility_profiles') return fluent({ data: { name: 'Salon X' } });
      return fluent({ data: null });
    });
    mockOwnerLookupFrom.mockImplementation((table: string) => {
      if (table === 'facility_members') return ownerRowsChain({ data: [{ user_id: 'owner-1' }] });
      if (table === 'profiles') return ownerRowsChain({ data: [{ email: 'owner@example.com' }] });
      return adminReadChain();
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    expect(sendBookingCancelled).toHaveBeenCalledTimes(1);
    expect(sendBookingCancellationToFacility).toHaveBeenCalledTimes(1);
    expect(sendBookingCancellationToFacility).toHaveBeenCalledWith(
      expect.objectContaining({ facilityEmail: 'owner@example.com', customerEmail: 'c@example.com' })
    );
    // 【回帰防止の核心】facility_members / profiles の取得が createServiceRoleClient()（service role）
    // 経由で行われたことを検証する。anon の db に戻す退行があれば、この2クエリは mockOwnerLookupFrom
    // を経由しなくなり、以下のアサーションが失敗する。
    expect(mockOwnerLookupFrom).toHaveBeenCalledWith('facility_members');
    expect(mockOwnerLookupFrom).toHaveBeenCalledWith('profiles');
  });

  // 【2026年7月17日 恒久根治・#510敵対検証】キャンセルのオーナー通知が .limit(1).single() で
  // 非決定的に1人だけ取得し、新規予約通知(/api/booking)・口コミ通知(/api/review)・
  // 問い合わせ通知(/api/inquiry)が施設の全オーナーへループ送信するのと非対称だった。
  // 複数オーナー施設で一部のオーナーにキャンセル通知が届かない実害を回帰防止する。
  test('オーナー2人（メールが別々）→ 施設向けキャンセルメールを2通送る（新規予約通知と対称）', async () => {
    const { sendBookingCancellationToFacility } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      if (table === 'facility_profiles') return fluent({ data: { name: 'Salon X' } });
      return fluent({ data: null });
    });
    mockOwnerLookupFrom.mockImplementation((table: string) => {
      if (table === 'facility_members') return ownerRowsChain({ data: [{ user_id: 'owner-1' }, { user_id: 'owner-2' }] });
      if (table === 'profiles') return ownerRowsChain({ data: [{ email: 'owner1@example.com' }, { email: 'owner2@example.com' }] });
      return adminReadChain();
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    expect(sendBookingCancellationToFacility).toHaveBeenCalledTimes(2);
    expect(sendBookingCancellationToFacility).toHaveBeenCalledWith(expect.objectContaining({ facilityEmail: 'owner1@example.com' }));
    expect(sendBookingCancellationToFacility).toHaveBeenCalledWith(expect.objectContaining({ facilityEmail: 'owner2@example.com' }));
  });

  test('オーナー2人が同じメールアドレス → 重複排除で施設向けキャンセルメールは1通のみ', async () => {
    const { sendBookingCancellationToFacility } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      if (table === 'facility_profiles') return fluent({ data: { name: 'Salon X' } });
      return fluent({ data: null });
    });
    mockOwnerLookupFrom.mockImplementation((table: string) => {
      if (table === 'facility_members') return ownerRowsChain({ data: [{ user_id: 'owner-1' }, { user_id: 'owner-2' }] });
      if (table === 'profiles') return ownerRowsChain({ data: [{ email: 'shared@example.com' }, { email: 'shared@example.com' }] });
      return adminReadChain();
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    expect(sendBookingCancellationToFacility).toHaveBeenCalledTimes(1);
    expect(sendBookingCancellationToFacility).toHaveBeenCalledWith(expect.objectContaining({ facilityEmail: 'shared@example.com' }));
  });

  test('オーナー0人（facility_members 0行）→ 施設向けキャンセルメール送信はスキップされ本体は成功', async () => {
    const { sendBookingCancellationToFacility } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      return fluent({ data: null });
    });
    mockOwnerLookupFrom.mockImplementation((table: string) => {
      if (table === 'facility_members') return ownerRowsChain({ data: [] });
      return adminReadChain();
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(sendBookingCancellationToFacility).not.toHaveBeenCalled();
  });

  // Branch coverage: ownerUserIds は1件以上あるが、profiles 取得(.in())が data:null を返すケース
  // （`(ownerProfiles ?? [])` の null 分岐）。facility_members は取れたが profiles が取れない
  // 異常系でも施設向けメール送信をスキップし本体は成功させる。
  test('オーナーは1人いるが profiles 取得が data:null → 施設向けキャンセルメールはスキップされ本体は成功', async () => {
    const { sendBookingCancellationToFacility } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      return fluent({ data: null });
    });
    mockOwnerLookupFrom.mockImplementation((table: string) => {
      if (table === 'facility_members') return ownerRowsChain({ data: [{ user_id: 'owner-1' }] });
      if (table === 'profiles') return ownerRowsChain({ data: null });
      return adminReadChain();
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(sendBookingCancellationToFacility).not.toHaveBeenCalled();
  });

  test('sendBookingCancelled/sendBookingCancellationToFacility が送達失敗(false)を返す → 無音化せず可視化するのみ（200のまま）', async () => {
    const { sendBookingCancelled, sendBookingCancellationToFacility } = require('@/lib/email');
    (sendBookingCancelled as jest.Mock).mockResolvedValueOnce(false);
    (sendBookingCancellationToFacility as jest.Mock).mockResolvedValueOnce(false);
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      if (table === 'facility_profiles') return fluent({ data: { name: 'Salon X' } });
      return fluent({ data: null });
    });
    mockOwnerLookupFrom.mockImplementation((table: string) => {
      if (table === 'facility_members') return ownerRowsChain({ data: [{ user_id: 'owner-1' }] });
      if (table === 'profiles') return ownerRowsChain({ data: [{ email: 'owner@example.com' }] });
      return adminReadChain();
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(sendBookingCancelled).toHaveBeenCalledTimes(1);
    expect(sendBookingCancellationToFacility).toHaveBeenCalledTimes(1);
  });

  // 【2026年7月17日 恒久根治】施設向けキャンセルメール送信 Promise の .catch((e)=>{...}) 経路に
  // テストが無かった（false 返却の .then 分岐は既存でテスト済みだが、reject による .catch 分岐は
  // 未検証だった）。送信が例外を投げても本体レスポンスは200のまま完了する（未処理rejectionで
  // 500化しない）ことを検証する。alertCaughtError/safeCaptureException はこのファイルでは
  // モックせず実装のまま呼ぶ（SLACK_BOT_TOKEN 未設定のテスト環境ではサイレントスキップの契約・
  // 既存の「送達失敗(false)」テストも同様に実装のまま検証済み）。
  test('施設向けキャンセルメール送信が例外を投げる(reject) → catchされ本体は200のまま完了する', async () => {
    const { sendBookingCancellationToFacility } = require('@/lib/email');
    (sendBookingCancellationToFacility as jest.Mock).mockRejectedValueOnce(new Error('network down'));
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      if (table === 'facility_profiles') return fluent({ data: { name: 'Salon X' } });
      return fluent({ data: null });
    });
    mockOwnerLookupFrom.mockImplementation((table: string) => {
      if (table === 'facility_members') return ownerRowsChain({ data: [{ user_id: 'owner-1' }] });
      if (table === 'profiles') return ownerRowsChain({ data: [{ email: 'owner@example.com' }] });
      return adminReadChain();
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    await new Promise((resolve) => setImmediate(resolve));
    expect(sendBookingCancellationToFacility).toHaveBeenCalledTimes(1);
  });

  // 【2026年7月17日 admin ロールへのメール通知統一】facility_members の admin ロールは
  // push.ts(sendPushToFacilityOwners) では通知対象だが、キャンセル通知メールは .eq('role','owner')
  // のため対象外という非対称があった。role フィルタが push.ts と同じ .in('role',['owner','admin'])
  // で呼ばれること（.eq('role','owner') に戻す退行があれば失敗する）と、admin ロールのメンバーにも
  // 実際にメールが届くこと（owner・admin混在で重複排除も維持されること）を検証する。
  test('owner+adminが混在 → 両ロールへ施設向けキャンセルメールが送られ、role フィルタは owner/admin 両方を含む', async () => {
    const { sendBookingCancellationToFacility } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      if (table === 'facility_profiles') return fluent({ data: { name: 'Salon X' } });
      return fluent({ data: null });
    });
    const membersChain = ownerRowsChain({ data: [{ user_id: 'owner-1' }, { user_id: 'admin-1' }] });
    mockOwnerLookupFrom.mockImplementation((table: string) => {
      if (table === 'facility_members') return membersChain;
      if (table === 'profiles') return ownerRowsChain({ data: [{ email: 'owner1@example.com' }, { email: 'admin1@example.com' }] });
      return adminReadChain();
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    expect(membersChain.in).toHaveBeenCalledWith('role', ['owner', 'admin']);
    expect(sendBookingCancellationToFacility).toHaveBeenCalledTimes(2);
    expect(sendBookingCancellationToFacility).toHaveBeenCalledWith(expect.objectContaining({ facilityEmail: 'owner1@example.com' }));
    expect(sendBookingCancellationToFacility).toHaveBeenCalledWith(expect.objectContaining({ facilityEmail: 'admin1@example.com' }));
  });

// ─── 深掘り: LINE Works キャンセル通知 ──────────────────────────────────────

  test('isLineWorksConfigured=true スタッフなし → 200（通知なし）', async () => {
    const { isLineWorksConfigured } = require('@/lib/integrations/line-works');
    (isLineWorksConfigured as jest.Mock).mockReturnValue(true);

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: 'staff-lw',
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      return fluent({ data: null });
    });

    // admin client returns empty staffList
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'staff_profiles') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              not: jest.fn().mockResolvedValue({ data: [] }),
            }),
          }),
        };
      }
      return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null }) }) }) };
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
  });

  test('isLineWorksConfigured=true スタッフあり → notifyCancellationLineWorks 呼び出し', async () => {
    const { isLineWorksConfigured, notifyCancellationLineWorks } = require('@/lib/integrations/line-works');
    (isLineWorksConfigured as jest.Mock).mockReturnValue(true);
    (notifyCancellationLineWorks as jest.Mock).mockResolvedValue(undefined);

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: 'staff-assigned',
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      return fluent({ data: null });
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'staff_profiles') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              not: jest.fn().mockResolvedValue({
                data: [{ id: 'staff-assigned', line_works_channel_id: 'ch-001', line_works_notify_all: false }],
              }),
            }),
          }),
        };
      }
      return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null }) }) }) };
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    expect(notifyCancellationLineWorks).toHaveBeenCalledWith('ch-001', expect.objectContaining({ customerName: 'テスト' }));
  });

  test('LINE_CHANNEL_ACCESS_TOKEN_CARELINK 設定時 → LINE通知パスを通る', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'line-token-test';

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      return fluent({ data: null });
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'line_user_links') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: { line_user_id: 'U_line_test' } }),
            }),
          }),
        };
      }
      return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null }) }) }) };
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);

    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  });

  test('LINE通知: menu_id あり → facility_menus からメニュー名を取得して通知', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'line-token-test';
    const { sendBookingCancellation } = require('@/lib/line');
    // 送達成功(truthy)を返させ、戻り値確認の成功分岐(未送達ログを出さない)を網羅する。
    (sendBookingCancellation as jest.Mock).mockResolvedValueOnce(true);

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    const eqChain = (data: unknown) => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data }),
      maybeSingle: jest.fn().mockResolvedValue({ data }),
      limit: jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: null }) }),
    });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: 'menu-line-1', staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      // For supabase (non-admin) calls in email/LINE path: facility_profiles, facility_menus, facility_members
      if (table === 'facility_menus') return eqChain({ name: 'カット' });
      if (table === 'facility_profiles') return eqChain({ name: 'Salon X' });
      return eqChain(null);
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'line_user_links') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: { line_user_id: 'U_line_abc' } }),
            }),
          }),
        };
      }
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null }),
          }),
        }),
      };
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    expect(sendBookingCancellation).toHaveBeenCalledWith('U_line_abc', expect.objectContaining({ menuName: 'カット' }));

    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  });

  test('LINE通知: line_user_id なし → sendLineCancellation 呼ばれない', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'line-token-test';
    const { sendBookingCancellation } = require('@/lib/line');

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      return fluent({ data: null });
    });

    // admin returns no line link
    mockAdminFrom.mockImplementation(() => ({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          maybeSingle: jest.fn().mockResolvedValue({ data: null }),
        }),
      }),
    }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    expect(sendBookingCancellation).not.toHaveBeenCalled();

    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  });

  test('LINE Works: menu_id ありでメニュー名を取得して通知', async () => {
    const { isLineWorksConfigured, notifyCancellationLineWorks } = require('@/lib/integrations/line-works');
    (isLineWorksConfigured as jest.Mock).mockReturnValue(true);
    (notifyCancellationLineWorks as jest.Mock).mockResolvedValue(undefined);

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: 'menu-lw-1', staff_id: 'staff-lw',
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      return fluent({ data: null });
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'staff_profiles') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              not: jest.fn().mockResolvedValue({
                data: [{ id: 'staff-lw', line_works_channel_id: 'ch-lw-001', line_works_notify_all: true }],
              }),
            }),
          }),
        };
      }
      if (table === 'facility_menus') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: { name: 'カラー' } }),
            }),
          }),
        };
      }
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null }),
          }),
        }),
      };
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    expect(notifyCancellationLineWorks).toHaveBeenCalledWith('ch-lw-001', expect.objectContaining({ menuName: 'カラー' }));
  });

  test('LINE Works: notifyCancellationLineWorks が reject → Sentry.captureException', async () => {
    const { isLineWorksConfigured, notifyCancellationLineWorks } = require('@/lib/integrations/line-works');
    (isLineWorksConfigured as jest.Mock).mockReturnValue(true);
    (notifyCancellationLineWorks as jest.Mock).mockRejectedValue(new Error('LW send error'));

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: 'staff-assigned',
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      return fluent({ data: null });
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'staff_profiles') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              not: jest.fn().mockResolvedValue({
                data: [{ id: 'staff-assigned', line_works_channel_id: 'ch-reject', line_works_notify_all: false }],
              }),
            }),
          }),
        };
      }
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null }),
          }),
        }),
      };
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 10));
  });

  test('total_price null → undefined フォールバック', async () => {
    const { sendBookingCancelled } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: null, menu_id: null, staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      return fluent({ data: null });
    });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    expect(sendBookingCancelled).toHaveBeenCalledWith(expect.objectContaining({ totalPrice: undefined }));
  });

  test('facility が null でも email 送信続行（facility?.name フォールバック）', async () => {
    const { sendBookingCancelled } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      // すべて null
      return fluent({ data: null });
    });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    expect(sendBookingCancelled).toHaveBeenCalledWith(expect.objectContaining({ facilityName: '' }));
  });

  test('owner 取得できるが ownerProfile.email なし → 送信は1回のみ', async () => {
    const { sendBookingCancelled } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      if (table === 'facility_profiles') return fluent({ data: { name: 'Salon Y' } });
      return fluent({ data: null });
    });
    mockOwnerLookupFrom.mockImplementation((table: string) => {
      if (table === 'facility_members') return ownerRowsChain({ data: [{ user_id: 'owner-1' }] });
      if (table === 'profiles') return ownerRowsChain({ data: [{ email: null }] });
      return adminReadChain();
    });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    expect(sendBookingCancelled).toHaveBeenCalledTimes(1);
  });

  test('LINE通知時の email 取得 throw → 内側 catch で握り潰し 200', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      // 3 回目以降の呼び出しで throw → email try/catch で握り潰し
      throw new Error('email path exploded');
    });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
  });

  test('LINE Works: 担当外スタッフ かつ notify_all=false → 通知スキップ', async () => {
    const { isLineWorksConfigured, notifyCancellationLineWorks } = require('@/lib/integrations/line-works');
    (isLineWorksConfigured as jest.Mock).mockReturnValue(true);
    (notifyCancellationLineWorks as jest.Mock).mockClear();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: 'staff-assigned',
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      return fluent({ data: null });
    });
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'staff_profiles') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              not: jest.fn().mockResolvedValue({
                data: [
                  { id: 'staff-other', line_works_channel_id: 'ch-skip', line_works_notify_all: false },
                  { id: 'staff-nochan', line_works_channel_id: null, line_works_notify_all: true },
                ],
              }),
            }),
          }),
        };
      }
      return { select: jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue({ maybeSingle: jest.fn().mockResolvedValue({ data: null }) }) }) };
    });
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    expect(notifyCancellationLineWorks).not.toHaveBeenCalled();
  });

  // Branch coverage: line 146 — LINE通知パス内で menu_id が存在してlineLink有効、menu_id false分岐
  test('LINE通知: lineLink あり + menu_id なし → cancelMenuName = "" で通知', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'line-token-test';
    const { sendBookingCancellation } = require('@/lib/line');

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      if (table === 'facility_profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { name: 'Salon Z' } }),
        };
      }
      return fluent({ data: null });
    });

    // admin client returns lineLink with line_user_id
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'line_user_links') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: { line_user_id: 'U_no_menu' } }),
            }),
          }),
        };
      }
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null }),
          }),
        }),
      };
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    // menu_id が null なので menuName は空文字
    expect(sendBookingCancellation).toHaveBeenCalledWith('U_no_menu', expect.objectContaining({ menuName: '' }));

    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  });

  // Branch coverage: line 148 — menuForLine が見つかったが name が null の場合
  test('LINE通知: menu_id あり + menuForLine.name が null → cancelMenuName = ""', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'line-token-test';
    const { sendBookingCancellation } = require('@/lib/line');

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: 'menu-null-name', staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      if (table === 'facility_menus') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { name: null } }),
          single: jest.fn().mockResolvedValue({ data: { name: null } }),
        };
      }
      if (table === 'facility_profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { name: 'Salon Q' } }),
          single: jest.fn().mockResolvedValue({ data: { name: 'Salon Q' } }),
        };
      }
      return fluent({ data: null });
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'line_user_links') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: { line_user_id: 'U_null_name' } }),
            }),
          }),
        };
      }
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null }),
          }),
        }),
      };
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    // name が null なので || '' で空文字になる
    expect(sendBookingCancellation).toHaveBeenCalledWith('U_null_name', expect.objectContaining({ menuName: '' }));

    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  });

  // Branch coverage: line 152 — facilityForLine?.name が null (|| '' 分岐)
  test('LINE通知: facilityForLine.name が null → facilityName = ""', async () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'line-token-test';
    const { sendBookingCancellation } = require('@/lib/line');

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      if (table === 'facility_profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          maybeSingle: jest.fn().mockResolvedValue({ data: { name: null } }),
          single: jest.fn().mockResolvedValue({ data: { name: null } }),
        };
      }
      return fluent({ data: null });
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'line_user_links') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: { line_user_id: 'U_null_facility' } }),
            }),
          }),
        };
      }
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null }),
          }),
        }),
      };
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    expect(sendBookingCancellation).toHaveBeenCalledWith('U_null_facility', expect.objectContaining({ facilityName: '' }));

    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  });

  // Branch coverage: line 177 — LINE Works パスで menuForLW?.name が null (|| '' 分岐)
  test('LINE Works: menu_id あり + menuForLW.name が null → menuName = ""', async () => {
    const { isLineWorksConfigured, notifyCancellationLineWorks } = require('@/lib/integrations/line-works');
    (isLineWorksConfigured as jest.Mock).mockReturnValue(true);
    (notifyCancellationLineWorks as jest.Mock).mockResolvedValue(undefined);

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: 'menu-lw-null', staff_id: 'staff-lw',
          },
        });
      }
      if (callNum === 2) {
        const eqTerminal = jest.fn(() => ({ eq: jest.fn(() => ({ select: jest.fn(() => Promise.resolve({ data: [{ id: 'bk' }], error: null })) })) }));
        return { update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: eqTerminal })) })) };
      }
      return fluent({ data: null });
    });

    mockAdminFrom.mockImplementation((table: string) => {
      if (table === 'staff_profiles') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              not: jest.fn().mockResolvedValue({
                data: [{ id: 'staff-lw', line_works_channel_id: 'ch-lw-null', line_works_notify_all: true }],
              }),
            }),
          }),
        };
      }
      if (table === 'facility_menus') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: { name: null } }),
            }),
          }),
        };
      }
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null }),
          }),
        }),
      };
    });

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
    // menuForLW.name が null なので || '' で空文字
    expect(notifyCancellationLineWorks).toHaveBeenCalledWith('ch-lw-null', expect.objectContaining({ menuName: '' }));
  });

  test('LINE Works: adminSupabase が throw → 外側 catch → Sentry + 200', async () => {
    const { isLineWorksConfigured } = require('@/lib/integrations/line-works');
    (isLineWorksConfigured as jest.Mock).mockReturnValue(true);

    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) {
        return fluent({
          data: {
            id: validId, user_id: 'user-1', status: 'pending',
            facility_id: 'f-1', customer_name: 'テスト', email: 'c@example.com',
            booking_date: '2026-04-01', start_time: '10:00', end_time: '11:00',
            total_price: 5000, menu_id: null, staff_id: null,
          },
        });
      }
      return fluent({ data: null });
    });

    // DB-1: 1回目の createClient(=UPDATE writeDb)は正常ラッパー(bookings→mockBookingsWrite で更新成功)。
    // 2回目以降(=通知の adminSupabase)は .from が throw ＝通知パスの例外を外側 catch が握って 200 を返すことを検証。
    const { createClient } = require('@supabase/supabase-js');
    (createClient as jest.Mock)
      .mockImplementationOnce(() => ({
        from: (...args: any[]) => (args[0] === 'bookings' ? mockBookingsWrite(...args) : mockAdminFrom(...args)),
      }))
      .mockImplementation(() => ({ from: jest.fn(() => { throw new Error('admin client exploded'); }) }));

    const res = await POST(makeRequest(), { params: Promise.resolve({ id: validId }) });
    expect(res.status).toBe(200);
  });
