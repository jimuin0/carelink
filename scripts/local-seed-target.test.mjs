import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { requireDisposableSeedTarget } from './local-seed-target.mjs';

const local = 'http://127.0.0.1:54321';
const env = { NEXT_PUBLIC_SUPABASE_URL: local, CARELINK_DISPOSABLE_SUPABASE_URL: local };
test('requires disposable target acknowledgement and explicit execution flag', () => {
  assert.equal(requireDisposableSeedTarget(env, ['--local-test-data']), local);
  assert.throws(() => requireDisposableSeedTarget(env, []), /SEED_LOCAL_TARGET_REQUIRED/);
  assert.throws(() => requireDisposableSeedTarget({ ...env, CARELINK_DISPOSABLE_SUPABASE_URL: undefined }, ['--local-test-data']));
  assert.throws(() => requireDisposableSeedTarget(env, ['--local-test-data', '--force']));
});
test('rejects remote, ambiguous and credential-bearing destinations even when acknowledged', () => {
  for (const url of [undefined, 'invalid', 'https://example.supabase.co', 'http://127.0.0.1.example.com:54321',
    'http://192.168.1.1:54321', 'http://127.0.0.1:8080', 'https://localhost:54321',
    'http://user:password@localhost:54321', `${local}/rest/v1`, `${local}/?target=prod`, `${local}/#prod`]) {
    assert.throws(() => requireDisposableSeedTarget({ NEXT_PUBLIC_SUPABASE_URL: url, CARELINK_DISPOSABLE_SUPABASE_URL: url }, ['--local-test-data']));
  }
});
test('both actual entrypoints stop before a request with a production-shaped target', () => {
  for (const script of ['seed-facilities.mjs', 'cleanup-seed.mjs']) {
    const result = spawnSync(process.execPath, [new URL(script, import.meta.url).pathname, '--local-test-data'], {
      env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
        CARELINK_DISPOSABLE_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-key' }, encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /SEED_LOCAL_TARGET_REQUIRED/);
    assert.equal(result.stdout, '');
  }
});
