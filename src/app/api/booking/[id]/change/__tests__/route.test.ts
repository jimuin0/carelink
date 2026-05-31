/**
 * @jest-environment node
 *
 * Tests for POST /api/booking/[id]/change
 * Key assertions:
 *   - user_id ownership in UPDATE WHERE (IDOR defence-in-depth)
 *   - Double-booking conflict check → 409
 *   - State machine guard: only pending/confirmed can be changed
 *   - Other user's booking → 403
 *   - Zod schema validation: date/time format
 */

jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: {},
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });
jest.mock('@/lib/integrations/line-works', () => ({
  isLineWorksConfigured: jest.fn(() => false),
  sendLineWorksMessage: jest.fn(),
}));
jest.mock('next/headers', () => ({
  cookies: () => ({ getAll: () => [], set: jest.fn() }),
}));

const BOOKING_UUID = '11111111-1111-1111-1111-111111111111';
const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';
const STAFF_ID = '44444444-4444-4444-4444-444444444444';

const CONFIRMED_BOOKING = {
  id: BOOKING_UUID,
  user_id: USER_ID,
  status: 'confirmed',
  facility_id: FACILITY_UUID,
  staff_id: STAFF_ID,
};

const mockFrom = jest.fn();
const mockGetUser = jest.fn();

jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ from: mockFrom, auth: { getUser: mockGetUser } }),
}));
const mockAdminFrom = jest.fn().mockReturnValue({
  select: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  not: jest.fn().mockReturnThis(),
  maybeSingle: jest.fn(() => Promise.resolve({ data: null })),
});
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (...args: unknown[]) => mockAdminFrom(...args) }),
}));

import { POST } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';

const VALID_BODY = {
  booking_date: '2026-12-01',
  start_time: '14:00',
  end_time: '15:00',
};

function makeRequest(body: object = VALID_BODY) {
  return new Request('http://localhost/api/booking/1/change', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeProps(id = BOOKING_UUID) {
  return { params: Promise.resolve({ id }) };
}

function singleChain(data: unknown, error: unknown = null) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    neq: jest.fn().mockReturnThis(),
    lt: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    limit: jest.fn(() => Promise.resolve({ data, error })),
    single: jest.fn(() => Promise.resolve({ data, error })),
    maybeSingle: jest.fn(() => Promise.resolve({ data, error })),
  };
}

function updateChain(error: unknown = null) {
  return {
    update: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn(() => Promise.resolve({ error })),
      }),
    }),
  };
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
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(401);
});

test('レートリミット → 429', async () => {
  (checkRateLimit as jest.Mock).mockResolvedValue(true);
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(429);
});

test('不正なUUID → 400', async () => {
  const res = await POST(makeRequest(), makeProps('bad-id'));
  expect(res.status).toBe(400);
});

test('他ユーザーの予約 → 403 (IDOR防止)', async () => {
  mockFrom.mockReturnValue(singleChain({ ...CONFIRMED_BOOKING, user_id: 'other-user' }));
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(403);
});

test('予約が存在しない → 404', async () => {
  mockFrom.mockReturnValue(singleChain(null));
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(404);
});

// ─── Schema validation ────────────────────────────────────────────────────────

test('booking_date が不正フォーマット → 400', async () => {
  const res = await POST(makeRequest({ booking_date: '01/12/2026', start_time: '14:00', end_time: '15:00' }), makeProps());
  expect(res.status).toBe(400);
});

test('start_time が不正フォーマット → 400', async () => {
  const res = await POST(makeRequest({ booking_date: '2026-12-01', start_time: '14時', end_time: '15:00' }), makeProps());
  expect(res.status).toBe(400);
});

// ─── State machine guard ──────────────────────────────────────────────────────

test('cancelled予約は変更不可 → 400', async () => {
  mockFrom.mockReturnValue(singleChain({ ...CONFIRMED_BOOKING, status: 'cancelled' }));
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(400);
});

test('completed予約は変更不可 → 400', async () => {
  mockFrom.mockReturnValue(singleChain({ ...CONFIRMED_BOOKING, status: 'completed' }));
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(400);
});

// ─── Double-booking check ─────────────────────────────────────────────────────

test('スタッフの同一時間帯に既存予約あり → 409', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING); // booking lookup
    // conflict check — returns 1 conflicting booking
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      neq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(),
      gt: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: [{ id: 'conflict-booking' }], error: null })),
    };
  });
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(409);
});

// ─── Update path ─────────────────────────────────────────────────────────────

test('UPDATE DB失敗 → 500', async () => {
  let callNum = 0;
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING);
    // no conflict
    if (callNum === 2) return {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(), neq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(), gt: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    return updateChain({ message: 'DB error' });
  });
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(500);
});

test('正常変更 → 200 success:true, user_idをWHEREに含む（IDOR defence-in-depth）', async () => {
  let callNum = 0;
  const innerEq = jest.fn(() => Promise.resolve({ error: null }));
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  const updateMock = jest.fn().mockReturnValue({ eq: outerEq });
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING);
    // no conflict
    if (callNum === 2) return {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(), neq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(), gt: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    return { update: updateMock };
  });

  const res = await POST(makeRequest(), makeProps());
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.success).toBe(true);
  // user_id must be in WHERE clause for IDOR defence-in-depth
  expect(innerEq).toHaveBeenCalledWith('user_id', USER_ID);
});

// ─── 深掘りテスト: 境界値・エッジケース ─────────────────────────────────────

test('CSRF 失敗 → 403', async () => {
  const csrfError = new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 });
  (checkCsrf as jest.Mock).mockReturnValue(csrfError);
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(403);
});

test('無効な JSON ボディ → 200 (空オブジェクト扱いでスキーマ検証失敗400)', async () => {
  const req = new Request('http://localhost/api/booking/1/change', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{invalid',
  });
  const res = await POST(req, makeProps());
  expect(res.status).toBe(400);
});

test('pending 予約も変更可能', async () => {
  let callNum = 0;
  const innerEq = jest.fn(() => Promise.resolve({ error: null }));
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ ...CONFIRMED_BOOKING, status: 'pending' });
    if (callNum === 2) return {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(), neq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(), gt: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    return { update: jest.fn().mockReturnValue({ eq: outerEq }) };
  });
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(200);
});

test('no_show 予約は変更不可 → 400', async () => {
  mockFrom.mockReturnValue(singleChain({ ...CONFIRMED_BOOKING, status: 'no_show' }));
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(400);
});

test('staff_id なしの予約は競合チェックをスキップ → 200', async () => {
  let callNum = 0;
  const innerEq = jest.fn(() => Promise.resolve({ error: null }));
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain({ ...CONFIRMED_BOOKING, staff_id: null });
    // 競合チェック呼ばれないのでそのまま update
    return { update: jest.fn().mockReturnValue({ eq: outerEq }) };
  });
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(200);
});

test('HH:MM:SS 形式の start_time も受け付ける', async () => {
  let callNum = 0;
  const innerEq = jest.fn(() => Promise.resolve({ error: null }));
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING);
    if (callNum === 2) return {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(), neq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(), gt: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    return { update: jest.fn().mockReturnValue({ eq: outerEq }) };
  });
  const res = await POST(
    makeRequest({ booking_date: '2026-12-01', start_time: '14:00:00', end_time: '15:00:00' }),
    makeProps()
  );
  expect(res.status).toBe(200);
});

test('booking_date のみが不正 (月が 13) → 400', async () => {
  const res = await POST(
    makeRequest({ booking_date: '2026-13-01', start_time: '14:00', end_time: '15:00' }),
    makeProps()
  );
  expect(res.status).toBe(400);
});

test('レートリミットパラメーター確認', async () => {
  (checkRateLimit as jest.Mock).mockClear();
  const req = new Request('http://localhost/api/booking/1/change', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '192.168.1.1',
    },
    body: JSON.stringify(VALID_BODY),
  });
  await POST(req, makeProps());
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[2]).toBe(10);   // max 10 req
  expect(call[3]).toBe(60_000); // per minute
  expect(call[4]).toBe('booking-change');
});

test('先頭 IP を x-forwarded-for から抽出', async () => {
  (checkRateLimit as jest.Mock).mockClear();
  const req = new Request('http://localhost/api/booking/1/change', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '10.0.0.1, 192.168.1.1',
    },
    body: JSON.stringify(VALID_BODY),
  });
  await POST(req, makeProps());
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBe('10.0.0.1');
});

test('writeAuditLog が変更成功時に呼ばれる', async () => {
  const { writeAuditLog } = require('@/lib/audit-logger');
  (writeAuditLog as jest.Mock).mockClear();

  let callNum = 0;
  const innerEq = jest.fn(() => Promise.resolve({ error: null }));
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING);
    if (callNum === 2) return {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(), neq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(), gt: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    return { update: jest.fn().mockReturnValue({ eq: outerEq }) };
  });

  await POST(makeRequest(), makeProps());
  expect(writeAuditLog).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'update',
      tableName: 'bookings',
      recordId: BOOKING_UUID,
    })
  );
});

test('時間重複チェック: 隣接時間（重複なし）は予約可能', async () => {
  // 既存予約: 12:00-13:00、新規: 13:00-14:00 → 重複なし
  let callNum = 0;
  const innerEq = jest.fn(() => Promise.resolve({ error: null }));
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING);
    if (callNum === 2) return {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(), neq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(), gt: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: [], error: null })), // 競合なし
    };
    return { update: jest.fn().mockReturnValue({ eq: outerEq }) };
  });
  const res = await POST(
    makeRequest({ booking_date: '2026-12-01', start_time: '13:00', end_time: '14:00' }),
    makeProps()
  );
  expect(res.status).toBe(200);
});

test('例外発生時 → 500', async () => {
  mockFrom.mockImplementation(() => { throw new Error('Unexpected error'); });
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(500);
});

test('LINE Works通知パス (isLineWorksConfigured=true, staffList有)', async () => {
  const { isLineWorksConfigured, sendLineWorksMessage } = jest.requireMock('@/lib/integrations/line-works') as {
    isLineWorksConfigured: jest.Mock;
    sendLineWorksMessage: jest.Mock;
  };
  isLineWorksConfigured.mockReturnValue(true);
  sendLineWorksMessage.mockResolvedValue(true);

  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });

  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'staff_profiles') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        not: jest.fn(() => Promise.resolve({
          data: [{ id: STAFF_ID, line_works_channel_id: 'ch-1', line_works_notify_all: true }],
        })),
      };
    }
    if (table === 'bookings') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn(() => Promise.resolve({ data: { customer_name: 'テスト', menu_id: null } })),
      };
    }
    return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), maybeSingle: jest.fn(() => Promise.resolve({ data: null })) };
  });

  let callNum = 0;
  const innerEq = jest.fn(() => Promise.resolve({ error: null }));
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING);
    if (callNum === 2) return {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(), neq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(), gt: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    return { update: jest.fn().mockReturnValue({ eq: outerEq }) };
  });

  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(200);
  isLineWorksConfigured.mockReturnValue(false);
});

test('LINE Works通知パス (isLineWorksConfigured=true, menu_id あり)', async () => {
  const { isLineWorksConfigured, sendLineWorksMessage } = jest.requireMock('@/lib/integrations/line-works') as {
    isLineWorksConfigured: jest.Mock;
    sendLineWorksMessage: jest.Mock;
  };
  isLineWorksConfigured.mockReturnValue(true);
  sendLineWorksMessage.mockResolvedValue(true);

  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });

  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'staff_profiles') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        not: jest.fn(() => Promise.resolve({
          data: [{ id: STAFF_ID, line_works_channel_id: 'ch-2', line_works_notify_all: false }],
        })),
      };
    }
    if (table === 'bookings') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn(() => Promise.resolve({ data: { customer_name: 'テスト', menu_id: 'menu-1' } })),
      };
    }
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(() => Promise.resolve({ data: { name: 'カット' } })),
    };
  });

  let callNum = 0;
  const innerEq = jest.fn(() => Promise.resolve({ error: null }));
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING);
    if (callNum === 2) return {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(), neq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(), gt: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    return { update: jest.fn().mockReturnValue({ eq: outerEq }) };
  });

  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(200);
  isLineWorksConfigured.mockReturnValue(false);
});

test('LINE Works: sendLineWorksMessage が reject → Sentry.captureException', async () => {
  const { isLineWorksConfigured, sendLineWorksMessage } = jest.requireMock('@/lib/integrations/line-works') as {
    isLineWorksConfigured: jest.Mock;
    sendLineWorksMessage: jest.Mock;
  };
  isLineWorksConfigured.mockReturnValue(true);
  sendLineWorksMessage.mockRejectedValue(new Error('LW send error'));

  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });

  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'staff_profiles') {
      return {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        not: jest.fn(() => Promise.resolve({
          data: [{ id: STAFF_ID, line_works_channel_id: 'ch-reject', line_works_notify_all: false }],
        })),
      };
    }
    return {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(() => Promise.resolve({ data: { customer_name: 'テスト', menu_id: null } })),
    };
  });

  let callNum = 0;
  const innerEq = jest.fn(() => Promise.resolve({ error: null }));
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING);
    if (callNum === 2) return {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(), neq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(), gt: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    return { update: jest.fn().mockReturnValue({ eq: outerEq }) };
  });

  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(200);
  await new Promise(r => setTimeout(r, 10));
  isLineWorksConfigured.mockReturnValue(false);
});

test('x-forwarded-for なし → unknown IP を使う', async () => {
  (checkRateLimit as jest.Mock).mockClear();
  await POST(makeRequest(), makeProps());
  const call = (checkRateLimit as jest.Mock).mock.calls[0];
  expect(call[1]).toBe('unknown');
});

test('LINE Works: staffList 空 → 通知ループに入らず 200', async () => {
  const { isLineWorksConfigured, sendLineWorksMessage } = jest.requireMock('@/lib/integrations/line-works') as {
    isLineWorksConfigured: jest.Mock; sendLineWorksMessage: jest.Mock;
  };
  isLineWorksConfigured.mockReturnValue(true);
  sendLineWorksMessage.mockClear();
  mockAdminFrom.mockImplementation(() => ({
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    not: jest.fn(() => Promise.resolve({ data: [] })),
    maybeSingle: jest.fn(() => Promise.resolve({ data: null })),
  }));
  let callNum = 0;
  const innerEq = jest.fn(() => Promise.resolve({ error: null }));
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING);
    if (callNum === 2) return {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(), neq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(), gt: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    return { update: jest.fn().mockReturnValue({ eq: outerEq }) };
  });
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(200);
  expect(sendLineWorksMessage).not.toHaveBeenCalled();
  isLineWorksConfigured.mockReturnValue(false);
});

test('LINE Works: customerBooking が null → "不明" フォールバック', async () => {
  const { isLineWorksConfigured, sendLineWorksMessage } = jest.requireMock('@/lib/integrations/line-works') as {
    isLineWorksConfigured: jest.Mock; sendLineWorksMessage: jest.Mock;
  };
  isLineWorksConfigured.mockReturnValue(true);
  sendLineWorksMessage.mockResolvedValue(true);
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'staff_profiles') {
      return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        not: jest.fn(() => Promise.resolve({
          data: [{ id: STAFF_ID, line_works_channel_id: 'ch-x', line_works_notify_all: true }],
        })),
      };
    }
    // customer booking lookup returns null
    return {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(() => Promise.resolve({ data: null })),
    };
  });
  let callNum = 0;
  const innerEq = jest.fn(() => Promise.resolve({ error: null }));
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING);
    if (callNum === 2) return {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(), neq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(), gt: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    return { update: jest.fn().mockReturnValue({ eq: outerEq }) };
  });
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(200);
  expect(sendLineWorksMessage).toHaveBeenCalledWith('ch-x', expect.objectContaining({
    content: expect.objectContaining({ text: expect.stringContaining('不明') }),
  }));
  isLineWorksConfigured.mockReturnValue(false);
});

test('LINE Works: menu_id ありで menu name が null → 空文字フォールバック', async () => {
  const { isLineWorksConfigured, sendLineWorksMessage } = jest.requireMock('@/lib/integrations/line-works') as {
    isLineWorksConfigured: jest.Mock; sendLineWorksMessage: jest.Mock;
  };
  isLineWorksConfigured.mockReturnValue(true);
  sendLineWorksMessage.mockResolvedValue(true);
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'staff_profiles') {
      return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        not: jest.fn(() => Promise.resolve({
          data: [{ id: STAFF_ID, line_works_channel_id: 'ch-y', line_works_notify_all: true }],
        })),
      };
    }
    if (table === 'bookings') {
      return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn(() => Promise.resolve({ data: { customer_name: '田中', menu_id: 'menu-z' } })),
      };
    }
    // facility_menus: name null
    return {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(() => Promise.resolve({ data: { name: null } })),
    };
  });
  let callNum = 0;
  const innerEq = jest.fn(() => Promise.resolve({ error: null }));
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING);
    if (callNum === 2) return {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(), neq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(), gt: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    return { update: jest.fn().mockReturnValue({ eq: outerEq }) };
  });
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(200);
  isLineWorksConfigured.mockReturnValue(false);
});

test('LINE Works: channel_id null / 担当外&notify_all=false → スキップ', async () => {
  const { isLineWorksConfigured, sendLineWorksMessage } = jest.requireMock('@/lib/integrations/line-works') as {
    isLineWorksConfigured: jest.Mock; sendLineWorksMessage: jest.Mock;
  };
  isLineWorksConfigured.mockReturnValue(true);
  sendLineWorksMessage.mockClear();
  sendLineWorksMessage.mockResolvedValue(true);
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === 'staff_profiles') {
      return {
        select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
        not: jest.fn(() => Promise.resolve({
          data: [
            { id: 'other-staff', line_works_channel_id: 'ch-skip', line_works_notify_all: false },
            { id: 'no-channel', line_works_channel_id: null, line_works_notify_all: true },
          ],
        })),
      };
    }
    return {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(() => Promise.resolve({ data: { customer_name: 'X', menu_id: null } })),
    };
  });
  let callNum = 0;
  const innerEq = jest.fn(() => Promise.resolve({ error: null }));
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING);
    if (callNum === 2) return {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(), neq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(), gt: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    return { update: jest.fn().mockReturnValue({ eq: outerEq }) };
  });
  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(200);
  expect(sendLineWorksMessage).not.toHaveBeenCalled();
  isLineWorksConfigured.mockReturnValue(false);
});

test('LINE Works: adminSupabase.from が throw → 外側 catch → Sentry + 200', async () => {
  const { isLineWorksConfigured } = jest.requireMock('@/lib/integrations/line-works') as {
    isLineWorksConfigured: jest.Mock;
  };
  isLineWorksConfigured.mockReturnValue(true);

  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });

  mockAdminFrom.mockImplementation(() => {
    throw new Error('admin client exploded');
  });

  let callNum = 0;
  const innerEq = jest.fn(() => Promise.resolve({ error: null }));
  const outerEq = jest.fn().mockReturnValue({ eq: innerEq });
  mockFrom.mockImplementation(() => {
    callNum++;
    if (callNum === 1) return singleChain(CONFIRMED_BOOKING);
    if (callNum === 2) return {
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(), neq: jest.fn().mockReturnThis(),
      lt: jest.fn().mockReturnThis(), gt: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
    };
    return { update: jest.fn().mockReturnValue({ eq: outerEq }) };
  });

  const res = await POST(makeRequest(), makeProps());
  expect(res.status).toBe(200);
  isLineWorksConfigured.mockReturnValue(false);
});
