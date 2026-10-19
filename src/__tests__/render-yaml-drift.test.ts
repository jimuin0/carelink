import { readFileSync } from 'fs';
import { join } from 'path';
import { CRON_JOBS } from '@/lib/cron-jobs';
import { DISPATCH_GROUPS } from '@/lib/cron-dispatch.mjs';

const yml = readFileSync(join(process.cwd(), 'render.yaml'), 'utf8');
const services = yml.split(/^ {2}- type: cron\s*$/m).slice(1).map(block => ({
  name: block.match(/^\s*name:\s*(\S+)/m)?.[1],
  schedule: block.match(/^\s*schedule:\s*"([^"]+)"/m)?.[1],
  start: block.match(/^\s*startCommand:\s*(.+)$/m)?.[1]?.trim(),
}));

test('five runners cover every business job exactly once with the canonical schedules intact', () => {
  expect(services).toHaveLength(5);
  const names = DISPATCH_GROUPS.flatMap((g: {jobs: string[]}) => g.jobs).concat('cron-heartbeat');
  expect(names.slice().sort()).toEqual(CRON_JOBS.map(j => j.name).sort());
  for (const group of DISPATCH_GROUPS) {
    expect(services.find(s => s.name === group.service)).toEqual({
      name: group.service, schedule: group.schedule, start: `node scripts/cron-dispatch.mjs ${group.name}`,
    });
  }
  expect(services.find(s => s.name === 'carelink-cron-heartbeat')).toEqual({
    name: 'carelink-cron-heartbeat', schedule: CRON_JOBS.find(j => j.name === 'cron-heartbeat')!.schedule,
    start: 'node scripts/cron-call.mjs cron-heartbeat',
  });
  expect(services.find(s => s.name === 'carelink-health-check')).toEqual({
    name: 'carelink-health-check', schedule: '*/5 * * * *', start: 'node scripts/health-check.mjs',
  });
});
