import { readFileSync } from 'fs';
import { join } from 'path';
import { CRON_JOBS } from '@/lib/cron-jobs';
import { DISPATCH_GROUPS, MONITOR_RUNNER } from '@/lib/cron-dispatch.mjs';

const yml = readFileSync(join(process.cwd(), 'render.yaml'), 'utf8');
const services = yml.split(/^ {2}- type: cron\s*$/m).slice(1).map(block => ({
  name: block.match(/^\s*name:\s*(\S+)/m)?.[1],
  schedule: block.match(/^\s*schedule:\s*"([^"]+)"/m)?.[1],
  start: block.match(/^\s*startCommand:\s*(.+)$/m)?.[1]?.trim(),
}));

test('four runners cover every business job exactly once with the canonical schedules intact', () => {
  expect(services).toHaveLength(4);
  const names = DISPATCH_GROUPS.flatMap((g: {jobs: string[]}) => g.jobs).concat(MONITOR_RUNNER.jobs);
  expect(names.slice().sort()).toEqual(CRON_JOBS.map(j => j.name).sort());
  for (const group of DISPATCH_GROUPS) {
    expect(services.find(s => s.name === group.service)).toEqual({
      name: group.service, schedule: group.schedule, start: `node scripts/cron-dispatch.mjs ${group.name}`,
    });
  }
  // cron-heartbeat no longer has its own service; it runs inside the monitor service.
  expect(services.find(s => s.name === 'carelink-cron-heartbeat')).toBeUndefined();
  expect(services.find(s => s.name === MONITOR_RUNNER.service)).toEqual({
    name: 'carelink-health-check', schedule: MONITOR_RUNNER.schedule, start: 'node scripts/health-check.mjs',
  });
});
