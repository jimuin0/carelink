import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { jstSchedule, exportSchedules } from './export-admin-schedules.mjs';

test('JST midnight advances the weekly calendar day', () => {
  assert.equal(jstSchedule('0 15 * * 1'), '毎週火 0:00');
  assert.equal(jstSchedule('10 22 * * 0'), '毎週月 7:10');
  assert.equal(jstSchedule('25 5 * * 3'), '毎週水 14:25');
  assert.equal(jstSchedule('0 18 * * *'), '毎日 3:00');
});
test('frequent jobs retain exact minute offsets', () => {
  assert.equal(jstSchedule('7,37 * * * *'), '毎時 7・37分');
  assert.equal(jstSchedule('*/5 * * * *'), '5分ごと');
  assert.equal(jstSchedule('5 * * * *'), '毎時 5分');
});
test('unsupported or invalid calendar expressions fail before export', () => {
  for (const cron of ['0 0 1 * *', '60 1 * * *', '0 24 * * *', '0 1 * * 8', '* * * * *', '0 1 * * mon', '0 1 * * * extra']) {
    assert.throws(() => jstSchedule(cron));
  }
});
test('missing, extra or changed Blueprint service cannot silently become a schedule', () => {
  assert.throws(() => exportSchedules([], ''));
  assert.throws(() => exportSchedules([{name:'example', label:'Example', schedule:'0 0 * * *'}], ''));
  assert.throws(() => exportSchedules([], '  - type: cron\n    name: carelink-health-check\n'));
});

test('consolidated admin export preserves each business time and maps to the retained runner', () => {
  const jobs = JSON.parse(readFileSync(new URL('../src/lib/cron-jobs.data.json', import.meta.url)));
  const blueprint = readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');
  const result = exportSchedules(jobs, blueprint);
  assert.equal(result.length, 18);
  for (const job of jobs) {
    const row = result.find(r => r.job_id === job.name);
    assert.equal(row.cron_utc, job.schedule);
    assert.equal(row.time, jstSchedule(job.schedule));
  }
  assert.deepEqual(result.find(r => r.job_id === 'flag-reviews').cron_services, ['carelink-webhook-retry']);
  assert.deepEqual(result.find(r => r.job_id === 'threads-backfill').cron_services, ['carelink-booking-reminder']);
  assert.deepEqual(result.find(r => r.job_id === 'weekly-report').cron_services, ['carelink-daily-summary']);
  assert.throws(() => exportSchedules(jobs, blueprint.replace('5,50 * * * *', '5 * * * *')));
  assert.throws(() => exportSchedules(jobs.slice(1), blueprint));
  assert.throws(() => exportSchedules([...jobs, jobs[0]], blueprint));
});
