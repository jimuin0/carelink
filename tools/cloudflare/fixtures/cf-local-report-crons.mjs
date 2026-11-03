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
for (const table of ['facility_members', 'profiles', 'cron_report_sends', 'daily_revenue_summary']) {
  const r = await db.from(table).select('*', { count: 'exact', head: true }); assert.ifError(r.error);
  assert.equal(r.count, 0, `refusing report run with existing rows: ${table}`);
}
for (const name of ['daily-summary', 'weekly-report']) {
  const before = await db.from('cron_logs').select('id', { count: 'exact', head: true }).eq('job_name', name); assert.ifError(before.error);
  const response = await fetch(`http://127.0.0.1:18744/api/cron/${name}`, {
    headers: { authorization: 'Bearer local-synthetic-cron-secret-not-production' }, redirect: 'manual',
  });
  assert.equal(response.status, 200, `${name} failed`);
  const result = await response.json(); assert.equal(result.emailsSent, 0);
  const logs = await db.from('cron_logs').select('status').eq('job_name', name).order('started_at', { ascending: false });
  assert.ifError(logs.error); assert.equal(logs.data.length, before.count + 1); assert.equal(logs.data[0].status, 'success');
  const sends = await db.from('cron_report_sends').select('*', { count: 'exact', head: true }); assert.ifError(sends.error); assert.equal(sends.count, 0);
  console.log(`${name}: HTTP 200, no email sent and success log`);
}
