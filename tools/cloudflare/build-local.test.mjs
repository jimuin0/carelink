import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./build-local.mjs', import.meta.url));

test('Worker config declares the cron secret binding used by cron authentication', () => {
  const config = JSON.parse(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.ok(config.secrets.required.includes('CRON_SECRET'));
});

test('Worker registration bindings exist and new registration stays disabled by default', () => {
  const config = JSON.parse(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_BASE_URL', 'THREADS_USER_ID']) {
    assert.equal(config.vars[key], '');
  }
  assert.equal(config.vars.NEXT_PUBLIC_REGISTRATION_AUTO_PUBLISH, 'false');
  assert.equal(config.vars.SALON_REGISTRATION_V2_ENABLED, 'false');
  assert.ok(config.secrets.required.includes('ADMIN_COOKIE_SECRET'));
});

test('restores Next route types after both successful and failed Worker builds', () => {
  const dir = mkdtempSync(join(tmpdir(), 'carelink-worker-build-test-'));
  try {
    for (const path of ['tools/cloudflare', 'node_modules/vite/bin', 'node_modules/next/dist/bin']) {
      mkdirSync(join(dir, path), { recursive: true });
    }
    writeFileSync(join(dir, 'tools/cloudflare/prepare-og-assets.mjs'), 'process.exit(Number(process.env.TEST_PREP_EXIT || 0))');
    writeFileSync(join(dir, 'node_modules/vite/bin/vite.js'), "require('node:fs').writeFileSync('phase', 'worker'); process.exit(Number(process.env.TEST_BUILD_EXIT || 0));");
    writeFileSync(join(dir, 'node_modules/next/dist/bin/next'), "require('node:fs').appendFileSync('phase', '-restored'); process.exit(Number(process.env.TEST_RESTORE_EXIT || 0));");
    for (const code of [0, 7]) {
      const result = spawnSync(process.execPath, [script], { cwd: dir, env: { ...process.env, TEST_BUILD_EXIT: String(code) }, encoding: 'utf8' });
      assert.equal(result.status, code);
      assert.equal(readFileSync(join(dir, 'phase'), 'utf8'), 'worker-restored');
    }
    const restoreFailed = spawnSync(process.execPath, [script], { cwd: dir, env: { ...process.env, TEST_RESTORE_EXIT: '9' }, encoding: 'utf8' });
    assert.equal(restoreFailed.status, 9);
    const prepFailed = spawnSync(process.execPath, [script], { cwd: dir, env: { ...process.env, TEST_PREP_EXIT: '5' }, encoding: 'utf8' });
    assert.equal(prepFailed.status, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
