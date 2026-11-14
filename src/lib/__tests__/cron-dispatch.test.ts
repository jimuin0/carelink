import { DISPATCH_GROUPS, MONITOR_RUNNER, matchesSchedule, cutoverTime, retiredLegacyJob, dispatchPlan, monitorPlan,
  MAX_STARTUP_DELAY_MS, MissedSlotError, minTickGapMs, startupWindowMs, missedJobs } from '../cron-dispatch.mjs';
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
  expect(() => cutoverTime('2026-02-30T06:12:00Z')).toThrow();
  expect(() => cutoverTime('2026-10-19T24:00:00Z')).toThrow();
  expect(() => cutoverTime('2026-99-99T99:99:00Z')).toThrow();
});
test('preparation preserves legacy ownership; activation disables only consolidated legacy jobs', () => {
  const at = new Date('2026-10-19T06:00:00Z');
  expect(retiredLegacyJob('webhook-retry', jobs, Infinity, at)).toBe(false);
  expect(retiredLegacyJob('webhook-retry', jobs, at.getTime(), at)).toBe(true);
  expect(retiredLegacyJob('cron-heartbeat', jobs, 0, at)).toBe(false);
  expect(retiredLegacyJob('health-check', jobs, 0, at)).toBe(false);
  expect(retiredLegacyJob('unknown', jobs, 0, at)).toBe(false);
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
  // hourly ticks are >=15 minutes apart, so a 5-minute delay still owns 06:05.
  expect(dispatchPlan('hourly', jobs, new Date('2026-10-19T06:10:00Z'), 0).slot).toBe('2026-10-19T06:05:00.000Z');
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

test('delayed runs on both sides of cutover have exactly one nominal-slot owner', () => {
  const cutover = Date.parse('2026-10-18T22:12:00Z');
  const delayed = new Date('2026-10-18T22:13:00Z');
  expect(retiredLegacyJob('weekly-report', jobs, cutover, delayed)).toBe(false);
  expect(dispatchPlan('calendar', jobs, delayed, cutover).jobs).not.toContain('weekly-report');
  const next = new Date('2026-10-18T22:16:00Z');
  expect(retiredLegacyJob('webhook-retry', jobs, cutover, next)).toBe(true);
  expect(dispatchPlan('quarter-hour', jobs, next, cutover).jobs).toContain('webhook-retry');
  expect(() => retiredLegacyJob('weekly-report', [], cutover, delayed)).toThrow();
  expect(retiredLegacyJob('weekly-report', jobs, cutover, new Date('2026-10-18T22:16:00Z'))).toBe(false);
  expect(() => retiredLegacyJob('weekly-report', jobs, cutover, new Date('2026-10-18T22:20:00Z'))).toThrow(MissedSlotError);
});

test('monitor runner runs cron-heartbeat only at its canonical 7,37 slots', () => {
  expect(monitorPlan(jobs, new Date('2026-10-19T06:07:25Z'))).toEqual({slot: '2026-10-19T06:07:00.000Z', jobs: ['cron-heartbeat']});
  expect(monitorPlan(jobs, new Date('2026-10-19T06:37:40Z')).jobs).toEqual(['cron-heartbeat']);
  expect(monitorPlan(jobs, new Date('2026-10-19T06:02:10Z'))).toEqual({slot: '2026-10-19T06:02:00.000Z', jobs: []});
  // Startup delay resolves to the latest tick, including across the hour.
  expect(monitorPlan(jobs, new Date('2026-10-19T06:11:59Z')).jobs).toEqual(['cron-heartbeat']);
  expect(monitorPlan(jobs, new Date('2026-10-19T07:01:30Z')).slot).toBe('2026-10-19T06:57:00.000Z');
  expect(() => monitorPlan([], new Date('2026-10-19T06:07:00Z'))).toThrow('Missing cron registry job');
});
test('monitor ticks contain every heartbeat slot and keep a five-minute health cadence', () => {
  const heartbeat = jobs.find(j => j.name === 'cron-heartbeat')!;
  const start = Date.parse('2026-10-18T00:00:00Z');
  let ticks = 0;
  for (let n = 0; n < 24 * 60; n++) {
    const date = new Date(start + n * 60_000);
    if (matchesSchedule(heartbeat.schedule, date)) expect(matchesSchedule(MONITOR_RUNNER.schedule, date)).toBe(true);
    if (matchesSchedule(MONITOR_RUNNER.schedule, date)) {
      ticks++;
      expect(monitorPlan(jobs, date).jobs).toEqual(matchesSchedule(heartbeat.schedule, date) ? ['cron-heartbeat'] : []);
    }
  }
  expect(ticks).toBe(24 * 12);
  // The monitors stay apart from the business runners they watch.
  for (const group of DISPATCH_GROUPS as {jobs: string[]; service: string}[]) {
    expect(group.jobs).not.toContain('cron-heartbeat');
    expect(group.service).not.toBe(MONITOR_RUNNER.service);
  }
});

test('startup window is min(MAX_STARTUP_DELAY_MS, shortest tick gap) for every runner', () => {
  expect(MAX_STARTUP_DELAY_MS).toBe(10 * 60_000);
  expect(minTickGapMs('*/15 * * * *')).toBe(15 * 60_000);
  expect(minTickGapMs('0,10,20,25,40 * * * *')).toBe(5 * 60_000);
  expect(minTickGapMs('0 15 * * 1')).toBe(7 * 24 * 60 * 60_000);
  expect(minTickGapMs('0 15 * * 1')).toBe(7 * 24 * 60 * 60_000); // cached
  expect(startupWindowMs('*/15 * * * *')).toBe(MAX_STARTUP_DELAY_MS);
  expect(startupWindowMs('0,10,20,25,40 * * * *')).toBe(5 * 60_000);
  for (const s of [...(DISPATCH_GROUPS as {schedule: string}[]).map(g => g.schedule), MONITOR_RUNNER.schedule]) {
    // Uniqueness: no later tick can fall inside the window of an earlier tick.
    expect(startupWindowMs(s)).toBeLessThanOrEqual(minTickGapMs(s));
  }
});
test('every delay inside the window runs the launching slot exactly once (no adoption of the next tick)', () => {
  for (const group of DISPATCH_GROUPS as {name: string; schedule: string}[]) {
    const window = startupWindowMs(group.schedule);
    const start = Date.parse('2026-10-19T00:00:00Z');
    const owners = new Map<string, number>();
    for (let n = 0; n < 24 * 60; n++) {
      const tick = start + n * 60_000;
      if (!matchesSchedule(group.schedule, new Date(tick))) continue;
      for (const delay of [0, 59_000, window - 1000]) {
        const plan = dispatchPlan(group.name, jobs, new Date(tick + delay), 0);
        expect(plan.slot).toBe(new Date(tick).toISOString());
      }
      owners.set(new Date(tick).toISOString(), (owners.get(new Date(tick).toISOString()) || 0) + 1);
    }
    for (const count of owners.values()) expect(count).toBe(1);
  }
});
test('the delayed quarter-hour run keeps its own jobs instead of resolving to none', () => {
  // 06:00 (webhook-retry, flag-reviews) delayed by 8 minutes.
  expect(dispatchPlan('quarter-hour', jobs, new Date('2026-10-19T06:08:30Z'), 0))
    .toEqual({slot: '2026-10-19T06:00:00.000Z', jobs: ['webhook-retry', 'flag-reviews']});
});
test('a start beyond the window raises MissedSlotError with the lost slot and its jobs', () => {
  let error: MissedSlotError | undefined;
  try { dispatchPlan('quarter-hour', jobs, new Date('2026-10-19T06:11:00Z'), 0); } catch (e) { error = e as MissedSlotError; }
  expect(error).toBeInstanceOf(MissedSlotError);
  expect(error!.slot.toISOString()).toBe('2026-10-19T06:00:00.000Z');
  expect(error!.delayMs).toBe(11 * 60_000);
  expect(missedJobs('quarter-hour', jobs, error!.slot, 0)).toEqual(['webhook-retry', 'flag-reviews']);
  expect(missedJobs('quarter-hour', jobs, error!.slot, Infinity)).toEqual(['webhook-retry']);
  expect(() => missedJobs('unknown', jobs, error!.slot, 0)).toThrow('Unknown dispatch group');
});
