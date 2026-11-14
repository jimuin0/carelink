import { businessIntervalAcrossMidnightFits } from '../business-interval-across-midnight';
import { WEEK_DAYS } from '../business-hours';

const closed = Object.fromEntries(WEEK_DAYS.map(day => [day, null]));
const night = { ...closed, sat: { open: '18:00', close: '05:00' } };

test('an overnight booking fits the complete Saturday-to-Sunday window', () => {
  expect(businessIntervalAcrossMidnightFits(night, 6, 23 * 60 + 30, 24 * 60 + 30)).toBe(true);
  expect(businessIntervalAcrossMidnightFits(night, 6, 23 * 60, 24 * 60 + 5 * 60)).toBe(true);
  expect(businessIntervalAcrossMidnightFits(night, 6, 23 * 60, 24 * 60 + 5 * 60 + 1)).toBe(false);
  expect(businessIntervalAcrossMidnightFits(night, 6, 17 * 60, 24 * 60 + 30)).toBe(false);
});

test('a gap at midnight cannot be crossed, but touching periods can', () => {
  const gap = { ...closed, mon: { open: '18:00', close: '23:30' }, tue: { open: '00:30', close: '05:00' } };
  const touching = { ...closed, mon: { open: '18:00', close: '24:00' }, tue: { open: '00:00', close: '05:00' } };
  expect(businessIntervalAcrossMidnightFits(gap, 1, 23 * 60, 24 * 60 + 60)).toBe(false);
  expect(businessIntervalAcrossMidnightFits(touching, 1, 23 * 60, 24 * 60 + 60)).toBe(true);
});

test('same-day bookings still respect lunch and explicit closure', () => {
  const split = { ...closed, mon: { open: '09:00', close: '12:00', periods: [{ open: '09:00', close: '12:00' }, { open: '14:00', close: '18:00' }] } };
  expect(businessIntervalAcrossMidnightFits(split, 1, 540, 600)).toBe(true);
  expect(businessIntervalAcrossMidnightFits(split, 1, 690, 870)).toBe(false);
  expect(businessIntervalAcrossMidnightFits(split, 2, 540, 600)).toBe(false);
});

test.each([
  [night, -1, 100, 200], [night, 7, 100, 200], [night, 1.5, 100, 200],
  [night, 6, -1, 100], [night, 6, 1440, 1500], [night, 6, 100, 100],
  [night, 6, 100, 1541], [night, 6, NaN, 200], [night, 6, 100, Infinity],
  [{ sat: { open: '18:00', close: '05:00' } }, 6, 1400, 1500],
])('invalid or incomplete data fails closed', (hours, day, start, end) => {
  expect(businessIntervalAcrossMidnightFits(hours, day, start, end)).toBe(false);
});
