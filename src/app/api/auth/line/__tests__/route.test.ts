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
  inMemoryRateLimit: jest.fn(() => false),
}));
jest.mock('next/headers');
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });

import { inMemoryRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

let mockCookieSet: jest.Mock;

function setupDefaultMocks() {
  mockCookieSet = jest.fn();
  const { cookies } = require('next/headers');
  cookies.mockResolvedValue({
    set: mockCookieSet,
  });

  process.env.NEXT_PUBLIC_LINE_CHANNEL_ID = 'test-channel-id';
  process.env.NODE_ENV = 'production';
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
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
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

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

  test('LINE auth URL includes callback URL', async () => {
    const res = await GET(makeRequest() as any);

    const location = res.headers.get('location')!;
    expect(location).toContain(
      encodeURIComponent('http://localhost/api/auth/line/callback')
    );
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
    (inMemoryRateLimit as jest.Mock).mockClear();

    GET(makeRequest('', '192.168.1.1') as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('192.168.1.1');
    expect(call[1]).toBe(20);
    expect(call[2]).toBe(60_000);
    expect(call[3]).toBe('line-auth');
  });

  test('extracts first IP from x-forwarded-for', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    GET(makeRequest('', '10.0.0.1, 192.168.1.1') as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('10.0.0.1');
  });

  test('uses unknown IP when x-forwarded-for missing', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    const req = new Request('http://localhost/api/auth/line', {
      method: 'GET',
    });
    Object.defineProperty(req, 'nextUrl', {
      value: new URL(req.url),
      writable: true,
    });

    GET(req as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('unknown');
  });

  test('exception caught → 302 with error=line_unexpected', async () => {
    const { cookies } = require('next/headers');
    cookies.mockRejectedValue(new Error('Cookie error'));

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=line_unexpected');
  });

  test('NODE_ENV development → secure=false', async () => {
    process.env.NODE_ENV = 'development';
    jest.clearAllMocks();
    setupDefaultMocks();
    process.env.NODE_ENV = 'development';

    await GET(makeRequest() as any);

    const stateCookie = mockCookieSet.mock.calls.find(
      (call) => call[0] === 'line_oauth_state'
    );
    expect(stateCookie[2].secure).toBe(false);
  });
});
