/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/google-calendar
 * Key assertions:
 *   - GET: Rate limiting (20 req/min), auth required, connection status check
 *   - POST: CSRF check, rate limiting (10 req/min), auth required
 *   - POST disconnect: Delete token from database
 *   - POST auth flow: Generate OAuth URL with state parameter
 */

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/supabase-server-auth');
jest.mock('@/lib/supabase-server');
jest.mock('next/headers');
jest.mock('crypto', () => ({
  randomBytes: jest.fn(() => Buffer.alloc(32, 'a')),
}));

import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';
import { GET, POST } from '../route';

let mockGetUser: jest.Mock;
let mockTokenMaybeSingle: jest.Mock;
let mockDelete: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);

  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: { id: 'user-123', email: 'test@example.com' } },
  });

  mockTokenMaybeSingle = jest.fn().mockResolvedValue({
    data: {
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      scope: 'calendar.events calendar.readonly',
      updated_at: new Date().toISOString(),
    },
  });
  const mockTokenEq = jest.fn().mockReturnValue({ single: mockTokenMaybeSingle });
  const mockTokenSelect = jest.fn().mockReturnValue({ eq: mockTokenEq });

  mockDelete = jest.fn().mockResolvedValue({ error: null });
  const mockDeleteEq = jest.fn().mockResolvedValue({ error: null });
  mockDelete.mockReturnValue({ eq: mockDeleteEq });

  const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
  createServerSupabaseAuthClient.mockResolvedValue({
    auth: { getUser: mockGetUser },
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'google_calendar_tokens') {
        return {
          select: mockTokenSelect,
          delete: mockDelete,
        };
      }
    }),
  });

  const { cookies } = require('next/headers');
  cookies.mockResolvedValue({
    set: jest.fn(),
  });

  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.NEXT_PUBLIC_APP_URL = 'https://carelink-jp.com';
});

function makeGetRequest(ip = '192.168.1.1') {
  return new Request('http://localhost/api/google-calendar', {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
}

function makePostRequest(body: object, ip = '192.168.1.1') {
  return new Request('http://localhost/api/google-calendar', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('GET /api/google-calendar', () => {
  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);

    const res = await GET(makeGetRequest() as any);

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain('多すぎます');
  });

  test('unauthenticated user → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await GET(makeGetRequest() as any);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('Unauthorized');
  });

  test('not connected (no token) → 200 with connected=false', async () => {
    mockTokenMaybeSingle.mockResolvedValue({ data: null });

    const res = await GET(makeGetRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.connected).toBe(false);
  });

  test('connected (token exists, not expired) → 200 with details', async () => {
    const res = await GET(makeGetRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.connected).toBe(true);
    expect(json.isExpired).toBe(false);
    expect(json.updatedAt).toBeDefined();
  });

  test('connected but token expired → 200 with isExpired=true', async () => {
    mockTokenMaybeSingle.mockResolvedValue({
      data: {
        expires_at: new Date(Date.now() - 1000).toISOString(),
        scope: 'calendar.events',
        updated_at: new Date().toISOString(),
      },
    });

    const res = await GET(makeGetRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.connected).toBe(true);
    expect(json.isExpired).toBe(true);
  });

  test('rate limit params (20 req/min per IP)', () => {
    (checkRateLimit as jest.Mock).mockClear();
    (checkRateLimit as jest.Mock).mockReturnValue(false);

    GET(makeGetRequest('192.168.1.1') as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(20);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('google-calendar-get');
  });

  test('extracts last (trusted) IP from x-forwarded-for', () => {
    (checkRateLimit as jest.Mock).mockClear();
    (checkRateLimit as jest.Mock).mockReturnValue(false);

    GET(makeGetRequest('10.0.0.1, 192.168.1.1') as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  // Branch coverage: line 16 — x-forwarded-for ヘッダなし → 'unknown' にフォールバック
  test('x-forwarded-for ヘッダなし (GET) → IP が unknown にフォールバック', () => {
    (checkRateLimit as jest.Mock).mockClear();
    (checkRateLimit as jest.Mock).mockReturnValue(false);

    const req = new Request('http://localhost/api/google-calendar', { method: 'GET' });
    GET(req as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });
});

describe('POST /api/google-calendar', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF failed' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await POST(makePostRequest({}) as any);

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);

    const res = await POST(makePostRequest({}) as any);

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain('多すぎます');
  });

  test('unauthenticated user → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(makePostRequest({}) as any);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('Unauthorized');
  });

  test('Google Client ID not configured → 503', async () => {
    delete process.env.GOOGLE_CLIENT_ID;

    const res = await POST(makePostRequest({}) as any);

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toContain('not configured');
  });

  test('invalid JSON body handled gracefully', async () => {
    const req = new Request('http://localhost/api/google-calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.1' },
      body: 'invalid json {',
    });

    const res = await POST(req as any);

    // Should not return 4xx validation error, proceeds with flow
    expect(res.status).not.toBe(400);
  });

  test('rate limit params (10 req/min per IP)', () => {
    (checkRateLimit as jest.Mock).mockClear();
    (checkRateLimit as jest.Mock).mockReturnValue(false);

    POST(makePostRequest({}, '192.168.1.1') as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(10);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('google-calendar');
  });

  test('extracts last (trusted) IP from x-forwarded-for', () => {
    (checkRateLimit as jest.Mock).mockClear();
    (checkRateLimit as jest.Mock).mockReturnValue(false);

    POST(makePostRequest({}, '10.0.0.1, 192.168.1.1') as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  // Branch coverage: line 41 — x-forwarded-for ヘッダなし → 'unknown' にフォールバック
  test('x-forwarded-for ヘッダなし (POST) → IP が unknown にフォールバック', () => {
    (checkRateLimit as jest.Mock).mockClear();
    (checkRateLimit as jest.Mock).mockReturnValue(false);

    const req = new Request('http://localhost/api/google-calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    POST(req as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('POST requires CSRF token validation', () => {
    (checkCsrf as jest.Mock).mockClear();

    POST(makePostRequest({}) as any);

    expect(checkCsrf).toHaveBeenCalled();
  });

  test('disconnect action → deletes token and returns ok', async () => {
    const res = await POST(makePostRequest({ action: 'disconnect' }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mockDelete).toHaveBeenCalled();
  });

  test('disconnect action with DB error → 500', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn(() => ({
        delete: jest.fn().mockReturnValue({
          eq: jest.fn().mockResolvedValue({ error: { message: 'DB error' } }),
        }),
      })),
    });

    const res = await POST(makePostRequest({ action: 'disconnect' }) as any);

    expect(res.status).toBe(500);
  });

  test('generates OAuth URL with authUrl field', async () => {
    const res = await POST(makePostRequest({}) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.authUrl).toContain('accounts.google.com');
    expect(json.authUrl).toContain('test-client-id');
  });

  test('OAuth URL includes required params (scope, access_type, response_type)', async () => {
    const res = await POST(makePostRequest({}) as any);

    const json = await res.json();
    const url = new URL(json.authUrl);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toContain('calendar');
  });

  test('OAuth URL state param encodes userId', async () => {
    const res = await POST(makePostRequest({}) as any);

    const json = await res.json();
    const url = new URL(json.authUrl);
    const stateRaw = url.searchParams.get('state')!;
    const decoded = JSON.parse(Buffer.from(stateRaw, 'base64url').toString());
    expect(decoded.userId).toBe('user-123');
    expect(decoded.nonce).toBeDefined();
  });

  test('OAuth URL sets google_oauth_state cookie', async () => {
    const { cookies } = require('next/headers');
    const mockSet = jest.fn();
    cookies.mockResolvedValue({ set: mockSet });

    await POST(makePostRequest({}) as any);

    expect(mockSet).toHaveBeenCalledWith(
      'google_oauth_state',
      expect.any(String),
      expect.objectContaining({ httpOnly: true, maxAge: 600 })
    );
  });
});
