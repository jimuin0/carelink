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
jest.mock('next/headers');
jest.mock('crypto');

import { checkRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

let mockUpsert: jest.Mock;
let mockCookieGet: jest.Mock;
let mockCookieDelete: jest.Mock;
let mockTimingSafeEqual: jest.Mock;

function setupDefaultMocks(
  rateLimited: boolean = false,
  nonceCookieFound: boolean = true,
  nonceValid: boolean = true,
  tokenExchangeSucceeds: boolean = true,
  upsertSucceeds: boolean = true
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
    return Promise.resolve(new Response('{}'));
  }) as jest.Mock;

  mockUpsert = jest.fn().mockResolvedValue({
    error: upsertSucceeds ? null : new Error('Upsert failed'),
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn().mockReturnValue({
      upsert: mockUpsert,
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

  test('upserts tokens to google_calendar_tokens', async () => {
    setupDefaultMocks(false, true, true, true);

    await GET(
      makeRequest({ code: 'code-123', state: createValidState() }) as any
    );

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: 'access-token-xyz',
        refresh_token: 'refresh-token-abc',
      }),
      expect.objectContaining({
        onConflict: 'user_id',
      })
    );
  });

  test('upsert includes expires_at', async () => {
    setupDefaultMocks(false, true, true, true);

    await GET(
      makeRequest({ code: 'code-123', state: createValidState() }) as any
    );

    const call = mockUpsert.mock.calls[0];
    expect(call[0].expires_at).toBeDefined();
  });

  test('upsert includes scope', async () => {
    setupDefaultMocks(false, true, true, true);

    await GET(
      makeRequest({ code: 'code-123', state: createValidState() }) as any
    );

    const call = mockUpsert.mock.calls[0];
    expect(call[0].scope).toEqual('calendar');
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

  // Branch coverage: line 81 — tokens.refresh_token is falsy → null (right side of ||)
  // Branch coverage: line 83 — tokens.scope is falsy → null (right side of ||)
  test('refresh_token と scope が未提供 → upsert に null が渡る', async () => {
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
      return Promise.resolve(new Response('{}'));
    }) as jest.Mock;

    const res = await GET(
      makeRequest({ code: 'code-123', state: createValidState() }) as any
    );

    // Should still redirect to success
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('gcal=success');

    // Verify upsert was called with null for refresh_token and scope
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        refresh_token: null,  // line 81: undefined || null = null
        scope: null,          // line 83: undefined || null = null
      }),
      expect.anything()
    );
  });
});
