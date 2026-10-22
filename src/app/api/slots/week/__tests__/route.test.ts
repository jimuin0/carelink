/**
 * @jest-environment node
 *
 * GET /api/slots/week: the booking matrix (staff × up to 7 dates) in one request.
 */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/facility-publish-gate', () => ({ checkBookingReadiness: jest.fn() }));
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: jest.fn() }));
import { checkBookingReadiness } from '@/lib/facility-publish-gate';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

const FACILITY = '11111111-1111-4111-8111-111111111111';
const STAFF_A = '22222222-2222-4222-8222-222222222222';
const STAFF_B = '33333333-3333-4333-8333-333333333333';
const D1 = '2099-05-15';
const D2 = '2099-05-16';
let mockRpc: jest.Mock;

function req(params: Record<string, string>) {
  return new Request(`http://localhost/api/slots/week?${new URLSearchParams(params)}`, { headers: { 'x-real-ip': '192.0.2.1' } });
}
const base = { facilityId: FACILITY, staffIds: `${STAFF_A},${STAFF_B}`, dates: `${D1},${D2}`, duration: '60' };

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockRpc = jest.fn(async (_fn: string, args: { p_staff_id: string; p_date: string }) => ({
    data: [{ slot_start: '10:00:00', slot_end: '11:00:00', staff_id: args.p_staff_id, tag: `${args.p_staff_id}@${args.p_date}` }],
    error: null,
  }));
  const server = require('@/lib/supabase-server');
  server.createServerSupabaseClient.mockReturnValue({});
  server.createServiceRoleClient.mockReturnValue({ rpc: mockRpc });
  jest.mocked(checkBookingReadiness).mockResolvedValue({ readiness: { ready: true, missing: [] }, error: null });
});

test('returns every staff × date in one response, keyed by date then staff', async () => {
  const res = await GET(req(base));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(Object.keys(body.days)).toEqual([D1, D2]);
  expect(body.days[D2][STAFF_B][0].tag).toBe(`${STAFF_B}@${D2}`);
  expect(mockRpc).toHaveBeenCalledTimes(4);
  expect(mockRpc).toHaveBeenCalledWith('get_available_slots', { p_facility_id: FACILITY, p_staff_id: STAFF_A, p_date: D1, p_duration_minutes: 60 });
});

test('is rate limited before any lookup, under its own bucket', async () => {
  (checkRateLimit as jest.Mock).mockReturnValue(true);
  const res = await GET(req(base));
  expect(res.status).toBe(429);
  expect(checkRateLimit).toHaveBeenCalledWith(null, expect.any(String), 30, 60_000, 'slots-week');
  expect(mockRpc).not.toHaveBeenCalled();
});

test.each([
  ['bad facility', { facilityId: 'x' }],
  ['no staff', { staffIds: '' }],
  ['bad staff id', { staffIds: `${STAFF_A},nope` }],
  ['too many staff', { staffIds: Array.from({ length: 11 }, (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`).join(',') }],
  ['no dates', { dates: '' }],
  ['impossible date', { dates: '2099-02-30' }],
  ['too many dates', { dates: Array.from({ length: 8 }, (_, i) => `2099-05-${String(10 + i)}`).join(',') }],
])('rejects %s with 400 before any lookup', async (_label, patch) => {
  const res = await GET(req({ ...base, ...patch }));
  expect(res.status).toBe(400);
  expect(checkBookingReadiness).not.toHaveBeenCalled();
  expect(mockRpc).not.toHaveBeenCalled();
});

test('a facility not ready for booking returns no days without calling the slot RPC', async () => {
  jest.mocked(checkBookingReadiness).mockResolvedValue({ readiness: { ready: false, missing: ['写真'] }, error: null });
  const body = await (await GET(req(base))).json();
  expect(body).toEqual({ days: {}, bookingAvailable: false });
  expect(mockRpc).not.toHaveBeenCalled();
});

test('a readiness lookup failure is a 500', async () => {
  jest.mocked(checkBookingReadiness).mockResolvedValue({ readiness: { ready: false, missing: [] }, error: new Error('synthetic') });
  expect((await GET(req(base))).status).toBe(500);
});

test('one failed pair fails the whole response instead of looking fully booked', async () => {
  mockRpc.mockImplementation(async (_fn: string, args: { p_staff_id: string }) =>
    args.p_staff_id === STAFF_B ? { data: null, error: { message: 'synthetic' } } : { data: [], error: null });
  const res = await GET(req(base));
  expect(res.status).toBe(500);
  expect((await res.json()).days).toEqual({});
});

test('an unexpected exception is a 500 with the same body shape', async () => {
  mockRpc.mockRejectedValue(new Error('boom'));
  const res = await GET(req(base));
  expect(res.status).toBe(500);
  expect((await res.json()).days).toEqual({});
});

test('duplicate staff and dates are queried once', async () => {
  await GET(req({ ...base, staffIds: `${STAFF_A},${STAFF_A}`, dates: `${D1},${D1}` }));
  expect(mockRpc).toHaveBeenCalledTimes(1);
});

test('a missing data array is treated as no slots for that pair', async () => {
  mockRpc.mockResolvedValue({ data: null, error: null });
  const body = await (await GET(req({ ...base, staffIds: STAFF_A, dates: D1 }))).json();
  expect(body.days).toEqual({ [D1]: { [STAFF_A]: [] } });
});

test('missing parameters are rejected with 400', async () => {
  const res = await GET(new Request('http://localhost/api/slots/week', { headers: { 'x-real-ip': '192.0.2.1' } }));
  expect(res.status).toBe(400);
});

// ─── excludeBookingId（予約日時の変更画面・2026年10月23日）────────────────────────────
// Regression: the reschedule page counted the reservation being moved as taking its own time, so moving a 14:00-15:00
// reservation to 14:30 was impossible from the page. The page now passes the reservation; it is left out only when the
// signed-in customer owns it, it belongs to the facility and can still be changed (someone else's reservation must not
// be left out, which would reveal its time).
describe('excludeBookingId', () => {
  const BOOKING = '44444444-4444-4444-8444-444444444444';
  const USER = '55555555-5555-4555-8555-555555555555';
  let getUser: jest.Mock;
  let ownRead: { data: unknown; error: unknown };
  let authFrom: jest.Mock;
  let select: jest.Mock;
  let eq: jest.Mock;
  beforeEach(() => {
    getUser = jest.fn(async () => ({ data: { user: { id: USER } }, error: null }));
    ownRead = { data: { user_id: USER, facility_id: FACILITY, status: 'confirmed' }, error: null };
    const builder = { select: jest.fn(), eq: jest.fn(), maybeSingle: jest.fn(async () => ownRead) };
    builder.select.mockReturnValue(builder); builder.eq.mockReturnValue(builder);
    select = builder.select; eq = builder.eq;
    authFrom = jest.fn(() => builder);
    jest.mocked(createServerSupabaseAuthClient).mockResolvedValue({ auth: { getUser }, from: authFrom } as never);
  });
  const withExclusion = (id = BOOKING) => req({ ...base, staffIds: STAFF_A, dates: D1, excludeBookingId: id });

  test('the customer\'s own changeable reservation is left out of the slot RPC', async () => {
    const res = await GET(withExclusion());
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('get_available_slots', {
      p_facility_id: FACILITY, p_staff_id: STAFF_A, p_date: D1, p_duration_minutes: 60, p_exclude_booking_id: BOOKING,
    });
    expect(authFrom).toHaveBeenCalledWith('bookings');
    expect(select).toHaveBeenCalledWith('user_id, facility_id, status');
    expect(eq).toHaveBeenCalledWith('id', BOOKING);
  });

  test('a pending reservation is changeable too', async () => {
    ownRead.data = { user_id: USER, facility_id: FACILITY, status: 'pending' };
    expect((await GET(withExclusion())).status).toBe(200);
  });

  test('without the parameter nothing is excluded and no sign-in is needed', async () => {
    await GET(req({ ...base, staffIds: STAFF_A, dates: D1 }));
    expect(createServerSupabaseAuthClient).not.toHaveBeenCalled();
    expect(mockRpc.mock.calls[0][1]).not.toHaveProperty('p_exclude_booking_id');
  });

  test('an id that is not a UUID is rejected before sign-in or any lookup', async () => {
    expect((await GET(withExclusion('nope'))).status).toBe(400);
    expect(createServerSupabaseAuthClient).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('a visitor who is not signed in gets 401 and no slots', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(withExclusion());
    expect(res.status).toBe(401);
    expect((await res.json()).days).toEqual({});
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('an unavailable sign-in check is a 503, not a guest', async () => {
    getUser.mockRejectedValue(new Error('synthetic'));
    expect((await GET(withExclusion())).status).toBe(503);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('a failed reservation read is a 500 with the same body shape', async () => {
    ownRead = { data: null, error: { code: '08006' } };
    const res = await GET(withExclusion());
    expect(res.status).toBe(500);
    expect((await res.json()).days).toEqual({});
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test.each([
    ['missing (or hidden by RLS)', null],
    ['someone else\'s', { user_id: 'other-user', facility_id: FACILITY, status: 'confirmed' }],
    ['at another facility', { user_id: USER, facility_id: STAFF_B, status: 'confirmed' }],
    ['no longer changeable', { user_id: USER, facility_id: FACILITY, status: 'cancelled' }],
  ])('a reservation that is %s is never left out (404, no slots)', async (_label, data) => {
    ownRead.data = data;
    const res = await GET(withExclusion());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: '予約が見つかりません', days: {} });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
