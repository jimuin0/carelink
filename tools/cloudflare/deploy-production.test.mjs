import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGithubVariables, assertCommitSha } from './deploy-production.mjs';

test('the operator reads the same public values from the GitHub repository variables', () => {
  assert.deepEqual(parseGithubVariables(JSON.stringify([
    { name: 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: 'eyJ.a.b\n' },
    { name: 'CLOUDFLARE_ACCOUNT_ID', value: 'acct' },
    { name: 'NEXT_PUBLIC_GA_ID', value: '' },
  ])), { NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJ.a.b' });
});

test('an empty or malformed commit id stops the deploy', () => {
  assert.throws(() => assertCommitSha(''), /Not a commit id/);
  assert.throws(() => assertCommitSha('abc1234'), /Not a commit id/);
  assert.equal(assertCommitSha('a'.repeat(40)), 'a'.repeat(40));
});

test('in GitHub Actions only non-empty public variables are taken, trimmed', async () => {
  const { publicEnvFromProcess } = await import('./deploy-production.mjs');
  assert.deepEqual(publicEnvFromProcess({
    NEXT_PUBLIC_SUPABASE_URL: ' https://x.supabase.co\n',
    NEXT_PUBLIC_GA_ID: '',
    CLOUDFLARE_API_TOKEN: 'secret',
    SUPABASE_SERVICE_ROLE_KEY: 'secret',
    next_public_lower: 'x',
  }), { NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co' });
});

test('the Supabase public settings are required before building', async () => {
  const { missingPublicEnv } = await import('./deploy-production.mjs');
  assert.deepEqual(missingPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: 'u' }), ['NEXT_PUBLIC_SUPABASE_ANON_KEY']);
  assert.deepEqual(missingPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: 'u', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k' }), []);
});
