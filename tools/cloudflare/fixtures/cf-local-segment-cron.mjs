import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

// This destructive-by-design job may run only on a newly created,
// exclusively dedicated native stack. Never point it at another local database.
const statusFile = process.env.CARELINK_LOCAL_CRON_STACK_STATUS;
assert.ok(statusFile, 'dedicated stack status is required');
const saved = JSON.parse(readFileSync(statusFile, 'utf8'));
const root = realpathSync(saved.identity.project_root);
assert.equal(root, '/private/tmp/carelink-cf-cron-check-20261029');
assert.equal(saved.runtime, 'native');
const current = JSON.parse(execFileSync('npm', ['exec', '--yes', '--package=supabase@2.122.0', '--', 'supabase', 'stack', 'status', '--output-format', 'json'], {
  cwd: root, env: { PATH: process.env.PATH, HOME: process.env.HOME, SUPABASE_EXPERIMENTAL_STACK: '1' },
  encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
}));
assert.equal(current.identity.id, saved.identity.id);
assert.equal(current.readiness, 'ready');
assert.equal(current.env.API_URL, saved.env.API_URL);
const api = new URL(current.env.API_URL);
assert.equal(api.hostname, '127.0.0.1');
const db = createClient(api.href, current.env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
for (const table of ['bookings', 'customer_segments', 'cron_logs']) {
  const existing = await db.from(table).select('id', { count: 'exact', head: true });
  assert.ifError(existing.error); assert.equal(existing.count, 0, `dedicated stack is not empty: ${table}`);
}
// Fresh migration replay creates ten built-in sample facilities. Preserve them
// and prove their rows did not change; there are no old segment rows to delete.
const originalFacilities = await db.from('facility_profiles').select('*').order('id');
assert.ifError(originalFacilities.error); assert.equal(originalFacilities.data.length, 10);
assert.ok(originalFacilities.data.every(row => row.status === 'published'));
const suffix = randomUUID().slice(0, 8);
const facility = await db.from('facility_profiles').insert({ name: '分類検証の合成施設', slug: `cf-cron-${suffix}`,
  business_type: 'ヘアサロン', prefecture: '東京都', city: 'テスト市', address: 'テスト住所', status: 'published' }).select('id').single();
assert.ifError(facility.error);
const day = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const entries = ['10:00:00', '11:00:00'].map((start, index) => ({ facility_id: facility.data.id, booking_date: day,
  start_time: start, end_time: index ? '11:30:00' : '10:30:00', customer_name: '分類検証の合成利用者',
  email: `synthetic-${suffix}@example.invalid`, status: 'completed', total_price: 1000 }));
assert.ifError((await db.from('bookings').insert(entries)).error);
const before = await db.from('customer_segments').select('id', { count: 'exact', head: true });
assert.ifError(before.error); assert.equal(before.count, 0);
const response = await fetch('http://127.0.0.1:18744/api/cron/customer-segment', {
  headers: { authorization: 'Bearer local-synthetic-cron-secret-not-production' }, redirect: 'manual',
});
assert.equal(response.status, 200, 'local synthetic cron did not succeed');
const result = await response.json(); assert.equal(result.processed, 1);
const segment = await db.from('customer_segments').select('facility_id,segment,total_visits,total_spent')
  .eq('facility_id', facility.data.id).single();
assert.ifError(segment.error); assert.equal(segment.data.segment, 'regular');
assert.equal(segment.data.total_visits, 2); assert.equal(segment.data.total_spent, 2000);
const logs = await db.from('cron_logs').select('job_name,status,processed').eq('job_name', 'customer-segment');
assert.ifError(logs.error); assert.equal(logs.data.length, 1);
assert.equal(logs.data[0].status, 'success'); assert.equal(logs.data[0].processed, 1);
const originalAfter = await db.from('facility_profiles').select('*').in('id', originalFacilities.data.map(row => row.id)).order('id');
assert.ifError(originalAfter.error); assert.deepEqual(originalAfter.data, originalFacilities.data);
console.log('Synthetic customer-segment cron: 200; expected segment and success log persisted');
