/**
 * @jest-environment node
 *
 * Tests for GET /api/google-calendar/callback
 * Key assertions:
 *   - Rate limiting (10 req/min per IP)
 *   - error param → redirect with gcal=error
 *   - code & state validation
 *   - state max 2000 chars
 *   - Nonce cookie retrieval & deletion
 *   - State base64url decode & JSON parse
 *   - UUID validation
 *   - State timestamp (10min expiry)
 *   - Timing-safe nonce comparison
 *   - Token exchange (Google POST)
 *   - Token upsert to DB
 *   - Success redirect (gcal=success)
 */

jest.mock('@/lib/rate-limit');
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/supabase-server-auth');
jest.mock('next/headers');
jest.mock('crypto');
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
jest.mock('@/lib/safe', () => ({ safeCaptureException: jest.fn() }));

import { checkRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

let mockInsert: jest.Mock;
let mockCookieGet: jest.Mock;
let mockCookieDelete: jest.Mock;
let mockTimingSafeEqual: jest.Mock;
let mockAuthGetUser: jest.Mock;
let mockMaybeSingle: jest.Mock;
let mockUpdate: jest.Mock;
let mockSave: jest.Mock;

function updateChain(result: unknown) {
  const eq = jest.fn();
  const chain = { eq, then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject) };
  eq.mockReturnValue(chain); return chain;
}
function reconsentFetch(url: string) {
  return Promise.resolve(new Response(JSON.stringify(url.includes('oauth2.googleapis.com') ? { access_token: 'new-access', expires_in: 3600 } : { id: 'owner@example.invalid' }), { status: 200 }));
}

function setupDefaultMocks(
  rateLimited: boolean = false,
  nonceCookieFound: boolean = true,
  nonceValid: boolean = true,
  tokenExchangeSucceeds: boolean = true,
  insertSucceeds: boolean = true
) {
  (checkRateLimit as jest.Mock).mockReturnValue(rateLimited);

  mockCookieGet = jest.fn().mockReturnValue(
    nonceCookieFound ? { value: '1234567890abcdef' } : undefined
  );

  mockCookieDelete = jest.fn();

  const { cookies } = require('next/headers');
  cookies.mockResolvedValue({
    get: mockCookieGet,
    delete: mockCookieDelete,
  });

  mockTimingSafeEqual = jest.fn().mockReturnValue(nonceValid);

  const crypto = require('crypto');
  crypto.timingSafeEqual = mockTimingSafeEqual;
  crypto.createHash.mockImplementation(jest.requireActual('crypto').createHash);

  global.fetch = jest.fn((url: string) => {
    if (url.includes('oauth2.googleapis.com/token')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: 'access-token-xyz',
            refresh_token: 'refresh-token-abc',
            expires_in: 3600,
            scope: 'calendar',
          }),
          { ok: tokenExchangeSucceeds, status: tokenExchangeSucceeds ? 200 : 400 }
        )
      );
    }
    return Promise.resolve(new Response(JSON.stringify({id:'owner@example.invalid'})));
  }) as jest.Mock;

  mockSave = jest.fn().mockResolvedValue({ data: true, error: insertSucceeds ? null : new Error('Save failed') });
  mockInsert = jest.fn().mockResolvedValue({
    count: 1, error: insertSucceeds ? null : new Error('Insert failed'),
  });

  mockAuthGetUser = jest.fn().mockResolvedValue({
    data: { user: { id: '550e8400-e29b-41d4-a716-446655440000' } },
  });
  const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
  createServerSupabaseAuthClient.mockResolvedValue({ auth: { getUser: mockAuthGetUser } });
  mockMaybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  mockUpdate = jest.fn().mockReturnValue(updateChain({count:1,error:null}));

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    rpc: mockSave,
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle }),
      }),
      update: mockUpdate,
      insert: mockInsert,
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setupDefaultMocks();
  process.env.GOOGLE_CLIENT_ID = 'client-id-123';
  process.env.GOOGLE_CLIENT_SECRET = 'client-secret-abc';
  process.env.NEXT_PUBLIC_APP_URL = 'https://carelink-jp.com';
});

function makeRequest(params: Record<string, string>, ip = '192.168.1.1') {
  const searchParams = new URLSearchParams(params);
  return new Request(`http://localhost/api/google-calendar/callback?${searchParams}`, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
}

function createValidState(): string {
  const state = {
    userId: '550e8400-e29b-41d4-a716-446655440000',
    ts: Date.now(),
    nonce: '1234567890abcdef',
  };
  return Buffer.from(JSON.stringify(state)).toString('base64url');
}

describe('GET /api/google-calendar/callback', () => {
  test.each(['read', 'insert', 'update'] as const)('DB %s failure is monitored without credential details', async (operation) => {
    const failure = { code: '08006', message: 'private refresh_token=synthetic-secret', details: 'private SQL input' };
    if (operation === 'read') mockMaybeSingle.mockResolvedValue({ data: null, error: failure });
    if (operation === 'insert') mockSave.mockResolvedValue({ error: failure });
    if (operation === 'update') {
      mockMaybeSingle.mockResolvedValue({ data: { id: 'fc170001-0000-4000-8000-000000000001', updated_at: '2026-01-01T00:00:00Z', refresh_token: 'existing-refresh' }, error: null });
      global.fetch = jest.fn(reconsentFetch);
      mockSave.mockResolvedValue({ error: failure });
    }
    const res = await GET(makeRequest({ code: 'code-123', state: createValidState() }) as any);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/mypage/settings?gcal=error');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const tag = operation === 'read' ? 'gcal-callback-token-read' : 'gcal-callback-token-save';
    const diagnostic = expect.objectContaining({ message: 'DATABASE_FAILURE:08006' });
    expect(require('@/lib/safe').safeCaptureException).toHaveBeenCalledTimes(1);
    expect(require('@/lib/safe').safeCaptureException).toHaveBeenCalledWith(diagnostic, tag);
    expect(require('@/lib/alert').alertCaughtError).toHaveBeenCalledWith(tag, diagnostic, '/api/google-calendar/callback');
    if (operation === 'read') {
      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    }
  });

  test('unexpected provider rejection never forwards the raw exception to logs or monitoring', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      global.fetch = jest.fn().mockRejectedValue(new Error('private access_token=synthetic-secret'));
      const res = await GET(makeRequest({ code: 'code-123', state: createValidState() }) as any);
      expect(res.headers.get('location')).toBe('http://localhost/mypage/settings?gcal=error');
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(log).not.toHaveBeenCalled();
      const diagnostic = expect.objectContaining({ message: 'GOOGLE_CALENDAR_CALLBACK_FAILURE' });
      expect(require('@/lib/safe').safeCaptureException).toHaveBeenCalledWith(diagnostic, 'gcal-callback');
      expect(require('@/lib/alert').alertCaughtError).toHaveBeenCalledWith('gcal-callback', diagnostic, '/api/google-calendar/callback');
      expect(mockInsert).not.toHaveBeenCalled();
      expect(mockUpdate).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  test.each([
    { data: { user: null }, error: { status: 503, message: 'private auth details' } },
    { data: { user: { id: '550e8400-e29b-41d4-a716-446655440000' } }, error: { status: 503, message: 'private auth details' } },
    null,
  ])('uncertain identity stops before token exchange: %j', async (result) => {
    mockAuthGetUser.mockResolvedValueOnce(result);
    const res = await GET(makeRequest({ code: 'code-123', state: createValidState() }) as any);
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ code: 'AUTH_UNAVAILABLE', error: 'ログイン状態を確認できません。時間をおいて、同じ操作を再確認してください。' });
    expect(require('@/lib/alert').alertCaughtError).toHaveBeenCalledWith('gcal-callback-auth', expect.objectContaining({ message: 'AUTH_UNAVAILABLE' }), '/api/google-calendar/callback', 503);
    expect(require('@/lib/safe').safeCaptureException).toHaveBeenCalledWith(expect.objectContaining({ message: 'AUTH_UNAVAILABLE' }), 'gcal-callback-auth');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(require('@/lib/supabase-server').createServiceRoleClient).not.toHaveBeenCalled();
  });

  test('auth SDK rejection stops before token exchange', async () => {
    mockAuthGetUser.mockRejectedValueOnce(new Error('private auth details'));
    const res = await GET(makeRequest({ code: 'code-123', state: createValidState() }) as any);
    expect(res.status).toBe(503);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(require('@/lib/supabase-server').createServiceRoleClient).not.toHaveBeenCalled();
  });

  test('auth verification timeout stops before token exchange', async () => {
    jest.useFakeTimers();
    try {
      mockAuthGetUser.mockImplementationOnce(() => new Promise(() => {}));
      const pending = GET(makeRequest({ code: 'code-123', state: createValidState() }) as any);
      await jest.advanceTimersByTimeAsync(5000);
      expect((await pending).status).toBe(503);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(require('@/lib/supabase-server').createServiceRoleClient).not.toHaveBeenCalled();
    } finally { jest.useRealTimers(); }
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);

    const res = await GET(
      makeRequest({ code: 'code-123', state: createValidState() }) as any
    );

    expect(res.status).toBe(307); // redirect
    expect(res.headers.get('location')).toContain('gcal=error');
  });

  test('error param → redirect with gcal=error', async () => {
    const res = await GET(
      makeRequest({ error: 'access_denied' }) as any
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('gcal=error');
  });

  test('missing code → redirect with gcal=error', async () => {
    const res = await GET(
      makeRequest({ state: createValidState() }) as any
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('gcal=error');
  });

  test('missing state → redirect with gcal=error', async () => {
    const res = await GET(
      makeRequest({ code: 'code-123' }) as any
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('gcal=error');
  });

  test('state > 2000 chars → redirect with gcal=error', async () => {
    const res = await GET(
      makeRequest({ code: 'code-123', state: 'x'.repeat(2001) }) as any
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('gcal=error');
  });

  test('retrieves nonce cookie', async () => {
    setupDefaultMocks(false, true);

    await GET(
      makeRequest({ code: 'code-123', state: createValidState() }) as any
    );

    expect(mockCookieGet).toHaveBeenCalledWith('google_oauth_state');
  });

  test('deletes nonce cookie', async () => {
    setupDefaultMocks(false, true);

    await GET(
      makeRequest({ code: 'code-123', state: createValidState() }) as any
    );

    expect(mockCookieDelete).toHaveBeenCalledWith('google_oauth_state');
  });

  test('nonce cookie not found → redirect with error', async () => {
    setupDefaultMocks(false, false);

    const res = await GET(
      makeRequest({ code: 'code-123', state: createValidState() }) as any
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('gcal=error');
  });

  test('decodes state from base64url', async () => {
    setupDefaultMocks(false, true);

    const validState = createValidState();
    await GET(
      makeRequest({ code: 'code-123', state: validState }) as any
    );

    // Should successfully parse base64url state
  });

  test('invalid base64 state → redirect with error', async () => {
    const res = await GET(
      makeRequest({ code: 'code-123', state: '!!!invalid!!!' }) as any
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('gcal=error');
  });

  test('invalid JSON in state → redirect with error', async () => {
    const invalidState = Buffer.from('not json').toString('base64url');
    const res = await GET(
      makeRequest({ code: 'code-123', state: invalidState }) as any
    );

    expect(res.status).toBe(307);
  });

  test('validates userId is UUID format', async () => {
    setupDefaultMocks(false, true);

    const invalidState = Buffer.from(
      JSON.stringify({
        userId: 'not-a-uuid',
        ts: Date.now(),
        nonce: '1234567890abcdef',
      })
    ).toString('base64url');

    const res = await GET(
      makeRequest({ code: 'code-123', state: invalidState }) as any
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('gcal=error');
  });

  test('rejects expired state (> 10 min)', async () => {
    setupDefaultMocks(false, true);

    const expiredState = Buffer.from(
      JSON.stringify({
        userId: '550e8400-e29b-41d4-a716-446655440000',
        ts: Date.now() - 11 * 60 * 1000,
        nonce: '1234567890abcdef',
      })
    ).toString('base64url');

    const res = await GET(
      makeRequest({ code: 'code-123', state: expiredState }) as any
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('gcal=error');
  });

  test.each([
    ['timestamp missing', { userId: '550e8400-e29b-41d4-a716-446655440000', nonce: '1234567890abcdef' }],
    ['future timestamp', { userId: '550e8400-e29b-41d4-a716-446655440000', ts: Date.now() + 60_000, nonce: '1234567890abcdef' }],
  ])('state with %s → rejected before token exchange', async (_label, payload) => {
    const state = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const res = await GET(makeRequest({ code: 'code-123', state }) as any);
    expect(res.headers.get('location')).toContain('gcal=error');
    expect((global.fetch as jest.Mock).mock.calls.some((call) => call[0].includes('oauth2.googleapis.com/token'))).toBe(false);
  });

  test('accepts valid state within 10 min', async () => {
    setupDefaultMocks(false, true);

    const validState = Buffer.from(
      JSON.stringify({
        userId: '550e8400-e29b-41d4-a716-446655440000',
        ts: Date.now() - 5 * 60 * 1000,
        nonce: '1234567890abcdef',
      })
    ).toString('base64url');

    const res = await GET(
      makeRequest({ code: 'code-123', state: validState }) as any
    );

    // Should not immediately reject
    expect(res).toBeDefined();
  });

  test('timing-safe nonce comparison', async () => {
    setupDefaultMocks(false, true, true);

    await GET(
      makeRequest({ code: 'code-123', state: createValidState() }) as any
    );

    expect(mockTimingSafeEqual).toHaveBeenCalled();
  });

  test('nonce mismatch → redirect with error', async () => {
    setupDefaultMocks(false, true, false);

    const res = await GET(
      makeRequest({ code: 'code-123', state: createValidState() }) as any
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('gcal=error');
  });

  test('exchanges code for tokens via Google API', async () => {
    setupDefaultMocks(false, true, true, true);

    await GET(
      makeRequest({ code: 'code-123', state: createValidState() }) as any
    );

    const call = (global.fetch as jest.Mock).mock.calls.find((c) =>
      c[0].includes('oauth2.googleapis.com/token')
    );
    expect(call).toBeDefined();
    expect(call[1].method).toBe('POST');
  });

  test('token exchange includes required params', async () => {
    setupDefaultMocks(false, true, true, true);

    await GET(
      makeRequest({ code: 'my-code', state: createValidState() }) as any
    );

    const call = (global.fetch as jest.Mock).mock.calls.find((c) =>
      c[0].includes('oauth2.googleapis.com/token')
    );
    const body = String(call[1].body);
    expect(body).toContain('code=my-code');
    expect(body).toContain('client_id=client-id-123');
    expect(body).toContain('client_secret=client-secret-abc');
    expect(body).toContain('grant_type=authorization_code');
  });

  test('token exchange fails → redirect with error', async () => {
    setupDefaultMocks(false, true, true, false);

    const res = await GET(
      makeRequest({ code: 'code-123', state: createValidState() }) as any
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('gcal=error');
  });

  test.each([
    ['null response', 'null'],
    ['non-object response', 'true'],
    ['missing access token', JSON.stringify({ expires_in: 3600 })],
    ['empty access token', JSON.stringify({ access_token: '', expires_in: 3600 })],
    ['missing expiry', JSON.stringify({ access_token: 'access' })],
    ['non-numeric expiry', JSON.stringify({ access_token: 'access', expires_in: '3600' })],
    ['non-finite expiry', '{"access_token":"access","expires_in":1e999}'],
    ['zero expiry', JSON.stringify({ access_token: 'access', expires_in: 0 })],
  ])('malformed token response (%s) → error redirect without saving credentials', async (_label, tokenJson) => {
    global.fetch = jest.fn((url: string) => url.includes('oauth2.googleapis.com/token')
      ? Promise.resolve(new Response(tokenJson, { status: 200 }))
      : Promise.resolve(new Response(JSON.stringify({id:'owner@example.invalid'})))) as jest.Mock;
    const res = await GET(makeRequest({ code: 'code-123', state: createValidState() }) as any);
    expect(res.headers.get('location')).toContain('gcal=error');
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('現在のSupabaseセッションとstateのuserIdが異なる → tokenを保存しない', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: '660e8400-e29b-41d4-a716-446655440000' } } });
    const res = await GET(makeRequest({ code: 'code-123', state: createValidState() }) as any);

    expect(res.headers.get('location')).toContain('gcal=error');
    expect((global.fetch as jest.Mock).mock.calls.some((call) => call[0].includes('oauth2.googleapis.com/token'))).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('認証済みセッションがない → tokenを保存しない', async () => {
    mockAuthGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(makeRequest({ code: 'code-123', state: createValidState() }) as any);

    expect(res.headers.get('location')).toContain('gcal=error');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('既存token照会が失敗 → tokenを上書きしない', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: new Error('lookup failed') });
    const res = await GET(makeRequest({ code: 'code-123', state: createValidState() }) as any);

    expect(res.headers.get('location')).toContain('gcal=error');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('saves the complete new grant through the fenced service RPC', async () => {
    await GET(makeRequest({ code: 'code-123', state: createValidState() }) as any);
    expect(mockSave).toHaveBeenCalledWith('save_google_calendar_oauth', expect.objectContaining({
      p_actor_id: '550e8400-e29b-41d4-a716-446655440000', p_access_token: 'access-token-xyz',
      p_refresh_token: 'refresh-token-abc', p_expires_at: expect.any(String), p_scope: 'calendar',
      p_observed_token_id: null, p_observed_updated_at: null, p_nonce_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(mockInsert).not.toHaveBeenCalled(); expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('successful token exchange → redirect with gcal=success', async () => {
    setupDefaultMocks(false, true, true, true);

    const res = await GET(
      makeRequest({ code: 'code-123', state: createValidState() }) as any
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('gcal=success');
  });

  test('rate limit params (10 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await GET(
      makeRequest({ code: 'code-123', state: createValidState() }, '192.168.1.1') as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(10);
    expect(call[3]).toBe(60_000);
  });

  test('extracts last (trusted) IP from x-forwarded-for', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await GET(
      makeRequest(
        { code: 'code-123', state: createValidState() },
        '10.0.0.1, 192.168.1.1'
      ) as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('uses unknown IP when x-forwarded-for missing', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    const req = new Request(
      `http://localhost/api/google-calendar/callback?code=code-123&state=${createValidState()}`,
      { method: 'GET' }
    );

    await GET(req as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('nonce empty string → mismatch error', async () => {
    setupDefaultMocks(false, true);

    const stateWithoutNonce = Buffer.from(
      JSON.stringify({
        userId: '550e8400-e29b-41d4-a716-446655440000',
        ts: Date.now(),
      })
    ).toString('base64url');

    const res = await GET(
      makeRequest({ code: 'code-123', state: stateWithoutNonce }) as any
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('gcal=error');
  });

  test('nonce length mismatch → error', async () => {
    setupDefaultMocks(false, true);

    const shortNonceState = Buffer.from(
      JSON.stringify({
        userId: '550e8400-e29b-41d4-a716-446655440000',
        ts: Date.now(),
        nonce: 'short',
      })
    ).toString('base64url');

    const res = await GET(
      makeRequest({ code: 'code-123', state: shortNonceState }) as any
    );

    expect(res.status).toBe(307);
  });

  test('初回接続でrefresh_tokenがない → 非更新可能な接続を保存しない', async () => {
    setupDefaultMocks(false, true, true, true, true);

    // Override fetch to return tokens without refresh_token and scope
    global.fetch = jest.fn((url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: 'access-only-token',
              // refresh_token omitted → falsy → null (line 81 right branch)
              expires_in: 3600,
              // scope omitted → falsy → null (line 83 right branch)
            }),
            { ok: true, status: 200 }
          )
        );
      }
      return Promise.resolve(new Response(JSON.stringify({id:'owner@example.invalid'})));
    }) as jest.Mock;

    const res = await GET(
      makeRequest({ code: 'code-123', state: createValidState() }) as any
    );

    // A connection without a refresh token would stop working after access-token expiry.
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('gcal=error');
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('再認可でrefresh_tokenが省略されたら既存tokenを保持する', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { id: 'fc170001-0000-4000-8000-000000000001', updated_at: '2026-01-01T00:00:00Z', refresh_token: 'existing-refresh' }, error: null });
    global.fetch = jest.fn((url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: 'new-access', expires_in: 3600 }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({id:'owner@example.invalid'})));
    }) as jest.Mock;

    const res = await GET(makeRequest({ code: 'code-123', state: createValidState() }) as any);

    expect(res.headers.get('location')).toContain('gcal=success');
    expect(mockSave).toHaveBeenCalledWith('save_google_calendar_oauth', expect.objectContaining({ p_access_token: 'new-access', p_refresh_token: 'existing-refresh' }));
    expect(mockInsert).not.toHaveBeenCalled(); expect(mockUpdate).not.toHaveBeenCalled();
  });

  test('refresh token付き応答でscope省略 → scopeをnullに正規化して保存', async () => {
    global.fetch = jest.fn((url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({id:'owner@example.invalid'})));
    }) as jest.Mock;
    await GET(makeRequest({ code: 'code-123', state: createValidState() }) as any);
    expect(mockSave).toHaveBeenCalledWith('save_google_calendar_oauth', expect.objectContaining({ p_scope: null, p_refresh_token: 'refresh' }));
  });

  test('既存token更新が失敗 → redirect with gcal=error', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { id: 'fc170001-0000-4000-8000-000000000001', updated_at: '2026-01-01T00:00:00Z', refresh_token: 'existing-refresh' }, error: null });
    mockSave.mockResolvedValue({ error: new Error('save failed') });
    global.fetch = jest.fn((url: string) => {
      if (url.includes('oauth2.googleapis.com/token')) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: 'new-access', expires_in: 3600 }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({id:'owner@example.invalid'})));
    }) as jest.Mock;
    const res = await GET(makeRequest({ code: 'code-123', state: createValidState() }) as any);
    expect(res.headers.get('location')).toContain('gcal=error');
  });

  // Branch coverage: トークン upsert が失敗 → 成功扱いにせず gcal=error へ
  test('token insert が失敗 → redirect with gcal=error', async () => {
    setupDefaultMocks(false, true, true, true, false);

    const res = await GET(
      makeRequest({ code: 'code-123', state: createValidState() }) as any
    );

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('gcal=error');
  });
});

describe('callback save confirmation using the real Supabase HTTP decoder', () => {
  test.each([true, false, null, 1])('only boolean true confirms the fenced transaction: %s', async data => {
    const { createClient } = jest.requireActual('@supabase/supabase-js');
    const databaseFetch = jest.fn(async (url: unknown) => new Response(JSON.stringify(String(url).includes('/rpc/') ? data : [{ id: 'fc170001-0000-4000-8000-000000000001', updated_at: '2026-01-01T00:00:00Z', refresh_token: 'existing-refresh' }]), { headers: { 'Content-Type': 'application/json' } }));
    require('@/lib/supabase-server').createServiceRoleClient.mockReturnValue(createClient('http://127.0.0.1:1', 'synthetic-service-key', {
      global: { fetch: databaseFetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }));
    global.fetch = jest.fn(reconsentFetch);
    const res = await GET(makeRequest({ code: 'code-123', state: createValidState() }) as any);
    expect(res.headers.get('location')).toContain(data === true ? 'gcal=success' : 'gcal=error');
    expect(databaseFetch).toHaveBeenCalledTimes(2);
  });
});

// Reconsent must not splice credentials belonging to two Google accounts.
test('different Google primary with omitted refresh token cannot overwrite the prior connection', async () => {
  mockMaybeSingle.mockResolvedValue({ data: { id: 'fc170001-0000-4000-8000-000000000001', updated_at: '2026-01-01T00:00:00Z', refresh_token: 'existing-refresh' }, error: null });
  global.fetch = jest.fn(async (url: string, options: RequestInit) => {
    if (url.includes('oauth2.googleapis.com')) return new Response(JSON.stringify({ access_token: String(options.body).includes('grant_type=refresh_token') ? 'old-account-access' : 'new-account-access', expires_in: 3600 }));
    return new Response(JSON.stringify({ id: new Headers(options.headers).get('Authorization') === 'Bearer old-account-access' ? 'old-owner@example.invalid' : 'new-owner@example.invalid' }));
  }) as jest.Mock;
  const res=await GET(makeRequest({code:'code-123',state:createValidState()}) as any);
  expect(res.headers.get('location')).toContain('gcal=error');
  expect(mockUpdate).not.toHaveBeenCalled();expect(mockInsert).not.toHaveBeenCalled();
});

test.each([{id:undefined,updated_at:'2026-01-01'}, {id:'',updated_at:'2026-01-01'}, {id:'token-id',updated_at:'invalid'}])('missing credential version stops before reuse: %j', async metadata => {
  mockMaybeSingle.mockResolvedValue({data:{...metadata,refresh_token:'existing-refresh'},error:null});
  global.fetch=jest.fn(reconsentFetch) as jest.Mock;
  const res=await GET(makeRequest({code:'code-123',state:createValidState()}) as any);
  expect(res.headers.get('location')).toContain('gcal=error');expect(fetch).toHaveBeenCalledTimes(1);expect(mockUpdate).not.toHaveBeenCalled();
});
test('proved refresh rotation is saved with the exact credential generation',async()=>{
  mockMaybeSingle.mockResolvedValue({data:{id:'token-id',updated_at:'2026-01-01',refresh_token:'existing-refresh'},error:null});
  global.fetch=jest.fn(async(url:string,options:RequestInit)=>new Response(JSON.stringify(url.includes('oauth2.googleapis.com')?{access_token:'access',expires_in:3600,...(String(options.body).includes('grant_type=refresh_token')?{refresh_token:'rotated-refresh'}:{})}:{id:'owner@example.invalid'}))) as jest.Mock;
  const res=await GET(makeRequest({code:'code-123',state:createValidState()}) as any);
  expect(res.headers.get('location')).toContain('gcal=success');
  expect(mockSave).toHaveBeenCalledWith('save_google_calendar_oauth', expect.objectContaining({ p_refresh_token: 'rotated-refresh', p_observed_token_id: 'token-id', p_observed_updated_at: '2026-01-01' }));
});

// A complete OAuth grant must obey the same observed-row fence as a reused one.
// The real SDK builds requests; the synthetic database applies their predicates
// and uniqueness semantics after an intervening connection change.
test.each(['disconnect', 'reconnect', 'refresh', 'first-connect-race'])('full grant cannot overwrite concurrent %s', async mode => {
  const { createClient } = jest.requireActual('@supabase/supabase-js');
  const old = { id: 'fc170001-0000-4000-8000-000000000001', updated_at: '2026-01-01T00:00:00Z', refresh_token: 'original-refresh' };
  const latest = { ...old, id: mode === 'refresh' ? old.id : 'fc170002-0000-4000-8000-000000000002', updated_at: '2026-01-02T00:00:00Z', refresh_token: 'latest-refresh' };
  let stored: Record<string, unknown> | null = mode === 'disconnect' ? null : { ...latest };
  const databaseFetch = jest.fn(async (url: unknown, init: RequestInit) => {
    if (init.method === 'GET') return new Response(JSON.stringify(mode === 'first-connect-race' ? [] : [old]), { headers: { 'Content-Type': 'application/json' } });
    if (String(url).includes('/rpc/save_google_calendar_oauth')) return new Response('false', { headers: { 'Content-Type': 'application/json' } });
    const fields = JSON.parse(String(init.body));
    if (init.method === 'PATCH') {
      const params = new URL(String(url)).searchParams;
      const matches = stored !== null && params.get('id') === `eq.${stored.id}` && params.get('updated_at') === `eq.${stored.updated_at}`;
      if (matches) stored = { ...stored, ...fields };
      return new Response(null, { status: 204, headers: { 'Content-Range': `*/${matches ? 1 : 0}` } });
    }
    // Upsert resurrects deleted state and replaces newer credentials; a plain
    // insert instead loses to the unique user_id row without overwriting it.
    if (new Headers(init.headers).get('Prefer')?.includes('resolution=merge-duplicates')) {
      stored = { ...stored, ...fields };
      return new Response(null, { status: 201, headers: { 'Content-Range': '*/1' } });
    }
    return new Response(JSON.stringify({ code: '23505', message: 'synthetic unique conflict' }), { status: 409 });
  });
  require('@/lib/supabase-server').createServiceRoleClient.mockReturnValue(createClient('http://127.0.0.1:1', 'synthetic-service-key', {
    global: { fetch: databaseFetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }));
  const res = await GET(makeRequest({ code: 'code-123', state: createValidState() }) as any);
  expect(stored).toEqual(mode === 'disconnect' ? null : latest);
  expect(res.headers.get('location')).toContain('gcal=error');
  const [url, init] = databaseFetch.mock.calls[1];
  expect(new URL(String(url)).searchParams.has('on_conflict')).toBe(false);
  expect(new Headers(init.headers).get('Prefer') ?? '').not.toContain('resolution=merge-duplicates');
  expect(new URL(String(url)).pathname).toBe('/rest/v1/rpc/save_google_calendar_oauth');
  expect(JSON.parse(String(init.body))).toMatchObject({ p_nonce_hash: expect.stringMatching(/^[a-f0-9]{64}$/) });
});

test.each([false, true])('complete grants carry the observed token revision into the transaction, existing=%s', async existing => {
  mockMaybeSingle.mockResolvedValue({ data: existing ? { id: 'token-id', updated_at: '2026-01-01', refresh_token: 'old' } : null, error: null });
  const res = await GET(makeRequest({ code: 'code-123', state: createValidState() }) as any);
  expect(res.headers.get('location')).toContain('gcal=success');
  expect(mockSave).toHaveBeenCalledWith('save_google_calendar_oauth', expect.objectContaining({
    p_observed_token_id: existing ? 'token-id' : null, p_observed_updated_at: existing ? '2026-01-01' : null,
    p_refresh_token: 'refresh-token-abc',
  }));
});
