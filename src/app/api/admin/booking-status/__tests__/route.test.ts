/**
 * @jest-environment node
 *
 * Tests for CAS (Compare-And-Swap) race-condition guard and state machine
 * transitions in POST /api/admin/booking-status.
 */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: null,
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('@/lib/email', () => ({
  sendBookingConfirmed: jest.fn(),
  sendBookingCancelled: jest.fn(),
  sendBookingStatusUpdate: jest.fn(),
}));
jest.mock('@/lib/push', () => ({ sendPushToUser: jest.fn() }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });

const mockGetUser = jest.fn();
const mockFrom = jest.fn();

jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: jest.fn(() => Promise.resolve({
    auth: { getUser: mockGetUser },
  })),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(() => ({ from: mockFrom })),
  createServerSupabaseClient: jest.fn(() => ({ from: mockFrom })),
}));
jest.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: jest.fn() }),
}));

import { POST } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { sendBookingConfirmed, sendBookingCancelled, sendBookingStatusUpdate } from '@/lib/email';
import { sendPushToUser } from '@/lib/push';

const validBookingId = '123e4567-e89b-12d3-a456-426614174000';
const facilityId = 'fac00000-0000-0000-0000-000000000001';
const userId = 'user-admin-1';

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
});

function makeRequest(body: object) {
  return new Request('http://localhost/api/admin/booking-status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://localhost',
      Host: 'localhost',
    },
    body: JSON.stringify(body),
  });
}

/** Build a fluent Supabase chain that resolves to `resolvedValue` at any terminal method. */
function fluent(resolvedValue: unknown) {
  const resolve = jest.fn(() => Promise.resolve(resolvedValue));
  const chain: Record<string, jest.Mock> = {};
  const link = jest.fn(() => chain);
  chain.select = link; chain.eq = link; chain.in = link;
  chain.update = link; chain.maybeSingle = resolve; chain.single = resolve;
  chain.then = jest.fn((fn: (v: unknown) => unknown) => Promise.resolve(resolvedValue).then(fn));
  return chain;
}

/** Build the membership fluent chain that responds to `.maybeSingle().then(r => r.data)` */
function membershipChain(data: unknown) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data })),
    then: jest.fn((fn: (v: unknown) => unknown) => Promise.resolve({ data }).then(fn)),
  };
}

/**
 * Build the CAS update chain for bookings:
 *   supabase.from('bookings').update(...).eq('id').eq('facility_id').eq('status').select('id')
 * The route awaits the final call, so .select() must return a Promise.
 */
function updateChain(result: { data: unknown; error: unknown }) {
  const selectFn = jest.fn(() => Promise.resolve(result));
  const eqFn = jest.fn();
  // Three chained .eq() calls, last returns { select }
  const eq3 = jest.fn(() => ({ select: selectFn }));
  const eq2 = jest.fn(() => ({ eq: eq3 }));
  const eq1 = jest.fn(() => ({ eq: eq2 }));
  return {
    update: jest.fn(() => ({ eq: eq1 })),
  };
}

/** Build a simple .select().eq().single() chain (for facility_profiles, menus, staff). */
function singleChain(data: unknown) {
  return {
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn(() => Promise.resolve({ data, error: null })),
      })),
    })),
  };
}

const bookingBase = {
  id: validBookingId, facility_id: facilityId, user_id: 'customer-1',
  customer_name: 'テスト', email: 'c@example.com',
  booking_date: '2026-05-01', start_time: '10:00', end_time: '11:00',
  total_price: 5000, menu_id: null, staff_id: null,
};
const bookingPending = { ...bookingBase, status: 'pending' };

/** Full success-path mock: booking with `fromStatus`, update returns rows (CAS success). */
function setupSuccessMock(fromStatus: string) {
  mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
  const memberData = { facility_id: facilityId, role: 'owner' };
  let callCount = 0;
  mockFrom.mockImplementation((table: string) => {
    if (table === 'bookings') {
      callCount++;
      if (callCount === 1) {
        // booking lookup
        return fluent({ data: { ...bookingBase, status: fromStatus } });
      }
      // CAS update
      return updateChain({ data: [{ id: validBookingId }], error: null });
    }
    if (table === 'facility_members') {
      return membershipChain(memberData);
    }
    // facility_profiles, facility_menus, staff_profiles
    return singleChain({ name: 'テスト施設' });
  });
}

describe('POST /api/admin/booking-status', () => {
  test('認証なし → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'confirmed' }));
    expect(res.status).toBe(401);
  });

  test('不正なbookingId → 400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
    const res = await POST(makeRequest({ bookingId: 'not-a-uuid', status: 'confirmed' }));
    expect(res.status).toBe(400);
  });

  test('不正なstatus → 400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'invalid' }));
    expect(res.status).toBe(400);
  });

  test('予約が存在しない → 404', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return fluent({ data: null }); // booking lookup → null
      return fluent({ data: null });
    });
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'confirmed' }));
    expect(res.status).toBe(404);
  });

  test('施設メンバーでない → 404 (ID enumeration防止)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return fluent({ data: bookingPending }); // booking found
      return membershipChain(null); // not a member
    });
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'confirmed' }));
    expect(res.status).toBe(404);
  });

  test('同一ステータスへの変更 → 400 (既にそのステータスです)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return fluent({ data: { ...bookingBase, status: 'confirmed' } });
      return membershipChain({ facility_id: facilityId, role: 'owner' });
    });
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'confirmed' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/既にそのステータスです/);
  });

  test('許可されていない状態遷移 (cancelled→confirmed) → 400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return fluent({ data: { ...bookingBase, status: 'cancelled' } });
      return membershipChain({ facility_id: facilityId, role: 'owner' });
    });
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'confirmed' }));
    expect(res.status).toBe(400);
  });

  test('CSRF失敗 → 403', async () => {
    const { NextResponse } = jest.requireActual('next/server') as { NextResponse: typeof import('next/server').NextResponse };
    (checkCsrf as jest.Mock).mockReturnValue(NextResponse.json({ error: 'CSRF' }, { status: 403 }));
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'confirmed' }));
    expect(res.status).toBe(403);
  });

  test('レートリミット → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'confirmed' }));
    expect(res.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// State machine: valid transitions
// ---------------------------------------------------------------------------
describe('POST /api/admin/booking-status - state machine (valid transitions)', () => {
  test.each([
    ['pending',    'confirmed'],
    ['pending',    'cancelled'],
    ['confirmed',  'completed'],
    ['confirmed',  'cancelled'],
    ['confirmed',  'no_show'],
    ['completed',  'no_show'],
    ['no_show',    'cancelled'],
  ])('%s → %s: valid transition → 200', async (fromStatus, toStatus) => {
    setupSuccessMock(fromStatus);
    const res = await POST(makeRequest({ bookingId: validBookingId, status: toStatus }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// State machine: invalid transitions
// ---------------------------------------------------------------------------
describe('POST /api/admin/booking-status - state machine (invalid transitions)', () => {
  // Note: 'pending' is not in validStatuses so →pending is caught by the earlier
  // validation check ("不正なステータスです"), not by the state machine. Those cases
  // are already covered by the '不正なstatus → 400' test above and are omitted here.
  test.each([
    ['pending',   'completed'],
    ['pending',   'no_show'],
    ['confirmed', 'confirmed'],  // same-status (covered separately but consistent)
    ['completed', 'confirmed'],
    ['completed', 'cancelled'],
    ['cancelled', 'confirmed'],
    ['cancelled', 'completed'],
    ['cancelled', 'no_show'],
    ['cancelled', 'cancelled'],  // same-status terminal
    ['no_show',   'confirmed'],
    ['no_show',   'completed'],
    ['no_show',   'no_show'],    // same-status
  ])('%s → %s → 400', async (fromStatus, toStatus) => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return fluent({ data: { ...bookingBase, status: fromStatus } });
      return membershipChain({ facility_id: facilityId, role: 'owner' });
    });
    const res = await POST(makeRequest({ bookingId: validBookingId, status: toStatus }));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// CAS and DB errors
// ---------------------------------------------------------------------------
describe('POST /api/admin/booking-status - CAS and DB errors', () => {
  test('CAS競合: 読み取り後にステータスが変更された → 409', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
    const memberData = { facility_id: facilityId, role: 'owner' };
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') {
        callCount++;
        if (callCount === 1) return fluent({ data: bookingPending });
        // CAS update returns empty rows — status changed concurrently
        return updateChain({ data: [], error: null });
      }
      if (table === 'facility_members') return membershipChain(memberData);
      return singleChain({ name: 'テスト施設' });
    });
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'confirmed' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/既に変更されています/);
  });

  test('DBアップデートエラー → 500', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
    const memberData = { facility_id: facilityId, role: 'owner' };
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') {
        callCount++;
        if (callCount === 1) return fluent({ data: bookingPending });
        // update returns an error
        return updateChain({ data: null, error: { message: 'DB error' } });
      }
      if (table === 'facility_members') return membershipChain(memberData);
      return singleChain({ name: 'テスト施設' });
    });
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'confirmed' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/更新に失敗/);
  });
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
describe('POST /api/admin/booking-status - notifications', () => {
  test('confirmed → sendBookingConfirmed が呼ばれる', async () => {
    setupSuccessMock('pending');
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'confirmed' }));
    expect(res.status).toBe(200);
    expect(sendBookingConfirmed).toHaveBeenCalledTimes(1);
    expect(sendBookingCancelled).not.toHaveBeenCalled();
    expect(sendBookingStatusUpdate).not.toHaveBeenCalled();
  });

  test('cancelled → sendBookingCancelled が呼ばれる', async () => {
    setupSuccessMock('pending');
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'cancelled' }));
    expect(res.status).toBe(200);
    expect(sendBookingCancelled).toHaveBeenCalledTimes(1);
    expect(sendBookingConfirmed).not.toHaveBeenCalled();
    expect(sendBookingStatusUpdate).not.toHaveBeenCalled();
  });

  test('completed → sendBookingStatusUpdate が呼ばれる', async () => {
    setupSuccessMock('confirmed');
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'completed' }));
    expect(res.status).toBe(200);
    expect(sendBookingStatusUpdate).toHaveBeenCalledTimes(1);
    expect(sendBookingConfirmed).not.toHaveBeenCalled();
    expect(sendBookingCancelled).not.toHaveBeenCalled();
  });

  test('no_show → sendBookingStatusUpdate が呼ばれる', async () => {
    setupSuccessMock('confirmed');
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'no_show' }));
    expect(res.status).toBe(200);
    expect(sendBookingStatusUpdate).toHaveBeenCalledTimes(1);
    const callArg = (sendBookingStatusUpdate as jest.Mock).mock.calls[0][0];
    expect(callArg.newStatus).toBe('no_show');
  });

  test('sendBookingConfirmed に正しい emailData が渡される', async () => {
    setupSuccessMock('pending');
    await POST(makeRequest({ bookingId: validBookingId, status: 'confirmed' }));
    expect(sendBookingConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: bookingBase.customer_name,
        customerEmail: bookingBase.email,
        bookingDate: bookingBase.booking_date,
        startTime: bookingBase.start_time,
        endTime: bookingBase.end_time,
        totalPrice: bookingBase.total_price,
        bookingId: bookingBase.id,
      })
    );
  });

  test('sendPushToUser が booking.user_id で呼ばれる', async () => {
    setupSuccessMock('pending');
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'confirmed' }));
    expect(res.status).toBe(200);
    // sendPushToUser is called with void so we wait a tick for the promise to settle
    await Promise.resolve();
    expect(sendPushToUser).toHaveBeenCalledWith(
      bookingBase.user_id,
      expect.objectContaining({
        title: expect.any(String),
        body: expect.any(String),
        url: `/mypage/bookings/${bookingBase.id}`,
        tag: `booking-status-${bookingBase.id}`,
      })
    );
  });

  test('メール送信エラーは無視して 200 を返す', async () => {
    setupSuccessMock('pending');
    (sendBookingConfirmed as jest.Mock).mockRejectedValueOnce(new Error('SMTP error'));
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'confirmed' }));
    // Email failure must not surface as HTTP error
    expect(res.status).toBe(200);
  });

  test('menu_id があるとき facility_menus から名前を取得して email に含める', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
    const memberData = { facility_id: facilityId, role: 'owner' };
    const bookingWithMenu = { ...bookingBase, status: 'pending', menu_id: 'menu-001', staff_id: null };
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') {
        callCount++;
        if (callCount === 1) return fluent({ data: bookingWithMenu });
        return updateChain({ data: [{ id: validBookingId }], error: null });
      }
      if (table === 'facility_members') return membershipChain(memberData);
      if (table === 'facility_profiles') return singleChain({ name: 'テスト施設' });
      if (table === 'facility_menus') return singleChain({ name: 'カット' });
      return singleChain(null);
    });
    await POST(makeRequest({ bookingId: validBookingId, status: 'confirmed' }));
    expect(sendBookingConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ menuName: 'カット' })
    );
  });

  test('staff_id があるとき staff_profiles から名前を取得して email に含める', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
    const memberData = { facility_id: facilityId, role: 'owner' };
    const bookingWithStaff = { ...bookingBase, status: 'pending', menu_id: null, staff_id: 'staff-001' };
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') {
        callCount++;
        if (callCount === 1) return fluent({ data: bookingWithStaff });
        return updateChain({ data: [{ id: validBookingId }], error: null });
      }
      if (table === 'facility_members') return membershipChain(memberData);
      if (table === 'facility_profiles') return singleChain({ name: 'テスト施設' });
      if (table === 'staff_profiles') return singleChain({ name: '田中スタッフ' });
      return singleChain(null);
    });
    await POST(makeRequest({ bookingId: validBookingId, status: 'confirmed' }));
    expect(sendBookingConfirmed).toHaveBeenCalledWith(
      expect.objectContaining({ staffName: '田中スタッフ' })
    );
  });

  test('booking.user_id が null → sendPushToUser が呼ばれない', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
    const memberData = { facility_id: facilityId, role: 'owner' };
    const bookingNoUser = { ...bookingBase, status: 'pending', user_id: null };
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') {
        callCount++;
        if (callCount === 1) return fluent({ data: bookingNoUser });
        return updateChain({ data: [{ id: validBookingId }], error: null });
      }
      if (table === 'facility_members') return membershipChain(memberData);
      return singleChain({ name: 'テスト施設' });
    });
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'confirmed' }));
    expect(res.status).toBe(200);
    await Promise.resolve();
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  test('adminロールでも操作可能 → 200', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
    const memberData = { facility_id: facilityId, role: 'admin' };  // admin role
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') {
        callCount++;
        if (callCount === 1) return fluent({ data: bookingPending });
        return updateChain({ data: [{ id: validBookingId }], error: null });
      }
      if (table === 'facility_members') return membershipChain(memberData);
      return singleChain({ name: 'テスト施設' });
    });
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'confirmed' }));
    expect(res.status).toBe(200);
  });

  test('不正なJSONボディ → 400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
    const req = new Request('http://localhost/api/admin/booking-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Host: 'localhost' },
      body: 'invalid json {',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test('DBのbooking.statusが未知の値 → 状態遷移拒否 → 400', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: userId } } });
    const memberData = { facility_id: facilityId, role: 'owner' };
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'bookings') {
        callCount++;
        if (callCount === 1) return fluent({ data: { ...bookingBase, status: 'unknown_status' } });
        return updateChain({ data: [{ id: validBookingId }], error: null });
      }
      if (table === 'facility_members') return membershipChain(memberData);
      return singleChain({ name: 'テスト施設' });
    });
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'confirmed' }));
    expect(res.status).toBe(400);
  });

  test('未処理例外 → 500', async () => {
    mockGetUser.mockRejectedValue(new Error('Unexpected crash'));
    const res = await POST(makeRequest({ bookingId: validBookingId, status: 'confirmed' }));
    expect(res.status).toBe(500);
  });
});
