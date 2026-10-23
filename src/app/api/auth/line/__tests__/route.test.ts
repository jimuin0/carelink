/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/auth/line - LINE OAuth initialization
 * Key assertions:
 *   - Rate limiting (20 req/min per IP)
 *   - Redirect parameter validation (security: must start with /)
 *   - NEXT_PUBLIC_LINE_CHANNEL_ID env check
 *   - State & redirect cookies (httpOnly, secure, sameSite, maxAge)
 *   - LINE OAuth URL generation
 *   - Error handling
 */

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('next/headers');
jest.mock('@/lib/supabase-server-auth',()=>({createServerSupabaseAuthClient:jest.fn()}));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });

import { checkRateLimit } from '@/lib/rate-limit';
import { LINE_SIGNUP_CONSENT_COOKIE, LINE_SIGNUP_CONSENT_MARKER } from '@/lib/line-oauth';
import { GET, POST } from '../route';

const ORIGINAL_ENV = { ...process.env };
afterAll(() => { process.env = ORIGINAL_ENV; });
const PUBLIC_ORIGIN = 'https://public.example.test';

let mockCookieSet: jest.Mock;

function setupDefaultMocks() {
  mockCookieSet = jest.fn();
  const { cookies } = require('next/headers');
  cookies.mockResolvedValue({
    set: mockCookieSet,
  });

  process.env.NEXT_PUBLIC_LINE_CHANNEL_ID = 'test-channel-id';
  // LINE ログインは LIFF（製品判断）とチャネル ID の両方が揃ったときだけ有効（line-availability.ts）。
  process.env.NEXT_PUBLIC_LIFF_ID = 'test-liff-id';
  process.env.NEXT_PUBLIC_BASE_URL = PUBLIC_ORIGIN;
  (process.env as Record<string, string>).NODE_ENV = 'production';
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  setupDefaultMocks();
});

function makeRequest(query: string = '', ip = '192.168.1.1') {
  const req = new Request(`http://localhost/api/auth/line${query}`, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
  Object.defineProperty(req, 'nextUrl', {
    value: new URL(req.url),
    writable: true,
  });
  return req;
}

describe('GET /api/auth/line', () => {
  test('rate limiting → 302 with error', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=too_many_requests');
  });

  test('missing NEXT_PUBLIC_LINE_CHANNEL_ID → 302 with error', async () => {
    delete process.env.NEXT_PUBLIC_LINE_CHANNEL_ID;

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=line_not_configured');
  });

  test('valid request → 302 redirect to LINE', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(307);
    const location = res.headers.get('location');
    expect(location).toContain('https://access.line.me/oauth2/v2.1/authorize');
    expect(location).toContain('client_id=test-channel-id');
    expect(location).toContain('response_type=code');
  });

  test('sets state cookie (httpOnly, secure, sameSite, 10min)', async () => {
    await GET(makeRequest() as any);

    const stateCookie = mockCookieSet.mock.calls.find(
      (call) => call[0] === 'line_oauth_state'
    );
    expect(stateCookie).toBeDefined();
    expect(stateCookie[2]).toEqual(
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 600,
        path: '/',
      })
    );
  });

  test('sets redirect cookie with default /mypage', async () => {
    await GET(makeRequest() as any);

    const redirectCookie = mockCookieSet.mock.calls.find(
      (call) => call[0] === 'line_oauth_redirect'
    );
    expect(redirectCookie).toBeDefined();
    expect(redirectCookie[1]).toBe('/mypage');
  });

  test('redirect parameter sanitization: valid path → accepted', async () => {
    await GET(makeRequest('?redirect=/mypage/favorite') as any);

    const redirectCookie = mockCookieSet.mock.calls.find(
      (call) => call[0] === 'line_oauth_redirect'
    );
    expect(redirectCookie[1]).toBe('/mypage/favorite');
  });

  test('redirect parameter sanitization: double slash → rejected to /mypage', async () => {
    await GET(makeRequest('?redirect=//evil.com') as any);

    const redirectCookie = mockCookieSet.mock.calls.find(
      (call) => call[0] === 'line_oauth_redirect'
    );
    expect(redirectCookie[1]).toBe('/mypage');
  });

  test('redirect parameter sanitization: no slash → rejected to /mypage', async () => {
    await GET(makeRequest('?redirect=evil.com') as any);

    const redirectCookie = mockCookieSet.mock.calls.find(
      (call) => call[0] === 'line_oauth_redirect'
    );
    expect(redirectCookie[1]).toBe('/mypage');
  });

  test('LINE auth URL includes scope: profile openid email', async () => {
    const res = await GET(makeRequest() as any);

    const location = res.headers.get('location')!;
    expect(location).toContain('scope=profile+openid+email');
  });

  test('LINE auth URL includes the configured public callback URL, not the request host', async () => {
    const res = await GET(makeRequest() as any);

    const location = new URL(res.headers.get('location')!);
    expect(location.searchParams.get('redirect_uri')).toBe(`${PUBLIC_ORIGIN}/api/auth/line/callback`);
  });

  test('state is unique UUID each request', async () => {
    await GET(makeRequest() as any);
    const state1 = mockCookieSet.mock.calls.find(
      (call) => call[0] === 'line_oauth_state'
    )?.[1];

    jest.clearAllMocks();
    setupDefaultMocks();

    await GET(makeRequest() as any);
    const state2 = mockCookieSet.mock.calls.find(
      (call) => call[0] === 'line_oauth_state'
    )?.[1];

    expect(state1).not.toBe(state2);
    expect(state1).toMatch(/^[0-9a-f-]{36}$/);
    expect(state2).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('rate limit params (20 req/min per IP)', () => {
    (checkRateLimit as jest.Mock).mockClear();

    GET(makeRequest('', '192.168.1.1') as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(20);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('line-auth');
  });

  test('extracts last (trusted) IP from x-forwarded-for', () => {
    (checkRateLimit as jest.Mock).mockClear();

    GET(makeRequest('', '10.0.0.1, 192.168.1.1') as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('uses unknown IP when x-forwarded-for missing', () => {
    (checkRateLimit as jest.Mock).mockClear();

    const req = new Request('http://localhost/api/auth/line', {
      method: 'GET',
    });
    Object.defineProperty(req, 'nextUrl', {
      value: new URL(req.url),
      writable: true,
    });

    GET(req as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('exception caught → 302 with error=line_unexpected', async () => {
    const { cookies } = require('next/headers');
    cookies.mockRejectedValue(new Error('Cookie error'));

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=line_unexpected');
  });

  test('NODE_ENV development → secure=false', async () => {
    jest.clearAllMocks();
    setupDefaultMocks();
    (process.env as Record<string, string>).NODE_ENV = 'development';

    await GET(makeRequest() as any);

    const stateCookie = mockCookieSet.mock.calls.find(
      (call) => call[0] === 'line_oauth_state'
    );
    expect(stateCookie[2].secure).toBe(false);
  });
});

const mockLinkAuth=()=>require('@/lib/supabase-server-auth').createServerSupabaseAuthClient;
describe('explicit verified-account LINE reconfirmation',()=>{
  test('same current Supabase account is stored in a protected short-lived state cookie',async()=>{
    mockLinkAuth().mockResolvedValue({auth:{getUser:jest.fn().mockResolvedValue({data:{user:{id:'actor'}},error:null})}});
    const res=await GET(makeRequest('?mode=link&redirect=%2Fmypage%2Fprofile') as any);
    expect(res.headers.get('location')).toContain('https://access.line.me/');
    expect(mockCookieSet).toHaveBeenCalledWith('line_oauth_link_actor','actor',expect.objectContaining({httpOnly:true,sameSite:'lax',maxAge:600}));
  });
  test.each([null,{id:'actor'}])('unavailable Auth data %p cannot start linking',async user=>{
    mockLinkAuth().mockResolvedValue({auth:{getUser:jest.fn().mockResolvedValue({data:{user},error:{status:503}})}});
    const res=await GET(makeRequest('?mode=link') as any);
    expect(res.headers.get('location')).toContain('line_auth_unavailable');expect(mockCookieSet).not.toHaveBeenCalled();
  });
  test('signed-out visitor must sign in before linking',async()=>{
    mockLinkAuth().mockResolvedValue({auth:{getUser:jest.fn().mockResolvedValue({data:{user:null},error:null})}});
    const res=await GET(makeRequest('?mode=link') as any);
    expect(res.headers.get('location')).toContain('/auth/login?redirect=');expect(mockCookieSet).not.toHaveBeenCalled();
  });
  test('normal LINE login removes a stale linking actor',async()=>{
    await GET(makeRequest() as any);expect(mockCookieSet).toHaveBeenCalledWith('line_oauth_link_actor','',expect.objectContaining({maxAge:0}));
  });
});

/**
 * 本番（Vercel）では request.url の origin が内部ホストになり、実際に
 * redirect_uri=https://0.0.0.0:3000/api/auth/line/callback で LINE へ送っていた（PR#792 レビュー）。
 */
function internalHostRequest(query = '') {
  return new Request(`https://0.0.0.0:3000/api/auth/line${query}`, { headers: { 'x-forwarded-for': '192.0.2.1' } });
}
describe('public origin (never request.url)', () => {
  test('internal request host is never sent to LINE as redirect_uri', async () => {
    const res = await GET(internalHostRequest() as any);
    const location = res.headers.get('location')!;
    expect(new URL(location).searchParams.get('redirect_uri')).toBe(`${PUBLIC_ORIGIN}/api/auth/line/callback`);
    expect(location).not.toContain('0.0.0.0');
  });
  test('unset NEXT_PUBLIC_BASE_URL falls back to the production apex (SITE_URL rules)', async () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    const res = await GET(internalHostRequest() as any);
    expect(new URL(res.headers.get('location')!).searchParams.get('redirect_uri')).toBe('https://carelink-jp.com/api/auth/line/callback');
  });
  test('local development keeps working with NEXT_PUBLIC_BASE_URL=http://localhost:3000', async () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'http://localhost:3000/';
    const res = await GET(internalHostRequest() as any);
    expect(new URL(res.headers.get('location')!).searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/line/callback');
  });
  test.each([
    ['rate limit', () => (checkRateLimit as jest.Mock).mockResolvedValue(true), 'too_many_requests'],
    ['not configured', () => { delete process.env.NEXT_PUBLIC_LINE_CHANNEL_ID; }, 'line_not_configured'],
    ['exception', () => require('next/headers').cookies.mockRejectedValue(new Error('x')), 'line_unexpected'],
  ])('%s error redirect stays on the public origin', async (_label, arrange, error) => {
    arrange();
    const res = await GET(internalHostRequest() as any);
    expect(res.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/auth/login?error=${error}`);
  });
});

/** 登録画面の「LINEで登録」フォームと同じ形の POST（同一オリジン＝CSRF 通過）。 */
function formPost(fields: Record<string, string> | null, headers: Record<string, string> = { origin: 'http://localhost', host: 'localhost' }) {
  return new Request('http://localhost/api/auth/line', {
    method: 'POST',
    headers: { 'x-forwarded-for': '192.0.2.10', ...headers, ...(fields ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: fields ? new URLSearchParams(fields).toString() : 'not a form',
  });
}
const consentCookie = () => mockCookieSet.mock.calls.find((call) => call[0] === LINE_SIGNUP_CONSENT_COOKIE);
const SIGNUP_FORM = { redirect: '/mypage/bookings', intent: 'signup', consent: 'agreed' };

describe('route is closed while LINE login is hidden (isLineLoginEnabled=false)', () => {
  test('GET: channel ID set but LIFF unset (production state) → line_not_configured, no OAuth cookies', async () => {
    delete process.env.NEXT_PUBLIC_LIFF_ID;
    const res = await GET(makeRequest('?intent=signup&consent=agreed') as any);
    expect(res.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/auth/login?error=line_not_configured`);
    expect(mockCookieSet).not.toHaveBeenCalled();
  });
  test('POST: the signup form is closed the same way (303, no OAuth cookies)', async () => {
    delete process.env.NEXT_PUBLIC_LIFF_ID;
    const res = await POST(formPost(SIGNUP_FORM));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/auth/login?error=line_not_configured`);
    expect(mockCookieSet).not.toHaveBeenCalled();
  });
});

/**
 * PR#793 レビュー P2: 同意マーカーは公開された定数なので、URL で受け取ると
 * `/api/auth/line?intent=signup&consent=<マーカー>` を直接開く・共有するだけで同意 Cookie が付いた。
 * GET は同意 Cookie を決して付けない（常に消す）。
 */
describe('GET never records signup consent (URLs can be forged and shared)', () => {
  test.each([
    ['the old public marker (the reported bypass)', `?redirect=%2Fmypage&intent=signup&consent=${LINE_SIGNUP_CONSENT_MARKER}`],
    ['the form value', '?intent=signup&consent=agreed'],
    ['no consent params (login page)', ''],
    ['intent only', '?intent=signup'],
  ])('%s → consent cookie is cleared, never stored', async (_label, query) => {
    const res = await GET(makeRequest(query) as any);
    expect(res.headers.get('location')).toContain('https://access.line.me/');
    expect(consentCookie()).toEqual([LINE_SIGNUP_CONSENT_COOKIE, '', expect.objectContaining({ httpOnly: true, maxAge: 0 })]);
    expect(mockCookieSet.mock.calls.some((call) => call[1] === LINE_SIGNUP_CONSENT_MARKER)).toBe(false);
  });
  test('link mode never stores signup consent even with the old marker', async () => {
    mockLinkAuth().mockResolvedValue({auth:{getUser:jest.fn().mockResolvedValue({data:{user:{id:'actor'}},error:null})}});
    await GET(makeRequest(`?mode=link&intent=signup&consent=${LINE_SIGNUP_CONSENT_MARKER}`) as any);
    expect(consentCookie()).toEqual([LINE_SIGNUP_CONSENT_COOKIE, '', expect.objectContaining({ maxAge: 0 })]);
    expect(mockCookieSet).toHaveBeenCalledWith('line_oauth_link_actor','actor',expect.objectContaining({maxAge:600}));
  });
});

describe('POST /api/auth/line (signup page form)', () => {
  test.each([
    ['no Origin/Referer', {}],
    ['cross-site Origin', { origin: 'https://evil.example', host: 'localhost' }],
  ])('CSRF: %s → 403 before rate limit, no cookies', async (_label, headers) => {
    const res = await POST(formPost(SIGNUP_FORM, headers as Record<string, string>));
    expect(res.status).toBe(403);
    expect(mockCookieSet).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  test('consent=agreed from the signup form stores the current terms edition server-side, then 303 to LINE', async () => {
    const res = await POST(formPost(SIGNUP_FORM));
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://access.line.me/oauth2/v2.1/authorize');
    expect(location.searchParams.get('redirect_uri')).toBe(`${PUBLIC_ORIGIN}/api/auth/line/callback`);
    expect(location.searchParams.get('state')).toBe(mockCookieSet.mock.calls.find((c) => c[0] === 'line_oauth_state')![1]);
    expect(consentCookie()).toEqual([LINE_SIGNUP_CONSENT_COOKIE, LINE_SIGNUP_CONSENT_MARKER,
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' })]);
    expect(mockCookieSet).toHaveBeenCalledWith('line_oauth_redirect', '/mypage/bookings', expect.anything());
    expect(mockCookieSet).toHaveBeenCalledWith('line_oauth_link_actor', '', expect.objectContaining({ maxAge: 0 }));
  });

  test.each([
    ['empty consent (checkbox not ticked)', { intent: 'signup', consent: '' }],
    ['no consent field', { intent: 'signup' }],
    ['wrong intent', { intent: 'login', consent: 'agreed' }],
    ['the old public marker is not the form value', { intent: 'signup', consent: LINE_SIGNUP_CONSENT_MARKER }],
  ])('%s → OAuth starts but consent is cleared', async (_label, fields) => {
    const res = await POST(formPost(fields as Record<string, string>));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('https://access.line.me/');
    expect(consentCookie()).toEqual([LINE_SIGNUP_CONSENT_COOKIE, '', expect.objectContaining({ maxAge: 0 })]);
  });

  test('mode=link is GET-only: a POSTed mode field never verifies or stores a linking actor', async () => {
    await POST(formPost({ ...SIGNUP_FORM, mode: 'link' }));
    expect(mockLinkAuth()).not.toHaveBeenCalled();
    expect(mockCookieSet).toHaveBeenCalledWith('line_oauth_link_actor', '', expect.objectContaining({ maxAge: 0 }));
  });

  test.each([
    ['//evil.com', '/mypage'],
    ['https://evil.com', '/mypage'],
    ['', '/mypage'],
  ])('redirect %p is sanitised to %p', async (raw, expected) => {
    await POST(formPost({ ...SIGNUP_FORM, redirect: raw }));
    expect(mockCookieSet).toHaveBeenCalledWith('line_oauth_redirect', expected, expect.anything());
  });

  test('unparseable body → treated as no consent and default redirect', async () => {
    const res = await POST(formPost(null));
    expect(res.status).toBe(303);
    expect(consentCookie()).toEqual([LINE_SIGNUP_CONSENT_COOKIE, '', expect.objectContaining({ maxAge: 0 })]);
    expect(mockCookieSet).toHaveBeenCalledWith('line_oauth_redirect', '/mypage', expect.anything());
  });

  test('a file in the consent field is not consent', async () => {
    const form = new FormData();
    form.set('intent', 'signup');
    form.set('consent', new Blob(['agreed']), 'agreed');
    const res = await POST(new Request('http://localhost/api/auth/line', { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' }, body: form }));
    expect(res.status).toBe(303);
    expect(consentCookie()).toEqual([LINE_SIGNUP_CONSENT_COOKIE, '', expect.objectContaining({ maxAge: 0 })]);
  });

  test('a file in the redirect field falls back to /mypage', async () => {
    const form = new FormData();
    form.set('redirect', new Blob(['/mypage/x']), 'r');
    await POST(new Request('http://localhost/api/auth/line', { method: 'POST', headers: { origin: 'http://localhost', host: 'localhost' }, body: form }));
    expect(mockCookieSet).toHaveBeenCalledWith('line_oauth_redirect', '/mypage', expect.anything());
  });

  test.each([
    ['rate limit', () => (checkRateLimit as jest.Mock).mockResolvedValue(true), 'too_many_requests'],
    ['exception', () => require('next/headers').cookies.mockRejectedValue(new Error('x')), 'line_unexpected'],
  ])('%s → 303 to the public login page (shares the GET rate-limit bucket)', async (_label, arrange, error) => {
    arrange();
    const res = await POST(formPost(SIGNUP_FORM));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/auth/login?error=${error}`);
    expect((checkRateLimit as jest.Mock).mock.calls[0]).toEqual([null, '192.0.2.10', 20, 60_000, 'line-auth']);
  });
});
