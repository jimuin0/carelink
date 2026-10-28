/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { loadSlotHolidayCalendar, readDatedSlots } from '../available-slots';
import { fetchCabinetHolidays } from '../cabinet-holidays';
jest.mock('../cabinet-holidays', () => ({ fetchCabinetHolidays: jest.fn() }));

function admin(result: unknown) {
  const rpc = jest.fn().mockResolvedValue(result);
  const q: any = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null, error: null }) };
  return { client: { from: () => q, rpc } as never, rpc, q };
}

test('unconfigured facilities do not require holiday downloads', async () => {
  const { client } = admin({ data: [], error: null });
  expect(await loadSlotHolidayCalendar(client, 'facility')).toEqual({ calendar: null, error: null });
  expect(fetchCabinetHolidays).not.toHaveBeenCalled();
});

test('holiday closures fail closed when official data is unavailable', async () => {
  const { client, q } = admin({ data: [], error: null });
  q.maybeSingle = async () => ({ data: { close_on_public_holidays: true }, error: null });
  jest.mocked(fetchCabinetHolidays).mockResolvedValueOnce(null);
  expect((await loadSlotHolidayCalendar(client, 'facility')).error).toBeInstanceOf(Error);
});
test('設定の読取エラーと確認済み祝日を区別する', async () => {
  const { client, q } = admin({ data: [], error: null });
  const error = new Error('read');
  q.maybeSingle = async () => ({ data: null, error });
  expect((await loadSlotHolidayCalendar(client,'facility')).error).toBe(error);
  q.maybeSingle = async () => ({ data: { close_on_public_holidays: true }, error: null });
  const calendar = { from:'2030-01-01', through:'2030-12-31', dates:new Set(['2030-01-01']) };
  jest.mocked(fetchCabinetHolidays).mockResolvedValueOnce(calendar);
  expect(await loadSlotHolidayCalendar(client,'facility')).toEqual({ calendar, error:null });
});

test('the dated slot reader passes an already verified exclusion and calendar', async () => {
  const { client, rpc } = admin({ data: [{ slot_start: '23:30:00', slot_end: '00:30:00', end_date: '2030-01-08' }], error: null });
  const calendar = { from: '2030-01-01', through: '2030-12-31', dates: new Set(['2030-01-01']) };
  expect((await readDatedSlots(client, 'f', 's', '2030-01-07', 60, calendar, 'own')).slots?.[0].end_date).toBe('2030-01-08');
  expect(rpc).toHaveBeenCalledWith('get_available_slots_dated', { p_facility_id: 'f', p_staff_id: 's', p_date: '2030-01-07',
    p_duration_minutes: 60, p_exclude_booking_id: 'own', p_holiday_dates: ['2030-01-01'], p_holiday_from: '2030-01-01', p_holiday_through: '2030-12-31' });
});
