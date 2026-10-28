import { bookingInterval, bookingIntervalsConflict } from '../booking-interval';
import fc from 'fast-check';

test('a cross-year booking overlaps the next calendar day, including buffer', () => {
  const overnight = bookingInterval('2026-12-31', '23:30', '2027-01-01', '00:30')!;
  const next = bookingInterval('2027-01-01', '00:35', '2027-01-01', '01:00')!;
  expect(bookingIntervalsConflict(next, overnight, 5)).toBe(false);
  expect(bookingIntervalsConflict(next, overnight, 10)).toBe(true);
  expect(bookingIntervalsConflict(overnight, next, 10)).toBe(true);
});

test('an explicit 24:00 end is the next midnight', () => {
  expect(bookingInterval('2026-10-27', '23:30', '2026-10-27', '24:00'))
    .toEqual(bookingInterval('2026-10-27', '23:30', '2026-10-28', '00:00'));
});

test.each([
  ['bad', '10:00', '2026-01-01', '11:00'], ['2026-02-30', '10:00', '2026-03-01', '11:00'],
  ['2026-10-27', '24:00', '2026-10-28', '01:00'], ['2026-10-27', '23:30', '2026-10-27', '00:30'],
  ['2026-10-27', '10:00', '2026-10-28', '11:00'], ['2026-10-27', '10:00:01', '2026-10-27', '11:00'],
])('invalid interval %s %s-%s %s is rejected', (date, start, endDate, end) => {
  expect(bookingInterval(date, start, endDate, end)).toBeNull();
});

test('invalid or inverted conflict inputs fail closed', () => {
  expect(bookingIntervalsConflict({ start: 10, end: 9 }, { start: 30, end: 40 }, 0)).toBe(true);
  expect(bookingIntervalsConflict({ start: 10, end: 20 }, { start: 30, end: 40 }, -1)).toBe(true);
});

test('overlap remains symmetric across every minute of a midnight boundary', () => {
  fc.assert(fc.property(
    fc.integer({ min: -480, max: 480 }), fc.integer({ min: 1, max: 480 }),
    fc.integer({ min: -480, max: 480 }), fc.integer({ min: 1, max: 480 }),
    fc.integer({ min: 0, max: 120 }), (a, aLength, b, bLength, buffer) => {
      const first = { start: a, end: a + aLength };
      const second = { start: b, end: b + bLength };
      expect(bookingIntervalsConflict(first, second, buffer)).toBe(bookingIntervalsConflict(second, first, buffer));
      expect(bookingIntervalsConflict(first, second, buffer)).toBe(a < b + bLength + buffer && a + aLength + buffer > b);
    },
  ), { numRuns: 2000 });
});
