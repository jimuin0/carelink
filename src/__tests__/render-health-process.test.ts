/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

// Exercise the real executable with all HTTP calls intercepted in the child.
// No inherited provider credentials or network requests enter this fixture.
function runHealth(mode: string, slack: boolean | 'shared-group' = false, opts: {at?: string; heartbeat?: 'ok' | 'fail' | 'network'} = {}) {
  const script = pathToFileURL(join(process.cwd(), 'scripts/health-check.mjs')).href;
  const program = `
    const fixtureMode = ${JSON.stringify(mode)};
    const heartbeatMode = ${JSON.stringify(opts.heartbeat || 'ok')};
    const RealDate = Date;
    const at = ${JSON.stringify(opts.at || '2026-10-19T06:02:20Z')};
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [at])); }
    };
    globalThis.fetch = async function (url) {
      if (url.endsWith('/api/cron/cron-heartbeat')) {
        if (arguments[1].headers.Authorization !== 'Bearer synthetic-cron-secret') throw new Error('bad auth');
        console.log('fixture heartbeat requested');
        if (heartbeatMode === 'network') throw new Error('sensitive-fixture-body');
        return new Response('sensitive-fixture-body', {status: heartbeatMode === 'fail' ? 503 : 200});
      }
      if (url.endsWith('/api/health')) {
        if (fixtureMode === 'network') throw new Error('fixture connection failed');
        if (fixtureMode === 'invalid') return new Response('invalid JSON');
        const status = fixtureMode === 'healthy' ? 'healthy' : 'degraded';
        return new Response(JSON.stringify({status}), {status: fixtureMode === 'http500' ? 500 : 200});
      }
      if (url === 'https://slack.com/api/chat.postMessage') {
        const { channel, text } = JSON.parse(arguments[1].body);
        console.log('fixture alert attempted to ' + channel + ': ' + text);
        return new Response(JSON.stringify({ok: true}));
      }
      throw new Error('unexpected fixture request');
    };
    await import(${JSON.stringify(script)});
  `;
  return spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    encoding: 'utf8', timeout: 10000,
    env: {
      CARELINK_BASE_URL: mode === 'missing' ? '' : 'https://carelink.example.invalid',
      CRON_SECRET: 'synthetic-cron-secret',
      SLACK_BOT_TOKEN: slack ? 'synthetic-fixture-token' : '',
      SLACK_DEFAULT_CHANNEL: slack === true ? 'synthetic-fixture-channel' : '',
      // render.yaml links the shared slack-gyomu-bot group, which names its channel this way.
      SLACK_ADMIN_CHANNEL_ID: slack === 'shared-group' ? 'synthetic-admin-channel' : '',
    },
  });
}

test('healthy response exits successfully without an alert', () => {
  const result = runHealth('healthy', true);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('healthy: HTTP 200 / status healthy');
  expect(result.stdout).not.toContain('fixture alert attempted');
});
test.each(['degraded', 'http500', 'invalid', 'network', 'missing'])(
  '%s cannot appear as a successful Render run when Slack is unset', mode => {
    const result = runHealth(mode);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
  },
);
test.each(['degraded', 'network'])('sending an alert does not turn %s into success', mode => {
  const result = runHealth(mode, true);
  expect(result.error).toBeUndefined();
  expect(result.stdout).toContain('fixture alert attempted to synthetic-fixture-channel: 【監視・基盤】🔴');
  expect(result.status).toBe(1);
});
test('the shared Slack group channel is used when SLACK_DEFAULT_CHANNEL is unset', () => {
  const result = runHealth('degraded', 'shared-group');
  expect(result.error).toBeUndefined();
  expect(result.stdout).toContain('fixture alert attempted to synthetic-admin-channel');
  expect(result.stderr).not.toContain('Slack 未設定');
  expect(result.status).toBe(1);
});
test('an explicit SLACK_DEFAULT_CHANNEL still wins', () => {
  const result = runHealth('degraded', true);
  expect(result.stdout).toContain('fixture alert attempted to synthetic-fixture-channel');
});

test('a non-heartbeat tick performs no heartbeat request', () => {
  const result = runHealth('healthy');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('jobs=none');
  expect(result.stdout).not.toContain('fixture heartbeat requested');
});
test('the heartbeat slot runs cron-heartbeat in the same service', () => {
  const result = runHealth('healthy', false, {at: '2026-10-19T06:37:25Z'});
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('jobs=cron-heartbeat');
  expect(result.stdout).toContain('cron-heartbeat 成功: HTTP 200');
});
test('the heartbeat still runs when the health probe fails, and both failures stay visible', () => {
  const unhealthy = runHealth('degraded', false, {at: '2026-10-19T06:07:25Z'});
  expect(unhealthy.stdout).toContain('cron-heartbeat 成功: HTTP 200');
  expect(unhealthy.status).toBe(1);
});
test.each(['fail', 'network'] as const)('heartbeat %s makes a healthy run fail without logging the body', heartbeat => {
  const result = runHealth('healthy', false, {at: '2026-10-19T06:07:25Z', heartbeat});
  expect(result.stdout).toContain('healthy: HTTP 200');
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).not.toContain('sensitive-fixture-body');
  expect(result.stdout + result.stderr).not.toContain('synthetic-cron-secret');
});
