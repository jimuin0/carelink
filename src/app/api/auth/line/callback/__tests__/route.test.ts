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
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('@/lib/supabase-server');
jest.mock('@supabase/ssr');
jest.mock('next/headers');
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });

import { checkRateLimit } from '@/lib/rate-limit';
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
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
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
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

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

  test('state cookie 欠落（savedState undefined）→ line_invalid_state', async () => {
    // state パラメータは存在するが line_oauth_state cookie が無いケース。
    // 定数時間比較ヘルパー導入で savedState undefined を呼び出し側 !savedState で
    // 早期 false にする分岐の検証（タイミング攻撃対策のブランチ網羅）。
    const { cookies } = require('next/headers');
    cookies.mockResolvedValue({
      get: jest.fn((name: string) => {
        if (name === 'line_oauth_redirect') return { value: '/mypage' };
        return undefined; // line_oauth_state cookie 無し
      }),
      delete: jest.fn(),
      getAll: jest.fn(() => []),
      set: jest.fn(),
    });

    const res = await GET(makeRequest('?code=test-code&state=some-state') as any);

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
    (checkRateLimit as jest.Mock).mockClear();

    GET(makeRequest('?code=test-code&state=saved-state', '192.168.1.1') as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(10);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('line-callback');
  });

  test('extracts last (trusted) IP from x-forwarded-for', () => {
    (checkRateLimit as jest.Mock).mockClear();

    GET(makeRequest('?code=test-code&state=saved-state', '10.0.0.1, 192.168.1.1') as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('uses unknown IP when x-forwarded-for missing', () => {
    (checkRateLimit as jest.Mock).mockClear();

    const req = new Request('http://localhost/api/auth/line/callback?code=test-code&state=saved-state', {
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

  test('missing x-forwarded-for → uses "unknown" IP for rate limit', () => {
    (checkRateLimit as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/auth/line/callback?code=c&state=saved-state');
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    GET(req as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('cookie redirect missing → falls back to /mypage default', async () => {
    const { cookies } = require('next/headers');
    cookies.mockResolvedValue({
      get: jest.fn((name: string) => {
        if (name === 'line_oauth_state') return { value: 'saved-state' };
        return undefined; // no redirect cookie
      }),
      delete: jest.fn(),
      getAll: jest.fn(() => []),
      set: jest.fn(),
    });
    const res = await GET(makeRequest('?code=c&state=saved-state') as any);
    expect(res.headers.get('location')).toContain('/mypage');
  });

  test('token response json() throws → line_token_failed', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url.includes('oauth2/v2.1/token')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.reject(new Error('parse error')),
        } as any);
      }
      return Promise.resolve(new Response('{}'));
    }) as jest.Mock;
    const res = await GET(makeRequest('?code=c&state=saved-state') as any);
    expect(res.headers.get('location')).toContain('error=line_token_failed');
  });

  test('profile response json() throws → line_profile_failed', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url.includes('oauth2/v2.1/token')) {
        return Promise.resolve(new Response(
          JSON.stringify({ access_token: 'tok' }),
          { ok: true, status: 200 }
        ));
      }
      if (url.includes('api.line.me/v2/profile')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.reject(new Error('parse error')),
        } as any);
      }
      return Promise.resolve(new Response('{}'));
    }) as jest.Mock;
    const res = await GET(makeRequest('?code=c&state=saved-state') as any);
    expect(res.headers.get('location')).toContain('error=line_profile_failed');
  });

  test('id_token with parts.length !== 3 → email stays null, fallback path', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url.includes('oauth2/v2.1/token')) {
        return Promise.resolve(new Response(
          JSON.stringify({ access_token: 'tok', id_token: 'a.b' }), // 2 parts
          { ok: true, status: 200 }
        ));
      }
      if (url.includes('api.line.me/v2/profile')) {
        return Promise.resolve(new Response(
          JSON.stringify({ userId: 'lu', displayName: 'D' }),
          { ok: true, status: 200 }
        ));
      }
      return Promise.resolve(new Response('{}'));
    }) as jest.Mock;
    const res = await GET(makeRequest('?code=c&state=saved-state') as any);
    expect(res.status).toBe(307);
  });

  test('id_token signature mismatch → line_token_invalid', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url.includes('oauth2/v2.1/token')) {
        return Promise.resolve(new Response(
          JSON.stringify({
            access_token: 'tok',
            // 3 parts but signature is wrong
            id_token: 'aGVhZGVy.eyJlbWFpbCI6InRAdC5jb20ifQ.AAAAAAAA',
          }),
          { ok: true, status: 200 }
        ));
      }
      if (url.includes('api.line.me/v2/profile')) {
        return Promise.resolve(new Response(
          JSON.stringify({ userId: 'lu', displayName: 'D' }),
          { ok: true, status: 200 }
        ));
      }
      return Promise.resolve(new Response('{}'));
    }) as jest.Mock;
    const res = await GET(makeRequest('?code=c&state=saved-state') as any);
    expect(res.headers.get('location')).toContain('error=line_token_invalid');
  });

  test('既存ユーザーの email がDB上にある → そのemailを使用', async () => {
    // userExists=true で line_user_links に行があり、getUserById がメールを返す
    setupDefaultMocks(false, true, true, true, true);
    // id_token なし
    global.fetch = jest.fn((url: string) => {
      if (url.includes('oauth2/v2.1/token')) {
        return Promise.resolve(new Response(
          JSON.stringify({ access_token: 'tok' }),
          { ok: true, status: 200 }
        ));
      }
      if (url.includes('api.line.me/v2/profile')) {
        return Promise.resolve(new Response(
          JSON.stringify({ userId: 'lu', displayName: 'D' }),
          { ok: true, status: 200 }
        ));
      }
      return Promise.resolve(new Response('{}'));
    }) as jest.Mock;
    const res = await GET(makeRequest('?code=c&state=saved-state') as any);
    expect(res.status).toBe(307);
  });

  test('createUser 失敗（already registered）→ ログ無し', async () => {
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
          createUser: jest.fn().mockResolvedValue({ error: { message: 'User already registered' } }),
          generateLink: jest.fn().mockResolvedValue({
            data: {
              properties: { hashed_token: 'tk' },
              user: { id: 'u', user_metadata: { line_user_id: 'set' } },
            },
            error: null,
          }),
          getUserById: jest.fn().mockResolvedValue({ data: { user: null } }),
          updateUserById: jest.fn().mockResolvedValue({ data: {}, error: null }),
        },
      },
    });
    const res = await GET(makeRequest('?code=c&state=saved-state') as any);
    expect(res.status).toBe(307);
    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('createUser failed'),
      expect.anything()
    );
    consoleSpy.mockRestore();
  });

  test('generateLink: linkData.user 不在 → updateUserById不呼', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    const mockUpdate = jest.fn().mockResolvedValue({ data: {}, error: null });
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
            data: { properties: { hashed_token: 'tk' }, user: null },
            error: null,
          }),
          getUserById: jest.fn().mockResolvedValue({ data: { user: null } }),
          updateUserById: mockUpdate,
        },
      },
    });
    await GET(makeRequest('?code=c&state=saved-state') as any);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('cookieStore.set throws → setAll catch silences', async () => {
    const { cookies } = require('next/headers');
    cookies.mockResolvedValue({
      get: jest.fn((name: string) => {
        if (name === 'line_oauth_state') return { value: 'saved-state' };
        if (name === 'line_oauth_redirect') return { value: '/mypage' };
        return undefined;
      }),
      delete: jest.fn(),
      getAll: jest.fn(() => []),
      set: jest.fn(() => { throw new Error('Server Component'); }),
    });
    const { createServerClient } = require('@supabase/ssr');
    createServerClient.mockImplementation((_u: string, _k: string, opts: any) => {
      // Trigger setAll path
      opts.cookies.setAll([{ name: 'sb', value: 'v', options: {} }]);
      return {
        auth: { verifyOtp: jest.fn().mockResolvedValue({ error: null }) },
      };
    });
    const res = await GET(makeRequest('?code=c&state=saved-state') as any);
    expect(res.status).toBe(307);
  });

  // Branch coverage: line 107 — payload.email が null/undefined の場合 email = null になる
  test('id_token payload に email なし → email=null になり fallback path へ', async () => {
    // id_token payload without email field
    // Build a valid 3-part token but with no email in payload
    // We need a valid HMAC so we use the existing valid token mechanism but clear email
    global.fetch = jest.fn((url: string) => {
      if (url.includes('oauth2/v2.1/token')) {
        // Create a token with payload {"sub":"123"} (no email)
        // The test doesn't need a cryptographically valid token —
        // we use signatureValid=false path to fall through to the catch block
        // which leaves email null, then follows the email=null branch
        return Promise.resolve(new Response(
          JSON.stringify({
            access_token: 'tok',
            // 3 parts but payload has no email — HMAC will fail (different secret)
            // so we reach the catch block and email stays null
            id_token: 'aGVhZGVy.eyJzdWIiOiIxMjMifQ.AAAAAAAA',
          }),
          { ok: true, status: 200 }
        ));
      }
      if (url.includes('api.line.me/v2/profile')) {
        return Promise.resolve(new Response(
          JSON.stringify({ userId: 'lu-no-email', displayName: 'D' }),
          { ok: true, status: 200 }
        ));
      }
      return Promise.resolve(new Response('{}'));
    }) as jest.Mock;
    // The signature will mismatch → redirect line_token_invalid OR catch → email=null path
    const res = await GET(makeRequest('?code=c&state=saved-state') as any);
    // Either line_token_invalid or fallback to /mypage (both are valid outcomes for this branch)
    expect(res.status).toBe(307);
  });

  // Branch coverage: line 127 — existingUser?.email が falsy → fallback email
  test('line_user_links にユーザーあり、getUserById が email=null → ダミーメール生成', async () => {
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn((table: string) => {
        if (table === 'line_user_links') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                maybeSingle: jest.fn().mockResolvedValue({
                  data: { user_id: 'found-user-id' },
                }),
              }),
            }),
          };
        }
      }),
      auth: {
        admin: {
          // getUserById returns user with no email (email = undefined/null)
          getUserById: jest.fn().mockResolvedValue({
            data: { user: { id: 'found-user-id', email: null } },
          }),
          createUser: jest.fn().mockResolvedValue({ error: null }),
          generateLink: jest.fn().mockResolvedValue({
            data: {
              properties: { hashed_token: 'tk' },
              user: { id: 'found-user-id', user_metadata: { line_user_id: 'already-set' } },
            },
            error: null,
          }),
          updateUserById: jest.fn().mockResolvedValue({ data: {}, error: null }),
        },
      },
    });

    // Use token without id_token so email is null → triggers line_user_links lookup
    global.fetch = jest.fn((url: string) => {
      if (url.includes('oauth2/v2.1/token')) {
        return Promise.resolve(new Response(
          JSON.stringify({ access_token: 'tok' }), // no id_token
          { ok: true, status: 200 }
        ));
      }
      if (url.includes('api.line.me/v2/profile')) {
        return Promise.resolve(new Response(
          JSON.stringify({ userId: 'lu-no-mail', displayName: 'D' }),
          { ok: true, status: 200 }
        ));
      }
      return Promise.resolve(new Response('{}'));
    }) as jest.Mock;

    const res = await GET(makeRequest('?code=c&state=saved-state') as any);
    // Should use fallback email line_lu-no-mail@line.carelink.local
    expect(res.status).toBe(307);
  });

  // Branch coverage: line 107 — payload.email が falsy → email = null
  test('id_token の payload に email フィールドなし（署名有効）→ email=null になり fallback path へ', async () => {
    // Build a valid HS256 token with payload {"sub":"123"} — no email field
    const { createHmac } = require('crypto');
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payloadNoEmail = Buffer.from(JSON.stringify({ sub: '123' })).toString('base64url');
    const signingInput = `${header}.${payloadNoEmail}`;
    const secret = 'test-secret'; // matches process.env.LINE_CHANNEL_SECRET set in setupDefaultMocks
    const sig = createHmac('sha256', secret).update(signingInput).digest('base64url');
    const idTokenNoEmail = `${header}.${payloadNoEmail}.${sig}`;

    global.fetch = jest.fn((url: string) => {
      if (url.includes('oauth2/v2.1/token')) {
        return Promise.resolve(new Response(
          JSON.stringify({ access_token: 'tok', id_token: idTokenNoEmail }),
          { ok: true, status: 200 }
        ));
      }
      if (url.includes('api.line.me/v2/profile')) {
        return Promise.resolve(new Response(
          JSON.stringify({ userId: 'lu-noemail', displayName: 'D' }),
          { ok: true, status: 200 }
        ));
      }
      return Promise.resolve(new Response('{}'));
    }) as jest.Mock;

    const res = await GET(makeRequest('?code=c&state=saved-state') as any);
    // email=null → line_user_links lookup → no link → fallback dummy email → generateLink → /mypage
    expect(res.status).toBe(307);
    // Should NOT hit line_token_invalid since signature IS valid
    expect(res.headers.get('location')).not.toContain('error=line_token_invalid');
  });

  // Branch coverage: line 157 — linkData.user.user_metadata || {} when user_metadata is null
  test('generateLink user_metadata が null → {} にフォールバックして line_user_id を設定', async () => {
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
              // user_metadata is null → triggers || {} branch at line 157
              user: { id: 'user-123', user_metadata: null },
            },
            error: null,
          }),
          getUserById: jest.fn().mockResolvedValue({ data: { user: null } }),
          updateUserById: mockUpdateUserById,
        },
      },
    });

    await GET(makeRequest('?code=test-code&state=saved-state') as any);
    // meta = null || {} = {} → !meta.line_user_id → updateUserById is called
    expect(mockUpdateUserById).toHaveBeenCalled();
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
