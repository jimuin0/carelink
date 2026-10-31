import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
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
const db = createClient(current.env.API_URL, current.env.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
for (const table of ['facility_reviews', 'moderation_queue']) {
  const existing = await db.from(table).select('id', { count: 'exact', head: true });
  assert.ifError(existing.error); assert.equal(existing.count, 0, `dedicated test table is not empty: ${table}`);
}
const suffix = randomUUID().slice(0, 8);
const facility = await db.from('facility_profiles').insert(Array.from({ length: 3 }, (_, index) => ({ name: 'レビュー検証の合成施設', slug: `cf-review-${suffix}-${index}`,
  business_type: 'ヘアサロン', prefecture: '東京都', city: 'テスト市', address: 'テスト住所', status: 'draft' }))).select('id');
assert.ifError(facility.error); assert.equal(facility.data.length, 3);
const data = facility.data.map(row => ({ facility_id: row.id, reviewer_name: '合成レビュー',
  rating: 4, comment: '合成データ', reviewer_ip: '198.18.0.7', status: 'published' }));
const inserted = await db.from('facility_reviews').insert(data).select('id'); assert.ifError(inserted.error);
const ids = inserted.data.map(row => row.id); assert.equal(ids.length, 3);
const response = await fetch('http://127.0.0.1:18744/api/cron/flag-reviews', {
  headers: { authorization: 'Bearer local-synthetic-cron-secret-not-production' }, redirect: 'manual',
});
assert.equal(response.status, 200, 'local synthetic flag-reviews cron failed');
const result = await response.json(); assert.equal(result.processed, 3);
const reviews = await db.from('facility_reviews').select('id,is_flagged').in('id', ids);
assert.ifError(reviews.error); assert.equal(reviews.data.length, 3); assert.ok(reviews.data.every(row => row.is_flagged));
const queue = await db.from('moderation_queue').select('content_id,status').in('content_id', ids);
assert.ifError(queue.error); assert.equal(queue.data.length, 3); assert.ok(queue.data.every(row => row.status === 'pending'));
const logs = await db.from('cron_logs').select('job_name,status,processed').eq('job_name', 'flag-reviews');
assert.ifError(logs.error); assert.equal(logs.data.length, 1); assert.equal(logs.data[0].status, 'success'); assert.equal(logs.data[0].processed, 3);
console.log('Synthetic review cron: 200; three flagged reviews, three pending queue rows and success log');
