import { businessMinute, periodWindow, businessPeriods, mergeBusinessWindows, businessWindows,
  businessIntervalFits, confirmedBusinessWeek, formatBusinessDay, WEEK_DAYS } from '../business-hours';

const closed = () => Object.fromEntries(WEEK_DAYS.map(day => [day, null]));
const period = (open = '09:00', close = '20:00') => ({ open, close });
const split = { ...period('09:00', '12:30'), periods: [period('09:00', '12:30'), period('15:00', '18:20')] };

test.each([
  ['00:00', false, 0], ['23:59', false, 1439], ['24:00', true, 1440], ['24:00', false, null],
  ['24:01', true, null], ['25:00', true, null], ['9:00', false, null], ['12:60', false, null], [null, true, null],
])('clock %p end=%p', (value, end, result) => expect(businessMinute(value, end as boolean)).toBe(result));

test.each([
  [period(), { start: 540, end: 1200 }], [period('18:00', '05:00'), { start: 1080, end: 1740 }],
  [period('05:00', '12:00'), { start: 300, end: 720 }], [period('00:00', '24:00'), { start: 0, end: 1440 }],
  [period('00:00', '00:00'), null], [period('24:00', '05:00'), null], [period('09:00', '99:00'), null],
])('period %p', (value, result) => expect(periodWindow(value)).toEqual(result));

test.each([undefined, false, [], 'always', {}, { periods: [] }, { periods: {} },
  { periods: Array(13).fill(period()) }, { periods: [null] }, { periods: [[]] },
  { periods: [{ open: 9, close: '18:00' }] }, { periods: [{ open: '09:00', close: 18 }] },
  { periods: [period('09:00', '25:00')] },
])('invalid day %p fails parsing', value => expect(businessPeriods(value)).toBeNull());

test('period parser retains explicit closed, legacy and multiple periods', () => {
  expect(businessPeriods(null)).toEqual([]);
  expect(businessPeriods(period())).toEqual([period()]);
  expect(businessPeriods(split)).toEqual(split.periods);
});

test('overlapping and touching ranges merge without mutating input', () => {
  const ranges = [{ start: 20, end: 30 }, { start: 0, end: 10 }, { start: 5, end: 20 }, { start: 40, end: 50 }];
  expect(mergeBusinessWindows(ranges)).toEqual([{ start: 0, end: 30 }, { start: 40, end: 50 }]);
  expect(ranges[0]).toEqual({ start: 20, end: 30 });
  expect(mergeBusinessWindows([])).toEqual([]);
});

test.each([null, undefined, [], false, {}, { tue: null }, { mon: 'always' }, { mon: [] },
  { mon: {} }, { mon: { open: null, close: '18:00' } }, { mon: { open: '09:00' } },
])('legacy unconfigured %p does not add a booking restriction', value => {
  expect(businessWindows(value, 1)).toEqual([{ start: 0, end: 1440 }]);
});

test('calendar windows exclude lunch and include the previous day across the week boundary', () => {
  expect(businessWindows({ ...closed(), mon: split }, 1)).toEqual([{ start: 540, end: 750 }, { start: 900, end: 1100 }]);
  const week = { ...closed(), sat: period('18:00', '05:00') };
  expect(businessWindows(week, 6)).toEqual([{ start: 1080, end: 1440 }]);
  expect(businessWindows(week, 0)).toEqual([{ start: 0, end: 300 }]);
  expect(businessWindows(week, 1)).toEqual([]);
  expect(businessWindows({ ...closed(), mon: period('00:00', '24:00') }, 1)).toEqual([{ start: 0, end: 1440 }]);
});

test.each([NaN, -1, 7, 1.5])('invalid weekday %p', day => expect(businessWindows(null, day)).toEqual([]));
test('explicit invalid periods fail closed', () => {
  expect(businessWindows({ mon: { periods: [] } }, 1)).toEqual([]);
  expect(businessWindows({ mon: period('25:00', '20:00') }, 1)).toEqual([]);
});

test.each([
  [540, 600, true], [720, 750, true], [750, 780, false], [740, 910, false], [900, 960, true],
  [-1, 600, false], [540, 1441, false], [600, 600, false], [600, 540, false], [NaN, 600, false], [540, Infinity, false],
])('whole booking interval %s..%s fits=%s', (start, end, result) => {
  expect(businessIntervalFits({ ...closed(), mon: split }, 1, start, end)).toBe(result);
});

test.each([null, [], false, {}, { ...closed(), mon: {} }, { ...closed(), mon: { periods: [] } }, closed()])(
  'week %p cannot be published', value => expect(confirmedBusinessWeek(value)).toBe(false));

test('A, B, C and 24-hour shops are independent and complete schedules are accepted', () => {
  for (const hours of [period('09:00', '20:00'), period('18:00', '05:00'), period('05:00', '12:00'), period('00:00', '24:00'), split]) {
    expect(confirmedBusinessWeek({ ...closed(), mon: hours })).toBe(true);
  }
  expect(confirmedBusinessWeek(Object.fromEntries(WEEK_DAYS.map(day => [day, period('18:00', '05:00')])))).toBe(true);
});

test('overlaps are refused within a day, on the next day, and across Saturday/Sunday', () => {
  expect(confirmedBusinessWeek({ ...closed(), mon: { ...period(), periods: [period(), period('12:00', '14:00')] } })).toBe(false);
  expect(confirmedBusinessWeek({ ...closed(), mon: period('18:00', '05:00'), tue: period('04:00', '12:00') })).toBe(false);
  expect(confirmedBusinessWeek({ ...closed(), sat: period('18:00', '05:00'), sun: period('04:00', '12:00') })).toBe(false);
  expect(confirmedBusinessWeek({ ...closed(), mon: period('18:00', '05:00'), tue: period('05:00', '12:00') })).toBe(true);
});

test('display distinguishes closure, unknown, 24-hour, split and overnight periods', () => {
  expect(formatBusinessDay(null)).toBe('休み');
  expect(formatBusinessDay({})).toBe('未設定');
  expect(formatBusinessDay(period('00:00', '24:00'))).toBe('24時間営業');
  expect(formatBusinessDay(period('18:00', '05:00'))).toBe('18:00 〜 翌05:00');
  expect(formatBusinessDay(split)).toBe('09:00 〜 12:30 ／ 15:00 〜 18:20');
});
