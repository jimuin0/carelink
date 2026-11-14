/** @jest-environment node */
jest.mock('@/lib/rate-limit', () => ({ checkRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/audit-logger', () => ({ writeAuditLog: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: () => ({ getAll: () => [], set: jest.fn() }) }));
const STAFF = '11111111-1111-4111-8111-111111111111';
const FACILITY = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';
const OP = '44444444-4444-4444-8444-444444444444';
const OV = '55555555-5555-4555-8555-555555555555';
const mockGetUser = jest.fn(); const mockAnonFrom = jest.fn(); const mockAdminFrom = jest.fn(); const mockRpc = jest.fn();
jest.mock('@supabase/ssr', () => ({ createServerClient: () => ({ from: mockAnonFrom, auth: { getUser: mockGetUser } }) }));
jest.mock('@/lib/supabase-server', () => ({ createServiceRoleClient: () => ({ from: mockAdminFrom, rpc: mockRpc }) }));
import { NextRequest } from 'next/server';
import { PUT, POST, DELETE } from '../route';
import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';
import { writeAuditLog } from '@/lib/audit-logger';
const body = { operation_id: OP, schedules: [{ day_of_week: 1, start_time: '09:00', end_time: '18:00' }] };
function request(method: string, payload: unknown, facility: string | null = FACILITY) {
  return new NextRequest(`http://localhost/api/admin/staff/${STAFF}/schedule${facility ? `?facility_id=${facility}` : ''}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}
function props(id = STAFF) { return { params: Promise.resolve({ id }) }; }
function chain(data: unknown, error: unknown = null, menus: unknown = []) {
  // facility_menus（最短のメニュー）は .select().eq().or() を await する。
  const c = { select: jest.fn(), eq: jest.fn(), in: jest.fn(), maybeSingle: jest.fn(async () => ({ data, error })),
    or: jest.fn(async () => ({ data: menus, error: null })) };
  c.select.mockReturnValue(c); c.eq.mockReturnValue(c); c.in.mockReturnValue(c); return c;
}
beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockResolvedValue(false); (checkCsrf as jest.Mock).mockReturnValue(null);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER } }, error: null });
  mockAnonFrom.mockReturnValue(chain({ facility_id: FACILITY }));
  mockAdminFrom.mockReturnValue(chain({ id: STAFF }));
  mockRpc.mockResolvedValue({ data: { ok: true, replayed: false }, error: null });
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
});
test.each([PUT, POST, DELETE])('csrf, rate limiting and invalid staff ID block mutations', async handler => {
  (checkCsrf as jest.Mock).mockReturnValueOnce(new Response('{}', { status: 403 }));
  expect((await handler(request('PUT', body), props())).status).toBe(403);
  (checkRateLimit as jest.Mock).mockResolvedValueOnce(true);
  expect((await handler(request('PUT', body), props())).status).toBe(429);
  expect((await handler(request('PUT', body), props('bad'))).status).toBe(400);
  expect(mockRpc).not.toHaveBeenCalled();
});
test.each([PUT, POST, DELETE])('verified membership and staff tenant required', async handler => {
  mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
  expect((await handler(request('PUT', body), props())).status).toBe(401);
  expect((await handler(request('PUT', body, null), props())).status).toBe(401);
  expect((await handler(request('PUT', body, 'bad'), props())).status).toBe(401);
  mockAnonFrom.mockReturnValueOnce(chain(null));
  expect((await handler(request('PUT', body), props())).status).toBe(401);
  mockAdminFrom.mockReturnValueOnce(chain(null));
  expect((await handler(request('PUT', body), props())).status).toBe(401);
  expect(mockRpc).not.toHaveBeenCalled();
});
test.each([
  { schedules: body.schedules },
  { ...body, operation_id: 'bad' },
  { ...body, schedules: [{ day_of_week: 7, start_time: '09:00', end_time: '18:00' }] },
  { ...body, schedules: [{ day_of_week: 1, start_time: '25:00', end_time: '18:00' }] },
  { ...body, schedules: [{ day_of_week: 1, start_time: '18:00', end_time: '09:00' }] },
  { ...body, schedules: [body.schedules[0], body.schedules[0]] },
  null,
])('PUT rejects malformed schedules before transaction', async payload => {
  expect((await PUT(request('PUT', payload), props())).status).toBe(400); expect(mockRpc).not.toHaveBeenCalled();
});
test('PUT uses one transaction with trusted actor, facility, target, immutable operation and strict force boolean', async () => {
  const res = await PUT(request('PUT', { ...body, force: 'true' }), props());
  expect(res.status).toBe(200);
  expect(mockRpc).toHaveBeenCalledWith('replace_staff_schedules_atomic', { p_actor_id: USER, p_facility_id: FACILITY, p_staff_id: STAFF, p_operation_id: OP, p_schedules: body.schedules, p_force: false });
  // 書き込みは RPC だけ。保存後に営業時間を読み、重ならない曜日の注意を返す（2026年10月23日）。
  expect(mockAdminFrom.mock.calls).toEqual([['staff_profiles'], ['facility_profiles'], ['facility_menus']]);
  expect(writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ tableName: 'staff_schedules', facilityId: FACILITY }));
  expect(await res.json()).toEqual({ ok: true });
});
// 2026年10月23日: 予約枠は営業時間の中にしか出ない。営業時間（定休日を含む）と重ならない勤務を保存しても
// 成功に見えるだけで、予約画面は毎日「満枠」になっていた。保存は止めず、注意を返す。
describe('営業時間と重ならない勤務の注意（保存は止めない）', () => {
  const HOURS = { mon: { open: '10:00', close: '18:00' }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null };
  const withHours = (hours: unknown, error: unknown = null, menus: unknown = []) => {
    mockAdminFrom.mockReset();
    mockAdminFrom.mockImplementation((table: string) => table === 'facility_profiles' ? chain(hours === undefined ? null : { business_hours: hours }, error)
      : chain({ id: STAFF }, null, menus));
  };
  test('PUT: 定休日・営業時間外の曜日を知らせる', async () => {
    withHours(HOURS);
    const res = await PUT(request('PUT', { operation_id: OP, schedules: [
      { day_of_week: 1, start_time: '09:00', end_time: '18:00' }, { day_of_week: 0, start_time: '09:00', end_time: '18:00' },
    ] }), props());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, warning: '日曜の勤務時間は、店舗の営業時間（定休日を含む）の中に最短のメニュー（15分）が入る長さがないため、その曜日はネット予約の枠が出ません。' });
  });
  test('PUT: 最短のメニューより短くしか重ならない曜日も知らせる（20261023190000）', async () => {
    // 月曜 10:00-18:00 の営業に 09:00-10:30 の勤務＝30 分。最短のメニューは 45 分
    withHours(HOURS, null, [{ duration_minutes: 45 }, { duration_minutes: null }]);
    const res = await PUT(request('PUT', { operation_id: OP, schedules: [
      { day_of_week: 1, start_time: '09:00', end_time: '10:30' }, { day_of_week: 3, start_time: '09:00', end_time: '18:00' },
    ] }), props());
    expect((await res.json()).warning).toBe('月・水曜の勤務時間は、店舗の営業時間（定休日を含む）の中に最短のメニュー（45分）が入る長さがないため、その曜日はネット予約の枠が出ません。このままでは、このスタッフは週間の勤務ではネット予約を受けられません。店舗の営業時間か勤務時間を見直してください。');
  });
  test('PUT: どの曜日も重ならなければ、このスタッフが予約を受けられないことまで知らせる', async () => {
    withHours(HOURS);
    const res = await PUT(request('PUT', { operation_id: OP, schedules: [
      { day_of_week: 2, start_time: '09:00', end_time: '18:00' }, { day_of_week: 1, start_time: '07:00', end_time: '10:00' },
    ] }), props());
    expect((await res.json()).warning).toBe('月・火曜の勤務時間は、店舗の営業時間（定休日を含む）の中に最短のメニュー（15分）が入る長さがないため、その曜日はネット予約の枠が出ません。このままでは、このスタッフは週間の勤務ではネット予約を受けられません。店舗の営業時間か勤務時間を見直してください。');
  });
  test.each([[undefined, null], [HOURS, { message: 'down' }]])('PUT: 営業時間を読めなければ注意を出さず、保存は成功のまま', async (hours, error) => {
    withHours(hours, error);
    const res = await PUT(request('PUT', { operation_id: OP, schedules: [{ day_of_week: 0, start_time: '09:00', end_time: '18:00' }] }), props());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
  test('POST: 勤務する特別日が定休日なら知らせる。営業日の中なら知らせない', async () => {
    withHours(HOURS);
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    // 2030-01-08 は火曜（定休日）、2030-01-07 は月曜
    let res = await POST(request('POST', { date: '2030-01-08', is_holiday: false, start_time: '10:00', end_time: '12:00' }), props());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, warning: 'この特別日の勤務時間は、店舗の営業時間（定休日を含む）の中に最短のメニュー（15分）が入る長さがないため、この日はネット予約の枠が出ません。' });
    res = await POST(request('POST', { date: '2030-01-07', is_holiday: false, start_time: '10:00', end_time: '12:00' }), props());
    expect(await res.json()).toEqual({ ok: true });
  });
  test('POST: 休みの特別日・時刻なしの特別日は営業時間を読まない', async () => {
    withHours(HOURS);
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    for (const payload of [{ date: '2030-01-08', is_holiday: true }, { date: '2030-01-08', is_holiday: false }]) {
      const res = await POST(request('POST', payload), props());
      expect(await res.json()).toEqual({ ok: true });
    }
    expect(mockAdminFrom.mock.calls.map(([table]) => table)).not.toContain('facility_profiles');
  });
  test('POST: 営業時間を読めなければ注意を出さない', async () => {
    withHours(HOURS, { message: 'down' });
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    const res = await POST(request('POST', { date: '2030-01-08', is_holiday: false, start_time: '10:00', end_time: '12:00' }), props());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });
});
test('PUT empty schedule/force/replay accepted, no old receipt overwrites a newer schedule', async () => {
  mockRpc.mockResolvedValue({ data: { ok: true, replayed: true }, error: null });
  expect((await PUT(request('PUT', { operation_id: OP, schedules: [], force: true }), props())).status).toBe(200);
  expect(mockRpc).toHaveBeenCalledWith('replace_staff_schedules_atomic', expect.objectContaining({ p_schedules: [], p_force: true }));
});
test.each([null, {}, { ok: false }, { ok: true }, { code: 'BOOKINGS_AFFECTED', affectedBookings: -1 }])('PUT malformed RPC result is visible failure', async data => {
  mockRpc.mockResolvedValue({ data, error: null }); expect((await PUT(request('PUT', body), props())).status).toBe(500); expect(writeAuditLog).not.toHaveBeenCalled();
});
test('PUT exact affected booking count comes from final DB transaction', async () => {
  mockRpc.mockResolvedValue({ data: { code: 'BOOKINGS_AFFECTED', affectedBookings: 2 }, error: null });
  const res = await PUT(request('PUT', body), props()); expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ code: 'BOOKINGS_AFFECTED', affectedBookings: 2 }); expect(writeAuditLog).not.toHaveBeenCalled();
});
test.each([null, { ok: true, replayed: false }])('PUT error rejects accompanying data without compensating I/O', async data => {
  mockRpc.mockResolvedValue({ data, error: { message: 'transaction insert failed' } });
  expect((await PUT(request('PUT', body), props())).status).toBe(500); expect(mockRpc).toHaveBeenCalledTimes(1); expect(mockAdminFrom.mock.calls).toEqual([['staff_profiles']]); expect(writeAuditLog).not.toHaveBeenCalled();
});
test.each([
  { date: 'bad', is_holiday: false }, { date: '2027-02-30', is_holiday: false },
  { date: '2099-01-05', is_holiday: false, start_time: '09:00' }, { date: '2099-01-05', is_holiday: false, end_time: '18:00' }, { date: '2099-01-05', is_holiday: false, start_time: '18:00', end_time: '09:00' }, null,
])('POST validation rejects malformed overrides', async payload => {
  expect((await POST(request('POST', payload), props())).status).toBe(400); expect(mockRpc).not.toHaveBeenCalled();
});
test.each([true, false])('POST override final impact check and upsert share one DB transaction', async holiday => {
  expect((await POST(request('POST', { date: '2099-01-05', is_holiday: holiday, start_time: '09:00', end_time: '18:00', force: true }), props())).status).toBe(201);
  expect(mockRpc).toHaveBeenCalledWith('save_staff_override_atomic', { p_actor_id: USER, p_facility_id: FACILITY, p_staff_id: STAFF, p_date: '2099-01-05', p_is_holiday: holiday, p_start_time: holiday ? null : '09:00', p_end_time: holiday ? null : '18:00', p_force: true });
});
test('POST unspecified times retain weekly fallback', async () => {
  expect((await POST(request('POST', { date: '2099-01-05', is_holiday: false }), props())).status).toBe(201);
  expect(mockRpc).toHaveBeenCalledWith('save_staff_override_atomic', expect.objectContaining({ p_start_time: null, p_end_time: null, p_force: false }));
});
test('POST booking impact never writes/audits', async () => {
  mockRpc.mockResolvedValue({ data: { code: 'BOOKINGS_AFFECTED', affectedBookings: 1 }, error: null });
  expect((await POST(request('POST', { date: '2099-01-05', is_holiday: true }), props())).status).toBe(409); expect(writeAuditLog).not.toHaveBeenCalled();
});
test.each([{ data: { ok: true }, error: { message: 'db failed' } }, { data: null, error: null }])('POST db error/malformed result cannot look successful', async result => {
  mockRpc.mockResolvedValue(result); expect((await POST(request('POST', { date: '2099-01-05', is_holiday: true }), props())).status).toBe(500); expect(writeAuditLog).not.toHaveBeenCalled();
});
test('DELETE malformed id rejected', async () => { expect((await DELETE(request('DELETE', { override_id: 'bad' }), props())).status).toBe(400); expect(mockRpc).not.toHaveBeenCalled(); });
test.each([true, false, null])('DELETE validates exact transaction outcome', async data => {
  mockRpc.mockResolvedValue({ data, error: null });
  expect((await DELETE(request('DELETE', { override_id: OV }), props())).status).toBe(data === true ? 200 : data === false ? 404 : 500);
  expect(mockRpc).toHaveBeenCalledWith('delete_staff_override_atomic', { p_actor_id: USER, p_facility_id: FACILITY, p_staff_id: STAFF, p_override_id: OV });
});
test('DELETE error beats accompanying success', async () => {
  mockRpc.mockResolvedValue({ data: true, error: { message: 'delete failed' } }); expect((await DELETE(request('DELETE', { override_id: OV }), props())).status).toBe(500); expect(writeAuditLog).not.toHaveBeenCalled();
});
test('DELETE reports when removing an override would strand an overnight booking', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: 'STAFF_OVERNIGHT_BOOKINGS_AFFECTED' } });
  const response = await DELETE(request('DELETE', { override_id: OV }), props());
  expect(response.status).toBe(409);
  expect((await response.json()).error).toContain('日付をまたぐ予約');
  expect(writeAuditLog).not.toHaveBeenCalled();
});
