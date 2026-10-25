/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createServerClient } from '@supabase/ssr';
jest.mock('@supabase/ssr', () => ({ createServerClient: jest.fn() }));
jest.mock('next/server', () => ({ NextResponse: {
  next: () => ({ headers: new Headers() }),
  json: (body: unknown, init: ResponseInit) => ({ body, status: init.status, headers: new Headers(init.headers) }),
} }));
import { middleware } from '../../middleware';

function request(path: string, agent: string, method = 'GET') {
  return { nextUrl: new URL('https://carelink-jp.com' + path), method,
    headers: new Headers({ 'user-agent': agent }) } as never;
}

test('collection request is denied before auth, with no cached HTML or nonce-bearing content', async () => {
  const response = await middleware(request('/search?type=hair-salon', 'GoogleOther'));
  expect(response.status).toBe(403);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  expect(response.headers.get('x-robots-tag')).toBe('noindex');
  expect(createServerClient).not.toHaveBeenCalled();
});

test.each(['/privacy', '/robots.txt'])('Googlebot and policy reads keep nonce CSP: %s', async (path) => {
  const response = await middleware(request(path, path === '/robots.txt' ? 'GoogleOther' : 'Googlebot/2.1'));
  expect(response.headers.get('content-security-policy')).toContain("'nonce-");
  expect(createServerClient).not.toHaveBeenCalled();
});
