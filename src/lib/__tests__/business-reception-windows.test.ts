import { businessReceptionWindows } from '../business-reception-windows';
import { WEEK_DAYS } from '../business-hours';

const closed = Object.fromEntries(WEEK_DAYS.map(day => [day, null]));

test('each session has its own cutoff and lunch is not treated as open', () => {
  const mon = { open: '09:00', close: '12:30', periods: [{ open: '09:00', close: '12:30' }, { open: '15:00', close: '18:20' }] };
  expect(businessReceptionWindows({ ...closed, mon }, 1, 15)).toEqual([{ start: 540, end: 735 }, { start: 900, end: 1085 }]);
});

test('the cutoff of an overnight period uses its real closing time, not midnight', () => {
  const week = { ...closed, sat: { open: '18:00', close: '05:00' } };
  expect(businessReceptionWindows(week, 6, 15)).toEqual([{ start: 1080, end: 1440 }]);
  expect(businessReceptionWindows(week, 0, 15)).toEqual([{ start: 0, end: 285 }]);
});

test('zero cutoff keeps 24-hour reception and short periods can have no reception', () => {
  expect(businessReceptionWindows({ ...closed, mon: { open: '00:00', close: '24:00' } }, 1, 0)).toEqual([{ start: 0, end: 1440 }]);
  expect(businessReceptionWindows({ ...closed, mon: { open: '09:00', close: '09:15' } }, 1, 15)).toEqual([]);
});

test('touching sessions are continuous across midnight before applying the cutoff', () => {
  const week = { ...closed, mon: { open: '18:00', close: '24:00' }, tue: { open: '00:00', close: '05:00' } };
  expect(businessReceptionWindows(week, 1, 15)).toEqual([{ start: 1080, end: 1440 }]);
  expect(businessReceptionWindows(week, 2, 15)).toEqual([{ start: 0, end: 285 }]);
});

test('continuous 24-hour weekly operation has no daily artificial cutoff', () => {
  const allDay = Object.fromEntries(WEEK_DAYS.map(day => [day, { open: '00:00', close: '24:00' }]));
  expect(businessReceptionWindows(allDay, 1, 15)).toEqual([{ start: 0, end: 1440 }]);
});

test.each([
  [null, 1, 0], [{}, 1, 0], [closed, 1, 0], [{ ...closed, mon: { open: '09:00', close: '18:00' } }, -1, 0],
  [{ ...closed, mon: { open: '09:00', close: '18:00' } }, 7, 0], [{ ...closed, mon: { open: '09:00', close: '18:00' } }, 1, -1],
  [{ ...closed, mon: { open: '09:00', close: '18:00' } }, 1, 1441], [{ ...closed, mon: { open: '09:00', close: '18:00' } }, 1, 0.5],
])('invalid settings do not assert reception hours', (hours, day, cutoff) => {
  expect(businessReceptionWindows(hours, day, cutoff)).toBeNull();
});
