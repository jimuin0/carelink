/**
 * @jest-environment node
 *
 * computeBusinessStatus（純粋関数・TZ非依存）の判定テスト。
 * 深夜営業（close<=open の翌日跨ぎ）が常に 'closed' になっていた不具合の回帰防止を含む。
 */
import { computeBusinessStatus, computeCalendarBusinessStatus } from '@/components/facility/BusinessStatusBadge';

describe('computeBusinessStatus', () => {
  const day = { open: '09:00', close: '18:00' };

  test('通常営業: 営業時間内 → open', () => {
    expect(computeBusinessStatus('12:00', day)).toBe('open');
  });
  test('通常営業: 開店前 → closed', () => {
    expect(computeBusinessStatus('08:00', day)).toBe('closed');
  });
  test('通常営業: 開店ちょうど → open（>= open）', () => {
    expect(computeBusinessStatus('09:00', day)).toBe('open');
  });
  test('通常営業: 閉店ちょうど → closed（< close 排他）', () => {
    expect(computeBusinessStatus('18:00', day)).toBe('closed');
  });

  const overnight = { open: '20:00', close: '02:00' }; // 翌日跨ぎ

  test('深夜営業: 夜（開店後）→ open（旧コードは closed・回帰防止）', () => {
    expect(computeBusinessStatus('21:00', overnight)).toBe('open');
  });
  test('深夜営業: 翌朝（閉店前）→ open（旧コードは closed・回帰防止）', () => {
    expect(computeBusinessStatus('01:00', overnight)).toBe('open');
  });
  test('深夜営業: 営業時間外（昼）→ closed', () => {
    expect(computeBusinessStatus('15:00', overnight)).toBe('closed');
  });
  test('深夜営業: 閉店ちょうど → closed', () => {
    expect(computeBusinessStatus('02:00', overnight)).toBe('closed');
  });
  test('深夜営業: 開店ちょうど → open', () => {
    expect(computeBusinessStatus('20:00', overnight)).toBe('open');
  });

  test('定休日: todayHours が null → holiday', () => {
    expect(computeBusinessStatus('12:00', null)).toBe('holiday');
  });
  test('定休日: todayHours が undefined → holiday', () => {
    expect(computeBusinessStatus('12:00', undefined)).toBe('holiday');
  });
});


const mondayAt = (clock: string) => Date.parse(`2030-01-07T${clock}:00+09:00`);
test.each([['09:00', 'open'], ['12:30', 'closed'], ['14:00', 'closed'], ['15:00', 'open'], ['18:20', 'closed']])(
  'JST public badge respects both periods at %s', (clock, expected) => {
    const mon = { open: '09:00', close: '12:30', periods: [{ open: '09:00', close: '12:30' }, { open: '15:00', close: '18:20' }] };
    expect(computeCalendarBusinessStatus({ mon }, mondayAt(clock))).toBe(expected);
  });
test('a night opening belongs to its starting day and continues across the week boundary', () => {
  const hours = { sun: { open: '18:00', close: '05:00' }, mon: null };
  expect(computeCalendarBusinessStatus(hours, mondayAt('04:59'))).toBe('open');
  expect(computeCalendarBusinessStatus(hours, mondayAt('05:00'))).toBe('holiday');
  expect(computeCalendarBusinessStatus({ mon: { open: '18:00', close: '05:00' } }, mondayAt('04:00'))).toBe('closed');
  expect(computeCalendarBusinessStatus({ mon: { open: '00:00', close: '24:00' } }, mondayAt('23:59'))).toBe('open');
});
test('missing or malformed hours never claim that an unconfigured shop is open', () => {
  expect(computeCalendarBusinessStatus(null, mondayAt('12:00'))).toBe('unknown');
  expect(computeCalendarBusinessStatus({}, mondayAt('12:00'))).toBe('unknown');
  expect(computeCalendarBusinessStatus({ mon: { open: '', close: '' } }, mondayAt('12:00'))).toBe('unknown');
});
