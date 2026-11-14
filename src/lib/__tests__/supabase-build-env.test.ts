/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { hasSupabasePublicEnv } from '../supabase-build-env';

const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY };
// process.env へ undefined を代入すると文字列 'undefined'（真の値）になるので、元が未設定なら delete で戻す。
function restore(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY', value: string | undefined) {
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
}
afterEach(() => {
  restore('NEXT_PUBLIC_SUPABASE_URL', saved.url);
  restore('NEXT_PUBLIC_SUPABASE_ANON_KEY', saved.key);
});

test.each([
  ['https://example.supabase.co', 'anon', true],
  ['', 'anon', false],
  ['https://example.supabase.co', '', false],
  [undefined, undefined, false],
])('url=%p key=%p -> %p', (url, key, expected) => {
  if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  if (key === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = key;
  expect(hasSupabasePublicEnv()).toBe(expected);
});
