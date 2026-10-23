/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * 「LINEで登録」は登録画面のフォーム（POST /api/auth/line）から始まり、ルートは 303 で LINE の
 * 認可画面へ送る（PR#793 レビュー P2：同意を URL ではなくフォーム送信で受け取るため）。
 * CSP の form-action はフォーム送信【後のリダイレクト先】にも適用されるので、登録画面の CSP が
 * LINE の認可オリジンを許可していないと、ボタンを押しても遷移がブラウザに止められる。
 * ここでは「ルートが実際に送る先（LINE_AUTHORIZE_URL）」と「登録画面に実際に返る CSP」を突き合わせる。
 */
import { LINE_AUTHORIZE_URL } from '../line-oauth';

jest.mock('next/server', () => ({
  NextResponse: {
    next: () => ({ cookies: { set: () => undefined, getAll: () => [] }, headers: new Headers() }),
    redirect: () => ({ cookies: { set: () => undefined, getAll: () => [] }, headers: new Headers() }),
    json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200, headers: new Headers() }),
  },
}));
jest.mock('@supabase/ssr', () => ({ createServerClient: () => { throw new Error('public pages must not create an auth client'); } }));

import { middleware } from '../../middleware';

function publicRequest(path: string) {
  const url = new URL('https://carelink-jp.com' + path) as URL & { clone: () => URL };
  url.clone = () => new URL(url.toString());
  return { nextUrl: url, headers: new Headers(), cookies: { get: () => undefined, getAll: () => [], set: () => undefined } } as never;
}

async function formAction(path: string): Promise<string[]> {
  const res = (await middleware(publicRequest(path))) as unknown as { headers: Headers };
  const csp = res.headers.get('content-security-policy')!;
  const directive = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('form-action '));
  return directive!.split(/\s+/).slice(1);
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
});

test('登録画面の form-action は自サイトと LINE の認可オリジンだけを許可する', async () => {
  expect(await formAction('/auth/signup')).toEqual(["'self'", new URL(LINE_AUTHORIZE_URL).origin]);
});

// 負の対照: 任意の外部オリジンへのフォーム送信は引き続き許可されない。
test('他の外部オリジンは form-action に含まれない', async () => {
  const allowed = await formAction('/auth/signup');
  expect(allowed).not.toContain('https:');
  expect(allowed).not.toContain('*');
  expect(allowed).not.toContain('https://evil.example');
});
