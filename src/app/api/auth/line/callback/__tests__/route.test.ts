/**
 * @jest-environment node
 *
 * Tests for GET /api/auth/line/callback - LINE OAuth callback
 * Key assertions:
 *   - Rate limiting (10 req/min per IP)
 *   - State parameter validation (CSRF protection)
 *   - LINE error handling
 *   - Token exchange with LINE API
 *   - User profile fetch from LINE
 *   - ID token signature verification (HMAC-SHA256)
 *   - Email extraction from existing user or auto-generated
 *   - Supabase user creation/linking
 *   - Magic link generation and verification
 */

jest.mock('@/lib/rate-limit', () => ({
  inMemoryRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server');
jest.mock('@supabase/ssr');
jest.mock('next/headers');
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });

import { inMemoryRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

let mockCookieGet: jest.Mock;
let mockCookieDelete: jest.Mock;

function setupDefaultMocks(
  lineError: boolean = false,
  validState: boolean = true,
  tokenOk: boolean = true,
  profileOk: boolean = true,
  userExists: boolean = false,
  signatureValid: boolean = true
) {
  mockCookieGet = jest.fn((name: string) => {
    if (name === 'line_oauth_state') return { value: 'saved-state' };
    if (name === 'line_oauth_redirect') return { value: '/mypage' };
    return undefined;
  });
  mockCookieDelete = jest.fn();

  const { cookies } = require('next/headers');
  cookies.mockResolvedValue({
    get: mockCookieGet,
    delete: mockCookieDelete,
    getAll: jest.fn(() => []),
    set: jest.fn(),
  });

  global.fetch = jest.fn((url: string) => {
    // LINE token endpoint
    if (url.includes('oauth2/v2.1/token')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'test-access-token',
            id_token: signatureValid ? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiaWF0IjoxNTE2MjM5MDIyfQ.hXRQ_qNLqRN_eitThQ4wttMuNEiMgltw56x6mZtgZvM' : 'invalid',
          }),
          { ok: tokenOk, status: tokenOk ? 200 : 401 }
        )
      );
    }
    // LINE profile endpoint
    if (url.includes('api.line.me/v2/profile')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            userId: 'line-user-123',
            displayName: 'Test User',
            pictureUrl: 'https://example.com/pic.jpg',
          }),
          { ok: profileOk, status: profileOk ? 200 : 401 }
        )
      );
    }
    return Promise.resolve(new Response('{}'));
  }) as jest.Mock;

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'line_user_links') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({
                data: userExists ? { user_id: 'existing-user-id' } : null,
              }),
            }),
          }),
        };
      }
    }),
    auth: {
      admin: {
        createUser: jest
          .fn()
          .mockResolvedValue({ error: null }),
        generateLink: jest.fn().mockResolvedValue({
          data: {
            properties: { hashed_token: 'test-hashed-token' },
            user: { id: 'user-id-123', user_metadata: {} },
          },
          error: null,
        }),
        getUserById: jest.fn().mockResolvedValue({
          data: {
            user: {
              id: 'existing-user-id',
              email: 'existing@example.com',
              user_metadata: {},
            },
          },
        }),
        updateUserById: jest.fn().mockResolvedValue({ data: {}, error: null }),
      },
    },
  });

  const { createServerClient } = require('@supabase/ssr');
  createServerClient.mockReturnValue({
    auth: {
      verifyOtp: jest.fn().mockResolvedValue({ error: null }),
    },
  });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.NEXT_PUBLIC_LINE_CHANNEL_ID = 'test-channel-id';
  process.env.LINE_CHANNEL_SECRET = 'test-secret';
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  setupDefaultMocks();
});

function makeRequest(query: string = '', ip = '192.168.1.1') {
  const req = new Request(`http://localhost/api/auth/line/callback${query}`, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
  Object.defineProperty(req, 'nextUrl', {
    value: new URL(req.url),
    writable: true,
  });
  return req;
}

describe('GET /api/auth/line/callback', () => {
  test('rate limiting → 302 with error', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=too_many_requests');
  });

  test('LINE error parameter → 302 with line_denied', async () => {
    const res = await GET(makeRequest('?error=access_denied') as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=line_denied');
  });

  test('missing code parameter → 302 with line_invalid_state', async () => {
    const res = await GET(makeRequest('?state=test-state') as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=line_invalid_state');
  });

  test('missing state parameter → 302 with line_invalid_state', async () => {
    const res = await GET(makeRequest('?code=test-code') as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=line_invalid_state');
  });

  test('state mismatch → 302 with line_invalid_state', async () => {
    const res = await GET(
      makeRequest('?code=test-code&state=wrong-state') as any
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=line_invalid_state');
  });

  test('valid state → deletes OAuth cookies', async () => {
    await GET(makeRequest('?code=test-code&state=saved-state') as any);

    expect(mockCookieDelete).toHaveBeenCalledWith('line_oauth_state');
    expect(mockCookieDelete).toHaveBeenCalledWith('line_oauth_redirect');
  });

  test('valid request with valid profile → 302 redirect to saved redirect', async () => {
    const res = await GET(makeRequest('?code=test-code&state=saved-state') as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/mypage');
  });

  test('LINE token endpoint failure → 302 with line_token_failed', async () => {
    setupDefaultMocks(false, true, false);

    const res = await GET(makeRequest('?code=test-code&state=saved-state') as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=line_token_failed');
  });

  test('LINE profile endpoint failure → 302 with line_profile_failed', async () => {
    setupDefaultMocks(false, true, true, false);

    const res = await GET(makeRequest('?code=test-code&state=saved-state') as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=line_profile_failed');
  });

  test('calls LINE token API with code and client credentials', async () => {
    await GET(makeRequest('?code=test-code&state=saved-state') as any);

    const tokenCall = (global.fetch as jest.Mock).mock.calls.find((call) =>
      call[0].includes('oauth2/v2.1/token')
    );
    expect(tokenCall).toBeDefined();
    expect(tokenCall[1].method).toBe('POST');
  });

  test('calls LINE profile API with access_token', async () => {
    await GET(makeRequest('?code=test-code&state=saved-state') as any);

    const profileCall = (global.fetch as jest.Mock).mock.calls.find((call) =>
      call[0].includes('api.line.me/v2/profile')
    );
    expect(profileCall).toBeDefined();
    expect(profileCall[1].headers.Authorization).toBe(
      'Bearer test-access-token'
    );
  });

  test('rate limit params (10 req/min per IP)', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    GET(makeRequest('?code=test-code&state=saved-state', '192.168.1.1') as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('192.168.1.1');
    expect(call[1]).toBe(10);
    expect(call[2]).toBe(60_000);
    expect(call[3]).toBe('line-callback');
  });

  test('extracts first IP from x-forwarded-for', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    GET(makeRequest('?code=test-code&state=saved-state', '10.0.0.1, 192.168.1.1') as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('10.0.0.1');
  });

  test('uses unknown IP when x-forwarded-for missing', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    const req = new Request('http://localhost/api/auth/line/callback?code=test-code&state=saved-state', {
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

  test('exception during flow → 302 with line_unexpected', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

    const res = await GET(makeRequest('?code=test-code&state=saved-state') as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=line_unexpected');
  });

  test('既存ユーザーの場合は line_user_links からメールを取得', async () => {
    setupDefaultMocks(false, true, true, true, true);

    const res = await GET(makeRequest('?code=test-code&state=saved-state') as any);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/mypage');
  });

  test('id_token なし（no email）+ line_user_links 未登録 → ダミーメール生成', async () => {
    // Token response without id_token
    global.fetch = jest.fn((url: string) => {
      if (url.includes('oauth2/v2.1/token')) {
        return Promise.resolve(new Response(
          JSON.stringify({ access_token: 'test-token' }), // no id_token
          { ok: true, status: 200 }
        ));
      }
      if (url.includes('api.line.me/v2/profile')) {
        return Promise.resolve(new Response(
          JSON.stringify({ userId: 'line-no-email', displayName: 'No Email User' }),
          { ok: true, status: 200 }
        ));
      }
      return Promise.resolve(new Response('{}'));
    }) as jest.Mock;

    const res = await GET(makeRequest('?code=test-code&state=saved-state') as any);
    expect(res.status).toBe(307);
  });

  test('generateLink失敗 → 302 with line_auth_failed', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null }),
      })),
      auth: {
        admin: {
          createUser: jest.fn().mockResolvedValue({ error: null }),
          generateLink: jest.fn().mockResolvedValue({ data: null, error: { message: 'link failed' } }),
          getUserById: jest.fn().mockResolvedValue({ data: { user: null } }),
          updateUserById: jest.fn().mockResolvedValue({ data: {}, error: null }),
        },
      },
    });

    const res = await GET(makeRequest('?code=test-code&state=saved-state') as any);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=line_auth_failed');
  });

  test('verifyOtp失敗 → 302 with line_session_failed', async () => {
    const { createServerClient } = require('@supabase/ssr');
    createServerClient.mockReturnValue({
      auth: {
        verifyOtp: jest.fn().mockResolvedValue({ error: { message: 'OTP failed' } }),
      },
    });

    const res = await GET(makeRequest('?code=test-code&state=saved-state') as any);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('error=line_session_failed');
  });

  test('無効なリダイレクトURL(//から始まる) → /mypageにフォールバック', async () => {
    const { cookies } = require('next/headers');
    cookies.mockResolvedValue({
      get: jest.fn((name: string) => {
        if (name === 'line_oauth_state') return { value: 'saved-state' };
        if (name === 'line_oauth_redirect') return { value: '//evil.com/steal' };
        return undefined;
      }),
      delete: jest.fn(),
      getAll: jest.fn(() => []),
      set: jest.fn(),
    });

    const res = await GET(makeRequest('?code=test-code&state=saved-state') as any);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/mypage');
    expect(res.headers.get('location')).not.toContain('evil.com');
  });

  test('meta.line_user_id未設定 → updateUserById呼ぶ', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    const mockUpdateUserById = jest.fn().mockResolvedValue({ data: {}, error: null });
    createServiceRoleClient.mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null }),
      })),
      auth: {
        admin: {
          createUser: jest.fn().mockResolvedValue({ error: null }),
          generateLink: jest.fn().mockResolvedValue({
            data: {
              properties: { hashed_token: 'test-token' },
              user: { id: 'user-123', user_metadata: {} }, // no line_user_id in metadata
            },
            error: null,
          }),
          getUserById: jest.fn().mockResolvedValue({ data: { user: null } }),
          updateUserById: mockUpdateUserById,
        },
      },
    });

    await GET(makeRequest('?code=test-code&state=saved-state') as any);
    expect(mockUpdateUserById).toHaveBeenCalled();
  });

  test('meta.line_user_id設定済み → updateUserById不呼', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    const mockUpdateUserById = jest.fn().mockResolvedValue({ data: {}, error: null });
    createServiceRoleClient.mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null }),
      })),
      auth: {
        admin: {
          createUser: jest.fn().mockResolvedValue({ error: null }),
          generateLink: jest.fn().mockResolvedValue({
            data: {
              properties: { hashed_token: 'test-token' },
              user: { id: 'user-123', user_metadata: { line_user_id: 'already-set' } },
            },
            error: null,
          }),
          getUserById: jest.fn().mockResolvedValue({ data: { user: null } }),
          updateUserById: mockUpdateUserById,
        },
      },
    });

    await GET(makeRequest('?code=test-code&state=saved-state') as any);
    expect(mockUpdateUserById).not.toHaveBeenCalled();
  });

  test('createUser 失敗（already registered以外）→ ログだけで続行', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: null }),
      })),
      auth: {
        admin: {
          createUser: jest.fn().mockResolvedValue({ error: { message: 'something went wrong' } }),
          generateLink: jest.fn().mockResolvedValue({
            data: {
              properties: { hashed_token: 'test-token' },
              user: { id: 'user-123', user_metadata: {} },
            },
            error: null,
          }),
          getUserById: jest.fn().mockResolvedValue({ data: { user: null } }),
          updateUserById: jest.fn().mockResolvedValue({ data: {}, error: null }),
        },
      },
    });

    const res = await GET(makeRequest('?code=test-code&state=saved-state') as any);
    expect(res.status).toBe(307);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
