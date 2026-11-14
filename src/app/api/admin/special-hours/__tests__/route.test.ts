/** @jest-environment node */
import { NextRequest, NextResponse } from 'next/server';
import { GET, PUT } from '../route';
import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { fetchCabinetHolidays } from '@/lib/cabinet-holidays';

const getUser = jest.fn();
const membership = jest.fn();
const read = jest.fn();
const rpc = jest.fn();
function query(result: jest.Mock) {
  const value: any = { select: () => value, eq: () => value, in: () => value, maybeSingle: () => result() };
  return value;
}
jest.mock('@/lib/supabase-server-auth', () => ({ createServerSupabaseAuthClient: async () => ({ auth: { getUser }, from: () => query(membership) }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: () => query(read), rpc }) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(async () => false) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn(async () => {}) }));
jest.mock('@/lib/cabinet-holidays', () => ({ fetchCabinetHolidays: jest.fn() }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));

const owner = 'faa10000-0000-4000-8000-000000000001';
const facility = 'faa10001-0000-4000-8000-000000000001';
const url = `http://localhost/api/admin/special-hours?facility_id=${facility}`;
const body = { allowOvernightBookings: false, closeOnPublicHolidays: true, closedDates: ['2026-12-31'], receptionCutoffMinutes: 15, revision: null };
const put = (data: unknown) => new NextRequest(url, { method: 'PUT', body: JSON.stringify(data) });

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: owner } }, error: null });
  membership.mockResolvedValue({ data: { facility_id: facility }, error: null });
  read.mockResolvedValue({ data: null, error: null });
  rpc.mockResolvedValue({ data: null, error: null });
  jest.mocked(checkCsrf).mockReturnValue(null);
  jest.mocked(checkRateLimit).mockResolvedValue(false);
  jest.mocked(fetchCabinetHolidays).mockResolvedValue({ from: '2026-01-01', through: '2027-12-31', dates: new Set(['2026-11-03']) });
});

test('unconfigured facility reads neutral defaults without creating a row', async () => {
  const result = await GET(new NextRequest(url));
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({ allowOvernightBookings: false, closeOnPublicHolidays: false, closedDates: [], receptionCutoffMinutes: null, revision: null });
  expect(rpc).not.toHaveBeenCalled();
});

test('configured facility reads its saved revision and values', async () => {
  read.mockResolvedValue({ data: { allow_overnight_bookings: false, close_on_public_holidays: true, closed_dates: ['2026-12-31'],
    reception_cutoff_minutes: 15, updated_at: '2026-10-28T00:00:00Z' }, error: null });
  expect(await (await GET(new NextRequest(url))).json()).toEqual({ ...body, revision: '2026-10-28T00:00:00Z' });
});

test('only the authorized facility and verified actor reach the atomic writer', async () => {
  expect((await PUT(put(body))).status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('save_facility_special_hours_atomic', {
    p_actor_id: owner, p_facility_id: facility, p_allow_overnight: false, p_close_on_holidays: true,
    p_closed_dates: ['2026-12-31'], p_cutoff_minutes: 15, p_expected_updated_at: null,
    p_holiday_dates: ['2026-11-03'], p_holiday_from: '2026-01-01', p_holiday_through: '2027-12-31',
  });
});
test('祝日休業を使わない場合、祝日データ取得を行わない', async () => {
  expect((await PUT(put({ ...body, closeOnPublicHolidays:false }))).status).toBe(200);
  expect(fetchCabinetHolidays).not.toHaveBeenCalled();
  expect(rpc).toHaveBeenCalledWith('save_facility_special_hours_atomic',expect.objectContaining({p_holiday_dates:null,p_holiday_from:null,p_holiday_through:null}));
});
test('認証されていない人は設定を読めない', async () => {
  getUser.mockResolvedValue({ data:{user:null}, error:null });
  expect((await GET(new NextRequest(url))).status).toBe(401);
});

test.each([
  { ...body, closedDates: ['2026-02-30'] }, { ...body, closedDates: ['2026-12-31', '2026-12-31'] },
  { ...body, receptionCutoffMinutes: -1 }, { ...body, receptionCutoffMinutes: 1441 },
  { ...body, revision: 'bad' }, { ...body, unexpected: true },
])('invalid input is rejected before writing: %j', async input => {
  expect((await PUT(put(input))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});

test('revoked membership blocks reading and writing', async () => {
  membership.mockResolvedValue({ data: null, error: null });
  expect((await GET(new NextRequest(url))).status).toBe(401);
  expect((await PUT(put(body))).status).toBe(401);
  expect(read).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
});

test('the atomic writer blocks a concurrent stale edit and revoked role', async () => {
  rpc.mockResolvedValueOnce({ error: { message: 'SPECIAL_HOURS_CHANGED' } });
  expect((await PUT(put(body))).status).toBe(409);
  rpc.mockResolvedValueOnce({ error: { message: 'FACILITY_PERMISSION_REVOKED' } });
  expect((await PUT(put(body))).status).toBe(403);
  rpc.mockResolvedValueOnce({ error: { message: 'SPECIAL_HOURS_HAS_BOOKINGS' } });
  expect((await PUT(put(body))).status).toBe(409);
  rpc.mockResolvedValueOnce({ error: { message: 'HOLIDAY_CALENDAR_UNAVAILABLE' } });
  expect((await PUT(put(body))).status).toBe(409);
});

test('csrf and rate-limit failures stop before authorization', async () => {
  jest.mocked(checkCsrf).mockReturnValueOnce(NextResponse.json({ error: 'csrf' }, { status: 403 }));
  expect((await PUT(put(body))).status).toBe(403);
  jest.mocked(checkRateLimit).mockResolvedValueOnce(true);
  expect((await PUT(put(body))).status).toBe(429);
  expect(getUser).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
});

test('invalid facility and unavailable authentication stop before writing', async () => {
  expect((await GET(new NextRequest('http://localhost/api/admin/special-hours?facility_id=bad'))).status).toBe(401);
  getUser.mockResolvedValue({ data: { user: null }, error: { status: 503, message: 'unavailable' } });
  expect((await GET(new NextRequest(url))).status).toBe(503);
  expect((await PUT(put(body))).status).toBe(503);
  expect(read).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
});

test('lookup failures are distinct from absent membership and never write', async () => {
  membership.mockResolvedValue({ data: null, error: { message: 'query failed' } });
  expect((await GET(new NextRequest(url))).status).toBe(500);
  expect((await PUT(put(body))).status).toBe(500);
  expect(read).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
});

test('read and save failures do not claim success', async () => {
  read.mockResolvedValue({ data: null, error: { message: 'read failed' } });
  expect((await GET(new NextRequest(url))).status).toBe(500);
  rpc.mockResolvedValue({ data: null, error: { message: 'unknown' } });
  const result = await PUT(put(body));
  expect(result.status).toBe(500);
  expect(result.headers.get('cache-control')).toBe('no-store');
});

test('unavailable holiday data blocks activation without writing', async () => {
  jest.mocked(fetchCabinetHolidays).mockResolvedValue(null);
  expect((await PUT(put(body))).status).toBe(503);
  expect(rpc).not.toHaveBeenCalled();
});
