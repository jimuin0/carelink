/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

function run(script: string, args: string[], options: {at?: string; cutover?: string; fail?: string; mode?: string; render?: boolean} = {}) {
  const url = pathToFileURL(join(process.cwd(), 'scripts', script)).href;
  const program = `
    const RealDate = Date;
    const at = ${JSON.stringify(options.at || '2026-10-19T06:00:25Z')};
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [at])); }
    };
    process.argv = ['node', ${JSON.stringify(url)}, ...${JSON.stringify(args)}];
    const mode = ${JSON.stringify(options.mode)};
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      if (init.headers.Authorization !== 'Bearer synthetic-fixture-token') throw Error('bad auth');
      console.log('fixture request ' + url + ' timeout=' + (init.signal instanceof AbortSignal));
      if (url.endsWith('/' + ${JSON.stringify(options.fail || 'never')})) {
        if (mode === 'network') throw Error('sensitive-fixture-body');
        return new Response('sensitive-fixture-body', {status: 503});
      }
      await new Promise(resolve => setTimeout(resolve, 5));
      console.log('fixture finished ' + url);
      return new Response('sensitive-fixture-body', {status: 200});
    };
    await import(${JSON.stringify(url)});
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    encoding: 'utf8', timeout: 10000,
    env: {
      CARELINK_BASE_URL: 'https://carelink.example.invalid', CRON_SECRET: 'synthetic-fixture-token',
      CARELINK_CRON_DISPATCH_FROM: options.cutover ?? '2026-10-19T05:52:00Z',
      RENDER_SERVICE_ID: options.render ? 'synthetic-render-id' : '',
    },
  });
}

test('real dispatcher starts all due peers, preserves auth, and does not log response content', () => {
  const r = run('cron-dispatch.mjs', ['quarter-hour']);
  expect(r.error).toBeUndefined();
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('fixture finished https://carelink.example.invalid/api/cron/webhook-retry');
  expect(r.stdout).toContain('fixture finished https://carelink.example.invalid/api/cron/flag-reviews');
  expect(r.stdout).toContain('timeout=true');
  expect(r.stdout + r.stderr).not.toContain('sensitive-fixture-body');
  expect(r.stdout + r.stderr).not.toContain('synthetic-fixture-token');
});
test.each(['http', 'network'])('%s failure cannot stop or mask a successful peer', mode => {
  const r = run('cron-dispatch.mjs', ['quarter-hour'], {fail: 'webhook-retry', mode});
  expect(r.status).toBe(1);
  expect(r.stdout).toContain('flag-reviews 成功: HTTP 200');
  expect(r.stdout + r.stderr).not.toContain('sensitive-fixture-body');
});
test('dry run and empty calendar tick perform zero requests', () => {
  for (const args of [['quarter-hour', '--dry-run'], ['calendar']]) {
    const r = run('cron-dispatch.mjs', args, {at: args[0] === 'calendar' ? '2026-10-19T05:25:20Z' : '2026-10-19T06:00:20Z'});
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('fixture request');
  }
});
test('preparation is safe even when new tick includes a different legacy job', () => {
  const r = run('cron-dispatch.mjs', ['hourly'], {at: '2026-10-19T06:50:20Z', cutover: ''});
  expect(r.status).toBe(0);
  expect(r.stdout).toContain('jobs=none');
  expect(r.stdout).not.toContain('fixture request');
});
test('bad configuration fails without making a request', () => {
  for (const [args, cutover] of [[['no-such-group'], ''], [['quarter-hour'], 'invalid']] as [string[], string][]) {
    const r = run('cron-dispatch.mjs', args, {cutover});
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain('fixture request');
  }
});
test('retired Render jobs cannot issue duplicate calls after cutover; independent heartbeat still runs', () => {
  const retired = run('cron-call.mjs', ['flag-reviews'], {render: true});
  expect(retired.status).toBe(0);
  expect(retired.stdout).toContain('legacy invocation skipped');
  expect(retired.stdout).not.toContain('fixture request');
  const heartbeat = run('cron-call.mjs', ['cron-heartbeat'], {render: true});
  expect(heartbeat.status).toBe(0);
  expect(heartbeat.stdout).toContain('cron-heartbeat 成功: HTTP 200');
});
test('legacy preparation and explicit non-Render manual invocation remain operational', () => {
  const before = run('cron-call.mjs', ['flag-reviews'], {render: true, cutover: ''});
  const manual = run('cron-call.mjs', ['flag-reviews']);
  expect(before.status).toBe(0);
  expect(manual.status).toBe(0);
  expect(before.stdout).toContain('fixture request');
  expect(manual.stdout).toContain('fixture request');
});
test('legacy executable reports HTTP errors, unknown job names and missing arguments as failures', () => {
  expect(run('cron-call.mjs', ['flag-reviews'], {fail: 'flag-reviews'}).status).toBe(1);
  expect(run('cron-call.mjs', ['unknown']).status).toBe(1);
  expect(run('cron-call.mjs', []).status).toBe(1);
});

test('a delayed legacy weekly job is not lost across a wall-clock cutover', () => {
  const options = {render: true, at: '2026-10-18T22:13:00Z', cutover: '2026-10-18T22:12:00Z'};
  const legacy = run('cron-call.mjs', ['weekly-report'], options);
  const dispatcher = run('cron-dispatch.mjs', ['calendar'], options);
  expect(legacy.status).toBe(0);
  expect(legacy.stdout).toContain('weekly-report 成功: HTTP 200');
  expect(dispatcher.status).toBe(0);
  expect(dispatcher.stdout).not.toContain('fixture request');
});
