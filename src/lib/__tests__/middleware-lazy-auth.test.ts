/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { NextRequest } from 'next/server';
import { middleware } from '@/middleware';

const mockLoadSdk = jest.fn();
jest.mock('@supabase/ssr', () => {
  mockLoadSdk();
  throw new Error('Synthetic auth SDK initialization failure');
});

beforeEach(() => mockLoadSdk.mockClear());

test('a public read retains nonce CSP without loading a broken cookie-auth SDK', async () => {
  const response = await middleware(new NextRequest('https://carelink.example.invalid/search'));
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Security-Policy')).toContain("'nonce-");
  expect(mockLoadSdk).not.toHaveBeenCalled();
});

test('a protected request fails closed when deferred auth initialization fails', async () => {
  const response = await middleware(new NextRequest('https://carelink.example.invalid/admin/settings'));
  expect(mockLoadSdk).toHaveBeenCalledTimes(1);
  expect(response.status).toBe(503);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(response.headers.get('set-cookie')).toBeNull();
  expect(response.headers.get('Content-Security-Policy')).toContain("'nonce-");
});

test('an unavailable auth SDK leaves the public login form reachable with CSP', async () => {
  const response = await middleware(new NextRequest('https://carelink.example.invalid/auth/login'));
  expect(mockLoadSdk).toHaveBeenCalledTimes(1);
  expect(response.status).toBe(200);
  expect(response.headers.get('Content-Security-Policy')).toContain("'nonce-");
  expect(response.headers.get('set-cookie')).toBeNull();
});
