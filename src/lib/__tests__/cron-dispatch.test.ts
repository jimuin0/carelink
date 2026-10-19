import { DISPATCH_GROUPS, matchesSchedule, cutoverTime, retiredLegacyJob, dispatchPlan } from '../cron-dispatch.mjs';
import jobs from '../cron-jobs.data.json';

test('UTC minute offsets, weekdays, midnight and leap days remain exact', () => {
  expect(matchesSchedule('7,37 * * * *', new Date('2028-02-29T23:37:59Z'))).toBe(true);
  expect(matchesSchedule('7,37 * * * *', new Date('2028-02-29T23:38:00Z'))).toBe(false);
  expect(matchesSchedule('*/15 * * * *', new Date('2026-10-19T00:45:00Z'))).toBe(true);
  expect(matchesSchedule('0 15 * * 1', new Date('2026-10-19T15:00:00Z'))).toBe(true);
  expect(matchesSchedule('0 15 * * 1', new Date('2026-10-20T15:00:00Z'))).toBe(false);
});
test.each(['* * *', '0 0 1 * *', '0 0 * 1 *', '60 * * * *', '0 24 * * *',
  '0 0 * * 7', '*/0 * * * *', '*/60 * * * *', '1-5 * * * *', '0 0 * * mon'])(
  'new/unreviewed syntax fails closed: %s', schedule => {
    expect(() => matchesSchedule(schedule, new Date())).toThrow();
  },
);
test('invalid dates and cutover values cannot silently activate runners', () => {
  expect(() => matchesSchedule('* * * * *', new Date(NaN))).toThrow();
  expect(cutoverTime(undefined)).toBe(Infinity);
  expect(cutoverTime('')).toBe(Infinity);
  expect(cutoverTime('2026-10-19T06:12:00Z')).toBe(Date.parse('2026-10-19T06:12:00Z'));
  expect(() => cutoverTime('tomorrow')).toThrow();
  expect(() => cutoverTime('2026-99-99T99:99:00Z')).toThrow();
});
test('preparation preserves legacy ownership; activation disables only consolidated legacy jobs', () => {
  const at = new Date('2026-10-19T06:00:00Z');
  expect(retiredLegacyJob('webhook-retry', Infinity, at)).toBe(false);
  expect(retiredLegacyJob('webhook-retry', at.getTime(), at)).toBe(true);
  expect(retiredLegacyJob('cron-heartbeat', 0, at)).toBe(false);
  expect(retiredLegacyJob('health-check', 0, at)).toBe(false);
  expect(retiredLegacyJob('unknown', 0, at)).toBe(false);
});
test('parallel peers are selected only at their own UTC schedule', () => {
  expect(dispatchPlan('quarter-hour', jobs, new Date('2026-10-19T06:00:35Z'), 0).jobs)
    .toEqual(['webhook-retry', 'flag-reviews']);
  expect(dispatchPlan('quarter-hour', jobs, new Date('2026-10-19T06:30:25Z'), 0).jobs)
    .toEqual(['webhook-retry', 'waitlist-notify']);
  expect(dispatchPlan('calendar', jobs, new Date('2026-10-21T05:25:20Z'), 0).jobs)
    .toEqual(['threads-token-refresh']);
  expect(dispatchPlan('calendar', jobs, new Date('2026-10-19T05:25:20Z'), 0).jobs).toEqual([]);
});
test('startup delay resolves the intended tick and fails on excessive delay', () => {
  expect(dispatchPlan('quarter-hour', jobs, new Date('2026-10-20T00:01:20Z'), 0).slot)
    .toBe('2026-10-20T00:00:00.000Z');
  expect(dispatchPlan('hourly', jobs, new Date('2026-10-19T06:06:30Z'), 0).jobs).toEqual(['booking-reminder']);
  expect(() => dispatchPlan('hourly', jobs, new Date('2026-10-19T06:10:00Z'), 0)).toThrow();
  expect(() => dispatchPlan('hourly', jobs, new Date('2026-10-19T06:04:00Z'), 0)).toThrow();
  expect(() => dispatchPlan('unknown', jobs, new Date(), 0)).toThrow();
  expect(() => dispatchPlan('hourly', [], new Date('2026-10-19T06:05:00Z'), 0)).toThrow();
});
test('before activation an expanded runner invokes only its original job at its original time', () => {
  expect(dispatchPlan('quarter-hour', jobs, new Date('2026-10-19T06:00:20Z'), Infinity).jobs).toEqual(['webhook-retry']);
  expect(dispatchPlan('hourly', jobs, new Date('2026-10-19T06:50:20Z'), Infinity).jobs).toEqual([]);
  expect(dispatchPlan('calendar', jobs, new Date('2026-10-19T17:20:20Z'), Infinity).jobs).toEqual([]);
});
test('exhaustive 8-day schedule equivalence includes all weekdays and every minute', () => {
  const start = Date.parse('2026-10-18T00:00:00Z');
  const groups = DISPATCH_GROUPS as {name: string; schedule: string; jobs: string[]}[];
  for (let n = 0; n < 8 * 24 * 60; n++) {
    const date = new Date(start + n * 60_000);
    for (const group of groups) {
      const expected = jobs.filter(j => group.jobs.includes(j.name) && matchesSchedule(j.schedule, date)).map(j => j.name).sort();
      const actual = matchesSchedule(group.schedule, date) ? dispatchPlan(group.name, jobs, date, 0).jobs.sort() : [];
      expect(actual).toEqual(expected);
    }
  }
}, 20000);
