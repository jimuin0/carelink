import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stagingEnv, SYNTHETIC_ORIGIN } from './staging-env.mjs';

test('staging ignores inherited production credentials and notification settings', () => {
  const result = stagingEnv({ NEXT_PUBLIC_SUPABASE_URL: 'https://production.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'production-test-sentinel', RESEND_API_KEY: 'notification-test-sentinel' });
  assert.equal(result.NEXT_PUBLIC_SUPABASE_URL, SYNTHETIC_ORIGIN);
  assert.equal(result.SUPABASE_SERVICE_ROLE_KEY, 'synthetic-staging-service');
  assert.equal(Object.hasOwn(result, 'RESEND_API_KEY'), false);
});

test('hosted databases and disguised non-origin inputs are rejected', () => {
  for (const value of ['https://production.invalid', 'https://synthetic.invalid.attacker.invalid',
    'https://synthetic.invalid/path', 'https://user:password@synthetic.invalid',
    'https://synthetic.invalid/?key=value', 'https://synthetic.invalid/#fragment',
    'http://127.0.0.1:9999', 'http://127.0.0.1:54321@attacker.invalid',
    'http://user:password@127.0.0.1:54321', 'http://127.0.0.1:54321/path',
    'http://127.0.0.1:54321/?query=value', 'http://127.0.0.1:54321/#fragment']) {
    assert.throws(() => stagingEnv({ CARELINK_STAGING_DB_URL: value, CI: 'true' }));
  }
});

test('local database writes are available only in isolated CI', () => {
  assert.throws(() => stagingEnv({ CARELINK_STAGING_DB_URL: 'http://127.0.0.1:54321' }));
  assert.throws(() => stagingEnv({ CI: 'true', CARELINK_STAGING_DB_URL: 'http://127.0.0.1:54321' }));
  assert.throws(() => stagingEnv({ CI: 'true', CARELINK_STAGING_DB_URL: 'http://127.0.0.1:54321', CARELINK_STAGING_ANON_KEY: 'local-anon' }));
  const result = stagingEnv({ CI: 'true', CARELINK_STAGING_DB_URL: 'http://127.0.0.1:54321',
    CARELINK_STAGING_ANON_KEY: 'local-anon', CARELINK_STAGING_SERVICE_ROLE_KEY: 'local-service' });
  assert.equal(result.SUPABASE_SERVICE_ROLE_KEY, 'local-service');
  assert.equal(result.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'local-anon');
});

test('native CI inherits only its disposable database credentials', () => {
  const result = stagingEnv({ CI: 'true', GITHUB_ACTIONS: 'true', NEXT_PUBLIC_SUPABASE_URL: 'https://localhost:54330',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-anon', SUPABASE_SERVICE_ROLE_KEY: 'local-service', ADMIN_COOKIE_SECRET: 'local-cookie' });
  assert.equal(result.NEXT_PUBLIC_SUPABASE_URL, 'https://localhost:54330');
  assert.equal(result.ADMIN_COOKIE_SECRET, 'local-cookie');
  assert.equal(result.NEXT_PUBLIC_BASE_URL, 'https://localhost:3000');
  assert.throws(() => stagingEnv({ CI: 'true', GITHUB_ACTIONS: 'true', NEXT_PUBLIC_SUPABASE_URL: 'https://production.invalid' }));
});
