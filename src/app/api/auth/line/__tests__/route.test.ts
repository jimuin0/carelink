/**
 * @jest-environment node
 *
 * Tests for GET /api/auth/line - LINE OAuth initialization
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
import { GET } from '../route';

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

describe('route is closed while LINE login is hidden (isLineLoginEnabled=false)', () => {
  test('channel ID set but LIFF unset (production state) → line_not_configured, no OAuth cookies', async () => {
    delete process.env.NEXT_PUBLIC_LIFF_ID;
    const res = await GET(makeRequest('?intent=signup&consent=' + LINE_SIGNUP_CONSENT_MARKER) as any);
    expect(res.headers.get('location')).toBe(`${PUBLIC_ORIGIN}/auth/login?error=line_not_configured`);
    expect(mockCookieSet).not.toHaveBeenCalled();
  });
});

describe('signup consent marker → httpOnly cookie with the OAuth state lifetime', () => {
  const consentCookie = () => mockCookieSet.mock.calls.find((call) => call[0] === LINE_SIGNUP_CONSENT_COOKIE);
  test('signup page marker for the current terms edition is stored', async () => {
    await GET(makeRequest(`?redirect=%2Fmypage&intent=signup&consent=${LINE_SIGNUP_CONSENT_MARKER}`) as any);
    expect(consentCookie()).toEqual([LINE_SIGNUP_CONSENT_COOKIE, LINE_SIGNUP_CONSENT_MARKER,
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' })]);
  });
  test.each([
    ['no marker (login page / copied link)', ''],
    ['intent only', '?intent=signup'],
    ['consent only', `?consent=${LINE_SIGNUP_CONSENT_MARKER}`],
    ['stale terms edition', '?intent=signup&consent=terms-0000000000000000000000000000000000000000000000000000000000000000'],
    ['wrong intent', `?intent=login&consent=${LINE_SIGNUP_CONSENT_MARKER}`],
  ])('%s → any stale consent cookie is cleared, never stored', async (_label, query) => {
    await GET(makeRequest(query) as any);
    expect(consentCookie()).toEqual([LINE_SIGNUP_CONSENT_COOKIE, '', expect.objectContaining({ httpOnly: true, maxAge: 0 })]);
  });
  test('link mode never stores signup consent even with the marker', async () => {
    mockLinkAuth().mockResolvedValue({auth:{getUser:jest.fn().mockResolvedValue({data:{user:{id:'actor'}},error:null})}});
    await GET(makeRequest(`?mode=link&intent=signup&consent=${LINE_SIGNUP_CONSENT_MARKER}`) as any);
    expect(consentCookie()).toEqual([LINE_SIGNUP_CONSENT_COOKIE, '', expect.objectContaining({ maxAge: 0 })]);
    expect(mockCookieSet).toHaveBeenCalledWith('line_oauth_link_actor','actor',expect.objectContaining({maxAge:600}));
  });
});
