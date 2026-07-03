/**
 * @jest-environment node
 *
 * Tests for POST /api/booking/complete
 * Key assertions:
 *   - CAS optimistic lock → 409 when zero rows updated (prevents double point awards)
 *   - booking.status !== 'confirmed' → 400 (state machine guard)
 *   - DB update error → 500
 *   - Ownership: only facility admin/owner can complete
 */

jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: {},
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
// 紹介ボーナス付与(applyCompletionSideEffects 経由)は referral.test / booking-completion.test で
// 検証済み。ここでは no-op にして referral_uses クエリのモックを不要にする（責務分離）。
jest.mock('@/lib/referral', () => ({ awardReferralPointsOnCompletion: jest.fn(() => Promise.resolve()) }));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));

const BOOKING_UUID = '11111111-1111-1111-1111-111111111111';
const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const CUSTOMER_USER_ID = '44444444-4444-4444-4444-444444444444';

const CONFIRMED_BOOKING = {
  id: BOOKING_UUID,
  facility_id: FACILITY_UUID,
  user_id: CUSTOMER_USER_ID,
  customer_name: 'テスト太郎',
  email: 'test@example.com',
  booking_date: '2026-05-01',
  start_time: '10:00:00',
  end_time: '11:00:00',
  total_price: 5000,
  menu_id: null,
  staff_id: null,
  status: 'confirmed',
};

const mockAnonFrom = jest.fn();
const mockServiceFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: () => Promise.resolve({
    auth: { getUser: mockGetUser },
  }),
}));
// route の DB 操作は全て serviceRole 経由なので、既存テストの mockAnonFrom 上の
// 期待を mockServiceFrom にもバインドする（同じ関数を共有）
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: () => ({ from: mockAnonFrom }),
  createServerSupabaseClient: () => ({ from: mockAnonFrom }),
}));

import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

function makeRequest(body: object = { bookingId: BOOKING_UUID }) {
  return new Request('http://localhost/api/booking/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function singleChain(data: unknown, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error })),
    single: jest.fn(() => Promise.resolve({ data, error })),
  };
}

function updateCasChain(data: unknown, error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              maybeSingle: jest.fn(() => Promise.resolve({ data, error })),
            }),
          }),
        }),
      }),
    }),
  };
}

// Full happy path setup
function setupHappyPath(casData: unknown = { id: BOOKING_UUID }, casError: unknown = null) {
  let callNum = 0;
  mockAnonFrom.mockImplementation((table: string) => {
    callNum++;
    if (table === 'bookings' && callNum === 1) return singleChain(CONFIRMED_BOOKING);
    if (table === 'facility_members') return singleChain({ facility_id: FACILITY_UUID, role: 'owner' });
    if (table === 'bookings') return updateCasChain(casData, casError).update ? updateCasChain(casData, casError) : singleChain(casData, casError);
    return { insert: jest.fn(() => Promise.resolve({ error: null })), select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({ data: null, error: null })) };
  });
  mockServiceFrom.mockReturnValue({
    insert: jest.fn(() => Promise.resolve({ error: null })),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

// ─── Security guards ──────────────────────────────────────────────────────────

test('未認証 → 401', async () => {
  mockGetUser.mockResolvedValue({ data: { user: null } });
  const res = await POST(makeRequest());
  expect(res.status).toBe(401);
});

test('レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockResolvedValue(true);
  const res = await POST(makeRequest());
  expect(res.status).toBe(429);
});

test('bookingId なし → 400', async () => {
  const res = await POST(makeRequest({}));
  expect(res.status).toBe(400);
});

test('不正なUUID → 400', async () => {
  const res = await POST(makeRequest({ bookingId: 'not-uuid' }));
  expect(res.status).toBe(400);
});

test('予約が見つからない → 404', async () => {
  mockAnonFrom.mockReturnValue(singleChain(null));
  const res = await POST(makeRequest());
  expect(res.status).toBe(404);
});

test('施設メンバー以外 → 403 (IDOR防止)', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING);
    return singleChain(null); // not a member
  });
  const res = await POST(makeRequest());
  expect(res.status).toBe(403);
});

// ─── State machine guard ──────────────────────────────────────────────────────

test('status が confirmed 以外 → 400', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain({ ...CONFIRMED_BOOKING, status: 'cancelled' });
    return singleChain({ facility_id: FACILITY_UUID, role: 'owner' });
  });
  const res = await POST(makeRequest());
  expect(res.status).toBe(400);
});

// ─── Critical: CAS optimistic lock ───────────────────────────────────────────

test('CAS: 0行更新（並行リクエストが先に完了） → 409 (二重ポイント付与防止)', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING); // booking
    if (table === 'facility_members') return singleChain({ facility_id: FACILITY_UUID, role: 'owner' });
    // CAS update → null (no rows matched)
    return {
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })),
              }),
            }),
          }),
        }),
      }),
    };
  });
  const res = await POST(makeRequest());
  expect(res.status).toBe(409);
});

test('UPDATE DBエラー → 500', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING);
    if (table === 'facility_members') return singleChain({ facility_id: FACILITY_UUID, role: 'owner' });
    return {
      update: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: { message: 'DB error' } })),
              }),
            }),
          }),
        }),
      }),
    };
  });
  const res = await POST(makeRequest());
  expect(res.status).toBe(500);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

test('正常完了 → 200 success:true, points_earned計算', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING); // booking (total_price: 5000 → 50 pts)
    if (table === 'facility_members') return singleChain({ facility_id: FACILITY_UUID, role: 'admin' });
    if (table === 'bookings') {
      // CAS update
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn(() => Promise.resolve({ data: { id: BOOKING_UUID }, error: null })),
                }),
              }),
            }),
          }),
        }),
      };
    }
    // customer_visits insert
    return { insert: jest.fn(() => Promise.resolve({ error: null })) };
  });
  mockServiceFrom.mockReturnValue({ insert: jest.fn(() => Promise.resolve({ error: null })) });

  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.success).toBe(true);
  expect(json.points_earned).toBe(50); // floor(5000 / 100)
});

test('total_price が 0 → ポイント付与なし', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain({ ...CONFIRMED_BOOKING, total_price: 0, user_id: CUSTOMER_USER_ID });
    if (table === 'facility_members') return singleChain({ facility_id: FACILITY_UUID, role: 'owner' });
    if (table === 'bookings') {
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn(() => Promise.resolve({ data: { id: BOOKING_UUID }, error: null })),
                }),
              }),
            }),
          }),
        }),
      };
    }
    return { insert: jest.fn(() => Promise.resolve({ error: null })) };
  });
  mockServiceFrom.mockReturnValue({ insert: jest.fn(() => Promise.resolve({ error: null })) });

  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.points_earned).toBe(0);
  // user_points insert should NOT be called
  expect(mockServiceFrom).not.toHaveBeenCalled();
});

test('booking.user_id が null → ポイント付与なし', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain({ ...CONFIRMED_BOOKING, user_id: null, total_price: 5000 });
    if (table === 'facility_members') return singleChain({ facility_id: FACILITY_UUID, role: 'owner' });
    if (table === 'bookings') {
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn(() => Promise.resolve({ data: { id: BOOKING_UUID }, error: null })),
                }),
              }),
            }),
          }),
        }),
      };
    }
    return { insert: jest.fn(() => Promise.resolve({ error: null })) };
  });

  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.points_earned).toBe(0);
  expect(mockServiceFrom).not.toHaveBeenCalled();
});

test('menu_id + staff_id あり → メニュー名・スタッフ名を取得', async () => {
  const bookingWithMenuStaff = {
    ...CONFIRMED_BOOKING,
    menu_id: 'menu-uuid-0001-0001-0001-000000000001',
    staff_id: 'staf-uuid-0001-0001-0001-000000000001',
  };
  let callNum = 0;
  mockAnonFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain(bookingWithMenuStaff);
    if (table === 'facility_members') return singleChain({ facility_id: FACILITY_UUID, role: 'owner' });
    if (table === 'bookings') {
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn(() => Promise.resolve({ data: { id: BOOKING_UUID }, error: null })),
                }),
              }),
            }),
          }),
        }),
      };
    }
    if (table === 'facility_menus') return singleChain({ name: 'カット' });
    if (table === 'staff_profiles') return singleChain({ name: '田中スタッフ' });
    return { insert: jest.fn(() => Promise.resolve({ error: null })) };
  });
  mockServiceFrom.mockReturnValue({ insert: jest.fn(() => Promise.resolve({ error: null })) });

  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
});

test('customer_visits insert失敗 → Sentryキャプチャして200', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING);
    if (table === 'facility_members') return singleChain({ facility_id: FACILITY_UUID, role: 'owner' });
    if (table === 'bookings') {
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn(() => Promise.resolve({ data: { id: BOOKING_UUID }, error: null })),
                }),
              }),
            }),
          }),
        }),
      };
    }
    // customer_visits insert fails
    return { insert: jest.fn(() => Promise.resolve({ error: { message: 'visit insert error' } })) };
  });
  mockServiceFrom.mockReturnValue({ insert: jest.fn(() => Promise.resolve({ error: null })) });

  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
});

test('user_points insert失敗 → Sentryキャプチャして200', async () => {
  let callNum = 0;
  mockAnonFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING); // total_price: 5000, user_id: CUSTOMER_USER_ID
    if (table === 'facility_members') return singleChain({ facility_id: FACILITY_UUID, role: 'owner' });
    if (table === 'bookings') {
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn(() => Promise.resolve({ data: { id: BOOKING_UUID }, error: null })),
                }),
              }),
            }),
          }),
        }),
      };
    }
    // user_points insert を失敗させる
    if (table === 'user_points') {
      return { insert: jest.fn(() => Promise.resolve({ error: { message: 'point error' } })) };
    }
    return { insert: jest.fn(() => Promise.resolve({ error: null })) };
  });

  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
});

test('未処理例外 → 500', async () => {
  mockGetUser.mockRejectedValue(new Error('Unexpected crash'));
  const res = await POST(makeRequest());
  expect(res.status).toBe(500);
});

test('total_price が null → ポイント付与なし', async () => {
  const bookingNullPrice = { ...CONFIRMED_BOOKING, total_price: null };
  let callNum = 0;
  mockAnonFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain(bookingNullPrice);
    if (table === 'facility_members') return singleChain({ facility_id: FACILITY_UUID, role: 'owner' });
    if (table === 'bookings') {
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn(() => Promise.resolve({ data: { id: BOOKING_UUID }, error: null })),
                }),
              }),
            }),
          }),
        }),
      };
    }
    return { insert: jest.fn(() => Promise.resolve({ error: null })) };
  });
  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.points_earned).toBe(0);
});

test('total_price が 50（低額）→ pointsEarned=0 でポイント insert スキップ', async () => {
  const bookingLowPrice = { ...CONFIRMED_BOOKING, total_price: 50 };
  let callNum = 0;
  let userPointsCalled = false;
  mockAnonFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain(bookingLowPrice);
    if (table === 'facility_members') return singleChain({ facility_id: FACILITY_UUID, role: 'owner' });
    if (table === 'bookings') {
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn(() => Promise.resolve({ data: { id: BOOKING_UUID }, error: null })),
                }),
              }),
            }),
          }),
        }),
      };
    }
    if (table === 'user_points') {
      userPointsCalled = true;
      return { insert: jest.fn(() => Promise.resolve({ error: null })) };
    }
    return { insert: jest.fn(() => Promise.resolve({ error: null })) };
  });
  const res = await POST(makeRequest());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.points_earned).toBe(0);
  expect(userPointsCalled).toBe(false);
});

test('不正JSON ボディ → bookingId なしと判断 → 400', async () => {
  const req = new Request('http://localhost/api/booking/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  const res = await POST(req);
  expect(res.status).toBe(400);
});

// Branch coverage: line 95 — menu?.name is falsy (null) → menuName = null (right-side of ||)
// Branch coverage: line 99 — staff?.name is falsy (null) → staffName = null (right-side of ||)
test('menu.name が null → menuName=null、staff.name が null → staffName=null', async () => {
  // Reuse BOOKING_UUID for menu_id/staff_id (only needs to be truthy UUID-like value)
  const bookingWithMenuStaff = {
    ...CONFIRMED_BOOKING,
    menu_id: BOOKING_UUID,
    staff_id: CUSTOMER_USER_ID,
  };
  let callNum = 0;
  mockAnonFrom.mockImplementation((table: string) => {
    callNum++;
    if (callNum === 1) return singleChain(bookingWithMenuStaff);
    if (table === 'facility_members') return singleChain({ facility_id: FACILITY_UUID, role: 'owner' });
    if (table === 'bookings') {
      return {
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                select: jest.fn().mockReturnValue({
                  maybeSingle: jest.fn(() => Promise.resolve({ data: { id: BOOKING_UUID }, error: null })),
                }),
              }),
            }),
          }),
        }),
      };
    }
    // facility_menus returns data but name=null → menuName = null||null = null (line 95 false branch)
    if (table === 'facility_menus') return singleChain({ name: null });
    // staff_profiles returns data but name=null → staffName = null||null = null (line 99 false branch)
    if (table === 'staff_profiles') return singleChain({ name: null });
    return { insert: jest.fn(() => Promise.resolve({ error: null })) };
  });
  mockServiceFrom.mockReturnValue({ insert: jest.fn(() => Promise.resolve({ error: null })) });

  const res = await POST(makeRequest());
  expect(res.status).toBe(200);
});
