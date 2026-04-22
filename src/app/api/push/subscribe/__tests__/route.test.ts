/**
 * @jest-environment node
 *
 * Tests for POST /api/push/subscribe
 * Key assertions:
 *   - CSRF check required
 *   - Rate limiting (10 req/min per IP)
 *   - Auth required (user context)
 *   - Subscription payload validation (endpoint, keys)
 *   - Endpoint HTTPS + length validation
 *   - Upsert to push_subscriptions table
 */

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: 'mutationLimit',
  checkRateLimit: jest.fn(),
}));
jest.mock('@supabase/ssr');
jest.mock('next/headers');

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST } from '../route';

let mockUpsert: jest.Mock;
let mockGetUser: jest.Mock;

function setupDefaultMocks(
  hasUser: boolean = true,
  upsertSucceeds: boolean = true
) {
  (checkCsrf as jest.Mock).mockReturnValue(null);

  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: hasUser ? { id: 'user-123' } : null },
  });

  mockUpsert = jest.fn().mockResolvedValue({
    error: upsertSucceeds ? null : { message: 'Upsert failed' },
  });

  const { createServerClient } = require('@supabase/ssr');
  createServerClient.mockReturnValue({
    auth: { getUser: mockGetUser },
    from: jest.fn().mockReturnValue({
      upsert: mockUpsert,
    }),
  });

  const { cookies } = require('next/headers');
  cookies.mockResolvedValue({
    get: jest.fn(() => ({ value: 'cookie-value' })),
  });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  setupDefaultMocks();
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

describe('POST /api/push/subscribe', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await POST(
      makeRequest({ endpoint: 'https://example.com', keys: { p256dh: 'abc', auth: 'def' } }) as any
    );

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(
      makeRequest({ endpoint: 'https://example.com', keys: { p256dh: 'abc', auth: 'def' } }) as any
    );

    expect(res.status).toBe(429);
  });

  test('unauthenticated → 401', async () => {
    setupDefaultMocks(false);

    const res = await POST(
      makeRequest({ endpoint: 'https://example.com', keys: { p256dh: 'abc', auth: 'def' } }) as any
    );

    expect(res.status).toBe(401);
  });

  test('invalid JSON → 400', async () => {
    const req = new Request('http://localhost/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.1' },
      body: 'invalid {',
    });

    const res = await POST(req as any);

    expect(res.status).toBe(400);
  });

  test('missing endpoint → 400', async () => {
    const res = await POST(
      makeRequest({ keys: { p256dh: 'abc', auth: 'def' } }) as any
    );

    expect(res.status).toBe(400);
  });

  test('missing keys → 400', async () => {
    const res = await POST(
      makeRequest({ endpoint: 'https://example.com' }) as any
    );

    expect(res.status).toBe(400);
  });

  test('missing p256dh key → 400', async () => {
    const res = await POST(
      makeRequest({ endpoint: 'https://example.com', keys: { auth: 'def' } }) as any
    );

    expect(res.status).toBe(400);
  });

  test('missing auth key → 400', async () => {
    const res = await POST(
      makeRequest({ endpoint: 'https://example.com', keys: { p256dh: 'abc' } }) as any
    );

    expect(res.status).toBe(400);
  });

  test('endpoint must be HTTPS → 400', async () => {
    const res = await POST(
      makeRequest({ endpoint: 'http://example.com', keys: { p256dh: 'abc', auth: 'def' } }) as any
    );

    expect(res.status).toBe(400);
  });

  test('endpoint > 2048 chars → 400', async () => {
    const res = await POST(
      makeRequest({
        endpoint: 'https://' + 'x'.repeat(2048),
        keys: { p256dh: 'abc', auth: 'def' },
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('p256dh > 200 chars → 400', async () => {
    const res = await POST(
      makeRequest({
        endpoint: 'https://example.com',
        keys: { p256dh: 'x'.repeat(201), auth: 'def' },
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('auth > 100 chars → 400', async () => {
    const res = await POST(
      makeRequest({
        endpoint: 'https://example.com',
        keys: { p256dh: 'abc', auth: 'x'.repeat(101) },
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('valid subscription → 200 with ok', async () => {
    const res = await POST(
      makeRequest({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
        keys: { p256dh: 'abcdefg', auth: 'hijklmn' },
      }) as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  test('upserts subscription with user_id', async () => {
    const res = await POST(
      makeRequest({
        endpoint: 'https://example.com/subscription',
        keys: { p256dh: 'key1', auth: 'key2' },
      }) as any
    );

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-123',
      }),
      expect.anything()
    );
  });

  test('upsert uses onConflict=user_id', async () => {
    const res = await POST(
      makeRequest({
        endpoint: 'https://example.com/subscription',
        keys: { p256dh: 'key1', auth: 'key2' },
      }) as any
    );

    const call = mockUpsert.mock.calls[0];
    expect(call[1]).toEqual({ onConflict: 'user_id' });
  });

  test('upsert error → 500', async () => {
    setupDefaultMocks(true, false);

    const res = await POST(
      makeRequest({
        endpoint: 'https://example.com',
        keys: { p256dh: 'abc', auth: 'def' },
      }) as any
    );

    expect(res.status).toBe(500);
  });

  test('includes updated_at timestamp', async () => {
    const res = await POST(
      makeRequest({
        endpoint: 'https://example.com',
        keys: { p256dh: 'abc', auth: 'def' },
      }) as any
    );

    const call = mockUpsert.mock.calls[0];
    expect(call[0].updated_at).toBeDefined();
  });

  test('rate limit params (10 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(
      makeRequest(
        {
          endpoint: 'https://example.com',
          keys: { p256dh: 'abc', auth: 'def' },
        },
        '192.168.1.1'
      ) as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(10);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('rl:push-sub');
  });

  test('extracts first IP from x-forwarded-for', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(
      makeRequest(
        {
          endpoint: 'https://example.com',
          keys: { p256dh: 'abc', auth: 'def' },
        },
        '10.0.0.1, 192.168.1.1'
      ) as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('10.0.0.1');
  });

  test('exception during processing → 500', async () => {
    const { createServerClient } = require('@supabase/ssr');
    createServerClient.mockImplementation(() => {
      throw new Error('Connection error');
    });

    const res = await POST(
      makeRequest({
        endpoint: 'https://example.com',
        keys: { p256dh: 'abc', auth: 'def' },
      }) as any
    );

    expect(res.status).toBe(500);
  });
});
