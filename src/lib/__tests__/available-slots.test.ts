/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
jest.mock('@/lib/admin-date', () => ({ todayJst: () => '2026-10-22' }));
import { clampDuration, dropStartedSlotsToday, readSlots, SLOT_DURATION_DEFAULT } from '../available-slots';

const slot = (start: string) => ({ slot_start: start, slot_end: '23:59:00', staff_id: 's' });

describe('clampDuration', () => {
  it('defaults missing or non-numeric values', () => {
    expect(clampDuration(null)).toBe(SLOT_DURATION_DEFAULT);
    expect(clampDuration('abc')).toBe(SLOT_DURATION_DEFAULT);
  });
  it('clamps to 15..480', () => {
    expect(clampDuration('5')).toBe(15);
    expect(clampDuration('90')).toBe(90);
    expect(clampDuration('999')).toBe(480);
  });
  it('drops a fraction like parseInt (the booking API compares whole minutes)', () => {
    expect(clampDuration('90.9')).toBe(90);
  });
});

describe('dropStartedSlotsToday', () => {
  // 2026-10-22 10:30 JST = 01:30 UTC
  const now = Date.parse('2026-10-22T01:30:00Z');
  it('drops slots that already started today (JST)', () => {
    expect(dropStartedSlotsToday('2026-10-22', [slot('10:00:00'), slot('11:00:00')], now)).toEqual([slot('11:00:00')]);
  });
  it('keeps every slot on other days', () => {
    expect(dropStartedSlotsToday('2026-10-23', [slot('00:30:00')], now)).toEqual([slot('00:30:00')]);
  });
});

describe('readSlots', () => {
  it('calls the slot RPC and returns its slots', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [slot('12:00:00')], error: null });
    const r = await readSlots({ rpc } as never, 'f', 's', '2026-10-23', 60);
    expect(r).toEqual({ slots: [slot('12:00:00')], error: null });
    expect(rpc).toHaveBeenCalledWith('get_available_slots', { p_facility_id: 'f', p_staff_id: 's', p_date: '2026-10-23', p_duration_minutes: 60 });
  });
  // 予約日時の変更画面（2026年10月23日）: 変更する予約を外した空きを 5 引数の RPC で取る。
  it('passes the reservation to leave out only when one is given', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [slot('14:30:00')], error: null });
    expect(await readSlots({ rpc } as never, 'f', 's', '2026-10-23', 60, 'b1')).toEqual({ slots: [slot('14:30:00')], error: null });
    expect(rpc).toHaveBeenCalledWith('get_available_slots', {
      p_facility_id: 'f', p_staff_id: 's', p_date: '2026-10-23', p_duration_minutes: 60, p_exclude_booking_id: 'b1',
    });
  });
  it('reports an RPC error instead of returning no slots', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: { message: 'x' } });
    expect(await readSlots({ rpc } as never, 'f', 's', '2026-10-23', 60)).toEqual({ slots: null, error: { message: 'x' } });
  });
  it('treats missing data as no slots', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    expect(await readSlots({ rpc } as never, 'f', 's', '2026-10-23', 60)).toEqual({ slots: [], error: null });
  });
});
