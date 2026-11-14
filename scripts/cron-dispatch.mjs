import { readFileSync } from 'node:fs';
import { cutoverTime, dispatchPlan, missedJobs, MissedSlotError } from '../src/lib/cron-dispatch.mjs';
import { callCron } from './cron-request.mjs';

async function main() {
  const jobs = JSON.parse(readFileSync(new URL('../src/lib/cron-jobs.data.json', import.meta.url), 'utf8'));
  const cutover = cutoverTime(process.env.CARELINK_CRON_DISPATCH_FROM);
  let plan;
  try {
    plan = dispatchPlan(process.argv[2], jobs, new Date(), cutover);
  } catch (error) {
    if (!(error instanceof MissedSlotError)) throw error;
    // Startup was later than the window: the slot's jobs did not run. Name
    // them so the failed Render run is an actionable alert, not a silent gap.
    const missed = missedJobs(process.argv[2], jobs, error.slot, cutover);
    console.error(`[cron-dispatch] MISSED ${process.argv[2]} slot=${error.slot.toISOString()} ` +
      `delay=${Math.round(error.delayMs / 1000)}s jobs=${missed.join(',') || 'none'}`);
    process.exitCode = 1;
    return;
  }
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
