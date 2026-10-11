/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

// Exercise the real executable with all HTTP calls intercepted in the child.
// No inherited provider credentials or network requests enter this fixture.
function runHealth(mode: string, slack = false) {
  const script = pathToFileURL(join(process.cwd(), 'scripts/health-check.mjs')).href;
  const program = `
    globalThis.fetch = async (url) => {
      if (url.endsWith('/api/health')) {
        if (process.env.FIXTURE_MODE === 'network') throw new Error('fixture connection failed');
        if (process.env.FIXTURE_MODE === 'invalid') return new Response('invalid JSON');
        const status = process.env.FIXTURE_MODE === 'healthy' ? 'healthy' : 'degraded';
        return new Response(JSON.stringify({status}), {status: process.env.FIXTURE_MODE === 'http500' ? 500 : 200});
      }
      if (url === 'https://slack.com/api/chat.postMessage') {
        console.log('fixture alert attempted');
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
      FIXTURE_MODE: mode,
      SLACK_BOT_TOKEN: slack ? 'synthetic-fixture-token' : '',
      SLACK_DEFAULT_CHANNEL: slack ? 'synthetic-fixture-channel' : '',
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
  expect(result.stdout).toContain('fixture alert attempted');
  expect(result.status).toBe(1);
});
