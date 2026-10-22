/**
 * @jest-environment node
 *
 * GET /api/slots/week: the booking matrix (staff × up to 7 dates) in one request.
 */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/facility-publish-gate', () => ({ checkBookingReadiness: jest.fn() }));
import { checkBookingReadiness } from '@/lib/facility-publish-gate';
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
