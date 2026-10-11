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
  const additive = readFileSync(join(process.cwd(), 'supabase/migrations/20260930075129_salon_photo_manifest.sql'), 'utf8');
  expect(additive).not.toMatch(/(?:INSERT INTO|UPDATE|ON)\s+storage\./i);
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261011054500_salon_signed_upload_cutover.sql'), 'utf8');
  expect(sql.match(/-- BEGIN SALON STORAGE RECONCILIATION/g)).toHaveLength(1);
  expect(sql.match(/-- END SALON STORAGE RECONCILIATION/g)).toHaveLength(1);
  expect(sql).toContain('AS allowed_mime(mime)');
  expect(sql).toContain('WHERE allowed_mime.mime IN');
  const code = readFileSync(script, 'utf8');
  expect(code).toContain('20261011054500_salon_signed_upload_cutover.sql');
  expect(code).toContain('20261011080147_salon_signed_upload_policy_guard.sql');
  expect(code).toContain('alternate-anonymous');
  expect(code).toContain('alternate-all');
  expect(code).toContain('nonliteral-bypass');
  expect(code).toContain('changed-known-policy');
  expect(code).toContain('changed-legacy-policy');
  expect(code).not.toContain('salon_legacy_authenticated_image_insert');
  expect(code).toContain("current_database() <> 'carelink_shadow'");
  expect(code).toContain('const expectRejected = (sql, expected, name)');
  expect(code).toContain('expectRejected(`${guard}INSERT INTO storage.buckets');
  expect(code).not.toContain('EXECUTE $migration$');
  expect(code).toContain('missing upgrade completion marker');
  expect(code).toContain("'bucket configuration preserved safely'");
  expect(code).toContain("'unrelated Storage policies unchanged'");
  expect(code).toContain("INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)");
  expect(code).toContain('expectRejected(`${guard}INSERT INTO storage.buckets');
  expect(code).toContain('ROLLBACK;');
  expect(code).not.toMatch(/\bCOMMIT;/);
  const ci = readFileSync(join(process.cwd(), '.github/workflows/schema-fingerprint.yml'), 'utf8');
  const upgrade = ci.indexOf('run: node scripts/check-salon-storage-upgrade.mjs');
  expect(upgrade).toBeGreaterThan(0);
  expect(upgrade).toBeLessThan(ci.indexOf('run: node scripts/check-salon-intent-concurrency.mjs'));
});
test('forward signed-upload cutover is replayed once by supabase start without the former deferred overlay', () => {
  const activeMigrations = readdirSync(join(process.cwd(), 'supabase/migrations'));
  expect(activeMigrations.filter(name => name.includes('salon_signed_upload_cutover'))).toEqual(['20261011054500_salon_signed_upload_cutover.sql']);
  const active = readFileSync(join(process.cwd(), 'supabase/migrations/20261011054500_salon_signed_upload_cutover.sql'), 'utf8');
  const frozen = readFileSync(join(process.cwd(), 'supabase/deferred-migrations/20260927000001_salon_signed_upload_cutover.sql'), 'utf8');
  const section = (sql: string) => sql.split('-- BEGIN SALON STORAGE RECONCILIATION\n')[1].split('-- END SALON STORAGE RECONCILIATION')[0];
  expect(section(active)).toBe(section(frozen));
  const validation = readFileSync(join(process.cwd(), 'supabase/migrations/20261011080147_salon_signed_upload_policy_guard.sql'), 'utf8');
  expect(validation).toContain("p.cmd IN ('INSERT','ALL')");
  expect(validation.indexOf('registration write policy set requires reconciliation')).toBeLessThan(validation.indexOf('DROP POLICY'));
  expect(validation).toContain("'with_check',p.with_check");
  expect(active).not.toMatch(/DELETE\s+FROM\s+storage\.objects/i);
  const workflow = readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
  const start = workflow.indexOf('run: supabase start');
  const e2e = workflow.indexOf('run: node scripts/run-ci-e2e.mjs');
  expect(start).toBeGreaterThanOrEqual(0);
  expect(e2e).toBeGreaterThan(start);
  expect(workflow).not.toContain('Apply deferred signed-upload cutover');
  expect(workflow).not.toContain('< supabase/deferred-migrations/20260927000001_salon_signed_upload_cutover.sql');
  expect(workflow).not.toContain('supabase db query --linked');
});
