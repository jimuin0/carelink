import assert from 'node:assert/strict';
import test from 'node:test';
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
