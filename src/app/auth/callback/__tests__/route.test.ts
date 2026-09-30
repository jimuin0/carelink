/** @jest-environment node */
jest.mock('@supabase/ssr', () => ({ createServerClient: jest.fn() }));
jest.mock('next/headers', () => ({ cookies: jest.fn() }));

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { GET } from '../route';

const exchangeCodeForSession = jest.fn();
const cookieGetAll = jest.fn(() => []);
const cookieSet = jest.fn();

function request(query = '') {
  return new Request(`https://carelink.test/auth/callback${query}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  (cookies as jest.Mock).mockResolvedValue({ getAll: cookieGetAll, set: cookieSet });
  exchangeCodeForSession.mockResolvedValue({ error: null });
  (createServerClient as jest.Mock).mockImplementation((_url, _key, options) => {
    options.cookies.setAll([{ name: 'sb-session', value: 'test-session', options: {} }]);
    return { auth: { exchangeCodeForSession } };
  });
});

test.each([
  ['code欠損', '', 'https://carelink.test/auth/login?error=callback_failed&redirect=%2Fmypage'],
  ['provider error', '?error=access_denied&redirect=/admin/onboarding', 'https://carelink.test/auth/login?error=callback_failed&redirect=%2Fadmin%2Fonboarding'],
])('%sは内部詳細を出さずloginへ案内する', async (_name, query, expectedLocation) => {
  const response = await GET(request(query));

  expect(response.headers.get('location')).toBe(expectedLocation);
  expect(createServerClient).not.toHaveBeenCalled();
});

test('安全な相対redirectを維持して、code交換成功後に遷移する', async () => {
  const response = await GET(request('?code=abc&redirect=/admin/onboarding'));

  expect(response.headers.get('location')).toBe('https://carelink.test/admin/onboarding');
  expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
  expect(cookieSet).toHaveBeenCalledWith('sb-session', 'test-session', {});
});

test('code交換に成功しても外部redirectはmypageへ正規化する', async () => {
  const response = await GET(request('?code=abc&redirect=https://attacker.test'));

  expect(response.headers.get('location')).toBe('https://carelink.test/mypage');
});

test.each([
  ['literal backslash', encodeURIComponent('/\\evil.example')],
  ['control character', encodeURIComponent('/admin/\u0000onboarding')],
])('%sを含むredirectはcode交換成功時もmypageへ正規化する', async (_name, encodedRedirect) => {
  const response = await GET(request(`?code=abc&redirect=${encodedRedirect}`));

  expect(response.headers.get('location')).toBe('https://carelink.test/mypage');
});

test.each([
  ['exchange error', () => exchangeCodeForSession.mockResolvedValue({ error: { message: 'invalid code' } })],
  ['exchange exception', () => exchangeCodeForSession.mockRejectedValue(new Error('network failure'))],
  ['cookie save failure', () => cookieSet.mockImplementation(() => { throw new Error('read only'); })],
])('%sは安全なlogin案内へ正規化する', async (_name, arrange) => {
  arrange();
  const response = await GET(request('?code=abc&redirect=https://attacker.test'));

  expect(response.headers.get('location')).toBe('https://carelink.test/auth/login?error=callback_failed&redirect=%2Fmypage');
});
