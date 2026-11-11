import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicEnv } from './deploy-production.mjs';

test('only public values are taken and the trailing newline from Vercel is removed', () => {
  const env = parsePublicEnv([
    'NEXT_PUBLIC_SUPABASE_ANON_KEY="eyJ.a.b\\n"',
    'NEXT_PUBLIC_SUPABASE_URL="https://x.supabase.co"',
    'SUPABASE_SERVICE_ROLE_KEY="secret\\n"',
    'NEXT_PUBLIC_PLAIN=value',
  ].join('\n'));
  assert.deepEqual(env, {
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'eyJ.a.b',
    NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
    NEXT_PUBLIC_PLAIN: 'value',
  });
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
