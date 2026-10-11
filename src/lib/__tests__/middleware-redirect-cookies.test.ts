/**
 * middleware.ts のリダイレクト時セッション Cookie 継承（AUTH-1）と
 * facility_members 取得エラー時の非キャッシュ fail-closed（AUTH-2）の挙動テスト。
 *
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * AUTH-1: getUser() がトークンを更新すると supabaseResponse に新 Cookie が載る。
 *   redirect（/auth/login→/mypage 等）でこれをコピーしないと次リクエストで強制ログアウトされる。
 * AUTH-2: facility_members クエリが一時的 DB エラーを返したとき、hasAccess=false を 5 分
 *   キャッシュせず、この request のみ503へfail-closedする（拒否と障害を区別）。
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

let getUserImpl: (opts: { cookies: { setAll: (c: unknown[]) => void } }) => Promise<{ data: { user: unknown }; error?: unknown }>;
let membershipResult: { data: unknown; error: unknown };
let profileResult: { data: unknown; error: unknown };
const mockMembershipLookup = jest.fn();
let mockThrowAt: string | null = null;

jest.mock('next/server', () => ({
  NextResponse: {
    next: () => makeResponse(),
    redirect: (url: unknown) => {
      const r = makeResponse();
      r._isRedirect = true;
      r._redirectedTo = url;
      return r;
    },
    json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) => ({
      ...makeResponse(), body, status: init?.status ?? 200, headers: new Headers(init?.headers),
    }),
  },
}));

jest.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: (c: unknown[]) => void } }) => {
    if (mockThrowAt === 'init') throw new Error('synthetic-private-value');
    return ({
    auth: { getUser: () => getUserImpl(opts) },
    from: (table: string) => {
      if (mockThrowAt === table) throw new Error('synthetic-private-value');
      return table === 'profiles' ? ({
      select: () => ({ eq: () => ({ single: async () => {
        if (mockThrowAt === 'profiles-await') throw new Error('synthetic-private-value');
        return profileResult;
      } }) }),
    }) : ({
      select: () => ({
        eq: () => ({
          in: () => ({
            limit: () => ({
              maybeSingle: async () => {
                mockMembershipLookup();
                if (mockThrowAt === 'facility_members-await') throw new Error('synthetic-private-value');
                return membershipResult;
              },
            }),
          }),
        }),
      }),
    });
    },
  });
  },
}));

import { middleware, signCacheValue, getMembershipCacheKey } from '../../middleware';
import { AuthRetryableFetchError, AuthSessionMissingError } from '@supabase/supabase-js';

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
  mockThrowAt = null;
  mockMembershipLookup.mockClear();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  process.env.ADMIN_COOKIE_SECRET = 'test-secret';
  // 既定：getUser はトークン更新（setAll で Cookie を書く）してユーザーを返す
  getUserImpl = async (opts) => {
    opts.cookies.setAll([{ name: 'sb-refresh-token', value: 'refreshed', options: { path: '/' } }]);
    return { data: { user: { id: 'u1' } } };
  };
  membershipResult = { data: { role: 'owner' }, error: null };
  profileResult = { data: { is_platform_admin: false }, error: null };
});

test.each(['/admin', '/admin/onboarding', '/admin/inquiries', '/mypage'])(
  'returned Auth outage fails closed without logout/role lookup: %s', async path => {
    const log = jest.spyOn(console, 'error').mockImplementation();
    getUserImpl = async opts => {
      opts.cookies.setAll([{ name: 'sb-refresh-token', value: 'refreshed', options: { path: '/' } }]);
      return { data: { user: null }, error: new AuthRetryableFetchError('synthetic-private-value', 503) };
    };
    const res: Record<string, unknown> = await middleware(makeRequest(path));
    expect(res.status).toBe(503);
    expect(res._isRedirect).toBeUndefined();
    expect((res.headers as Headers).get('cache-control')).toBe('no-store');
    expect((res.headers as Headers).get('content-security-policy')).toContain('nonce-');
    expect((res.cookies as ReturnType<typeof cookieStore>).getAll())
      .toEqual([expect.objectContaining({ name: 'sb-refresh-token', value: 'refreshed' })]);
    expect(mockMembershipLookup).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('[middleware] AUTH_UNAVAILABLE');
    expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-private-value');
    log.mockRestore();
  });
test.each(['/auth/login', '/auth/signup'])('Auth outage retains public form and refreshed cookies: %s', async path => {
  const log = jest.spyOn(console, 'error').mockImplementation();
  getUserImpl = async opts => {
    opts.cookies.setAll([{ name: 'sb-refresh-token', value: 'refreshed' }]);
    return { data: { user: null }, error: new AuthRetryableFetchError('private', 503) };
  };
  const res = await middleware(makeRequest(path));
  expect(res.status).toBeUndefined();expect(res._isRedirect).toBeUndefined();
  expect((res.headers as Headers).get('content-security-policy')).toContain('nonce-');
  expect((res.cookies as ReturnType<typeof cookieStore>).getAll()).toEqual([expect.objectContaining({ value: 'refreshed' })]);
  expect(mockMembershipLookup).not.toHaveBeenCalled();log.mockRestore();
});
test.each(['/auth/login', '/auth/signup', '/admin'])('timeout freezes response/cookies and grants no late access: %s', async path => {
  jest.useFakeTimers();const log = jest.spyOn(console, 'error').mockImplementation();
  try {
    let finish!: () => void;
    getUserImpl = opts => new Promise(resolve => {
      opts.cookies.setAll([{ name: 'sb-refresh-token', value: 'before-deadline' }]);
      finish = () => {
        opts.cookies.setAll([{ name: 'sb-refresh-token', value: 'late-replacement' }]);
        resolve({ data: { user: { id: 'late-user' } } });
      };
    });
    const request = makeRequest(path), pending = middleware(request);
    await jest.advanceTimersByTimeAsync(5000);
    const res = await pending;
    expect(res.status).toBe(path === '/admin' ? 503 : undefined);
    expect(res._isRedirect).toBeUndefined();
    expect((res.headers as Headers).get('content-security-policy')).toContain('nonce-');
    finish();await Promise.resolve();
    expect((res.cookies as ReturnType<typeof cookieStore>).get('sb-refresh-token')?.value).toBe('before-deadline');
    expect(request.cookies.get('sb-refresh-token')?.value).toBe('before-deadline');
    expect(mockMembershipLookup).not.toHaveBeenCalled();
  } finally { log.mockRestore();jest.useRealTimers(); }
});
test('a cookie callback at the deadline cannot change the response before the timeout continuation',async()=>{
  jest.useFakeTimers();const log=jest.spyOn(console,'error').mockImplementation();
  try {
    getUserImpl=opts=>new Promise(resolve=>{setTimeout(()=>{
      opts.cookies.setAll([{name:'sb-refresh-token',value:'at-deadline'}]);
      resolve({data:{user:{id:'too-late'}}});
    },5000);});
    const pending=middleware(makeRequest('/admin'));
    await jest.advanceTimersByTimeAsync(5000);const res=await pending;
    expect(res.status).toBe(503);expect(res._isRedirect).toBeUndefined();
    expect((res.cookies as ReturnType<typeof cookieStore>).getAll()).toEqual([]);
    expect(mockMembershipLookup).not.toHaveBeenCalled();
  }finally{log.mockRestore();jest.useRealTimers();}
});
test.each(['/auth/login','/auth/signup'])('client init outage still renders a public auth form with CSP: %s',async path=>{
  mockThrowAt='init';const res=await middleware(makeRequest(path));
  expect(res.status).toBeUndefined();expect(res._isRedirect).toBeUndefined();
  expect((res.headers as Headers).get('content-security-policy')).toContain('nonce-');
});
test('thrown Auth failure is 503; public registration does not contact Auth', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation();
  const auth = jest.fn(async () => { throw new Error('synthetic-private-value'); });
  getUserImpl = auth;
  expect((await middleware(makeRequest('/mypage'))).status).toBe(503);
  auth.mockClear();
  expect((await middleware(makeRequest('/register'))).status).toBeUndefined();
  expect(auth).not.toHaveBeenCalled();
  log.mockRestore();
});
test('genuine missing session keeps protected login redirect and anonymous login form', async () => {
  getUserImpl = async () => ({ data: { user: null }, error: new AuthSessionMissingError() });
  const protectedRes: Record<string, unknown> = await middleware(makeRequest('/mypage'));
  expect((protectedRes._redirectedTo as URL).pathname).toBe('/auth/login');
  expect((await middleware(makeRequest('/auth/login')))._isRedirect).toBeUndefined();
});

test('AUTH-1: /auth/login のログイン済みリダイレクトが更新済みセッション Cookie を継承する', async () => {
  const res: Record<string, unknown> = await middleware(makeRequest('/auth/login'));
  expect(res._isRedirect).toBe(true);
  expect((res._redirectedTo as URL).pathname).toBe('/mypage');
  const cookies = (res.cookies as ReturnType<typeof cookieStore>).getAll();
  // トークン更新で書かれた sb-refresh-token が redirect 応答にも載っていること（脱落しない）
  expect(cookies.find((c) => c.name === 'sb-refresh-token')?.value).toBe('refreshed');
});

test('AUTH-2: facility_members が DB エラー時は否定結果をキャッシュせず503へ fail-closed', async () => {
  membershipResult = { data: null, error: { message: 'db down' } };
  const res: Record<string, unknown> = await middleware(makeRequest('/admin'));
  expect(res.status).toBe(503);
  expect(res._isRedirect).toBeUndefined();
  // メンバーシップ否定（_cm_mbr_*）は 5 分キャッシュされていないこと
  const cookies = (res.cookies as ReturnType<typeof cookieStore>).getAll();
  expect(cookies.some((c) => c.name.startsWith('_cm_mbr_'))).toBe(false);
});

test('AUTH-2 対照: facility_members 取得成功（owner）なら /admin を通す', async () => {
  const res: Record<string, unknown> = await middleware(makeRequest('/admin'));
  // owner なので redirect せずレスポンスを返す（_isRedirect は付かない）
  expect(res._isRedirect).toBeUndefined();
});

test.each(['/admin/inquiries', '/admin/registrations'])('platform-only operator can access support: %s', async path => {
  membershipResult = { data: null, error: null };
  profileResult = { data: { is_platform_admin: true }, error: null };
  const res: Record<string, unknown> = await middleware(makeRequest(path));
  expect(res._isRedirect).toBeUndefined();
  const cookies = (res.cookies as ReturnType<typeof cookieStore>).getAll();
  expect(cookies.some(c => c.name.startsWith('_cm_mbr_'))).toBe(false);
  expect(cookies.find(c => c.name === 'sb-refresh-token')?.value).toBe('refreshed');
});

test.each([false, null, 'true'])('support privilege requires literal true, not %s', async value => {
  membershipResult = { data: null, error: null };
  profileResult = { data: { is_platform_admin: value }, error: null };
  const res: Record<string, unknown> = await middleware(makeRequest('/admin/inquiries'));
  expect(res._isRedirect).toBe(true);
  expect((res._redirectedTo as URL).pathname).toBe('/mypage');
});

test('support role lookup failure is not cached or treated as success', async () => {
  profileResult = { data: { is_platform_admin: true }, error: { message: 'unavailable' } };
  const res: Record<string, unknown> = await middleware(makeRequest('/admin/inquiries'));
  expect(res.status).toBe(503);
});

test.each(['/admin', '/admin/settings', '/admin/inquiries-evil'])('platform-only role cannot enter facility pages: %s', async path => {
  membershipResult = { data: null, error: null };
  profileResult = { data: { is_platform_admin: true }, error: null };
  const res: Record<string, unknown> = await middleware(makeRequest(path));
  expect(res._isRedirect).toBe(true);
});

test('unauthenticated support request still requires login', async () => {
  getUserImpl = async () => ({ data: { user: null } });
  profileResult = { data: { is_platform_admin: true }, error: null };
  const res: Record<string, unknown> = await middleware(makeRequest('/admin/inquiries'));
  expect((res._redirectedTo as URL).pathname).toBe('/auth/login');
});

test('signed negative membership cache cannot lock out a verified operator', async () => {
  profileResult = { data: { is_platform_admin: true }, error: null };
  const signed = await signCacheValue('u1', '0');
  const res: Record<string, unknown> = await middleware(makeRequest('/admin/inquiries', {
    [getMembershipCacheKey('u1')]: signed!,
  }));
  expect(res._isRedirect).toBeUndefined();
});

test('new owner bypasses a still-valid negative hint after lost setup headers', async () => {
  const signed = await signCacheValue('u1', '0');
  const res: Record<string, unknown> = await middleware(makeRequest('/admin', {
    [getMembershipCacheKey('u1')]: signed!,
  }));
  expect(mockMembershipLookup).toHaveBeenCalledTimes(1);
  expect(res._isRedirect).toBeUndefined();
  expect((res.cookies as ReturnType<typeof cookieStore>).get(getMembershipCacheKey('u1'))?.value.startsWith('1.')).toBe(true);
});

test('late pre-creation negative response cannot revoke a now-confirmed owner', async () => {
  membershipResult = { data: null, error: null };
  const denied: Record<string, unknown> = await middleware(makeRequest('/admin'));
  expect((denied._redirectedTo as URL).pathname).toBe('/mypage');
  const lateHint = (denied.cookies as ReturnType<typeof cookieStore>).get(getMembershipCacheKey('u1'))!;
  expect(lateHint.value.startsWith('0.')).toBe(true);
  membershipResult = { data: { role: 'owner' }, error: null };
  mockMembershipLookup.mockClear();
  const res: Record<string, unknown> = await middleware(makeRequest('/admin', { [lateHint.name]: lateHint.value }));
  expect(mockMembershipLookup).toHaveBeenCalledTimes(1);
  expect(res._isRedirect).toBeUndefined();
});

test.each(['absent', 'unavailable'])('negative hint still denies when current membership is %s', async state => {
  const signed = await signCacheValue('u1', '0');
  membershipResult = { data: null, error: state === 'unavailable' ? { message: 'db unavailable' } : null };
  const res: Record<string, unknown> = await middleware(makeRequest('/admin', { [getMembershipCacheKey('u1')]: signed! }));
  expect(mockMembershipLookup).toHaveBeenCalledTimes(1);
  if (state === 'absent') expect((res._redirectedTo as URL).pathname).toBe('/mypage');
  else {
    expect(res.status).toBe(503);
    expect(res._isRedirect).toBeUndefined();
  }
  expect((res.cookies as ReturnType<typeof cookieStore>).get('sb-refresh-token')?.value).toBe('refreshed');
  if (state === 'unavailable') {
    expect((res.cookies as ReturnType<typeof cookieStore>).get(getMembershipCacheKey('u1'))).toBeUndefined();
  }
});

test.each(['profiles', 'facility_members'])('%s returned/data+error/build/await failures cannot grant or cache a denial', async table => {
  const path = table === 'profiles' ? '/admin/inquiries' : '/admin/settings?facility_id=synthetic-id';
  const result = table === 'profiles' ? profileResult : membershipResult;
  for (const failure of ['returned', 'data+error', 'build', 'await']) {
    result.data = failure === 'data+error' ? { is_platform_admin: true, role: 'owner' } : null;
    result.error = failure === 'returned' || failure === 'data+error' ? { message: 'synthetic-private-value' } : null;
    mockThrowAt = failure === 'build' ? table : failure === 'await' ? `${table}-await` : null;
    const res: Record<string, unknown> = await middleware(makeRequest(path));
    expect(res.status).toBe(503);
    expect(res._isRedirect).toBeUndefined();
    expect((res.headers as Headers).get('location')).toBeNull();
    expect((res.headers as Headers).get('cache-control')).toBe('no-store');
    expect((res.headers as Headers).get('content-security-policy')).toContain('nonce-');
    expect((res.cookies as ReturnType<typeof cookieStore>).getAll())
      .toEqual([expect.objectContaining({ name: 'sb-refresh-token', value: 'refreshed' })]);
    expect(JSON.stringify(res.body)).not.toContain('synthetic-private-value');
  }
});

test('client initialization failure is no-store503 with CSP; public pages still skip initialization', async () => {
  mockThrowAt = 'init';
  const res: Record<string, unknown> = await middleware(makeRequest('/mypage'));
  expect(res.status).toBe(503);
  expect(res._isRedirect).toBeUndefined();
  expect((res.headers as Headers).get('cache-control')).toBe('no-store');
  expect((res.headers as Headers).get('content-security-policy')).toContain('nonce-');
  expect(mockMembershipLookup).not.toHaveBeenCalled();
  expect((await middleware(makeRequest('/register'))).status).toBeUndefined();
});

test.each(['expired', 'tampered'])('untrusted %s membership hint cannot hide a dependency failure', async type => {
  const signed = await signCacheValue('u1', '1', type === 'expired' ? Math.floor(Date.now() / 1000) - 301 : undefined);
  // Use a different valid hex digit. Non-hex aliases (e.g. 0x vs 00) can
  // decode to the same byte and make a malformed test time-dependent.
  const value = type === 'tampered' ? `${signed!.slice(0, -1)}${signed!.endsWith('0') ? '1' : '0'}` : signed!;
  if (type === 'tampered') expect(value).not.toBe(signed);
  membershipResult = { data: { role: 'owner' }, error: { message: 'synthetic-private-value' } };
  const res: Record<string, unknown> = await middleware(makeRequest('/admin', { [getMembershipCacheKey('u1')]: value }));
  expect(mockMembershipLookup).toHaveBeenCalledTimes(1);
  expect(res.status).toBe(503);
  expect(res._isRedirect).toBeUndefined();
  expect((res.cookies as ReturnType<typeof cookieStore>).get(getMembershipCacheKey('u1'))).toBeUndefined();
});

test('valid positive cache keeps its existing bounded optimization', async () => {
  const signed = await signCacheValue('u1', '1');
  membershipResult = { data: null, error: { message: 'should not be queried for valid positive hint' } };
  const res: Record<string, unknown> = await middleware(makeRequest('/admin', { [getMembershipCacheKey('u1')]: signed! }));
  expect(mockMembershipLookup).not.toHaveBeenCalled();
  expect(res._isRedirect).toBeUndefined();
});

test('revoked platform role is freshly checked and cannot rely on past support access', async () => {
  profileResult = { data: { is_platform_admin: true }, error: null };
  await middleware(makeRequest('/admin/inquiries'));
  membershipResult = { data: null, error: null };
  profileResult = { data: { is_platform_admin: false }, error: null };
  const res: Record<string, unknown> = await middleware(makeRequest('/admin/inquiries'));
  expect(res._isRedirect).toBe(true);
});
