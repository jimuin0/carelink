/**
 * @jest-environment node
 *
 * Tests for POST/DELETE /api/liff/link
 * Key assertions:
 *   - POST: Link Supabase user with LINE account
 *   - DELETE: Unlink LINE account
 *   - CSRF validation
 *   - Rate limiting (10 req/min POST, 5 req/min DELETE)
 *   - Auth required (session-based)
 *   - LINE token validation
 *   - IDOR prevention (no duplicate line_user_id linking)
 *   - access_token validation (max 512 chars)
 */

jest.mock('@/lib/supabase-server-auth');
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/line', () => ({
  verifyLineAccessToken: jest.fn(() => Promise.resolve({ ok: true, userId: 'line-user-verified' })),
}));
jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => Promise.resolve(false)),
}));

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST, DELETE } from '../route';

let mockGetUser: jest.Mock;
let mockProfilesSelect: jest.Mock;
let mockProfilesUpdate: jest.Mock;

function setupDefaultMocks(
  hasUser: boolean = true,
  lineTokenValid: boolean = true,
  otherUserHasLineId: boolean = false,
  updateFails: boolean = false
) {
  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: hasUser ? { id: 'user-123' } : null },
  });

  global.fetch = jest.fn((url: string) => {
    if (url.includes('api.line.me/v2/profile')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            userId: 'line-user-456',
          }),
          { ok: lineTokenValid, status: lineTokenValid ? 200 : 401 }
        )
      );
    }
    return Promise.resolve(new Response('{}'));
  }) as jest.Mock;

  const selectResult = { data: otherUserHasLineId ? { id: 'user-999' } : null };
  mockProfilesSelect = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      neq: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue(selectResult),
      }),
    }),
  });

  mockProfilesUpdate = jest.fn().mockReturnValue({
    eq: jest.fn().mockResolvedValue({
      error: updateFails ? new Error('DB error') : null,
    }),
  });

  const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
  createServerSupabaseAuthClient.mockResolvedValue({
    auth: { getUser: mockGetUser },
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn().mockReturnValue({
      select: mockProfilesSelect,
      update: mockProfilesUpdate,
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  setupDefaultMocks();
});

function makePostRequest(body: object, ip = '192.168.1.1') {
  return new Request('http://localhost/api/liff/link', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(ip = '192.168.1.1') {
  return new Request('http://localhost/api/liff/link', {
    method: 'DELETE',
    headers: {
      'x-forwarded-for': ip,
    },
  });
}

describe('POST/DELETE /api/liff/link', () => {
  describe('POST', () => {
    test('rate limiting → 429', async () => {
      (checkRateLimit as jest.Mock).mockResolvedValue(true);

      const res = await POST(
        makePostRequest({ access_token: 'valid-token' }) as any
      );

      expect(res.status).toBe(429);
    });

    test('CSRF check failed → returns error', async () => {
      (checkCsrf as jest.Mock).mockReturnValue(
        new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 })
      );

      const res = await POST(
        makePostRequest({ access_token: 'valid-token' }) as any
      );

      expect(res.status).toBe(403);
    });

    test('unauthenticated → 401', async () => {
      setupDefaultMocks(false);

      const res = await POST(
        makePostRequest({ access_token: 'valid-token' }) as any
      );

      expect(res.status).toBe(401);
    });

    test('missing access_token → 400', async () => {
      const res = await POST(makePostRequest({}) as any);

      expect(res.status).toBe(400);
    });

    test('access_token not string → 400', async () => {
      const res = await POST(makePostRequest({ access_token: 123 }) as any);

      expect(res.status).toBe(400);
    });

    test('access_token too long (>512) → 400', async () => {
      const res = await POST(
        makePostRequest({ access_token: 'x'.repeat(513) }) as any
      );

      expect(res.status).toBe(400);
    });

    test('invalid LINE token → 401', async () => {
      setupDefaultMocks(true, false);

      const res = await POST(
        makePostRequest({ access_token: 'invalid-token' }) as any
      );

      expect(res.status).toBe(401);
    });

    test('LINE account already linked to another user → 409', async () => {
      setupDefaultMocks(true, true, true);

      const res = await POST(
        makePostRequest({ access_token: 'valid-token' }) as any
      );

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.error).toContain('別のユーザーに紐付けられています');
    });

    test('valid linking → 200 with ok: true', async () => {
      const res = await POST(
        makePostRequest({ access_token: 'valid-token' }) as any
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    test('update fails → 500', async () => {
      setupDefaultMocks(true, true, false, true);

      const res = await POST(
        makePostRequest({ access_token: 'valid-token' }) as any
      );

      expect(res.status).toBe(500);
    });

    test('profile update includes line_user_id and updated_at', async () => {
      await POST(makePostRequest({ access_token: 'valid-token' }) as any);

      expect(mockProfilesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          line_user_id: 'line-user-456',
          updated_at: expect.any(String),
        })
      );
    });

    test('rate limit params (10 req/min per IP)', async () => {
      (checkRateLimit as jest.Mock).mockClear();

      await POST(
        makePostRequest({ access_token: 'token' }, '192.168.1.1') as any
      );

      const call = (checkRateLimit as jest.Mock).mock.calls[0];
      expect(call[1]).toBe('192.168.1.1');
      expect(call[2]).toBe(10);
      expect(call[3]).toBe(60_000);
      expect(call[4]).toBe('liff-link');
    });

    test('extracts last (trusted) IP from x-forwarded-for', async () => {
      (checkRateLimit as jest.Mock).mockClear();

      await POST(
        makePostRequest(
          { access_token: 'token' },
          '10.0.0.1, 192.168.1.1'
        ) as any
      );

      const call = (checkRateLimit as jest.Mock).mock.calls[0];
      expect(call[1]).toBe('192.168.1.1');
    });

    test('uses unknown IP when x-forwarded-for missing', async () => {
      (checkRateLimit as jest.Mock).mockClear();

      const req = new Request('http://localhost/api/liff/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: 'token' }),
      });

      await POST(req as any);

      const call = (checkRateLimit as jest.Mock).mock.calls[0];
      expect(call[1]).toBe('unknown');
    });

    test('exception during flow → 500', async () => {
      (global.fetch as jest.Mock).mockRejectedValue(new Error('Network'));

      const res = await POST(
        makePostRequest({ access_token: 'token' }) as any
      );

      expect(res.status).toBe(500);
    });

    test('max-length access_token (512) accepted', async () => {
      const res = await POST(
        makePostRequest({ access_token: 'x'.repeat(512) }) as any
      );

      expect(res.status).toBe(200);
    });

    test('checks other users do not have this line_user_id', async () => {
      await POST(makePostRequest({ access_token: 'token' }) as any);

      // Should call select().eq('line_user_id', ...).neq('id', ...)
      expect(mockProfilesSelect).toHaveBeenCalled();
    });

    // R2 audience検証: 他チャネル発行トークン（client_id不一致）→ 401（!tokenCheck.ok 分岐）
    test('verifyLineAccessToken fails (audience mismatch) → 401', async () => {
      const { verifyLineAccessToken } = require('@/lib/line');
      (verifyLineAccessToken as jest.Mock).mockResolvedValueOnce({ ok: false });
      const res = await POST(
        makePostRequest({ access_token: 'foreign-token' }) as any
      );
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toContain('Invalid LINE token');
    });
  });

  describe('DELETE', () => {
    test('rate limiting → 429', async () => {
      (checkRateLimit as jest.Mock).mockResolvedValue(true);

      const res = await DELETE(makeDeleteRequest() as any);

      expect(res.status).toBe(429);
    });

    test('CSRF check failed → returns error', async () => {
      (checkCsrf as jest.Mock).mockReturnValue(
        new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 })
      );

      const res = await DELETE(makeDeleteRequest() as any);

      expect(res.status).toBe(403);
    });

    test('unauthenticated → 401', async () => {
      setupDefaultMocks(false);

      const res = await DELETE(makeDeleteRequest() as any);

      expect(res.status).toBe(401);
    });

    test('valid unlink → 200 with ok: true', async () => {
      const res = await DELETE(makeDeleteRequest() as any);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
    });

    test('update fails → 500', async () => {
      setupDefaultMocks(true, true, false, true);

      const res = await DELETE(makeDeleteRequest() as any);

      expect(res.status).toBe(500);
    });

    test('profile update sets line_user_id to null', async () => {
      await DELETE(makeDeleteRequest() as any);

      expect(mockProfilesUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          line_user_id: null,
          updated_at: expect.any(String),
        })
      );
    });

    test('rate limit params (5 req/min per IP)', async () => {
      (checkRateLimit as jest.Mock).mockClear();

      await DELETE(makeDeleteRequest('192.168.1.1') as any);

      const call = (checkRateLimit as jest.Mock).mock.calls[0];
      expect(call[1]).toBe('192.168.1.1');
      expect(call[2]).toBe(5);
      expect(call[3]).toBe(60_000);
      expect(call[4]).toBe('liff-link-delete');
    });

    test('exception during flow → 500', async () => {
      mockGetUser.mockRejectedValue(new Error('Auth error'));

      const res = await DELETE(makeDeleteRequest() as any);

      expect(res.status).toBe(500);
    });

    // Branch coverage: line 67 — x-forwarded-for ヘッダなし → 'unknown' を使用（|| right side）
    test('DELETE: x-forwarded-for ヘッダなし → IP=unknown（line 67 || false 分岐）', async () => {
      (checkRateLimit as jest.Mock).mockClear();
      const req = new Request('http://localhost/api/liff/link', { method: 'DELETE' });
      await DELETE(req as any);
      const call = (checkRateLimit as jest.Mock).mock.calls[0];
      expect(call[1]).toBe('unknown');
    });
  });
});
