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
