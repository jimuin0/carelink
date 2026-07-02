/**
 * middleware.ts のリダイレクト時セッション Cookie 継承（AUTH-1）と
 * facility_members 取得エラー時の非キャッシュ fail-closed（AUTH-2）の挙動テスト。
 *
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * AUTH-1: getUser() がトークンを更新すると supabaseResponse に新 Cookie が載る。
 *   redirect（/auth/login→/mypage 等）でこれをコピーしないと次リクエストで強制ログアウトされる。
 * AUTH-2: facility_members クエリが一時的 DB エラーを返したとき、hasAccess=false を 5 分
 *   キャッシュせず、この request のみ /mypage へ fail-closed する（管理者の sticky lockout 防止）。
 */

// ---- fake NextResponse（cookies を実際に保持する）----
function cookieStore() {
  const m = new Map<string, { name: string; value: string; [k: string]: unknown }>();
  return {
    set: (a: unknown, b?: string, c?: object) => {
      if (a && typeof a === 'object') {
        const co = a as { name: string; value: string };
        m.set(co.name, { ...(a as object), name: co.name, value: co.value } as never);
      } else {
        m.set(a as string, { name: a as string, value: b as string, ...(c || {}) });
      }
    },
    getAll: () => [...m.values()],
    get: (k: string) => m.get(k),
  };
}
function makeResponse() {
  return { cookies: cookieStore(), headers: new Headers() } as Record<string, unknown>;
}

let getUserImpl: (opts: { cookies: { setAll: (c: unknown[]) => void } }) => Promise<{ data: { user: unknown } }>;
let membershipResult: { data: unknown; error: unknown };

jest.mock('next/server', () => ({
  NextResponse: {
    next: () => makeResponse(),
    redirect: (url: unknown) => {
      const r = makeResponse();
      r._isRedirect = true;
      r._redirectedTo = url;
      return r;
    },
    json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }),
  },
}));

jest.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: (c: unknown[]) => void } }) => ({
    auth: { getUser: () => getUserImpl(opts) },
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => ({
            limit: () => ({
              maybeSingle: async () => membershipResult,
            }),
          }),
        }),
      }),
    }),
  }),
}));

import { middleware } from '../../middleware';

function makeNextUrl(path: string): URL & { clone: () => URL } {
  const u = new URL('https://carelink-jp.com' + path) as URL & { clone: () => URL };
  u.clone = () => makeNextUrl(path);
  return u;
}

function makeRequest(path: string, cookies: Record<string, string> = {}) {
  const cm = new Map(Object.entries(cookies).map(([k, v]) => [k, { name: k, value: v }]));
  return {
    nextUrl: makeNextUrl(path),
    headers: new Headers(),
    cookies: {
      get: (k: string) => cm.get(k),
      getAll: () => [...cm.values()],
      set: (k: string, v: string) => cm.set(k, { name: k, value: v }),
    },
  } as never;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.ADMIN_COOKIE_SECRET = 'test-secret';
  // 既定：getUser はトークン更新（setAll で Cookie を書く）してユーザーを返す
  getUserImpl = async (opts) => {
    opts.cookies.setAll([{ name: 'sb-refresh-token', value: 'refreshed', options: { path: '/' } }]);
    return { data: { user: { id: 'u1' } } };
  };
  membershipResult = { data: { role: 'owner' }, error: null };
});

test('AUTH-1: /auth/login のログイン済みリダイレクトが更新済みセッション Cookie を継承する', async () => {
  const res: Record<string, unknown> = await middleware(makeRequest('/auth/login'));
  expect(res._isRedirect).toBe(true);
  expect((res._redirectedTo as URL).pathname).toBe('/mypage');
  const cookies = (res.cookies as ReturnType<typeof cookieStore>).getAll();
  // トークン更新で書かれた sb-refresh-token が redirect 応答にも載っていること（脱落しない）
  expect(cookies.find((c) => c.name === 'sb-refresh-token')?.value).toBe('refreshed');
});

test('AUTH-2: facility_members が DB エラー時は否定結果をキャッシュせず /mypage へ fail-closed', async () => {
  membershipResult = { data: null, error: { message: 'db down' } };
  const res: Record<string, unknown> = await middleware(makeRequest('/admin'));
  expect(res._isRedirect).toBe(true);
  expect((res._redirectedTo as URL).pathname).toBe('/mypage');
  // メンバーシップ否定（_cm_mbr_*）は 5 分キャッシュされていないこと
  const cookies = (res.cookies as ReturnType<typeof cookieStore>).getAll();
  expect(cookies.some((c) => c.name.startsWith('_cm_mbr_'))).toBe(false);
});

test('AUTH-2 対照: facility_members 取得成功（owner）なら /admin を通す', async () => {
  const res: Record<string, unknown> = await middleware(makeRequest('/admin'));
  // owner なので redirect せずレスポンスを返す（_isRedirect は付かない）
  expect(res._isRedirect).toBeUndefined();
});
