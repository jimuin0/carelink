/**
 * @jest-environment node
 *
 * Tests for POST /api/liff/auth
 * Key assertions:
 *   - Rate limiting (20 req/min per IP)
 *   - access_token required and validation
 *   - LINE token validation via profile API
 *   - Linking with existing profiles
 *   - Error handling
 */

jest.mock('@/lib/rate-limit', () => ({
  inMemoryRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server');

import { inMemoryRateLimit } from '@/lib/rate-limit';
import { POST } from '../route';

let mockSingle: jest.Mock;

function setupDefaultMocks(
  profileFound: boolean = true,
  lineTokenValid: boolean = true
) {
  global.fetch = jest.fn((url: string) => {
    if (url.includes('api.line.me/v2/profile')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            userId: 'line-user-123',
            displayName: 'Test User',
            pictureUrl: 'https://example.com/pic.jpg',
          }),
          { ok: lineTokenValid, status: lineTokenValid ? 200 : 401 }
        )
      );
    }
    return Promise.resolve(new Response('{}'));
  }) as jest.Mock;

  mockSingle = jest.fn().mockResolvedValue({
    data: profileFound
      ? {
          id: 'user-456',
          display_name: 'Test User',
          email: 'test@example.com',
          avatar_url: 'https://example.com/pic.jpg',
        }
      : null,
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: mockSingle,
        }),
      }),
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  setupDefaultMocks();
});

function makeRequest(body: object, ip = '192.168.1.1') {
  return new Request('http://localhost/api/liff/auth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/liff/auth', () => {
  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await POST(
      makeRequest({ access_token: 'valid-token' }) as any
    );

    expect(res.status).toBe(429);
  });

  test('missing access_token → 400', async () => {
    const res = await POST(makeRequest({}) as any);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('access_token');
  });

  test('access_token not string → 400', async () => {
    const res = await POST(makeRequest({ access_token: 123 }) as any);

    expect(res.status).toBe(400);
  });

  test('access_token too long (>512) → 400', async () => {
    const res = await POST(
      makeRequest({ access_token: 'x'.repeat(513) }) as any
    );

    expect(res.status).toBe(400);
  });

  test('invalid LINE token → 401', async () => {
    setupDefaultMocks(true, false);

    const res = await POST(
      makeRequest({ access_token: 'invalid-token' }) as any
    );

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('Invalid LINE token');
  });

  test('valid token with linked profile → 200', async () => {
    setupDefaultMocks(true, true);

    const res = await POST(
      makeRequest({ access_token: 'valid-token' }) as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.line_user_id).toBe('line-user-123');
    expect(json.linked).toBe(true);
    expect(json.profile).toBeDefined();
  });

  test('valid token without linked profile → 200 with linked=false', async () => {
    setupDefaultMocks(false, true);

    const res = await POST(
      makeRequest({ access_token: 'valid-token' }) as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.line_user_id).toBe('line-user-123');
    expect(json.linked).toBe(false);
    expect(json.profile).toBeNull();
  });

  test('response includes LINE profile data', async () => {
    const res = await POST(
      makeRequest({ access_token: 'valid-token' }) as any
    );

    const json = await res.json();
    expect(json.display_name).toBe('Test User');
    expect(json.picture_url).toBe('https://example.com/pic.jpg');
  });

  test('calls LINE profile API with access token', async () => {
    await POST(makeRequest({ access_token: 'my-token' }) as any);

    const call = (global.fetch as jest.Mock).mock.calls.find((c) =>
      c[0].includes('api.line.me/v2/profile')
    );
    expect(call).toBeDefined();
    expect(call[1].headers.Authorization).toBe('Bearer my-token');
  });

  test('rate limit params (20 req/min per IP)', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    POST(makeRequest({ access_token: 'token' }, '192.168.1.1') as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('192.168.1.1');
    expect(call[1]).toBe(20);
    expect(call[2]).toBe(60_000);
    expect(call[3]).toBe('liff-auth');
  });

  test('extracts first IP from x-forwarded-for', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    POST(
      makeRequest({ access_token: 'token' }, '10.0.0.1, 192.168.1.1') as any
    );

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('10.0.0.1');
  });

  test('uses unknown IP when x-forwarded-for missing', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    const req = new Request('http://localhost/api/liff/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: 'token' }),
    });

    POST(req as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('unknown');
  });

  test('invalid JSON → 500', async () => {
    const req = new Request('http://localhost/api/liff/auth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '192.168.1.1',
      },
      body: 'invalid {',
    });

    const res = await POST(req as any);

    expect(res.status).toBe(500);
  });

  test('exception during flow → 500', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Network error'));

    const res = await POST(
      makeRequest({ access_token: 'token' }) as any
    );

    expect(res.status).toBe(500);
  });

  test('max-length access_token (512) accepted', async () => {
    const res = await POST(
      makeRequest({ access_token: 'x'.repeat(512) }) as any
    );

    expect(res.status).toBe(200);
  });
});
