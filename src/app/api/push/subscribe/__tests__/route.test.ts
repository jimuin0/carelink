/**
 * @jest-environment node
 *
 * Tests for POST /api/push/subscribe
 * Key assertions:
 *   - CSRF check required
 *   - Rate limiting (10 req/min per IP)
 *   - Auth required
 *   - Subscription validation (endpoint HTTPS, max lengths, keys required)
 *   - Upsert on conflict (user_id)
 *   - Error handling with Sentry
 */

jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: 'mutationLimit',
  checkRateLimit: jest.fn(),
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@supabase/ssr');
jest.mock('next/headers');
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST } from '../route';

let mockGetUser: jest.Mock;
let mockUpsert: jest.Mock;

function setupDefaultMocks(hasUser: boolean = true, upsertError: boolean = false) {
  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: hasUser ? { id: 'user-123', email: 'test@example.com' } : null },
  });

  mockUpsert = jest.fn().mockResolvedValue({
    error: upsertError ? { message: 'Insert failed' } : null,
  });

  const { createServerClient } = require('@supabase/ssr');
  createServerClient.mockReturnValue({
    auth: { getUser: mockGetUser },
    from: jest.fn((table: string) => {
      if (table === 'push_subscriptions') {
        return { upsert: mockUpsert };
      }
    }),
  });

  const { cookies } = require('next/headers');
  cookies.mockResolvedValue({
    get: jest.fn(() => ({ value: 'test-cookie' })),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  setupDefaultMocks();

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
});

function makeRequest(body: object, ip = '192.168.1.1') {
  return new Request('http://localhost/api/push/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

const validSubscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/valid-endpoint',
  keys: {
    p256dh: 'base64encodedup256dhpublickey',
    auth: 'base64auth',
  },
};

describe('POST /api/push/subscribe', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF failed' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await POST(makeRequest(validSubscription) as any);

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(makeRequest(validSubscription) as any);

    expect(res.status).toBe(429);
  });

  test('unauthenticated user → 401', async () => {
    setupDefaultMocks(false);

    const res = await POST(makeRequest(validSubscription) as any);

    expect(res.status).toBe(401);
  });

  test('invalid JSON → 400', async () => {
    const req = new Request('http://localhost/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '192.168.1.1',
      },
      body: 'invalid json {',
    });

    const res = await POST(req as any);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid JSON');
  });

  test('missing endpoint → 400', async () => {
    const res = await POST(
      makeRequest({
        keys: { p256dh: 'key1', auth: 'key2' },
      })
    );

    expect(res.status).toBe(400);
  });

  test('missing keys → 400', async () => {
    const res = await POST(
      makeRequest({
        endpoint: 'https://example.com/push',
      })
    );

    expect(res.status).toBe(400);
  });

  test('missing p256dh key → 400', async () => {
    const res = await POST(
      makeRequest({
        endpoint: 'https://example.com/push',
        keys: { auth: 'key' },
      })
    );

    expect(res.status).toBe(400);
  });

  test('missing auth key → 400', async () => {
    const res = await POST(
      makeRequest({
        endpoint: 'https://example.com/push',
        keys: { p256dh: 'key' },
      })
    );

    expect(res.status).toBe(400);
  });

  test('endpoint not HTTPS → 400', async () => {
    const res = await POST(
      makeRequest({
        endpoint: 'http://example.com/push',
        keys: { p256dh: 'key1', auth: 'key2' },
      })
    );

    expect(res.status).toBe(400);
  });

  test('endpoint too long (>2048) → 400', async () => {
    const res = await POST(
      makeRequest({
        endpoint: 'https://' + 'x'.repeat(2050),
        keys: { p256dh: 'key1', auth: 'key2' },
      })
    );

    expect(res.status).toBe(400);
  });

  test('p256dh too long (>200) → 400', async () => {
    const res = await POST(
      makeRequest({
        endpoint: 'https://example.com/push',
        keys: { p256dh: 'x'.repeat(201), auth: 'key2' },
      })
    );

    expect(res.status).toBe(400);
  });

  test('auth too long (>100) → 400', async () => {
    const res = await POST(
      makeRequest({
        endpoint: 'https://example.com/push',
        keys: { p256dh: 'key1', auth: 'x'.repeat(101) },
      })
    );

    expect(res.status).toBe(400);
  });

  test('endpoint non-string → 400', async () => {
    const res = await POST(
      makeRequest({
        endpoint: 123,
        keys: { p256dh: 'key1', auth: 'key2' },
      })
    );

    expect(res.status).toBe(400);
  });

  test('valid subscription → 200 with ok', async () => {
    const res = await POST(makeRequest(validSubscription));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  test('valid subscription with max-length keys → 200', async () => {
    const res = await POST(
      makeRequest({
        endpoint: 'https://example.com/' + 'x'.repeat(2000),
        keys: { p256dh: 'x'.repeat(200), auth: 'x'.repeat(100) },
      })
    );

    expect(res.status).toBe(200);
  });

  test('upserts subscription with user_id conflict', async () => {
    await POST(makeRequest(validSubscription));

    expect(mockUpsert).toHaveBeenCalledWith(
      {
        user_id: 'user-123',
        endpoint: validSubscription.endpoint,
        p256dh: validSubscription.keys.p256dh,
        auth: validSubscription.keys.auth,
        updated_at: expect.any(String),
      },
      { onConflict: 'user_id' }
    );
  });

  test('Supabase upsert error → 500', async () => {
    setupDefaultMocks(true, true);

    const res = await POST(makeRequest(validSubscription) as any);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('Failed to save');
  });

  test('rate limit params (10 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(makeRequest(validSubscription, '192.168.1.1') as any);

    expect(checkRateLimit).toHaveBeenCalled();
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(10);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('rl:push-sub');
  });

  test('extracts first IP from x-forwarded-for', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(makeRequest(validSubscription, '10.0.0.1, 192.168.1.1') as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('10.0.0.1');
  });

  test('uses unknown IP when x-forwarded-for missing', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    const req = new Request('http://localhost/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validSubscription),
    });

    await POST(req as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('updated_at field set to current ISO timestamp', async () => {
    const beforeTime = new Date();
    await POST(makeRequest(validSubscription));
    const afterTime = new Date();

    const callArgs = mockUpsert.mock.calls[0][0];
    const updatedAt = new Date(callArgs.updated_at);

    expect(updatedAt.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
    expect(updatedAt.getTime()).toBeLessThanOrEqual(afterTime.getTime());
  });

  test('FCM endpoint example accepted', async () => {
    const res = await POST(
      makeRequest({
        endpoint: 'https://fcm.googleapis.com/fcm/send/ABC123:APA91bHj0',
        keys: { p256dh: 'validbase64', auth: 'validauth' },
      })
    );

    expect(res.status).toBe(200);
  });

  test('caught exception sends to Sentry', async () => {
    const { captureException } = require('@sentry/nextjs');
    const testError = new Error('Unexpected error');

    mockGetUser.mockRejectedValue(testError);

    await POST(makeRequest(validSubscription) as any);

    expect(captureException).toHaveBeenCalledWith(testError, expect.any(Object));
  });

  test('request.json() error handled gracefully → 400', async () => {
    const req = new Request('http://localhost/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.1' },
      body: 'invalid',
    });

    const res = await POST(req as any);

    expect(res.status).toBe(400);
  });
});
