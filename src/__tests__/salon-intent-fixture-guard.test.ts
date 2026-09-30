/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const script = join(__dirname, '../../scripts/check-salon-intent-concurrency.mjs');
// No PATH: even a broken guard cannot locate psql during this negative-only test.
const isolated = { CI: 'true', GITHUB_ACTIONS: 'true', PGHOST: 'localhost', PGPORT: '5432',
  PGUSER: 'postgres', PGPASSWORD: 'synthetic-fixture-only', PATH: '/nonexistent-fixture-tools' };
test.each([
  { CI: '' }, { GITHUB_ACTIONS: '' }, { PGHOST: 'production.invalid' },
  { PGHOST: 'localhost.production.invalid' }, { PGHOST: '' }, { PGPORT: '5433' },
  { PGUSER: 'other' }, { PGPASSWORD: '' }, { PGSERVICE: 'other' },
  { PGSERVICEFILE: '/other' }, { PGHOSTADDR: '192.0.2.1' },
])('registration concurrency refuses an unapproved environment %#', overrides => {
  const result = spawnSync(process.execPath, [script], { env: { ...isolated, ...overrides }, encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('Registration concurrency environment refused before database access.\n');
  expect(result.stderr).not.toContain(isolated.PGPASSWORD);
});

test('an approved environment reaches the distinct database failure path', () => {
  const result = spawnSync(process.execPath, [script], { env: isolated, encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('Registration concurrency contract failed; no production probe was authorized.\n');
});
