/**
 * @jest-environment node
 */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  bookingRateLimit: null,
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('@/lib/email', () => ({
  sendBookingConfirmation: jest.fn(() => Promise.resolve(true)),
  sendBookingConfirmed: jest.fn(() => Promise.resolve(true)),
  sendNewBookingNotification: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('@/lib/push', () => ({
  sendPushToFacilityOwners: jest.fn(() => Promise.resolve()),
  sendPushToUser: jest.fn(() => Promise.resolve()),
}));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
jest.mock('@/lib/line', () => ({
  sendBookingConfirmation: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('@/lib/integrations/line-works', () => ({
  isLineWorksConfigured: jest.fn(() => false),
  notifyNewBookingLineWorks: jest.fn(),
}));
jest.mock('@/lib/notification-settings', () => ({
  getFacilityNotificationSettings: jest.fn(),
}));

const mockGetUser = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();
// Service-role client の from() 専用トラッキング用モック。デフォルトは mockFrom へそのまま委譲する
// （table 名・callNum ベースの既存の mockFrom.mockImplementation をそのまま再利用でき、既存テストの
// 挙動は一切変えない）。目的は「facility_members / profiles の取得が service role 経由で行われて
// いるか」を独立して呼び出しトラッキングできるようにすること（2026年7月16日・匿名予約でオーナー
// 宛新規予約通知メールが届かない本番事故＝anon の RLS で0行になっていた根治の回帰防止用）。
const mockServiceFrom = jest.fn((table: string) => mockFrom(table));

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
    rpc: mockRpc,
  }),
}));
// Service-role client (createServiceRoleClient) の from は mockServiceFrom（内部で mockFrom に委譲）
// を使う。委譲のため table 名・callNum ベースの既存 mockFrom.mockImplementation はそのまま機能し、
// CAS テスト等の既存挙動は変わらない。rpc は従来どおり mockRpc を共有する。
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockServiceFrom, rpc: mockRpc }),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      not: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(() => Promise.resolve({ data: null })),
    })),
  }),
}));
jest.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: jest.fn() }),
}));

import { POST } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';

// Dynamic date: 6 months in the future (always within the 1-year booking limit)
function futureBookingDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 6);
  return d.toISOString().slice(0, 10);
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  // Default: RPC succeeds
  mockRpc.mockResolvedValue({ data: 'new-booking-id', error: null });
  // 既定は全通知 ON（既存挙動）。施設オーナー新規予約 Push のゲートを通す。
  const { getFacilityNotificationSettings } = require('@/lib/notification-settings');
  (getFacilityNotificationSettings as jest.Mock).mockResolvedValue({
    pushOnNewBooking: true, pushOnCancel: true, pushOnReview: true,
    emailDailySummary: false, emailWeeklyReport: true,
  });
});

const FUTURE_DATE = futureBookingDate();

// メニュー必須化（無メニュー予約は bookingSchema の refine で 400）に伴い、汎用の正常系フィクスチャは
// メニューを1件持つ。無メニュー予約自体を検証するテストは menu_id: null かつ menu_ids なしを明示する。
const MENU_UUID = '423e4567-e89b-12d3-a456-426614174000';

const validBooking = {
  facility_id: '123e4567-e89b-12d3-a456-426614174000',
  staff_id: null,
  menu_id: MENU_UUID,
  coupon_id: null,
  booking_date: FUTURE_DATE,
  start_time: '10:00',
  end_time: '11:00',
  customer_name: 'テスト太郎',
  email: 'test@example.com',
  total_price: 5000,
  points_used: 0,
};

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/booking', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Host: 'localhost' },
    body: JSON.stringify(body),
  });
}

// Fluent Supabase chain builder.
// Returns a chainable object; the terminal call (single / maybeSingle / the last chainable method)
// resolves to `resolvedValue`.
function fluent(resolvedValue: unknown) {
  const self: Record<string, jest.Mock> = {};
  const handler = jest.fn(() => self);
  self.select = handler;
  self.insert = handler;
  self.update = handler;
  self.delete = handler;
  self.eq = handler;
  self.neq = handler;
  self.not = handler;
  self.lt = handler;
  self.gt = handler;
  self.gte = handler;
  self.lte = handler;
  self.in = handler;
  self.limit = handler;
  self.maybeSingle = jest.fn(() => Promise.resolve(resolvedValue));
  self.single = jest.fn(() => Promise.resolve(resolvedValue));
  return self;
}

// Route call sequence (no menu/coupon/staff/points):
// call 1: conflict check   (bookings select)
// call 2: facility_profiles (auto-confirm setting)
// then: supabase.rpc('create_booking_atomic')
// subsequent calls: notification lookups (all in try/catch — failures are suppressed)

// 共有: ポイント利用テスト用のメニュー価格ルックアップ chain。
// ポイント利用には権威的なサーバ価格（メニュー）が必須なため、CAS 系テストは
// menu_id を付与し、conflict check の直後（mockFrom 呼び出し #2）でこの chain を返す。
const POINTS_MENU_ID = '323e4567-e89b-12d3-a456-426614174000';
function menuPriceChain(price: number) {
  const result = { data: [{ id: POINTS_MENU_ID, price }], error: null };
  const chain: Record<string, unknown> = {};
  const handler = jest.fn(() => chain);
  chain.select = handler;
  chain.in = handler;
  chain.eq = handler;
  chain.or = handler;
  chain.then = Promise.resolve(result).then.bind(Promise.resolve(result));
  return chain;
}

// 共有: クーポン対象メニュー(coupon_menus) の取得結果 chain。
// select('menu_id').eq('coupon_id', ...) を直接 await する形（.single() 無し・複数行）。
// rows=[] は「対象メニュー限定なし(0行)」＝全メニュー適用（本番の現状デフォルト）。
// errorObj を渡すとクエリ失敗（fail-closed 500）を再現できる。
function couponMenusChain(rows: { menu_id: string }[] | null, errorObj: { message: string } | null = null) {
  const result = { data: rows, error: errorObj };
  const chain: Record<string, unknown> = {};
  const handler = jest.fn(() => chain);
  chain.select = handler;
  chain.eq = handler;
  chain.then = Promise.resolve(result).then.bind(Promise.resolve(result));
  return chain;
}

// 共有: メニュー担当スタッフ(menu_staff) の取得結果 chain（2026年7月15日追加）。
// select('menu_id, staff_id').in('menu_id', ...) を直接 await する形（.single() 無し・複数行）。
// rows=[] は「担当制限定なし(0行)」＝全スタッフ対応（本番の現状デフォルト）。
// errorObj を渡すとクエリ失敗（fail-closed 500）を再現できる。
function menuStaffChain(rows: { menu_id: string; staff_id: string }[] | null, errorObj: { message: string } | null = null) {
  const result = { data: rows, error: errorObj };
  const chain: Record<string, unknown> = {};
  const handler = jest.fn(() => chain);
  chain.select = handler;
  chain.in = handler;
  chain.then = Promise.resolve(result).then.bind(Promise.resolve(result));
  return chain;
}

// 共有: facility_menus 価格ルックアップの chain（メニュー必須化・2026年7月15日）。
// route は .select('id, price').in('id', ...).eq('facility_id', ...).or(...) を直接 await するため
// thenable にする。base validBooking が MENU_UUID を持つので、メニューゲートを通過して下流
// （競合後の価格計算・RPC・通知など）に到達するテストは call 2 でこの chain を返す。
function menuLookupChain(price = 5000, id: string = MENU_UUID) {
  // 価格ルックアップ（.in().eq().or() を直接 await）は配列で解決する。
  const listResult = { data: [{ id, price }], error: null };
  // メール/LINE のメニュー名ルックアップ（.eq().eq().single()/.maybeSingle()）は単一行で解決する。
  // 同じ facility_menus テーブルを table 名ベースで両クエリに使い回せるよう両対応にする。
  const singleResult = { data: { id, price, name: 'テストメニュー' }, error: null };
  const chain: Record<string, unknown> = {};
  const handler = jest.fn(() => chain);
  chain.select = handler;
  chain.in = handler;
  chain.eq = handler;
  chain.or = handler;
  chain.then = Promise.resolve(listResult).then.bind(Promise.resolve(listResult));
  chain.single = jest.fn(() => Promise.resolve(singleResult));
  chain.maybeSingle = jest.fn(() => Promise.resolve(singleResult));
  return chain;
}

describe('POST /api/booking', () => {
  test('正常に予約を作成する', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain; // conflict check
      if (callNum === 2) return menuLookupChain(); // facility_menus 価格ルックアップ
      return nullChain;                         // facility_profiles + notification lookups
    });

    const res = await POST(makeRequest(validBooking));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.bookingId).toBe('new-booking-id');
  });

  // 【2026年7月7日 本番実データで確定した恒久根治の回帰防止】通知の副作用を fire-and-forget
  // (waitUntil) に戻すと本番(Fluid Compute 無効)でレスポンス返却後に打ち切られ通知が全滅する。
  // レスポンスは副作用の完了(await Promise.allSettled)まで確定しないことを直列に検証する。
  test('通知メール送信が完了するまでレスポンスを確定させない（awaitで確実に完了・fire-and-forget回帰防止）', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuLookupChain();
      return nullChain;
    });

    const { sendBookingConfirmation, sendBookingConfirmed } = require('@/lib/email');
    let resolveSend: (() => void) | undefined;
    const pending = new Promise<boolean>((resolve) => { resolveSend = () => resolve(true); });
    (sendBookingConfirmation as jest.Mock).mockReturnValueOnce(pending);
    (sendBookingConfirmed as jest.Mock).mockReturnValueOnce(pending);

    const postPromise = POST(makeRequest(validBooking));
    let settled = false;
    void postPromise.then(() => { settled = true; });

    // 送信 Promise が未解決の間はレスポンスも確定しない（＝fire-and-forget でない）。
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);

    // 送信完了でレスポンスが確定する。
    resolveSend!();
    const res = await postPromise;
    expect(settled).toBe(true);
    expect((await res.json()).success).toBe(true);
  });

  test('バリデーション失敗→400', async () => {
    const res = await POST(makeRequest({ ...validBooking, customer_name: '' }));
    expect(res.status).toBe(400);
  });

  test('開始時間>=終了時間→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    mockFrom.mockReturnValue(conflictChain);

    const res = await POST(makeRequest({ ...validBooking, start_time: '11:00', end_time: '10:00' }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('開始時間');
  });

  test('CSRF失敗→403', async () => {
    const { NextResponse } = jest.requireActual('next/server') as { NextResponse: typeof import('next/server').NextResponse };
    (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({ error: 'CSRF' }, { status: 403 }));

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(403);
  });

  test('レートリミット→429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(429);
  });

  test('staff_id指定時の競合→409', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const staffId = '223e4567-e89b-12d3-a456-426614174000';

    const conflictChain = fluent(null);
    // After eq(staff_id) the chain resolves with a conflict
    const conflictResult = Promise.resolve({ data: [{ id: 'existing' }] });
    const chainEnd: Record<string, unknown> = {};
    chainEnd.eq = jest.fn(() => conflictResult);
    chainEnd.then = conflictResult.then.bind(conflictResult);
    conflictChain.gt = jest.fn(() => chainEnd);

    mockFrom.mockReturnValue(conflictChain);

    const res = await POST(makeRequest({ ...validBooking, staff_id: staffId }));
    expect(res.status).toBe(409);
  });

  test('DB挿入失敗→500', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuLookupChain();
      return nullChain;
    });

    mockRpc.mockResolvedValue({ data: null, error: { message: 'db error', code: '99999' } });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(500);
  });

  test('DB制約違反（23505）→409', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuLookupChain();
      return nullChain;
    });

    mockRpc.mockResolvedValue({ data: null, error: { message: 'BOOKING_CONFLICT duplicate', code: '23505' } });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(409);
  });

  test('クーポン総上限到達（COUPON_LIMIT）→409', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuLookupChain();
      return nullChain;
    });

    mockRpc.mockResolvedValue({ data: null, error: { message: 'COUPON_LIMIT: このクーポンは利用上限に達しています', code: 'P0001' } });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('利用上限');
  });

  test('クーポン1人1回違反（COUPON_ALREADY_USED）→409', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuLookupChain();
      return nullChain;
    });

    mockRpc.mockResolvedValue({ data: null, error: { message: 'COUPON_ALREADY_USED: このクーポンは既に利用済みです', code: 'P0001' } });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('既に利用済み');
  });

  test('ポイント残高不足→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const pointsChain = fluent(null);
    pointsChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 100 }] }));

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      if (table === 'user_points') return pointsChain; // 残高100 < 利用500 → 不足
      return fluent({ data: null });
    });

    const res = await POST(makeRequest({ ...validBooking, points_used: 500 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('ポイント');
  });

  test('価格を超える points_used はサーバ価格にクランプして控除（過剰控除防止・回帰防止）', async () => {
    // menu 価格 8000 に対し points_used=10000 を送る。クランプで pointsUsed=8000・請求=0 になる。
    // 旧コードは full 10000 を p_points_used に渡し 2000pt 過剰控除していた。
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    // facility_menus 価格ルックアップ（route は chain を直接 await するため thenable にする）
    const menuLookupResult = { data: [{ id: menuId, price: 8000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = menuHandler;
    menuChain.or = menuHandler;
    menuChain.then = Promise.resolve(menuLookupResult).then.bind(Promise.resolve(menuLookupResult));

    const balanceChain = fluent(null);
    balanceChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 10000 }] })); // 残高十分

    const nullChain = fluent({ data: null });

    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({
      select: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: { id: 'deduction-1' } })) })),
    }));

    const recheckChain = fluent(null);
    recheckChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 2000 }] })); // 控除後も非負

    mockRpc.mockResolvedValue({ data: 'booking-clamp-1', error: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;  // conflict check
      if (callNum === 2) return menuChain;      // facility_menus 価格ルックアップ
      if (callNum === 3) return balanceChain;   // user_points 残高スナップショット
      if (callNum === 4) return nullChain;      // facility_profiles (auto-confirm)
      if (table === 'user_points' && callNum === 5) return deductionChain; // 控除 insert
      if (table === 'user_points') return recheckChain;                    // 再検証
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, points_used: 10000, total_price: 1 }));
    const json = await res.json();
    expect(json.success).toBe(true);
    // クランプ後: p_points_used=8000（10000 ではない）, p_total_price=0
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_points_used: 8000, p_total_price: 0 })
    );
    // 控除 insert も 8000（-8000）でなければならない
    expect((deductionChain.insert as jest.Mock)).toHaveBeenCalledWith(
      expect.objectContaining({ points: -8000 })
    );
  });

  // ポイント控除経路のヘルパ: menu価格・残高・facility の chain を組む（coupon なし）。
  function pointMenuChains(price: number, balance: number) {
    const menuLookupResult = { data: [{ id: '323e4567-e89b-12d3-a456-426614174000', price }], error: null };
    const menuChain: Record<string, unknown> = {}; const mh = jest.fn(() => menuChain);
    menuChain.select = mh; menuChain.in = mh; menuChain.eq = mh; menuChain.or = mh;
    menuChain.then = Promise.resolve(menuLookupResult).then.bind(Promise.resolve(menuLookupResult));
    const conflictChain = fluent(null); conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const balanceChain = fluent(null); balanceChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: balance }] }));
    return { menuChain, conflictChain, balanceChain };
  }

  test('H-1: ポイント控除INSERT失敗 → 予約キャンセル+500（無償値引き防止）', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const { menuChain, conflictChain, balanceChain } = pointMenuChains(8000, 10000);
    const nullChain = fluent({ data: null });
    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({ select: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null, error: { message: 'insert failed' } })) })) }));
    const bookingRbChain: Record<string, unknown> = {};
    // rollback の bookings update が失敗しても console.error で可視化するのみ（rbErr 分岐も網羅）。
    bookingRbChain.update = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: { message: 'rb failed' } })) }));
    mockRpc.mockResolvedValue({ data: 'booking-h1a', error: null });
    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return balanceChain;
      if (callNum === 4) return nullChain;                                 // facility auto-confirm
      if (table === 'user_points' && callNum === 5) return deductionChain; // 控除 insert（error）
      if (table === 'bookings') return bookingRbChain;                     // ロールバック
      return nullChain;
    });
    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, points_used: 5000 }));
    expect(res.status).toBe(500);
    // coupon なしなので coupon_redemptions 解放は呼ばれず、予約は cancelled 化される。
    expect(bookingRbChain.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
  });

  test('SM-12: 残高recheck取得失敗 → 控除削除+予約キャンセル+500（fail-open防止）', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const { menuChain, conflictChain, balanceChain } = pointMenuChains(8000, 10000);
    const nullChain = fluent({ data: null });
    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({ select: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: { id: 'deduction-1' }, error: null })) })) }));
    const recheckChain = fluent(null);
    recheckChain.eq = jest.fn(() => Promise.resolve({ data: null, error: { message: 'recheck failed' } }));
    // recheck 後の控除削除も from('user_points') 経由でこの chain を通る。
    recheckChain.delete = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) }));
    const bookingRbChain: Record<string, unknown> = {};
    bookingRbChain.update = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) }));
    mockRpc.mockResolvedValue({ data: 'booking-sm12', error: null });
    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return balanceChain;
      if (callNum === 4) return nullChain;
      if (table === 'user_points' && callNum === 5) return deductionChain; // 控除 insert（ok）
      if (table === 'user_points') return recheckChain;                    // recheck（error）
      if (table === 'bookings') return bookingRbChain;                     // ロールバック
      return nullChain;
    });
    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, points_used: 5000 }));
    expect(res.status).toBe(500);
    expect(recheckChain.delete).toHaveBeenCalled();                        // 控除行を削除
    expect(bookingRbChain.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
  });

  test('SM-6: ポイント控除失敗時にクーポン利用(coupon_redemptions)も解放', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const couponId = '423e4567-e89b-12d3-a456-426614174000';
    const { menuChain, conflictChain, balanceChain } = pointMenuChains(8000, 10000);
    const nullChain = fluent({ data: null });
    // coupon 検証（fixed 0円割引 = 価格不変・有効）
    const couponsChain = fluent({ data: { discount_type: 'fixed', discount_value: 0, special_price: null, is_active: true, valid_from: null, valid_until: null } });
    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({ select: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: null, error: { message: 'insert failed' } })) })) }));
    const bookingRbChain: Record<string, unknown> = {};
    bookingRbChain.update = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) }));
    const couponDelChain: Record<string, unknown> = {};
    // 解放 delete が失敗する場合も console.error で可視化するのみ（本体は continue）＝crErr 分岐も網羅。
    couponDelChain.delete = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: { message: 'coupon release failed' } })) }));
    mockRpc.mockResolvedValue({ data: 'booking-sm6', error: null });
    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (table === 'coupons') return couponsChain;          // coupon 検証（callNum 3）
      if (table === 'coupon_menus') return couponMenusChain([]); // 対象メニューチェック（callNum 4・0行→全メニュー適用）
      if (callNum === 5) return balanceChain;
      if (callNum === 6) return nullChain;                   // facility auto-confirm
      if (table === 'user_points' && callNum === 7) return deductionChain; // 控除 insert（error）
      if (table === 'bookings') return bookingRbChain;       // ロールバック
      if (table === 'coupon_redemptions') return couponDelChain; // クーポン解放
      return nullChain;
    });
    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, points_used: 5000, coupon_id: couponId }));
    expect(res.status).toBe(500);
    // coupon_id あり → coupon_redemptions を booking_id で解放（「1人1回」の恒久消費を防ぐ）。
    expect(couponDelChain.delete).toHaveBeenCalled();
  });

  test('未認証ユーザーがポイント利用→401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    mockFrom.mockImplementation((table: string) => {
      if (table === 'facility_menus') return menuLookupChain();
      return conflictChain; // bookings conflict（空）。401 はポイント認証チェックで返る。
    });

    const res = await POST(makeRequest({ ...validBooking, points_used: 100 }));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('認証');
  });

  test('menu_idありでサーバー側価格計算', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';

    // Route call order with menu_id:
    // 1: conflict check (bookings)
    // 2: facility_menus price lookup — returns { data: [{ id: menuId, price: 8000 }] }
    // 3: facility_profiles (auto-confirm)
    // rpc: create_booking_atomic → success
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    // facility_menus lookup: the route uses .in('id', [...]).eq('facility_id', ...)
    // fluent() chains resolve through single() or maybeSingle(); for this query the
    // route uses await directly on the chain object, so we need a thenable
    const menuLookupResult = { data: [{ id: menuId, price: 8000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = menuHandler;
    menuChain.or = menuHandler;
    menuChain.then = Promise.resolve(menuLookupResult).then.bind(Promise.resolve(menuLookupResult));

    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain; // conflict check
      if (callNum === 2) return menuChain;     // facility_menus price lookup
      return nullChain;                        // facility_profiles + notification lookups
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, total_price: 1 }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 8000 })
    );
  });

  test('coupon_id + percentage割引でサーバー側価格計算', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const couponId = '423e4567-e89b-12d3-a456-426614174000';

    // Route call order with menu_id + coupon_id:
    // 1: conflict check (bookings)
    // 2: facility_menus price lookup → price: 10000
    // 3: coupons discount lookup → 20% off → 8000
    // 4: coupon_menus 対象メニューチェック（0行=全メニュー適用）
    // 5: facility_profiles (auto-confirm)
    // rpc: create_booking_atomic with total_price: 8000
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = menuHandler;
    menuChain.or = menuHandler;
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    const couponChain = fluent({ data: { discount_type: 'percentage', discount_value: 20, is_active: true, valid_from: null, valid_until: null }, error: null });

    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;  // conflict check
      if (callNum === 2) return menuChain;      // facility_menus lookup
      if (callNum === 3) return couponChain;    // coupons discount lookup
      if (table === 'coupon_menus') return couponMenusChain([]); // 0行→全メニュー適用
      return nullChain;                         // facility_profiles + notification lookups
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId, total_price: 1 }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 8000 })
    );
  });

  test('coupon_id + percentage割引 100% 超でも価格が負にならない（Math.max(0) ガード）', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const couponId = '423e4567-e89b-12d3-a456-426614174000';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = menuHandler;
    menuChain.or = menuHandler;
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    // discount_value: 150 (150% off) → 計算結果は負 → Math.max(0,...) で 0 になるべき
    const couponChain = fluent({ data: { discount_type: 'percentage', discount_value: 150, is_active: true, valid_from: null, valid_until: null }, error: null });

    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return couponChain;
      if (table === 'coupon_menus') return couponMenusChain([]); // 0行→全メニュー適用
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId, total_price: 1 }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 0 })
    );
  });

  test('coupon_id + special_price だが special_price=null（設定不備）→ メニュー定価を維持（NULL伝播しない）', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const couponId = '423e4567-e89b-12d3-a456-426614174000';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = menuHandler;
    menuChain.or = menuHandler;
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    const couponChain = fluent({ data: { discount_type: 'special_price', discount_value: null, special_price: null, is_active: true, valid_from: null, valid_until: null }, error: null });
    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return couponChain;
      if (table === 'coupon_menus') return couponMenusChain([]); // 0行→全メニュー適用
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId, total_price: 1 }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 10000 })
    );
  });

  test('ポイント競合→rollback→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });

    // Route call order with points_used > 0 and user:
    // 1: conflict check → ok
    // 2: user_points balance check → 200 (sufficient for 150)
    // 3: facility_profiles (auto-confirm)
    // rpc: returns booking-race-1
    // 4: user_points insert (deduction) → deductionRow.id = 'deduction-1'
    // 5: user_points select re-verify → balance -50 (race detected)
    // 6: user_points delete deduction row
    // 7: bookings update cancel
    // → return 400 with "競合"

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const balanceChain = fluent(null);
    balanceChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 200 }] }));

    const nullChain = fluent({ data: null });

    // Point deduction insert chain: .insert().select('id').single()
    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: { id: 'deduction-1' } })),
      })),
    }));

    const recheckChain = fluent(null);
    recheckChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: -50 }] }));

    const deleteChain: Record<string, unknown> = {};
    deleteChain.delete = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) }));

    const cancelChain: Record<string, unknown> = {};
    cancelChain.update = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) }));

    mockRpc.mockResolvedValue({ data: 'booking-race-1', error: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;   // conflict check (bookings)
      if (callNum === 2) return menuPriceChain(100000); // facility_menus price lookup
      if (callNum === 3) return balanceChain;    // user_points balance snapshot
      if (callNum === 4) return nullChain;       // facility_profiles (auto-confirm)
      // After RPC success:
      if (table === 'user_points' && callNum === 5) return deductionChain; // insert deduction
      if (table === 'user_points' && callNum === 6) return recheckChain;   // re-verify balance
      if (table === 'user_points') return deleteChain;                     // rollback deduction
      if (table === 'bookings') return cancelChain;                        // cancel booking
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: POINTS_MENU_ID, points_used: 150 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('競合');
  });

  test('create_booking_atomic がnullを返す→500', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockRpc.mockResolvedValue({ data: null, error: null });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuLookupChain();
      return nullChain;
    });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(500);
  });

  test('coupon fixed割引でサーバー側価格計算', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const couponId = '423e4567-e89b-12d3-a456-426614174000';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = menuHandler;
    menuChain.or = menuHandler;
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    const couponChain = fluent({ data: { discount_type: 'fixed', discount_value: 1500, is_active: true, valid_from: null, valid_until: null } });
    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return couponChain;
      if (table === 'coupon_menus') return couponMenusChain([]); // 0行→全メニュー適用
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 8500 })
    );
  });

  test('coupon special_price割引でサーバー側価格計算', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const couponId = '423e4567-e89b-12d3-a456-426614174000';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = menuHandler;
    menuChain.or = menuHandler;
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    // special_price 型は専用列 special_price に実額が入る（discount_value は null）。
    const couponChain = fluent({ data: { discount_type: 'special_price', discount_value: null, special_price: 3000, is_active: true, valid_from: null, valid_until: null } });
    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return couponChain;
      if (table === 'coupon_menus') return couponMenusChain([]); // 0行→全メニュー適用
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 3000 })
    );
  });

  // 【2026年7月15日 恒久予防】クーポン×メニュー適合制約（coupon_menus）の全分岐。
  // 意味論＝coupon_menus に行があるクーポンは対象メニュー限定・行が無い(0行)クーポンは全メニュー適用。
  // 本番は現状全クーポン0行のため、上の既存5テスト（0行→通る）に加えて、行あり適合／行あり不適合／
  // クエリ失敗の3ケースをここで検証する。
  describe('クーポン×メニュー適合制約(coupon_menus)', () => {
    test('coupon_menusに行あり・選択メニューが対象に含まれる→通る（200・割引適用）', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const menuId = '323e4567-e89b-12d3-a456-426614174000';
      const otherMenuId = '523e4567-e89b-12d3-a456-426614174000';
      const couponId = '423e4567-e89b-12d3-a456-426614174000';

      const conflictChain = fluent(null);
      conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

      const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
      const menuChain: Record<string, unknown> = {};
      const menuHandler = jest.fn(() => menuChain);
      menuChain.select = menuHandler;
      menuChain.in = menuHandler;
      menuChain.eq = menuHandler;
      menuChain.or = menuHandler;
      menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

      const couponChain = fluent({ data: { discount_type: 'fixed', discount_value: 1000, is_active: true, valid_from: null, valid_until: null }, error: null });
      const nullChain = fluent({ data: null });

      let callNum = 0;
      mockFrom.mockImplementation((table: string) => {
        callNum++;
        if (callNum === 1) return conflictChain;
        if (callNum === 2) return menuChain;
        if (callNum === 3) return couponChain;
        // 対象メニューは otherMenuId と menuId の2件。選択中の menuId が含まれるため通る。
        if (table === 'coupon_menus') return couponMenusChain([{ menu_id: otherMenuId }, { menu_id: menuId }]);
        return nullChain;
      });

      const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId, total_price: 1 }));
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith(
        'create_booking_atomic',
        expect.objectContaining({ p_total_price: 9000, p_coupon_id: couponId })
      );
    });

    test('coupon_menusに行あり・選択メニューが対象外→400（割引を適用せずfail-closed）', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const menuId = '323e4567-e89b-12d3-a456-426614174000';
      const allowedMenuId = '623e4567-e89b-12d3-a456-426614174000';
      const couponId = '423e4567-e89b-12d3-a456-426614174000';

      const conflictChain = fluent(null);
      conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

      const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
      const menuChain: Record<string, unknown> = {};
      const menuHandler = jest.fn(() => menuChain);
      menuChain.select = menuHandler;
      menuChain.in = menuHandler;
      menuChain.eq = menuHandler;
      menuChain.or = menuHandler;
      menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

      const couponChain = fluent({ data: { discount_type: 'fixed', discount_value: 1000, is_active: true, valid_from: null, valid_until: null }, error: null });
      const nullChain = fluent({ data: null });

      let callNum = 0;
      mockFrom.mockImplementation((table: string) => {
        callNum++;
        if (callNum === 1) return conflictChain;
        if (callNum === 2) return menuChain;
        if (callNum === 3) return couponChain;
        // 対象メニューは allowedMenuId のみ。選択中の menuId は含まれないため拒否。
        if (table === 'coupon_menus') return couponMenusChain([{ menu_id: allowedMenuId }]);
        return nullChain;
      });

      const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId, total_price: 1 }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('対象メニュー');
      // 割引未適用のまま予約が作られてはいけない（金銭損失防止）→ RPC 自体に到達しない。
      expect(mockRpc).not.toHaveBeenCalled();
    });

    test('coupon_menus取得がエラー→500（無言で割引適用せずfail-closed）', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const menuId = '323e4567-e89b-12d3-a456-426614174000';
      const couponId = '423e4567-e89b-12d3-a456-426614174000';

      const conflictChain = fluent(null);
      conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

      const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
      const menuChain: Record<string, unknown> = {};
      const menuHandler = jest.fn(() => menuChain);
      menuChain.select = menuHandler;
      menuChain.in = menuHandler;
      menuChain.eq = menuHandler;
      menuChain.or = menuHandler;
      menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

      const couponChain = fluent({ data: { discount_type: 'fixed', discount_value: 1000, is_active: true, valid_from: null, valid_until: null }, error: null });
      const nullChain = fluent({ data: null });

      let callNum = 0;
      mockFrom.mockImplementation((table: string) => {
        callNum++;
        if (callNum === 1) return conflictChain;
        if (callNum === 2) return menuChain;
        if (callNum === 3) return couponChain;
        if (table === 'coupon_menus') return couponMenusChain(null, { message: 'db error' });
        return nullChain;
      });

      const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId, total_price: 1 }));
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toContain('クーポン');
      expect(mockRpc).not.toHaveBeenCalled();
    });
  });

  // 【2026年7月15日 HPB準拠仕様】メニュー担当スタッフ制(menu_staff)の全分岐。
  // 意味論＝menu_staff に行があるメニューは担当スタッフ限定・行が無い(0行)メニューは全スタッフ対応。
  // 本番は現状全メニュー0行のため挙動変化ゼロ。行あり適合(通る)／行あり不適合(400)／クエリ失敗(500)／
  // staff_id なし(チェック自体をスキップ)の各分岐を検証する。判定純関数の全分岐は
  // src/lib/__tests__/menu-staff.test.ts で網羅済みのため、ここは route の分岐（400/500）に集中する。
  describe('メニュー担当スタッフ制(menu_staff)', () => {
    // menu_staff チェックは price 計算後・staff_id がある時のみ実行される。共通の chain 束を作る。
    function baseChains(price: number) {
      const conflictChain = fluent(null);
      const noConflict = Promise.resolve({ data: [] });
      const chainEnd: Record<string, unknown> = {};
      chainEnd.eq = jest.fn(() => noConflict);
      chainEnd.then = noConflict.then.bind(noConflict);
      conflictChain.gt = jest.fn(() => chainEnd);

      const menuId = '323e4567-e89b-12d3-a456-426614174000';
      const menuResult = { data: [{ id: menuId, price }], error: null };
      const menuChain: Record<string, unknown> = {};
      const menuHandler = jest.fn(() => menuChain);
      menuChain.select = menuHandler;
      menuChain.in = menuHandler;
      menuChain.eq = menuHandler;
      menuChain.or = menuHandler;
      menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

      const staffFeeChain = fluent({ data: { nomination_fee: 0 } });
      const nullChain = fluent({ data: null });
      return { conflictChain, menuChain, staffFeeChain, nullChain, menuId };
    }

    test('menu_staffに行あり・指名スタッフが担当に含まれる→通る（200）', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const staffId = '223e4567-e89b-12d3-a456-426614174000';
      const { conflictChain, menuChain, staffFeeChain, nullChain, menuId } = baseChains(8000);
      let callNum = 0;
      mockFrom.mockImplementation((table: string) => {
        callNum++;
        if (callNum === 1) return conflictChain;
        if (callNum === 2) return menuChain;
        if (callNum === 3) return staffFeeChain;
        // 担当は当該 staffId と別スタッフの2件。指名 staffId が含まれるため通る。
        if (table === 'menu_staff') return menuStaffChain([{ menu_id: menuId, staff_id: 'other-staff' }, { menu_id: menuId, staff_id: staffId }]);
        return nullChain;
      });

      const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, staff_id: staffId, total_price: 1 }));
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(mockRpc).toHaveBeenCalledWith('create_booking_atomic', expect.objectContaining({ p_staff_id: staffId }));
    });

    test('menu_staffに行あり・指名スタッフが担当外→400（fail-closed・RPC未到達）', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const staffId = '223e4567-e89b-12d3-a456-426614174000';
      const { conflictChain, menuChain, staffFeeChain, nullChain, menuId } = baseChains(8000);
      let callNum = 0;
      mockFrom.mockImplementation((table: string) => {
        callNum++;
        if (callNum === 1) return conflictChain;
        if (callNum === 2) return menuChain;
        if (callNum === 3) return staffFeeChain;
        // 担当は別スタッフのみ。指名 staffId は含まれないため拒否。
        if (table === 'menu_staff') return menuStaffChain([{ menu_id: menuId, staff_id: 'only-other-staff' }]);
        return nullChain;
      });

      const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, staff_id: staffId, total_price: 1 }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('担当');
      expect(mockRpc).not.toHaveBeenCalled();
    });

    test('menu_staff取得がエラー→500（無言で予約を通さずfail-closed・RPC未到達）', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const staffId = '223e4567-e89b-12d3-a456-426614174000';
      const { conflictChain, menuChain, staffFeeChain, nullChain, menuId } = baseChains(8000);
      let callNum = 0;
      mockFrom.mockImplementation((table: string) => {
        callNum++;
        if (callNum === 1) return conflictChain;
        if (callNum === 2) return menuChain;
        if (callNum === 3) return staffFeeChain;
        if (table === 'menu_staff') return menuStaffChain(null, { message: 'db error' });
        return nullChain;
      });

      const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, staff_id: staffId, total_price: 1 }));
      expect(res.status).toBe(500);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    test('menu_staff がdata=null(0行相当)→全スタッフ対応として通る（200・?? [] フォールバック）', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const staffId = '223e4567-e89b-12d3-a456-426614174000';
      const { conflictChain, menuChain, staffFeeChain, nullChain, menuId } = baseChains(8000);
      let callNum = 0;
      mockFrom.mockImplementation((table: string) => {
        callNum++;
        if (callNum === 1) return conflictChain;
        if (callNum === 2) return menuChain;
        if (callNum === 3) return staffFeeChain;
        // data=null かつ error=null（0行を null で返す環境）→ buildMenuStaffMap(null ?? []) で空マップ扱い。
        if (table === 'menu_staff') return menuStaffChain(null);
        return nullChain;
      });

      const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, staff_id: staffId, total_price: 1 }));
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    test('menu_staffに行あり・指名なし(staff_id null)→担当チェックはスキップし通る（200）', async () => {
      // staff_id が無ければ担当制の判定対象外（おまかせ）。menu_staff クエリ自体が実行されない。
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const { conflictChain, menuChain, nullChain, menuId } = baseChains(8000);
      const menuStaffSpy = jest.fn(() => menuStaffChain([{ menu_id: menuId, staff_id: 'some-staff' }]));
      let callNum = 0;
      mockFrom.mockImplementation((table: string) => {
        callNum++;
        if (callNum === 1) return conflictChain;
        if (callNum === 2) return menuChain;
        if (table === 'menu_staff') return menuStaffSpy();
        return nullChain;
      });

      const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, staff_id: null, total_price: 1 }));
      const json = await res.json();
      expect(json.success).toBe(true);
      // 指名なしのため menu_staff クエリは呼ばれない（担当チェックは staff_id ありの時のみ）。
      expect(menuStaffSpy).not.toHaveBeenCalled();
    });
  });

  // 【2026年7月15日 HPB準拠仕様】クーポンは対象メニューにのみ効く（対象外メニューは定価加算）。
  // src/lib/coupon-pricing.ts の calculateCouponDiscountedTotal をサーバーが権威として呼ぶ。
  // ここでは対象+対象外混在のケースで「対象分のみ割引」の実額をサーバー請求額で検証する
  // （純粋関数の全分岐は src/lib/__tests__/coupon-pricing.test.ts で網羅済み）。
  describe('HPB準拠：対象メニュー限定クーポンは対象小計にのみ適用（混在ケース）', () => {
    test('fixed：対象メニュー(10000)+対象外メニュー(2000)混在 → 対象分のみ1000円引き(9000)+対象外2000=11000', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const targetMenuId = '323e4567-e89b-12d3-a456-426614174000';
      const otherMenuId = '523e4567-e89b-12d3-a456-426614174000';
      const couponId = '423e4567-e89b-12d3-a456-426614174000';

      const conflictChain = fluent(null);
      conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

      const menuResult = { data: [{ id: targetMenuId, price: 10000 }, { id: otherMenuId, price: 2000 }], error: null };
      const menuChain: Record<string, unknown> = {};
      const menuHandler = jest.fn(() => menuChain);
      menuChain.select = menuHandler;
      menuChain.in = menuHandler;
      menuChain.eq = menuHandler;
      menuChain.or = menuHandler;
      menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

      const couponChain = fluent({ data: { discount_type: 'fixed', discount_value: 1000, is_active: true, valid_from: null, valid_until: null }, error: null });
      const nullChain = fluent({ data: null });

      let callNum = 0;
      mockFrom.mockImplementation((table: string) => {
        callNum++;
        if (callNum === 1) return conflictChain;
        if (callNum === 2) return menuChain;
        if (callNum === 3) return couponChain;
        // 対象メニューは targetMenuId のみ（otherMenuId は対象外）
        if (table === 'coupon_menus') return couponMenusChain([{ menu_id: targetMenuId }]);
        return nullChain;
      });

      const res = await POST(makeRequest({
        ...validBooking, menu_id: null, menu_ids: [targetMenuId, otherMenuId], coupon_id: couponId, total_price: 1,
      }));
      const json = await res.json();
      expect(json.success).toBe(true);
      // 対象(10000)-1000=9000 + 対象外(2000)定価 = 11000（旧ANY-match実装なら 12000-1000=11000 と
      // 偶然一致してしまうため、下の percentage/special_price テストで意味論の違いを明確に検証する）
      expect(mockRpc).toHaveBeenCalledWith(
        'create_booking_atomic',
        expect.objectContaining({ p_total_price: 11000, p_coupon_id: couponId })
      );
    });

    test('percentage：対象メニュー(10000)+対象外メニュー(2000)混在 → 対象分のみ20%引き(8000)+対象外2000=10000（旧ANY-match実装なら9600になり非等価）', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const targetMenuId = '323e4567-e89b-12d3-a456-426614174000';
      const otherMenuId = '523e4567-e89b-12d3-a456-426614174000';
      const couponId = '423e4567-e89b-12d3-a456-426614174000';

      const conflictChain = fluent(null);
      conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

      const menuResult = { data: [{ id: targetMenuId, price: 10000 }, { id: otherMenuId, price: 2000 }], error: null };
      const menuChain: Record<string, unknown> = {};
      const menuHandler = jest.fn(() => menuChain);
      menuChain.select = menuHandler;
      menuChain.in = menuHandler;
      menuChain.eq = menuHandler;
      menuChain.or = menuHandler;
      menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

      const couponChain = fluent({ data: { discount_type: 'percentage', discount_value: 20, is_active: true, valid_from: null, valid_until: null }, error: null });
      const nullChain = fluent({ data: null });

      let callNum = 0;
      mockFrom.mockImplementation((table: string) => {
        callNum++;
        if (callNum === 1) return conflictChain;
        if (callNum === 2) return menuChain;
        if (callNum === 3) return couponChain;
        if (table === 'coupon_menus') return couponMenusChain([{ menu_id: targetMenuId }]);
        return nullChain;
      });

      const res = await POST(makeRequest({
        ...validBooking, menu_id: null, menu_ids: [targetMenuId, otherMenuId], coupon_id: couponId, total_price: 1,
      }));
      const json = await res.json();
      expect(json.success).toBe(true);
      // 新方式（対象小計のみ）: 10000*0.8=8000 + 対象外2000 = 10000
      // 旧ANY-match方式（合計に効く）なら (10000+2000)*0.8=9600 になり、この値と一致しないことで
      // 「対象分のみ割引」の意味論が実際に効いていることを検証する。
      expect(mockRpc).toHaveBeenCalledWith(
        'create_booking_atomic',
        expect.objectContaining({ p_total_price: 10000, p_coupon_id: couponId })
      );
    });

    test('special_price：対象メニュー(10000)+対象外メニュー(2000)混在 → 対象小計を5000に置換+対象外2000=7000', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null } });
      const targetMenuId = '323e4567-e89b-12d3-a456-426614174000';
      const otherMenuId = '523e4567-e89b-12d3-a456-426614174000';
      const couponId = '423e4567-e89b-12d3-a456-426614174000';

      const conflictChain = fluent(null);
      conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

      const menuResult = { data: [{ id: targetMenuId, price: 10000 }, { id: otherMenuId, price: 2000 }], error: null };
      const menuChain: Record<string, unknown> = {};
      const menuHandler = jest.fn(() => menuChain);
      menuChain.select = menuHandler;
      menuChain.in = menuHandler;
      menuChain.eq = menuHandler;
      menuChain.or = menuHandler;
      menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

      const couponChain = fluent({ data: { discount_type: 'special_price', discount_value: null, special_price: 5000, is_active: true, valid_from: null, valid_until: null }, error: null });
      const nullChain = fluent({ data: null });

      let callNum = 0;
      mockFrom.mockImplementation((table: string) => {
        callNum++;
        if (callNum === 1) return conflictChain;
        if (callNum === 2) return menuChain;
        if (callNum === 3) return couponChain;
        if (table === 'coupon_menus') return couponMenusChain([{ menu_id: targetMenuId }]);
        return nullChain;
      });

      const res = await POST(makeRequest({
        ...validBooking, menu_id: null, menu_ids: [targetMenuId, otherMenuId], coupon_id: couponId, total_price: 1,
      }));
      const json = await res.json();
      expect(json.success).toBe(true);
      // 対象(10000)→special_price(5000)に置換 + 対象外(2000)定価 = 7000
      expect(mockRpc).toHaveBeenCalledWith(
        'create_booking_atomic',
        expect.objectContaining({ p_total_price: 7000, p_coupon_id: couponId })
      );
    });
  });

  test('無効クーポン→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const couponId = '423e4567-e89b-12d3-a456-426614174000';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = menuHandler;
    menuChain.or = menuHandler;
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    // Inactive coupon
    const couponChain = fluent({ data: { discount_type: 'fixed', discount_value: 500, is_active: false, valid_from: null, valid_until: null } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return couponChain;
      return fluent({ data: null });
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('クーポン');
  });

  test('期限切れクーポン→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const couponId = '423e4567-e89b-12d3-a456-426614174000';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = menuHandler;
    menuChain.or = menuHandler;
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    // Expired coupon (valid_until in the past)
    const couponChain = fluent({ data: { discount_type: 'fixed', discount_value: 500, is_active: true, valid_from: null, valid_until: '2020-01-01T00:00:00Z' } });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return couponChain;
      return fluent({ data: null });
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId }));
    expect(res.status).toBe(400);
  });

  test('無効メニュー（facility不一致）→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const wrongMenuId = '999e4567-e89b-12d3-a456-426614174000';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    // Returns wrongMenuId, not the requested menuId
    const menuResult = { data: [{ id: wrongMenuId, price: 5000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = menuHandler;
    menuChain.or = menuHandler;
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    mockFrom.mockImplementation((_, callN = { n: 0 }) => {
      void callN;
      return menuChain;
    });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      return fluent({ data: null });
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('メニュー');
  });

  test('staff_id指定時に指名料を加算', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = '323e4567-e89b-12d3-a456-426614174000';
    const staffId = '223e4567-e89b-12d3-a456-426614174000';

    // staff_id is present → route chains .eq('staff_id', ...) after .gt(), so gt must return chainable
    const conflictChain = fluent(null);
    const noConflict = Promise.resolve({ data: [] });
    const chainEnd: Record<string, unknown> = {};
    chainEnd.eq = jest.fn(() => noConflict);
    chainEnd.then = noConflict.then.bind(noConflict);
    conflictChain.gt = jest.fn(() => chainEnd);

    const menuResult = { data: [{ id: menuId, price: 8000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = menuHandler;
    menuChain.or = menuHandler;
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    // Staff nomination fee chain
    const staffChain = fluent({ data: { nomination_fee: 500 } });

    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return staffChain;
      // メニュー担当スタッフ制(menu_staff)チェック（2026年7月15日追加）。行なし=無制限で通す。
      if (table === 'menu_staff') return menuStaffChain([]);
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, staff_id: staffId }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 8500 })
    );
  });

  test('menu_idsで複数メニュー価格を合計', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId1 = '323e4567-e89b-12d3-a456-426614174001';
    const menuId2 = '323e4567-e89b-12d3-a456-426614174002';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId1, price: 3000 }, { id: menuId2, price: 2000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = menuHandler;
    menuChain.or = menuHandler;
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    const nullChain = fluent({ data: null });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      return nullChain;
    });

    const body = { ...validBooking, menu_ids: [menuId1, menuId2] };
    const res = await POST(makeRequest(body));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 5000 })
    );
  });

  test('複数メニューで menu_ids 保存が失敗 → warn のみ・成功継続', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId1 = '323e4567-e89b-12d3-a456-426614174001';
    const menuId2 = '323e4567-e89b-12d3-a456-426614174002';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId1, price: 3000 }, { id: menuId2, price: 2000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = menuHandler;
    menuChain.or = menuHandler;
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    // menu_ids 永続化の update().eq() だけエラーを返す（他メソッドは fluent と同様）チェーン。
    // 何番目の from 呼び出しが menu_ids 更新かに依存せず、update 経路だけをエラー化する。
    const restErr = fluent({ data: null });
    restErr.update = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: { message: 'persist fail' } })) }));

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      return restErr;
    });

    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(makeRequest({ ...validBooking, menu_ids: [menuId1, menuId2] }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // 権威的なサーバ価格が無い（メニュー未指定で serverTotalPrice=null）状態でポイント利用を
  // 要求した場合、価格上限でクランプできず full 控除＝null 価格(=0円)予約に対するポイント消失
  // （金銭損失）になるため fail-closed で 400 を返す。ポイントは一切控除されない。
  test('メニュー未指定（ポイント利用含む）→ 400（無メニュー予約は拒否・ポイント控除も予約作成もしない）', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-no-menu-pts' } } });

    // user_points への insert が呼ばれたら検知するためのスパイ（無メニューは parse で 400 のため
    // from() 自体が呼ばれず、控除にも RPC にも到達しないことを保証する）。
    const deductionInsert = jest.fn(() => ({
      select: jest.fn(() => ({ single: jest.fn(() => Promise.resolve({ data: { id: 'should-not-happen' } })) })),
    }));
    const deductionChain: Record<string, unknown> = { insert: deductionInsert };
    mockFrom.mockImplementation((table: string) => {
      if (table === 'user_points') return deductionChain;
      const c = fluent(null);
      c.gt = jest.fn(() => Promise.resolve({ data: [] }));
      return c;
    });

    // menu_id / menu_ids 共になし → bookingSchema の refine で 400（parse 時点で拒否）
    const res = await POST(makeRequest({ ...validBooking, menu_id: null, points_used: 100 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('メニュー');
    // RPC（予約作成）にもポイント控除 insert にも到達しないこと
    expect(mockRpc).not.toHaveBeenCalled();
    expect(deductionInsert).not.toHaveBeenCalled();
  });

  test('ポイント成功（CAS通過）→200', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-2' } } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const balanceChain = fluent(null);
    balanceChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 500 }] }));

    const nullChain = fluent({ data: null });

    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: { id: 'deduction-ok' } })),
      })),
    }));

    const recheckChain = fluent(null);
    recheckChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 350 }] })); // still positive

    mockRpc.mockResolvedValue({ data: 'booking-cas-ok', error: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuPriceChain(100000); // facility_menus price lookup
      if (callNum === 3) return balanceChain;
      if (callNum === 4) return nullChain;
      if (table === 'user_points' && callNum === 5) return deductionChain;
      if (table === 'user_points' && callNum === 6) return recheckChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: POINTS_MENU_ID, points_used: 150 }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.bookingId).toBe('booking-cas-ok');
  });

  test('LINE Works通知パス（isLineWorksConfigured=true）', async () => {
    const { isLineWorksConfigured, notifyNewBookingLineWorks } = jest.requireMock('@/lib/integrations/line-works') as {
      isLineWorksConfigured: jest.Mock;
      notifyNewBookingLineWorks: jest.Mock;
    };
    isLineWorksConfigured.mockReturnValue(true);
    notifyNewBookingLineWorks.mockResolvedValue(true);

    mockGetUser.mockResolvedValue({ data: { user: null } });
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    // staffList with a LINE Works channel
    const staffListChain: Record<string, unknown> = {};
    const staffListResult = { data: [{ id: 'staff-lw', line_works_channel_id: 'ch-1', line_works_notify_all: true }] };
    staffListChain.select = jest.fn(() => staffListChain);
    staffListChain.eq = jest.fn(() => staffListChain);
    staffListChain.not = jest.fn(() => Promise.resolve(staffListResult));
    staffListChain.then = Promise.resolve(staffListResult).then.bind(Promise.resolve(staffListResult));

    const nullChain = fluent({ data: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      if (table === 'staff_profiles') return staffListChain; // LINE Works 対象スタッフ取得
      return nullChain;
    });

    const res = await POST(makeRequest(validBooking));
    const json = await res.json();
    expect(json.success).toBe(true);
    // Restore
    isLineWorksConfigured.mockReturnValue(false);
  });

  test('競合あり（スタッフなし）→409', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [{ id: 'conflict-booking' }] }));
    mockFrom.mockReturnValue(conflictChain);

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(409);
  });

  test('BOOKING_CONFLICT in error message (no 23505 code) → 409', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuLookupChain();
      return nullChain;
    });

    mockRpc.mockResolvedValue({ data: null, error: { message: 'BOOKING_CONFLICT occurred', code: '99998' } });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(409);
  });

  test('STAFF_NOT_IN_FACILITY（RPC が G1 ガードで RAISE）→ 400', async () => {
    // 指名スタッフが当該施設に属さない場合、create_booking_atomic が STAFF_NOT_IN_FACILITY を RAISE。
    // API はマルチテナント違反として 400 に変換する（500 汎用に落とさない）ことを検証する。
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuLookupChain();
      return nullChain;
    });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'STAFF_NOT_IN_FACILITY: 指定されたスタッフはこの施設に所属していません', code: 'P0001' } });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('この施設で予約できません');
  });

  test('認証済みユーザーの予約 → ユーザーへのプッシュ通知', async () => {
    const { sendPushToUser } = require('@/lib/push');
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-push-test' } } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuLookupChain();
      return nullChain;
    });

    mockRpc.mockResolvedValue({ data: 'booking-push-test', error: null });

    const res = await POST(makeRequest(validBooking));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(sendPushToUser).toHaveBeenCalledWith('user-push-test', expect.objectContaining({ title: expect.any(String) }));
  });

  test('オーナーメール通知パス（owner_idあり、email取得）', async () => {
    const { sendNewBookingNotification } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    // facility_profiles (auto-confirm) - null
    // facility_members (owner) - 全オーナー配列を返す（D-2: .eq('role','owner') を直接 await）
    // profiles (owner email) - .in('id', ...) で email 配列を返す
    const nullChain = fluent({ data: null });
    // facility_members: .select('user_id').eq().eq() を await → { data: [オーナー配列] }
    const ownersResult = { data: [{ user_id: 'owner-id-1' }, { user_id: 'owner-id-2' }] };
    const ownerChain = fluent(null);
    ownerChain.then = Promise.resolve(ownersResult).then.bind(Promise.resolve(ownersResult));
    // profiles: .select('email').in('id', ...) を await → { data: [email 配列] }
    const ownerProfilesResult = { data: [{ email: 'owner1@example.com' }, { email: 'owner2@example.com' }] };
    const ownerProfilesChain = fluent(null);
    ownerProfilesChain.then = Promise.resolve(ownerProfilesResult).then.bind(Promise.resolve(ownerProfilesResult));

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      if (table === 'facility_members') return ownerChain;
      if (table === 'profiles') return ownerProfilesChain;
      return nullChain; // facility_profiles (auto-confirm / email) 等
    });

    mockRpc.mockResolvedValue({ data: 'booking-owner-test', error: null });

    const res = await POST(makeRequest(validBooking));
    const json = await res.json();
    expect(json.success).toBe(true);
    // 全オーナー(2人)へ new booking 通知メールが送られる（push の owner 全員通知と対称）。
    expect(sendNewBookingNotification).toHaveBeenCalledTimes(2);
  });

  // 【2026年7月16日 本番実データで確定した根治の回帰防止】匿名（未ログイン）予約で、施設オーナー宛
  // 新規予約通知メール(sendNewBookingNotification)が一度も送信されない事故が本番で発生した
  // （2026年7月16日 08:43 の匿名テスト予約で Resend 送信ログは顧客確認メール1通のみ・オーナー通知は
  // 送信記録すら無し）。原因＝facility_members(RLS: USING(auth.uid()=user_id))・profiles
  // (RLS: USING(auth.uid()=id)) を匿名権限の supabase（anon）で引いていたため、匿名予約時は常に
  // 0行になり ownerEmails が空になっていたこと。根治＝この2クエリを service role
  // （createServiceRoleClient・RLSバイパス）に切替。
  // このテストは「オーナー取得の2クエリが実際に service role 経由（mockServiceFrom）で行われた」
  // ことを直接アサートする。table 名一致だけの検証だと、anon 経由でも service role 経由でも
  // mockFrom は同じ値を返せてしまい退行を検知できないため、mockServiceFrom への呼び出し自体を
  // 独立してトラッキングして検証する（anon の supabase に戻す退行があればこのアサーションが失敗する）。
  test('匿名予約(user=null)でもオーナー取得がservice role経由で行われ、新規予約通知メールが送信される', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });

    const ownerId = 'owner-user-anon-test';
    const ownerEmail = 'owner-anon-test@example.com';

    function ownerRowsChain(rows: unknown[]) {
      const result = { data: rows, error: null };
      const chain: Record<string, unknown> = {};
      const handler = jest.fn(() => chain);
      chain.select = handler;
      chain.eq = handler;
      chain.in = handler;
      chain.then = Promise.resolve(result).then.bind(Promise.resolve(result));
      return chain;
    }

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;       // conflict check
      if (callNum === 2) return menuLookupChain();   // facility_menus 価格ルックアップ
      if (table === 'facility_members') return ownerRowsChain([{ user_id: ownerId }]);
      if (table === 'profiles') return ownerRowsChain([{ email: ownerEmail }]);
      return nullChain;                              // facility_profiles + 通知用メニュー名 lookup
    });

    const { sendNewBookingNotification } = require('@/lib/email');

    const res = await POST(makeRequest(validBooking));
    const json = await res.json();
    expect(json.success).toBe(true);

    // オーナー宛メールが実際に送られる（宛先が空になっていない＝匿名予約でもオーナー取得が成功）。
    expect(sendNewBookingNotification).toHaveBeenCalledWith(
      expect.objectContaining({ facilityEmail: ownerEmail })
    );

    // 【回帰防止の核心】facility_members / profiles の取得が createServiceRoleClient()（service role）
    // 経由で行われたことを検証する。anon の supabase に戻す退行があれば、この2クエリは
    // mockServiceFrom を経由しなくなり、以下のアサーションが失敗する。
    expect(mockServiceFrom).toHaveBeenCalledWith('facility_members');
    expect(mockServiceFrom).toHaveBeenCalledWith('profiles');
  });

  test('確認メール・オーナー通知メールが送達失敗(false)を返す → 無音化せず可視化するのみ（200のまま）', async () => {
    const { sendBookingConfirmation, sendNewBookingNotification } = require('@/lib/email');
    const { alertCaughtError } = require('@/lib/alert');
    (sendBookingConfirmation as jest.Mock).mockResolvedValueOnce(false);
    (sendNewBookingNotification as jest.Mock).mockResolvedValueOnce(false);
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });
    const ownersResult = { data: [{ user_id: 'owner-id-1' }] };
    const ownerChain = fluent(null);
    ownerChain.then = Promise.resolve(ownersResult).then.bind(Promise.resolve(ownersResult));
    const ownerProfilesResult = { data: [{ email: 'owner1@example.com' }] };
    const ownerProfilesChain = fluent(null);
    ownerProfilesChain.then = Promise.resolve(ownerProfilesResult).then.bind(Promise.resolve(ownerProfilesResult));

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      if (table === 'facility_members') return ownerChain;
      if (table === 'profiles') return ownerProfilesChain;
      return nullChain;
    });
    mockRpc.mockResolvedValue({ data: 'booking-email-fail-test', error: null });

    const res = await POST(makeRequest(validBooking));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // fire-and-forget の .then() 内で実行されるため、マイクロタスクの解決を待つ。
    await new Promise((resolve) => setImmediate(resolve));
    expect(alertCaughtError).toHaveBeenCalledWith('booking-email', expect.any(Error), '/api/booking');
    expect(alertCaughtError).toHaveBeenCalledWith('booking-email-owner', expect.any(Error), '/api/booking');
  });

  test('オーナーは居るが profiles 取得が null → メール送信ゼロ（?? [] フォールバック）', async () => {
    const { sendNewBookingNotification } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });
    const ownersResult = { data: [{ user_id: 'owner-id-1' }] };
    const ownerChain = fluent(null);
    ownerChain.then = Promise.resolve(ownersResult).then.bind(Promise.resolve(ownersResult));
    // profiles が null を返す → ownerProfiles ?? [] の右辺（空配列フォールバック）
    const ownerProfilesNull = { data: null };
    const ownerProfilesChain = fluent(null);
    ownerProfilesChain.then = Promise.resolve(ownerProfilesNull).then.bind(Promise.resolve(ownerProfilesNull));

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      if (table === 'facility_members') return ownerChain;
      if (table === 'profiles') return ownerProfilesChain;
      return nullChain;
    });

    mockRpc.mockResolvedValue({ data: 'booking-owner-null', error: null });

    const res = await POST(makeRequest(validBooking));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(sendNewBookingNotification).not.toHaveBeenCalled();
  });

  test('LINE通知パス（user + LINE_CHANNEL_ACCESS_TOKEN_CARELINK + lineLink）', async () => {
    const { sendBookingConfirmation: sendLineConfirm } = jest.requireMock('@/lib/line') as { sendBookingConfirmation: jest.Mock };
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-line-test' } } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'test-line-token';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    // facility_profiles → auto-confirm
    const nullChain = fluent({ data: null });

    // line_user_links → lineLink with line_user_id
    const lineLinkChain = fluent({ data: { line_user_id: 'line-user-abc' } });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      if (table === 'line_user_links') return lineLinkChain;
      return nullChain; // facility_profiles (auto-confirm / email / LINE 施設名) 等
    });

    const res = await POST(makeRequest(validBooking));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(sendLineConfirm).toHaveBeenCalled();

    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  });

  test('LINE通知が送達失敗(false)を返す → 無音化せず可視化するのみ（200のまま）', async () => {
    const { sendBookingConfirmation: sendLineConfirm } = jest.requireMock('@/lib/line') as { sendBookingConfirmation: jest.Mock };
    const { alertCaughtError } = require('@/lib/alert');
    sendLineConfirm.mockResolvedValueOnce(false);
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-line-fail-test' } } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'test-line-token';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });
    const lineLinkChain = fluent({ data: { line_user_id: 'line-user-fail' } });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      if (table === 'line_user_links') return lineLinkChain;
      return nullChain;
    });

    const res = await POST(makeRequest(validBooking));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(alertCaughtError).toHaveBeenCalledWith('booking-line', expect.any(Error), '/api/booking');

    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  });

  test('A-14: LINE通知に指名スタッフ名を含める（staff_id あり → 担当名を解決）', async () => {
    const { sendBookingConfirmation: sendLineConfirm } = jest.requireMock('@/lib/line') as { sendBookingConfirmation: jest.Mock };
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-line-staff' } } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'test-line-token';
    const staffId = '223e4567-e89b-12d3-a456-426614174000';

    const conflictChain = fluent(null);
    const noConflict = Promise.resolve({ data: [] });
    const chainEnd: Record<string, unknown> = {};
    chainEnd.eq = jest.fn(() => noConflict);
    chainEnd.then = noConflict.then.bind(noConflict);
    conflictChain.gt = jest.fn(() => chainEnd);

    const lineLinkChain = fluent({ data: { line_user_id: 'line-user-staff' } });
    const staffChain = fluent({ data: { name: '佐藤スタッフ' } });
    const nullChain = fluent({ data: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      if (table === 'line_user_links') return lineLinkChain;
      if (table === 'staff_profiles') return staffChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, staff_id: staffId }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(sendLineConfirm).toHaveBeenCalledWith('line-user-staff', expect.objectContaining({ staffName: '佐藤スタッフ' }));

    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  });

  test('A-14: staff_id ありでも担当解決が空なら staffName は undefined', async () => {
    const { sendBookingConfirmation: sendLineConfirm } = jest.requireMock('@/lib/line') as { sendBookingConfirmation: jest.Mock };
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-line-staff2' } } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'test-line-token';
    const staffId = '223e4567-e89b-12d3-a456-426614174000';

    const conflictChain = fluent(null);
    const noConflict = Promise.resolve({ data: [] });
    const chainEnd: Record<string, unknown> = {};
    chainEnd.eq = jest.fn(() => noConflict);
    chainEnd.then = noConflict.then.bind(noConflict);
    conflictChain.gt = jest.fn(() => chainEnd);

    const lineLinkChain = fluent({ data: { line_user_id: 'line-user-staff2' } });
    const nullChain = fluent({ data: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      if (table === 'line_user_links') return lineLinkChain;
      return nullChain; // staff_profiles も null → staffForLine?.name || '' の右辺
    });

    const res = await POST(makeRequest({ ...validBooking, staff_id: staffId }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(sendLineConfirm).toHaveBeenCalledWith('line-user-staff2', expect.objectContaining({ staffName: undefined }));

    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  });

  test('LINE Works ループ（proper call ordering、staffList複数エントリ）', async () => {
    const { isLineWorksConfigured, notifyNewBookingLineWorks } = jest.requireMock('@/lib/integrations/line-works') as {
      isLineWorksConfigured: jest.Mock;
      notifyNewBookingLineWorks: jest.Mock;
    };
    isLineWorksConfigured.mockReturnValue(true);
    notifyNewBookingLineWorks.mockResolvedValue(undefined);

    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockRpc.mockResolvedValue({ data: 'booking-lw-test', error: null });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const nullChain = fluent({ data: null });

    // staffList with mixed entries: null channel_id (skip), notify_all=false (skip), notify_all=true (notify)
    const staffListResult = {
      data: [
        { id: 'staff-a', line_works_channel_id: null, line_works_notify_all: false },
        { id: 'staff-b', line_works_channel_id: 'ch-b', line_works_notify_all: false },
        { id: 'staff-c', line_works_channel_id: 'ch-c', line_works_notify_all: true },
      ],
    };
    const staffListChain: Record<string, jest.Mock> = {};
    staffListChain.select = jest.fn(() => staffListChain);
    staffListChain.eq = jest.fn(() => staffListChain);
    staffListChain.not = jest.fn(() => Promise.resolve(staffListResult));

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      // LINE Works の担当スタッフ取得は .not('line_works_channel_id', ...) を使う staff_profiles クエリ。
      if (table === 'staff_profiles') return staffListChain;
      return nullChain;
    });

    const res = await POST(makeRequest(validBooking));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(notifyNewBookingLineWorks).toHaveBeenCalledWith('ch-c', expect.any(Object));
    expect(notifyNewBookingLineWorks).not.toHaveBeenCalledWith('ch-b', expect.any(Object));

    isLineWorksConfigured.mockReturnValue(false);
  });

  test('オーナーemailなし → sendNewBookingNotification 呼ばれない', async () => {
    const { sendNewBookingNotification } = require('@/lib/email');
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const nullChain = fluent({ data: null });
    // オーナーは1人居るが、その profiles の email が null → email フィルタ(filter(Boolean))で
    // 宛先ゼロになり sendNewBookingNotification は呼ばれない、という分岐を突く。
    // facility_members / profiles は .in()/.eq() を直接 await するため thenable にする。
    const ownersResult = { data: [{ user_id: 'owner-1' }] };
    const ownerChain = fluent(null);
    ownerChain.then = Promise.resolve(ownersResult).then.bind(Promise.resolve(ownersResult));
    const noEmailResult = { data: [{ email: null }] };
    const noEmailChain = fluent(null);
    noEmailChain.then = Promise.resolve(noEmailResult).then.bind(Promise.resolve(noEmailResult));

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      if (table === 'facility_members') return ownerChain;
      if (table === 'profiles') return noEmailChain;
      return nullChain; // facility_profiles (auto-confirm / email) 等
    });

    mockRpc.mockResolvedValue({ data: 'booking-no-email', error: null });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(200);
    expect(sendNewBookingNotification).not.toHaveBeenCalled();
  });

  test('booking_auto_confirm=true→confirmed status', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    // table 名ベース（メニュー必須化で from の呼び出し順が変わっても堅牢）。
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      // facility_profiles は booking_auto_confirm: true を返す
      if (table === 'facility_profiles') return fluent({ data: { booking_auto_confirm: true } });
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_status: 'confirmed' })
    );
    // A-3: 自動確定施設(status='confirmed')では確定メール(sendBookingConfirmed)を送り、
    // 「確認後に確定メールを後送」と案内する確認待ちメール(sendBookingConfirmation)は送らない。
    const emailMock = require('@/lib/email');
    expect(emailMock.sendBookingConfirmed).toHaveBeenCalled();
    expect(emailMock.sendBookingConfirmation).not.toHaveBeenCalled();
  });

  test('sendPushToFacilityOwners が reject → .catch() → Sentry', async () => {
    const { sendPushToFacilityOwners } = require('@/lib/push');
    sendPushToFacilityOwners.mockReturnValue(Promise.reject(new Error('push failed')));

    mockGetUser.mockResolvedValue({ data: { user: null } });
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 10));
  });

  test('sendPushToUser が reject → .catch() → Sentry', async () => {
    const { sendPushToFacilityOwners, sendPushToUser } = require('@/lib/push');
    sendPushToFacilityOwners.mockResolvedValue(undefined);
    sendPushToUser.mockReturnValue(Promise.reject(new Error('user push failed')));

    mockGetUser.mockResolvedValue({ data: { user: { id: 'push-user' } } });
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 10));
  });

  test('push_on_new_booking=false → 施設オーナーへの新規予約Pushは送らない（客本人Pushは送る）', async () => {
    const { sendPushToFacilityOwners, sendPushToUser } = require('@/lib/push');
    const { getFacilityNotificationSettings } = require('@/lib/notification-settings');
    (getFacilityNotificationSettings as jest.Mock).mockResolvedValue({
      pushOnNewBooking: false, pushOnCancel: true, pushOnReview: true,
      emailDailySummary: false, emailWeeklyReport: true,
    });
    mockGetUser.mockResolvedValue({ data: { user: { id: 'push-user-off' } } });
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 10));
    expect(sendPushToFacilityOwners).not.toHaveBeenCalled();
    expect(sendPushToUser).toHaveBeenCalled();
  });

  test('LINE通知: menu_id あり → facility_menus からメニュー名を取得', async () => {
    const { sendBookingConfirmation: sendLineConfirm } = jest.requireMock('@/lib/line') as { sendBookingConfirmation: jest.Mock };
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-menu' } } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'test-line-token';

    const MENU_UUID = '11111111-1111-1111-a111-111111111111';
    const bookingWithMenu = { ...validBooking, menu_id: MENU_UUID };

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    // Call sequence with menu_id:
    // 1: bookings (conflict), 2: facility_menus (price check - .in().eq() chain)
    // 3: facility_profiles (auto-confirm), rpc
    // 4: facility_profiles (email), 5: facility_menus (email name lookup)
    // 6: facility_members (owner), 7: line_user_links (LINE via adminSupabase)
    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2 && table === 'facility_menus') {
        // Price validation: .select().in().eq() must resolve to { data: [{ id, price }] }
        return {
          select: jest.fn().mockReturnThis(),
          in: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          or: jest.fn().mockResolvedValue({ data: [{ id: MENU_UUID, price: 5000 }], error: null }),
        };
      }
      if (callNum === 7) return fluent({ data: { line_user_id: 'U_line_menu' } });
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(bookingWithMenu));
    expect(res.status).toBe(200);
    expect(sendLineConfirm).toHaveBeenCalled();

    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  });

  test('LINE通知: sendLineBookingConfirm が reject → Sentry', async () => {
    const { sendBookingConfirmation: sendLineConfirm } = jest.requireMock('@/lib/line') as { sendBookingConfirmation: jest.Mock };
    sendLineConfirm.mockReturnValue(Promise.reject(new Error('LINE send failed')));
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-line-err' } } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'test-line-token';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      if (table === 'line_user_links') return fluent({ data: { line_user_id: 'U_line_err' } });
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 10));
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  });

  test('LINE通知: sendLineBookingConfirm が false（未送達）→ console.error で可観測化（H1）', async () => {
    // false 返却は throw されないため、旧実装の .catch() では捕捉されず完全無音だった。
    // then で false を検知し「not delivered」をログ化することを検証する。
    const { sendBookingConfirmation: sendLineConfirm } = jest.requireMock('@/lib/line') as { sendBookingConfirmation: jest.Mock };
    sendLineConfirm.mockResolvedValue(false);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-line-undeliv' } } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'test-line-token';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      if (table === 'line_user_links') return fluent({ data: { line_user_id: 'U_line_undeliv' } });
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 10));
    expect(errSpy).toHaveBeenCalledWith('[booking] LINE booking confirmation not delivered', expect.any(Object));

    errSpy.mockRestore();
    sendLineConfirm.mockResolvedValue(true);
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  });

  test('LINE Works: notifyNewBookingLineWorks が reject → Sentry', async () => {
    const { isLineWorksConfigured, notifyNewBookingLineWorks } = jest.requireMock('@/lib/integrations/line-works') as {
      isLineWorksConfigured: jest.Mock;
      notifyNewBookingLineWorks: jest.Mock;
    };
    isLineWorksConfigured.mockReturnValue(true);
    notifyNewBookingLineWorks.mockReturnValue(Promise.reject(new Error('LW failed')));

    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const staffListChain: Record<string, jest.Mock> = {};
    staffListChain.select = jest.fn(() => staffListChain);
    staffListChain.eq = jest.fn(() => staffListChain);
    staffListChain.not = jest.fn(() => Promise.resolve({
      data: [{ id: 'staff-lw', line_works_channel_id: 'ch-lw-rej', line_works_notify_all: true }],
    }));

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      // LINE Works の担当スタッフ取得は .not('line_works_channel_id', ...) を使う staff_profiles クエリ。
      if (table === 'staff_profiles') return staffListChain;
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 10));
    isLineWorksConfigured.mockReturnValue(false);
  });

  test('LINE Works: notify が false（未送達）→ console.error で可観測化（H1）', async () => {
    const { isLineWorksConfigured, notifyNewBookingLineWorks } = jest.requireMock('@/lib/integrations/line-works') as {
      isLineWorksConfigured: jest.Mock;
      notifyNewBookingLineWorks: jest.Mock;
    };
    isLineWorksConfigured.mockReturnValue(true);
    notifyNewBookingLineWorks.mockResolvedValue(false);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const staffListChain: Record<string, jest.Mock> = {};
    staffListChain.select = jest.fn(() => staffListChain);
    staffListChain.eq = jest.fn(() => staffListChain);
    staffListChain.not = jest.fn(() => Promise.resolve({
      data: [{ id: 'staff-lw-false', line_works_channel_id: 'ch-lw-false', line_works_notify_all: true }],
    }));
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      if (table === 'staff_profiles') return staffListChain;
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 10));
    expect(errSpy).toHaveBeenCalledWith('[booking] LINE Works new-booking notification not delivered', expect.any(Object));

    errSpy.mockRestore();
    isLineWorksConfigured.mockReturnValue(false);
  });

  test('LINE Works: notify が true（送達成功）→ 未送達ログを出さない（H1・else 分岐）', async () => {
    const { isLineWorksConfigured, notifyNewBookingLineWorks } = jest.requireMock('@/lib/integrations/line-works') as {
      isLineWorksConfigured: jest.Mock;
      notifyNewBookingLineWorks: jest.Mock;
    };
    isLineWorksConfigured.mockReturnValue(true);
    notifyNewBookingLineWorks.mockResolvedValue(true);
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const staffListChain: Record<string, jest.Mock> = {};
    staffListChain.select = jest.fn(() => staffListChain);
    staffListChain.eq = jest.fn(() => staffListChain);
    staffListChain.not = jest.fn(() => Promise.resolve({
      data: [{ id: 'staff-lw-true', line_works_channel_id: 'ch-lw-true', line_works_notify_all: true }],
    }));
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      if (table === 'staff_profiles') return staffListChain;
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 10));
    expect(errSpy).not.toHaveBeenCalledWith('[booking] LINE Works new-booking notification not delivered', expect.any(Object));

    errSpy.mockRestore();
    isLineWorksConfigured.mockReturnValue(false);
  });

  test('予期しない例外 → 500', async () => {
    mockGetUser.mockImplementation(() => { throw new Error('unexpected'); });
    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(500);
  });

  test('CAS失敗（残高が負）→ rollback → 400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-cas' } } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const balanceChain = fluent(null);
    balanceChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 500 }] }));
    const nullChain = fluent({ data: null });

    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: { id: 'deduction-cas' } })),
      })),
    }));

    const recheckChain = fluent(null);
    recheckChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: -50 }] }));

    const rollbackPointsChain: Record<string, unknown> = {};
    rollbackPointsChain.delete = jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: null })),
    }));

    const rollbackBookingChain: Record<string, unknown> = {};
    rollbackBookingChain.update = jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: null })),
    }));

    mockRpc.mockResolvedValue({ data: 'booking-cas-fail', error: null });

    let upCall = 0;
    mockFrom.mockImplementation((table: string) => {
      upCall++;
      if (upCall === 1) return conflictChain;
      if (upCall === 2) return menuPriceChain(100000); // facility_menus price lookup
      if (upCall === 3) return balanceChain;
      if (upCall === 4) return nullChain;
      if (table === 'user_points' && upCall === 5) return deductionChain;
      if (table === 'user_points' && upCall === 6) return recheckChain;
      if (table === 'user_points') return rollbackPointsChain;
      if (table === 'bookings') return rollbackBookingChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: POINTS_MENU_ID, points_used: 150 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('競合');
  });

  test('rpc が null データで成功 → 500 (newBookingId 空)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      return fluent({ data: null });
    });
    // RPC は data=null・error=null（newBookingId が空文字）→ 予約作成失敗として 500 を返す経路。
    mockRpc.mockResolvedValue({ data: null, error: null });
    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(500);
  });

  test('menu_id null かつ menu_ids なし → 無メニュー予約は 400（parse 時点で拒否・RPC 未到達）', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(makeRequest({ ...validBooking, menu_id: null }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('メニュー');
    // メニュー必須化：無メニューは bookingSchema の refine で弾かれ、予約作成 RPC には到達しない。
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('menu_id null だが menu_ids に1件 → 無メニュー扱いにならず予約成立（200）', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuLookupChain(5000);
      return fluent({ data: null });
    });
    const res = await POST(makeRequest({ ...validBooking, menu_id: null, menu_ids: [MENU_UUID] }));
    expect(res.status).toBe(200);
    // menu_ids のみでもメニューは指定されているので refine を通り、サーバー価格(5000)で予約成立。
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 5000 })
    );
  });

  // Branch coverage: line 94 - menuRows が null → validIds = new Set([]) → allValid = false → 400
  test('facility_menus returns null → メニュー不正→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = crypto.randomUUID();

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: null, error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = menuHandler;
    menuChain.or = menuHandler;
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      return fluent({ data: null });
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('メニュー');
  });

  // Branch coverage: line 100 - r.price ?? 0 の null branch（price が null → 0 として集計）
  test('menu price が null → 0 として集計し total=0', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = crypto.randomUUID();

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: null }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = menuHandler;
    menuChain.or = menuHandler;
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    const nullChain = fluent({ data: null });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 0 })
    );
  });

  // Branch coverage: line 115 - valid_from が未来 → coupon 無効 → 400
  test('クーポン valid_from が未来 → 無効として400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = crypto.randomUUID();
    const couponId = crypto.randomUUID();

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = menuHandler;
    menuChain.or = menuHandler;
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    // valid_from は未来 → まだ有効期間に入っていない
    const couponChain = fluent({
      data: {
        discount_type: 'fixed',
        discount_value: 500,
        is_active: true,
        valid_from: new Date(Date.now() + 86400000 * 30).toISOString(),
        valid_until: null,
      }
    });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return couponChain;
      return fluent({ data: null });
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('クーポン');
  });

  // Branch coverage: line 162 - serverTotalPrice != null && pointsUsed > 0 → finalPrice を差し引き計算
  test('ポイント使用時に serverTotalPrice から差し引いた finalPrice を RPC に渡す', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-final' } } });
    const menuId = crypto.randomUUID();

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: 5000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = menuHandler;
    menuChain.or = menuHandler;
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    const balanceChain = fluent(null);
    balanceChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 1000 }] }));

    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: { id: 'ded-final' } })),
      })),
    }));

    const recheckChain = fluent(null);
    recheckChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 500 }] }));

    mockRpc.mockResolvedValue({ data: 'booking-final-price', error: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return balanceChain;
      if (callNum === 4) return fluent({ data: null }); // facility_profiles
      if (table === 'user_points' && callNum === 5) return deductionChain;
      if (table === 'user_points' && callNum === 6) return recheckChain;
      return fluent({ data: null });
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, points_used: 500 }));
    const json = await res.json();
    expect(json.success).toBe(true);
    // serverTotalPrice=5000, pointsUsed=500 → finalPrice=4500
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 4500, p_points_used: 500 })
    );
  });

  // Branch coverage: line 236 - deductionRow?.id が falsy → delete スキップして booking をキャンセル
  test('CAS失敗でdeductionRow.idなし → deleteスキップしてbookingロールバック→400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-no-did' } } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const balanceChain = fluent(null);
    balanceChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 500 }] }));

    const nullChain = fluent({ data: null });

    // Deduction insert returns data: null (no id)
    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: null })),
      })),
    }));

    const recheckChain = fluent(null);
    recheckChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: -100 }] }));

    const cancelChain: Record<string, unknown> = {};
    cancelChain.update = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) }));

    mockRpc.mockResolvedValue({ data: 'booking-no-did', error: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuPriceChain(100000); // facility_menus price lookup
      if (callNum === 3) return balanceChain;
      if (callNum === 4) return nullChain;
      if (table === 'user_points' && callNum === 5) return deductionChain;
      if (table === 'user_points' && callNum === 6) return recheckChain;
      if (table === 'bookings') return cancelChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: POINTS_MENU_ID, points_used: 200 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('競合');
  });

  // Branch coverage: line 238 - rollbackPointsErr がある場合 console.error ログ
  test('CAS失敗でポイントrollbackエラー → console.error ログ出力', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-rb-err' } } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const balanceChain = fluent(null);
    balanceChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 500 }] }));

    const nullChain = fluent({ data: null });

    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: { id: 'ded-err-id' } })),
      })),
    }));

    const recheckChain = fluent(null);
    recheckChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: -100 }] }));

    // delete returns an error
    const deleteChain: Record<string, unknown> = {};
    deleteChain.delete = jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: { message: 'delete failed' } })),
    }));

    const cancelChain: Record<string, unknown> = {};
    cancelChain.update = jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) }));

    mockRpc.mockResolvedValue({ data: 'booking-rb-err', error: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuPriceChain(100000); // facility_menus price lookup
      if (callNum === 3) return balanceChain;
      if (callNum === 4) return nullChain;
      if (table === 'user_points' && callNum === 5) return deductionChain;
      if (table === 'user_points' && callNum === 6) return recheckChain;
      if (table === 'user_points') return deleteChain;
      if (table === 'bookings') return cancelChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: POINTS_MENU_ID, points_used: 200 }));
    expect(res.status).toBe(400);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[booking] point deduction rollback failed'),
      expect.anything()
    );
    consoleSpy.mockRestore();
  });

  // Branch coverage: line 242 - rollbackBookingErr がある場合 console.error ログ
  test('CAS失敗でbooking rollbackエラー → console.error ログ出力', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-bk-rb-err' } } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const balanceChain = fluent(null);
    balanceChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 500 }] }));

    const nullChain = fluent({ data: null });

    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: { id: 'ded-bk-err' } })),
      })),
    }));

    const recheckChain = fluent(null);
    recheckChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: -100 }] }));

    const deleteChain: Record<string, unknown> = {};
    deleteChain.delete = jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: null })),
    }));

    // booking update returns error
    const cancelChain: Record<string, unknown> = {};
    cancelChain.update = jest.fn(() => ({
      eq: jest.fn(() => Promise.resolve({ error: { message: 'cancel failed' } })),
    }));

    mockRpc.mockResolvedValue({ data: 'booking-bk-err', error: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuPriceChain(100000); // facility_menus price lookup
      if (callNum === 3) return balanceChain;
      if (callNum === 4) return nullChain;
      if (table === 'user_points' && callNum === 5) return deductionChain;
      if (table === 'user_points' && callNum === 6) return recheckChain;
      if (table === 'user_points') return deleteChain;
      if (table === 'bookings') return cancelChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: POINTS_MENU_ID, points_used: 200 }));
    expect(res.status).toBe(400);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[booking] booking rollback failed'),
      expect.anything()
    );
    consoleSpy.mockRestore();
  });

  // Branch coverage: line 155 - pointRows が null → ?? [] → reduce で 0 → 残高不足チェック
  test('user_points クエリが null → ポイント残高 0 → points_used を超えるので400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-null-pts' } } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    // user_points returns { data: null } → (null ?? []).reduce(...) = 0 < 200 → 400
    const pointsNullChain = fluent(null);
    pointsNullChain.eq = jest.fn(() => Promise.resolve({ data: null }));

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuPriceChain(100000); // facility_menus price lookup
      return pointsNullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: POINTS_MENU_ID, points_used: 200 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('ポイント');
  });

  // Branch coverage: line 232 - recheck が null → ?? [] → reduce で 0 → newBalance=0 >= 0 → CAS通過
  test('CAS recheck が null → 残高 0 → CAS通過 → 200', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-recheck-null' } } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const balanceChain = fluent(null);
    balanceChain.eq = jest.fn(() => Promise.resolve({ data: [{ points: 200 }] }));

    const nullChain = fluent({ data: null });

    const deductionChain: Record<string, unknown> = {};
    deductionChain.insert = jest.fn(() => ({
      select: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data: { id: 'ded-recheck-null' } })),
      })),
    }));

    // recheck returns { data: null } → (null ?? []) = [] → reduce = 0 → newBalance=0 >= 0 → no rollback
    const recheckNullChain = fluent(null);
    recheckNullChain.eq = jest.fn(() => Promise.resolve({ data: null }));

    mockRpc.mockResolvedValue({ data: 'booking-recheck-null', error: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuPriceChain(100000); // facility_menus price lookup
      if (callNum === 3) return balanceChain;
      if (callNum === 4) return nullChain; // facility_profiles
      if (table === 'user_points' && callNum === 5) return deductionChain;
      if (table === 'user_points' && callNum === 6) return recheckNullChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: POINTS_MENU_ID, points_used: 150 }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.bookingId).toBe('booking-recheck-null');
  });

  // Branch coverage: line 317, 355, 358 - LINE Works: menu_id + staff_id (isAssigned=true) → Promise.all でメニュー名・スタッフ名を取得
  test('LINE Works: menu_id + staff_id あり → assigned staff へ通知', async () => {
    const { isLineWorksConfigured, notifyNewBookingLineWorks } = jest.requireMock('@/lib/integrations/line-works') as {
      isLineWorksConfigured: jest.Mock;
      notifyNewBookingLineWorks: jest.Mock;
    };
    isLineWorksConfigured.mockReturnValue(true);
    notifyNewBookingLineWorks.mockResolvedValue(undefined);

    const menuId = crypto.randomUUID();
    const staffId = crypto.randomUUID();

    mockGetUser.mockResolvedValue({ data: { user: null } });
    mockRpc.mockResolvedValue({ data: 'booking-lw-assigned', error: null });

    // staff_id → conflict chain needs extra .eq() after .gt()
    const noConflict = Promise.resolve({ data: [] });
    const conflictChain = fluent(null);
    const chainEnd: Record<string, unknown> = {};
    chainEnd.eq = jest.fn(() => noConflict);
    chainEnd.then = noConflict.then.bind(noConflict);
    conflictChain.gt = jest.fn(() => chainEnd);

    const menuResult = { data: [{ id: menuId, price: 5000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = menuHandler;
    menuChain.or = menuHandler;
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    // Staff nomination fee (null → skip addition)
    const staffFeeChain = fluent({ data: { nomination_fee: null } });
    const nullChain = fluent({ data: null });

    // staffList: assigned staff (notify_all=false, isAssigned=true)
    const staffListResult = {
      data: [{ id: staffId, line_works_channel_id: 'ch-assigned', line_works_notify_all: false }],
    };
    const staffListChain: Record<string, jest.Mock> = {};
    staffListChain.select = jest.fn(() => staffListChain);
    staffListChain.eq = jest.fn(() => staffListChain);
    staffListChain.not = jest.fn(() => Promise.resolve(staffListResult));

    // call order (user=null, menu_id, staff_id):
    // 1: conflict, 2: facility_menus (price), 3: staff_profiles (fee),
    // 4: menu_staff (担当チェック・2026年7月15日追加), 5: facility_profiles (auto-confirm), rpc
    // notification: 6+, LINE Works staffList at call 10（menu_staff追加により旧9→10に1件シフト）
    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return staffFeeChain;
      if (table === 'menu_staff') return menuStaffChain([]);
      if (callNum === 5) return nullChain;
      if (callNum === 10) return staffListChain;
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, staff_id: staffId }));
    const json = await res.json();
    expect(json.success).toBe(true);
    // isAssigned=true → notified
    expect(notifyNewBookingLineWorks).toHaveBeenCalledWith('ch-assigned', expect.any(Object));

    isLineWorksConfigured.mockReturnValue(false);
  });

  // Branch coverage: discount_type が既知のいずれでもない → 割引なし → total_price そのまま → 200
  test('coupon discount_type が未知の値 → 割引なし → total_price そのまま → 200', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const menuId = crypto.randomUUID();
    const couponId = crypto.randomUUID();

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const menuResult = { data: [{ id: menuId, price: 10000 }], error: null };
    const menuChain: Record<string, unknown> = {};
    const menuHandler = jest.fn(() => menuChain);
    menuChain.select = menuHandler;
    menuChain.in = menuHandler;
    menuChain.eq = menuHandler;
    menuChain.or = menuHandler;
    menuChain.then = Promise.resolve(menuResult).then.bind(Promise.resolve(menuResult));

    // discount_type = 'mystery' → no if/else branch matches → price unchanged
    const couponChain = fluent({ data: { discount_type: 'mystery', discount_value: 0, is_active: true, valid_from: null, valid_until: null } });
    const nullChain = fluent({ data: null });

    let callNum = 0;
    mockFrom.mockImplementation((table: string) => {
      callNum++;
      if (callNum === 1) return conflictChain;
      if (callNum === 2) return menuChain;
      if (callNum === 3) return couponChain;
      if (table === 'coupon_menus') return couponMenusChain([]); // 0行→全メニュー適用
      return nullChain;
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: menuId, coupon_id: couponId, total_price: 1 }));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith(
      'create_booking_atomic',
      expect.objectContaining({ p_total_price: 10000 })
    );
  });

  // Branch coverage: LINE通知 → lineLink が存在するが line_user_id が null → 通知スキップ → 200
  test('LINE通知: lineLink あり + line_user_id が null → 通知スキップ → 200', async () => {
    const { sendBookingConfirmation: sendLineConfirm } = jest.requireMock('@/lib/line') as { sendBookingConfirmation: jest.Mock };
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-line-no-id' } } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'test-token';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));

    const nullChain = fluent({ data: null });

    // line_user_links → lineLink exists but line_user_id is null → lineLink?.line_user_id is falsy → skip
    const lineLinkChain = fluent({ data: { line_user_id: null } });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      if (table === 'line_user_links') return lineLinkChain;
      return nullChain;
    });

    const res = await POST(makeRequest(validBooking));
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(sendLineConfirm).not.toHaveBeenCalled();

    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  });

  // Branch coverage: menu_ids のみ（menu_id=null）予約では、LINE / LINE Works のメニュー名ルックアップ
  // (parsed.data.menu_id 分岐) の else 側を通る。メニュー必須化後も menu_ids 単独指定は正当なため、
  // この経路が 200 で完走することを検証する。
  test('menu_ids のみ（menu_id null）+ LINE + LINE Works → menu_id 分岐の else を通り 200', async () => {
    const { sendBookingConfirmation: sendLineConfirm } = jest.requireMock('@/lib/line') as { sendBookingConfirmation: jest.Mock };
    const { isLineWorksConfigured, notifyNewBookingLineWorks } = jest.requireMock('@/lib/integrations/line-works') as {
      isLineWorksConfigured: jest.Mock; notifyNewBookingLineWorks: jest.Mock;
    };
    sendLineConfirm.mockResolvedValue(true);
    isLineWorksConfigured.mockReturnValue(true);
    notifyNewBookingLineWorks.mockResolvedValue(true);
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-menuids-only' } } });
    process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK = 'test-line-token';

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    const lineLinkChain = fluent({ data: { line_user_id: 'U_menuids_only' } });
    const staffListResult = { data: [{ id: 'staff-lw-mids', line_works_channel_id: 'ch-mids', line_works_notify_all: true }] };
    const staffListChain: Record<string, jest.Mock> = {};
    staffListChain.select = jest.fn(() => staffListChain);
    staffListChain.eq = jest.fn(() => staffListChain);
    staffListChain.not = jest.fn(() => Promise.resolve(staffListResult));

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      if (table === 'line_user_links') return lineLinkChain;
      if (table === 'staff_profiles') return staffListChain; // LINE Works 対象スタッフ
      return fluent({ data: null });
    });

    const res = await POST(makeRequest({ ...validBooking, menu_id: null, menu_ids: [MENU_UUID] }));
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 10));
    // menu_id 不在でも LINE 確認は送られる（メニュー名は空でスキップ）。
    expect(sendLineConfirm).toHaveBeenCalled();
    expect(notifyNewBookingLineWorks).toHaveBeenCalledWith('ch-mids', expect.any(Object));

    isLineWorksConfigured.mockReturnValue(false);
    delete process.env.LINE_CHANNEL_ACCESS_TOKEN_CARELINK;
  });

  // Branch coverage: LINE Works 有効だが対象スタッフが1人も居ない（staffList 空）→ 通知ループに入らず 200。
  test('LINE Works 有効 + 対象スタッフ0件（staffList 空）→ 通知なしで 200', async () => {
    const { isLineWorksConfigured, notifyNewBookingLineWorks } = jest.requireMock('@/lib/integrations/line-works') as {
      isLineWorksConfigured: jest.Mock; notifyNewBookingLineWorks: jest.Mock;
    };
    isLineWorksConfigured.mockReturnValue(true);
    notifyNewBookingLineWorks.mockResolvedValue(true);
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const conflictChain = fluent(null);
    conflictChain.gt = jest.fn(() => Promise.resolve({ data: [] }));
    // staff_profiles.select().eq().not() が空配列を返す → staffList.length===0 → ループに入らない。
    const emptyStaffChain: Record<string, jest.Mock> = {};
    emptyStaffChain.select = jest.fn(() => emptyStaffChain);
    emptyStaffChain.eq = jest.fn(() => emptyStaffChain);
    emptyStaffChain.not = jest.fn(() => Promise.resolve({ data: [] }));

    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') return conflictChain;
      if (table === 'facility_menus') return menuLookupChain();
      if (table === 'staff_profiles') return emptyStaffChain;
      return fluent({ data: null });
    });

    const res = await POST(makeRequest(validBooking));
    expect(res.status).toBe(200);
    await new Promise(r => setTimeout(r, 10));
    expect(notifyNewBookingLineWorks).not.toHaveBeenCalled();

    isLineWorksConfigured.mockReturnValue(false);
  });
});
