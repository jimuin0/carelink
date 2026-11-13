import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DISPATCH_GROUPS, MONITOR_RUNNER } from '../src/lib/cron-dispatch.mjs';

// Only the cron forms in the canonical registry are supported. Reject new forms
// until their JST calendar conversion is reviewed, preserving the last export.
export function jstSchedule(cron) {
  const [minute, hour, dom, month, dow, extra] = cron.split(' ');
  if (extra || dom !== '*' || month !== '*') throw new Error(`Unsupported cron: ${cron}`);
  if (hour === '*' && dow === '*') {
    if (/^\*\/[1-9]\d*$/.test(minute)) return `${minute.slice(2)}分ごと`;
    if (/^\d+(,\d+)*$/.test(minute) && minute.split(',').every((m) => Number(m) < 60)) {
      const ms = minute.split(',').map(Number);
      // A phase-shifted */N runner tick list (e.g. 2,7,…,57) is "every N minutes", so
      // consumers keep the N-minute freshness window. Short business lists such as 7,37
      // keep their exact minutes (three or more evenly spaced ticks are required).
      const step = ms[1] - ms[0];
      if (ms.length >= 3 && step > 0 && ms.length * step === 60 && ms.every((m, i) => m === ms[0] + i * step)) {
        return `${step}分ごと`;
      }
      return `毎時 ${ms.join('・')}分`;
    }
    throw new Error(`Unsupported cron: ${cron}`);
  }
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour) || Number(minute) > 59 || Number(hour) > 23) {
    throw new Error(`Unsupported cron: ${cron}`);
  }
  const hours = Number(hour) + 9;
  const time = `${hours % 24}:${minute.padStart(2, '0')}`;
  if (dow === '*') return `毎日 ${time}`;
  if (/^[0-6]$/.test(dow)) return `毎週${'日月火水木金土'[(Number(dow) + Math.floor(hours / 24)) % 7]} ${time}`;
  throw new Error(`Unsupported cron: ${cron}`);
}

export function exportSchedules(jobs, blueprint) {
  const blocks = blueprint.split(/^ {2}- type: cron\s*$/m).slice(1);
  const actual = new Map(blocks.map((block) => [
    block.match(/^\s*name:\s*(\S+)/m)?.[1],
    block.match(/^\s*schedule:\s*"([^"]+)"/m)?.[1],
  ]));
  const all = [...jobs, { name: 'health-check', label: '外形死活監視', schedule: actual.get('carelink-health-check') }];
  const expected = new Map(DISPATCH_GROUPS.map(group => [group.service, group.schedule]));
  expected.set(MONITOR_RUNNER.service, MONITOR_RUNNER.schedule);
  if (actual.size !== expected.size) throw new Error('Cron registry coverage mismatch');
  for (const [name, schedule] of expected) {
    if (actual.get(name) !== schedule) throw new Error(`Runner schedule mismatch: ${name}`);
  }
  const groupedNames = DISPATCH_GROUPS.flatMap(group => group.jobs);
  const names = [...groupedNames, ...MONITOR_RUNNER.jobs];
  if (new Set(names).size !== names.length || names.length !== jobs.length ||
      jobs.some(job => !names.includes(job.name))) throw new Error('Dispatch registry coverage mismatch');
  return all.map((job) => {
    const group = DISPATCH_GROUPS.find(group => group.jobs.includes(job.name));
    const service = group ? group.service : MONITOR_RUNNER.service;
    if (!job.schedule) throw new Error(`Cron registry mismatch: ${service}`);
    return { time: jstSchedule(job.schedule), desc: job.label, job_id: job.name,
      cron_services: [service], runner: `cron:${service}`, source: 'render_cron', cron_utc: job.schedule };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const jobs = JSON.parse(readFileSync(new URL('../src/lib/cron-jobs.data.json', import.meta.url), 'utf8'));
  const blueprint = readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');
  const output = `${JSON.stringify(exportSchedules(jobs, blueprint), null, 2)}\n`;
  const path = new URL('../schedules.json', import.meta.url);
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8') !== output) throw new Error('Run node scripts/export-admin-schedules.mjs');
  } else {
    writeFileSync(path, output);
  }
}
