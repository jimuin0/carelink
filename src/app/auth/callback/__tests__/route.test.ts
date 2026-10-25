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
  // 戻り先の指定が無ければログイン画面にも付けない（ログイン後は /auth/landing が店舗オーナーを /admin へ振り分ける）
  ['code欠損', '', '/auth/login?error=callback_failed'],
  ['provider error', '?error=access_denied&redirect=/admin/onboarding', '/auth/login?error=callback_failed&redirect=%2Fadmin%2Fonboarding'],
])('%sは内部詳細を出さずloginへ案内する', async (_name, query, expectedLocation) => {
  const response = await GET(request(query));

  expect(response.headers.get('location')).toBe(expectedLocation);
  expect(createServerClient).not.toHaveBeenCalled();
});

test('安全な相対redirectを維持して、code交換成功後に遷移する', async () => {
  const response = await GET(request('?code=abc&redirect=/admin/onboarding'));

  expect(response.headers.get('location')).toBe('/admin/onboarding');
  expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
});

test('exchange例外とcookie保存失敗は成功遷移せず、同じlogin案内へ戻す', async () => {
  exchangeCodeForSession.mockRejectedValueOnce(new Error('network down'));
  const exchangeFailure = await GET(request('?code=abc&redirect=/admin/onboarding'));
  expect(exchangeFailure.headers.get('location')).toBe('/auth/login?error=callback_failed&redirect=%2Fadmin%2Fonboarding');

  (createServerClient as jest.Mock).mockImplementationOnce((_url, _key, options) => {
    options.cookies.setAll([{ name: 'sb-session', value: 'test-session', options: {} }]);
    return { auth: { exchangeCodeForSession: jest.fn().mockResolvedValue({ error: null }) } };
  });
  (cookies as jest.Mock).mockResolvedValueOnce({ getAll: cookieGetAll, set: () => { throw new Error('cookie write failed'); } });
  const cookieFailure = await GET(request('?code=abc&redirect=/admin/onboarding'));
  expect(cookieFailure.headers.get('location')).toBe('/auth/login?error=callback_failed&redirect=%2Fadmin%2Fonboarding');
});

test('外部redirectはmypageへ正規化する', async () => {
  const response = await GET(request('?code=abc&redirect=https://attacker.test'));
  expect(response.headers.get('location')).toBe('/mypage');
});

test('戻り先の指定が無い成功は /auth/landing へ（店舗オーナーを /mypage に固定しない）', async () => {
  const response = await GET(request('?code=abc'));
  expect(response.headers.get('location')).toBe('/auth/landing');
});

test('確認メールを別ブラウザで開いた失敗（PKCE verifier 無し）でも、申込の続きの戻り先を引き継ぐ', async () => {
  exchangeCodeForSession.mockResolvedValueOnce({ error: { code: 'bad_code_verifier' } });
  const response = await GET(request('?code=abc&redirect=%2Fadmin%2Fonboarding%3Fhandoff%3Dregistration'));
  const location = new URL(response.headers.get('location')!, 'https://carelink.test');
  expect(location.pathname).toBe('/auth/login');
  expect(location.searchParams.get('error')).toBe('callback_failed');
  expect(location.searchParams.get('redirect')).toBe('/admin/onboarding?handoff=registration');
});

test.each([false, true])('container origin never escapes in the callback redirect (exchange fails=%s)', async (fails) => {
  exchangeCodeForSession.mockResolvedValueOnce({ error: fails ? { code: 'bad_code_verifier' } : null });
  const response = await GET(new Request('http://0.0.0.0:3000/auth/callback?code=synthetic&redirect=%2Fregister%2Frecover', {
    headers: { host: 'carelink-jp.com', 'x-forwarded-host': 'attacker.invalid', 'x-forwarded-proto': 'https' },
  }));
  expect(response.status).toBe(307);
  expect(response.headers.get('location')).toBe(fails
    ? '/auth/login?error=callback_failed&redirect=%2Fregister%2Frecover'
    : '/register/recover');
});
