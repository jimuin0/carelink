/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createServerClient } from '@supabase/ssr';
jest.mock('@supabase/ssr', () => ({ createServerClient: jest.fn(() => { throw new Error('auth client unavailable'); }) }));
const setCookie = jest.fn();
jest.mock('next/server', () => ({ NextResponse: {
  next: () => ({ headers: new Headers(), cookies: { getAll: () => [], set: setCookie } }),
  json: (body: unknown, init: ResponseInit) => ({ body, status: init.status, headers: new Headers(init.headers) }),
} }));
import { middleware } from '../../middleware';

const original = process.env;
afterEach(() => { process.env = original; jest.clearAllMocks(); });

function request(path: string, method = 'GET', cookieNames: string[] = []) {
  return { nextUrl: new URL('https://preview.example.test' + path), method,
    headers: new Headers({ 'user-agent': 'Mozilla/5.0' }),
    cookies: { getAll: () => cookieNames.map((name) => ({ name, value: 'v' })) } } as never;
}

function env(vercelEnv: string, key?: string) {
  process.env = { ...original, VERCEL_ENV: vercelEnv };
  if (key) process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

test.each([['/auth/login', 'GET'], ['/auth/signup', 'GET'], ['/auth/callback', 'GET'], ['/mypage', 'GET'], ['/admin', 'GET'], ['/search', 'POST']])(
  'public Preview refuses %s %s before production Auth is contacted', async (path, method) => {
    env('preview');
    const res = await middleware(request(path, method)) as Response;
    expect(res.status).toBe(403);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(createServerClient).not.toHaveBeenCalled();
  });

test('public Preview keeps public pages with the nonce CSP', async () => {
  env('preview');
  const res = await middleware(request('/search'));
  expect(res.headers.get('content-security-policy')).toContain("'nonce-");
  expect(createServerClient).not.toHaveBeenCalled();
});

test.each([['production', undefined], ['preview', 'isolated-preview-key']])(
  '%s still runs the normal login flow', async (vercelEnv, key) => {
    env(vercelEnv, key);
    await middleware(request('/auth/login'));
    expect(createServerClient).toHaveBeenCalled();
  });

const SESSION = ['sb-abcdefghijklmnopqrst-auth-token.0', 'sb-abcdefghijklmnopqrst-auth-token.1', 'cookie_consent'];

test('a session left on the public Preview is expired on public pages', async () => {
  env('preview');
  await middleware(request('/facility/example', 'GET', SESSION));
  expect(setCookie.mock.calls).toEqual([
    ['sb-abcdefghijklmnopqrst-auth-token.0', '', { maxAge: 0, path: '/' }],
    ['sb-abcdefghijklmnopqrst-auth-token.1', '', { maxAge: 0, path: '/' }],
  ]);
});

test('a session left on the public Preview is expired by the refusal too', async () => {
  env('preview');
  const res = await middleware(request('/mypage', 'GET', SESSION)) as Response;
  expect(res.headers.getSetCookie()).toHaveLength(2);
});

test('production keeps session cookies on public pages', async () => {
  env('production');
  await middleware(request('/facility/example', 'GET', SESSION));
  expect(setCookie).not.toHaveBeenCalled();
});
