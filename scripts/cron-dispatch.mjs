import { readFileSync } from 'node:fs';
import { cutoverTime, dispatchPlan } from '../src/lib/cron-dispatch.mjs';
import { callCron } from './cron-request.mjs';

async function main() {
  const jobs = JSON.parse(readFileSync(new URL('../src/lib/cron-jobs.data.json', import.meta.url), 'utf8'));
  const plan = dispatchPlan(process.argv[2], jobs, new Date(), cutoverTime(process.env.CARELINK_CRON_DISPATCH_FROM));
  console.log(`[cron-dispatch] ${process.argv[2]} slot=${plan.slot} jobs=${plan.jobs.join(',') || 'none'}`);
  if (process.argv.includes('--dry-run')) return;
  // Start every due job independently. One rejection must never prevent another
  // job from starting or finishing, and any rejection makes the Render run fail.
  const results = await Promise.allSettled(plan.jobs.map(name => callCron(name, jobs.map(job => job.name))));
  if (results.some(result => result.status === 'rejected')) {
    console.error('[cron-dispatch] One or more jobs failed (details withheld)');
    process.exitCode = 1;
  }
}

main().catch(() => {
  console.error('[cron-dispatch] Configuration or scheduling failure (details withheld)');
  process.exitCode = 1;
});
