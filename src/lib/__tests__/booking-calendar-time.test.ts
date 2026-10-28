import { bookingCalendarTimes } from '../booking-calendar-time';

test.each([
  ['2026-10-27', '10:00', '11:00', '2026-10-27T01:00:00.000Z', '2026-10-27T02:00:00.000Z', '2026-10-27'],
  ['2026-12-31', '23:30:00', '00:30:00', '2026-12-31T14:30:00.000Z', '2026-12-31T15:30:00.000Z', '2027-01-01'],
  ['2026-10-27', '23:30', '24:00', '2026-10-27T14:30:00.000Z', '2026-10-27T15:00:00.000Z', '2026-10-27'],
  ['2026-10-27', '23:30:01', '24:00:00', '2026-10-27T14:30:01.000Z', '2026-10-27T15:00:00.000Z', '2026-10-27'],
])('converts %s %s-%s using JST', (date, start, end, expectedStart, expectedEnd, endDate) => {
  expect(bookingCalendarTimes(date, start, end, endDate)).toEqual({ start: expectedStart, end: expectedEnd });
});

test.each([
  ['bad', '10:00', '11:00'], ['2026-02-30', '10:00', '11:00'],
  ['2026-10-27', 'bad', '11:00'], ['2026-10-27', '10:00', 'bad'],
  ['2026-10-27', '24:00', '01:00'], ['2026-10-27', '10:00', '10:00:00'],
  ['2026-10-27', '23:30', '00:30'],
])('rejects invalid input %s %s-%s', (date, start, end) => {
  expect(bookingCalendarTimes(date, start, end)).toBeNull();
});
