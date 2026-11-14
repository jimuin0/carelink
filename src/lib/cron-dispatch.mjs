// Business schedules remain in cron-jobs.data.json. These are runner wake-ups,
// not replacement business schedules. Keep >=15 minutes between active runs
// in each group so the existing five-minute request timeout cannot delay peers.
export const DISPATCH_GROUPS = [
  { name: 'quarter-hour', service: 'carelink-webhook-retry', schedule: '*/15 * * * *', legacy: 'webhook-retry',
    jobs: ['webhook-retry', 'flag-reviews', 'waitlist-notify'] },
  { name: 'hourly', service: 'carelink-booking-reminder', schedule: '5,50 * * * *', legacy: 'booking-reminder',
    jobs: ['booking-reminder', 'threads-backfill'] },
  { name: 'calendar', service: 'carelink-daily-summary', schedule: '0,10,20,25,40 * * * *', legacy: 'daily-summary',
    jobs: ['daily-summary', 'customer-segment', 'review-request', 'sync-google-ratings',
      'onboarding-followup', 'birthday-coupon', 'favorites-digest', 'weekly-report',
      'hpb-menu-scrape', 'schema-drift-check', 'threads-token-refresh'] },
];

// Both monitors run on one Render service (carelink-health-check). The health
// probe runs on every tick; cron-heartbeat keeps its canonical 7,37 business
// slots. Ticks are offset by two minutes so both heartbeat minutes are ticks.
// Monitors stay separate from the business runners they watch.
export const MONITOR_RUNNER = {
  service: 'carelink-health-check',
  schedule: '2,7,12,17,22,27,32,37,42,47,52,57 * * * *',
  jobs: ['cron-heartbeat'],
};

// Deliberately support only the registry's reviewed UTC syntax; fail closed
// instead of silently interpreting future calendar/range extensions incorrectly.
export function matchesSchedule(schedule, date) {
  const fields = schedule.split(' ');
  if (fields.length !== 5 || fields[2] !== '*' || fields[3] !== '*' || !Number.isFinite(date.getTime())) {
    throw new Error('Unsupported UTC schedule');
  }
  const values = [date.getUTCMinutes(), date.getUTCHours(), 0, 0, date.getUTCDay()];
  return fields.map((field, i) => {
    if (field === '*') return true;
    if (i === 0 && /^\*\/[1-9]\d*$/.test(field) && Number(field.slice(2)) <= 59) {
      return values[i] % Number(field.slice(2)) === 0;
    }
    const max = [59, 23, 0, 0, 6][i];
    if (!/^\d+(,\d+)*$/.test(field) || field.split(',').some(n => Number(n) > max)) {
      throw new Error('Unsupported UTC schedule');
    }
    return field.split(',').map(Number).includes(values[i]);
  }).every(Boolean);
}

export function cutoverTime(value) {
  if (!value) return Infinity; // Preparation deploy preserves all legacy jobs.
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:00Z$/.test(value) || !Number.isFinite(Date.parse(value)) ||
      new Date(Date.parse(value)).toISOString().replace('.000Z', 'Z') !== value) {
    throw new Error('Invalid CARELINK_CRON_DISPATCH_FROM');
  }
  return Date.parse(value);
}

// Upper bound on Render startup delay that is still attributed to the tick
// that launched the container. The effective window per runner is
// min(MAX_STARTUP_DELAY_MS, shortest gap between its ticks), so the latest tick
// inside the window is always the launching tick: one slot is never resolved
// by two containers (no double run) and a delayed run never adopts the next
// tick's jobs. A start later than the window is reported as a missed slot.
export const MAX_STARTUP_DELAY_MS = 10 * 60_000;

export class MissedSlotError extends Error {
  constructor(slot, delayMs) {
    super('Runner started after its startup-delay window');
    this.name = 'MissedSlotError';
    this.slot = slot;
    this.delayMs = delayMs;
  }
}

const gapCache = new Map();
// Shortest interval between consecutive ticks (UTC). Every supported schedule
// ticks at least weekly, so two weeks always yield a finite gap.
export function minTickGapMs(schedule) {
  if (gapCache.has(schedule)) return gapCache.get(schedule);
  const start = Date.UTC(2026, 9, 18); // two full weeks: weekly ticks pair up
  let prev = null;
  let gap = Infinity;
  for (let n = 0; n < 15 * 24 * 60; n++) {
    const t = start + n * 60_000;
    if (!matchesSchedule(schedule, new Date(t))) continue;
    if (prev !== null) gap = Math.min(gap, t - prev);
    prev = t;
  }
  gapCache.set(schedule, gap);
  return gap;
}

export function startupWindowMs(schedule) {
  return Math.min(MAX_STARTUP_DELAY_MS, minTickGapMs(schedule));
}

function scheduledSlot(schedule, now) {
  const window = startupWindowMs(schedule);
  let slot = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  while (!matchesSchedule(schedule, slot)) {
    slot = new Date(slot.getTime() - 60_000);
  }
  const delay = now.getTime() - slot.getTime();
  if (delay >= window) throw new MissedSlotError(slot, delay);
  return slot;
}

export function retiredLegacyJob(name, jobs, cutover, now) {
  if (!Number.isFinite(cutover) || !DISPATCH_GROUPS.some(group => group.jobs.includes(name))) return false;
  const job = jobs.find(job => job.name === name);
  if (!job) throw new Error('Missing cron registry job');
  // A delayed pre-cutover run still belongs to the legacy owner, even if its
  // container starts after the wall-clock cutover. Both owners use the slot.
  return scheduledSlot(job.schedule, now).getTime() >= cutover;
}

export function dispatchPlan(groupName, jobs, now, cutover) {
  const group = DISPATCH_GROUPS.find(g => g.name === groupName);
  if (!group) throw new Error('Unknown dispatch group');
  // Render starts containers some time after the scheduled minute. Resolve the
  // latest runner tick inside the startup window, including day rollover.
  const slot = scheduledSlot(group.schedule, now);
  const names = slot.getTime() < cutover ? [group.legacy] : group.jobs;
  const selected = names.map(name => {
    const job = jobs.find(j => j.name === name);
    if (!job) throw new Error('Missing cron registry job');
    return job;
  }).filter(job => matchesSchedule(job.schedule, slot));
  return { slot: slot.toISOString(), jobs: selected.map(job => job.name) };
}

// Jobs that were due at a slot the runner could not claim (for the alert log).
export function missedJobs(groupName, jobs, slot, cutover) {
  const group = DISPATCH_GROUPS.find(g => g.name === groupName);
  if (!group) throw new Error('Unknown dispatch group');
  const names = slot.getTime() < cutover ? [group.legacy] : group.jobs;
  return names.filter(name => jobs.some(job => job.name === name && matchesSchedule(job.schedule, slot)));
}

export function monitorPlan(jobs, now) {
  const slot = scheduledSlot(MONITOR_RUNNER.schedule, now);
  const selected = MONITOR_RUNNER.jobs.map(name => {
    const job = jobs.find(j => j.name === name);
    if (!job) throw new Error('Missing cron registry job');
    return job;
  }).filter(job => matchesSchedule(job.schedule, slot));
  return { slot: slot.toISOString(), jobs: selected.map(job => job.name) };
}
