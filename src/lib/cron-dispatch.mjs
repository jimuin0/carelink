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
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:00Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error('Invalid CARELINK_CRON_DISPATCH_FROM');
  }
  return Date.parse(value);
}

export function retiredLegacyJob(name, cutover, now) {
  return now.getTime() >= cutover && DISPATCH_GROUPS.some(group => group.jobs.includes(name));
}

export function dispatchPlan(groupName, jobs, now, cutover) {
  const group = DISPATCH_GROUPS.find(g => g.name === groupName);
  if (!group) throw new Error('Unknown dispatch group');
  // Render starts containers several seconds after the scheduled minute. Resolve
  // the latest runner tick, bounded to five minutes, including day rollover.
  let slot = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  while (!matchesSchedule(group.schedule, slot)) {
    slot = new Date(slot.getTime() - 60_000);
    if (now.getTime() - slot.getTime() >= 300_000) throw new Error('Runner started outside its scheduled window');
  }
  const names = slot.getTime() < cutover ? [group.legacy] : group.jobs;
  const selected = names.map(name => {
    const job = jobs.find(j => j.name === name);
    if (!job) throw new Error('Missing cron registry job');
    return job;
  }).filter(job => matchesSchedule(job.schedule, slot));
  return { slot: slot.toISOString(), jobs: selected.map(job => job.name) };
}
