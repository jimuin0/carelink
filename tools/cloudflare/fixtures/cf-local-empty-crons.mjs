import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';

const saved = JSON.parse(readFileSync(process.env.CARELINK_LOCAL_CRON_STACK_STATUS, 'utf8'));
const root = realpathSync(saved.identity.project_root);
assert.equal(root, '/private/tmp/carelink-cf-cron-check-20261029'); assert.equal(saved.runtime, 'native');
const current = JSON.parse(execFileSync('npm', ['exec', '--yes', '--package=supabase@2.122.0', '--', 'supabase', 'stack', 'status', '--output-format', 'json'], {
  cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, SUPABASE_EXPERIMENTAL_STACK: '1' },
  encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
}));
assert.equal(current.identity.id, saved.identity.id); assert.equal(current.readiness, 'ready');
assert.equal(current.env.API_URL, saved.env.API_URL); assert.equal(new URL(current.env.API_URL).hostname, '127.0.0.1');
const keys = readFileSync('dist/server/.dev.vars', 'utf8').split('\n').filter(line => line.includes('=')).map(line => line.split('=', 1)[0]);
assert.ok(keys.includes('CRON_SECRET')); assert.ok(keys.every(key => ['SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET'].includes(key)));
const db = createClient(current.env.API_URL, current.env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const creds = await db.from('threads_credentials').select('id', { count: 'exact', head: true });
assert.ifError(creds.error); assert.equal(creds.count, 0, 'refusing to refresh real or synthetic provider credentials');
for (const name of process.env.CARELINK_LOCAL_REMINDER_ONLY === '1' ? [] : ['threads-token-refresh', 'cron-heartbeat']) {
  const before = await db.from('cron_logs').select('id', { count: 'exact', head: true }).eq('job_name', name);
  assert.ifError(before.error);
  const response = await fetch(`http://127.0.0.1:18744/api/cron/${name}`, {
    headers: { authorization: 'Bearer local-synthetic-cron-secret-not-production' }, redirect: 'manual',
  });
  assert.equal(response.status, 200, `${name} failed`);
  const logs = await db.from('cron_logs').select('status').eq('job_name', name).order('started_at', { ascending: false });
  assert.ifError(logs.error); assert.equal(logs.data.length, before.count + 1);
  assert.equal(logs.data[0].status, name === 'threads-token-refresh' ? 'skipped' : 'success');
  console.log(`${name}: HTTP 200 and expected local cron log`);
}
// Do not run the reminder job during its send hour. It is safe only with an
// empty local reminder ledger and no external notification credentials.
const jstHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
assert.notEqual(jstHour, 9, 'refusing to run reminder during its delivery hour');
const reminders = await db.from('sent_reminders').select('id', { count: 'exact', head: true });
assert.ifError(reminders.error); assert.equal(reminders.count, 0);
const beforeReminder = await db.from('cron_logs').select('id', { count: 'exact', head: true }).eq('job_name', 'booking-reminder');
assert.ifError(beforeReminder.error);
const reminder = await fetch('http://127.0.0.1:18744/api/cron/booking-reminder', {
  headers: { authorization: 'Bearer local-synthetic-cron-secret-not-production' }, redirect: 'manual',
});
assert.equal(reminder.status, 200, 'local off-hours reminder failed');
const summary = await reminder.json(); assert.equal(summary.sent, 0);
const reminderLogs = await db.from('cron_logs').select('status').eq('job_name', 'booking-reminder').order('started_at', { ascending: false });
assert.ifError(reminderLogs.error); assert.equal(reminderLogs.data.length, beforeReminder.count + 1);
assert.equal(reminderLogs.data[0].status, 'skipped');
console.log('booking-reminder: off-hours, sent 0 and recorded skipped');
