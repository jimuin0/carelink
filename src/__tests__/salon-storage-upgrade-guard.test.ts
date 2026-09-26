/** @jest-environment node */
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const script = join(__dirname, '../../scripts/check-salon-storage-upgrade.mjs');
const isolated = { CI: 'true', GITHUB_ACTIONS: 'true', PGHOST: 'localhost', PGPORT: '5432',
  PGUSER: 'postgres', PGPASSWORD: 'synthetic-fixture-only', PATH: '/nonexistent-fixture-tools' };
test.each([
  { CI: '' }, { GITHUB_ACTIONS: '' }, { PGHOST: 'production.invalid' },
  { PGHOST: 'localhost.production.invalid' }, { PGHOST: '' }, { PGPORT: '5433' },
  { PGUSER: 'other' }, { PGPASSWORD: '' }, { PGSERVICE: 'other' },
  { PGSERVICEFILE: '/other' }, { PGHOSTADDR: '192.0.2.1' },
])('storage upgrade refuses an unapproved environment before database access %#', overrides => {
  const result = spawnSync(process.execPath, [script], { env: { ...isolated, ...overrides }, encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe('Registration storage upgrade environment refused before database access.\n');
});
test('valid environment with no database tool is a distinct failure, never a passing rejection', () => {
  const result = spawnSync(process.execPath, [script], { env: isolated, encoding: 'utf8' });
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('Registration storage upgrade contract failed; no production repair was authorized.\n');
});
test('upgrade fixture executes the actual migration section and is wired before nonempty concurrency fixtures', () => {
  const additive = readFileSync(join(process.cwd(), 'supabase/migrations/20260926000003_salon_photo_manifest.sql'), 'utf8');
  expect(additive).not.toMatch(/(?:INSERT INTO|UPDATE|ON)\s+storage\./i);
  const sql = readFileSync(join(process.cwd(), 'supabase/deferred-migrations/20260927000001_salon_signed_upload_cutover.sql'), 'utf8');
  expect(sql.match(/-- BEGIN SALON STORAGE RECONCILIATION/g)).toHaveLength(1);
  expect(sql.match(/-- END SALON STORAGE RECONCILIATION/g)).toHaveLength(1);
  const code = readFileSync(script, 'utf8');
  expect(code).toContain('20260927000001_salon_signed_upload_cutover.sql');
  expect(code).not.toContain('salon_legacy_authenticated_image_insert');
  expect(code).toContain("current_database() <> 'carelink_shadow'");
  expect(code).toContain('const expectRejected = (sql, expected, name)');
  expect(code).toContain('expectRejected(`${guard}${setup}${mime}');
  expect(code).not.toContain('EXECUTE $migration$');
  expect(code).toContain('missing upgrade completion marker');
  expect(code).toContain("'bucket configuration preserved safely'");
  expect(code).toContain("'unrelated Storage policies unchanged'");
  expect(code).toContain('ROLLBACK;');
  expect(code).not.toMatch(/\bCOMMIT;/);
  const ci = readFileSync(join(process.cwd(), '.github/workflows/schema-fingerprint.yml'), 'utf8');
  const upgrade = ci.indexOf('run: node scripts/check-salon-storage-upgrade.mjs');
  expect(upgrade).toBeGreaterThan(0);
  expect(upgrade).toBeLessThan(ci.indexOf('run: node scripts/check-salon-intent-concurrency.mjs'));
});
test('signed-upload cutover stays out of production migration replay and is applied only to disposable local E2E', () => {
  const activeMigrations = readdirSync(join(process.cwd(), 'supabase/migrations'));
  expect(activeMigrations.filter(name => name.includes('salon_signed_upload_cutover'))).toEqual([]);
  const workflow = readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
  const start = workflow.indexOf('run: supabase start');
  const overlay = workflow.indexOf('docker exec -i "${db_containers[0]}" psql');
  const e2e = workflow.indexOf('run: node scripts/run-ci-e2e.mjs');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(overlay).toBeGreaterThan(start);
  expect(e2e).toBeGreaterThan(overlay);
  expect(workflow).toContain('Apply deferred signed-upload cutover to disposable local Supabase only');
  expect(workflow).toContain('label=com.supabase.cli.project=carelink');
  expect(workflow).toContain('label=com.docker.compose.project=carelink');
  expect(workflow).toContain('if [[ "${#db_containers[@]}" != "1" ]]');
  expect(workflow).toContain('< supabase/deferred-migrations/20260927000001_salon_signed_upload_cutover.sql');
  expect(workflow).not.toContain('supabase db query --linked');
});
