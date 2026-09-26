/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const script = join(__dirname, '../../scripts/start-ci-https.mjs');
const isolated = { CI: 'true', GITHUB_ACTIONS: 'true',
  PLAYWRIGHT_BASE_URL: 'https://localhost:3000', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  PATH: '/nonexistent-fixture-tools' };

test.each([
  { CI: '' }, { GITHUB_ACTIONS: '' }, { PLAYWRIGHT_BASE_URL: 'http://localhost:3000' },
  { PLAYWRIGHT_BASE_URL: 'https://production.invalid' },
  { NEXT_PUBLIC_SUPABASE_URL: 'https://production.invalid' },
  { NEXT_PUBLIC_SUPABASE_URL: 'http://localhost.production.invalid:54321' },
  { NEXT_PUBLIC_SUPABASE_URL: 'http://user@localhost:54321' },
])('HTTPS E2E server refuses an unapproved environment %#', overrides => {
  const result = spawnSync(process.execPath, [script], {
    env: { ...isolated, ...overrides }, encoding: 'utf8', timeout: 10000,
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('Isolated HTTPS E2E environment refused before application startup.\n');
});

test('approved CI proceeds beyond guard but fails closed without OpenSSL', () => {
  const result = spawnSync(process.execPath, [script], {
    env: isolated, encoding: 'utf8', timeout: 10000,
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('Isolated HTTPS E2E setup failed at certificate; no application was made public.\n');
});
