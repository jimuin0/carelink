/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const script = join(__dirname, '../../scripts/run-ci-e2e.mjs');
const isolated = { CI: 'true', GITHUB_ACTIONS: 'true',
  PLAYWRIGHT_BASE_URL: 'https://localhost:3000', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  RUNNER_TEMP: '/tmp', PATH: '/nonexistent-fixture-tools' };

test.each([
  { CI: '' }, { GITHUB_ACTIONS: '' }, { RUNNER_TEMP: '' }, { RUNNER_TEMP: 'relative' },
  { PLAYWRIGHT_BASE_URL: 'http://localhost:3000' },
  { PLAYWRIGHT_BASE_URL: 'https://production.invalid' },
  { NEXT_PUBLIC_SUPABASE_URL: 'https://production.invalid' },
  { NEXT_PUBLIC_SUPABASE_URL: 'http://localhost.production.invalid:54321' },
  { NEXT_PUBLIC_SUPABASE_URL: 'http://user@127.0.0.1:54321' },
  { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54322' },
])('TLS dependency refuses unapproved inputs before starting a process/server %#', overrides => {
  const result = spawnSync(process.execPath, [script], {
    env: { ...isolated, ...overrides }, encoding: 'utf8', timeout: 10000,
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('Isolated TLS dependency environment refused before startup.\n');
});

test('approved isolated inputs reach certificate generation but do not expose its failure', () => {
  const result = spawnSync(process.execPath, [script], {
    env: isolated, encoding: 'utf8', timeout: 10000,
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('Isolated TLS dependency lifecycle failed at certificate.\n');
});
