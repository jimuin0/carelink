/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { hasSupabasePublicEnv, supabasePreconnectOrigin } from '../supabase-build-env';

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

// 監査 A199: preconnect は env から導出し、未設定の環境（Preview 等）では本番ホストへ張らない。
test.each([
  ['https://example.supabase.co/rest/v1', 'https://example.supabase.co'],
  ['http://127.0.0.1:54321', 'http://127.0.0.1:54321'],
  ['', null],
  [undefined, null],
  ['not a url', null],
  ['ftp://example.com', null],
])('preconnect url=%p -> %p', (url, expected) => {
  if (url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  expect(supabasePreconnectOrigin()).toBe(expected);
});
