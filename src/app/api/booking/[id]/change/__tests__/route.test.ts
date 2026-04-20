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
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));
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
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: jest.fn().mockReturnValue({ select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), not: jest.fn().mockReturnThis(), maybeSingle: jest.fn(() => Promise.resolve({ data: null })) }) }),
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
