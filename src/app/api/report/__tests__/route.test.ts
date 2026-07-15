/**
 * @jest-environment node
 *
 * Tests for POST /api/report
 *
 * 【2026年7月15日 要ログイン化】HPB 準拠・通報は会員前提（神原さん確定）。
 * withRoute(requireAuth: true) に統一。未認証は 401 で遮断し、匿名通報は許可しない。
 *
 * Key assertions:
 *   - CSRF check required
 *   - Rate limiting (5 req/min per IP)
 *   - Auth required (unauthenticated → 401, handler/DB not reached)
 *   - Schema validation (target_type, target_id UUID, reason enum, detail max 500)
 *   - Authenticated report records user_id
 *   - Duplicate report prevention (23505 handling)
 *   - IP logging alongside user_id
 */

jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: 'mutationLimit',
  checkRateLimit: jest.fn(),
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@supabase/ssr');
jest.mock('next/headers');
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(),
  createServerSupabaseClient: jest.fn(),
}));

import { checkRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';
import { POST } from '../route';

let mockGetUser: jest.Mock;
let mockInsert: jest.Mock;

function setupDefaultMocks(
  hasUser: boolean = true,
  insertSucceeds: boolean = true
) {
  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: hasUser ? { id: 'user-123' } : null },
  });

  mockInsert = jest.fn().mockResolvedValue({
    error: insertSucceeds ? null : { code: 'db-error' },
  });

  // 認証判定のみ anon SSR クライアント（createServerClient・withRoute 内部の
  // createServerSupabaseAuthClient 経由で使われる）
  const { createServerClient } = require('@supabase/ssr');
  createServerClient.mockReturnValue({
    auth: { getUser: mockGetUser },
  });

  // DB 書き込みは service_role クライアント（createServiceRoleClient）
  const { createServiceRoleClient } = require('@/lib/supabase-server');
  (createServiceRoleClient as jest.Mock).mockReturnValue({
    from: jest.fn().mockReturnValue({
      insert: mockInsert,
    }),
  });

  const { cookies } = require('next/headers');
  cookies.mockResolvedValue({
    getAll: jest.fn(() => []),
    set: jest.fn(),
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
  return new Request('http://localhost/api/report', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

const VALID_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

const validReport = {
  target_type: 'review',
  target_id: VALID_UUID,
  reason: 'spam',
};

describe('POST /api/report', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF' }), {
      status: 403,
    });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await POST(makeRequest(validReport) as any);

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(makeRequest(validReport) as any);

    expect(res.status).toBe(429);
  });

  test('unauthenticated → 401（通報は要ログイン・HPB準拠）', async () => {
    setupDefaultMocks(false);

    const res = await POST(makeRequest(validReport) as any);

    expect(res.status).toBe(401);
    // 未認証時はハンドラ本体（DB insert）に到達しない
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('unauthenticated → DB へは一切書き込まれない', async () => {
    setupDefaultMocks(false);

    await POST(makeRequest(validReport) as any);

    const { createServiceRoleClient } = require('@/lib/supabase-server');
    // requireAuth で 401 遮断された場合、service_role クライアントの生成自体も
    // ハンドラ本体側で行われるため呼ばれない（withRoute が呼ぶのは認証前）
    expect((createServiceRoleClient as jest.Mock).mock.calls.length).toBe(0);
  });

  test('missing target_type → 400', async () => {
    const res = await POST(
      makeRequest({
        target_id: VALID_UUID,
        reason: 'spam',
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('invalid target_type → 400', async () => {
    const res = await POST(
      makeRequest({
        target_type: 'invalid',
        target_id: VALID_UUID,
        reason: 'spam',
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('missing target_id → 400', async () => {
    const res = await POST(
      makeRequest({
        target_type: 'review',
        reason: 'spam',
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('invalid target_id UUID → 400', async () => {
    const res = await POST(
      makeRequest({
        target_type: 'review',
        target_id: 'not-uuid',
        reason: 'spam',
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('missing reason → 400', async () => {
    const res = await POST(
      makeRequest({
        target_type: 'review',
        target_id: VALID_UUID,
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('invalid reason enum → 400', async () => {
    const res = await POST(
      makeRequest({
        target_type: 'review',
        target_id: VALID_UUID,
        reason: 'invalid-reason',
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('detail too long (>500) → 400', async () => {
    const res = await POST(
      makeRequest({
        target_type: 'review',
        target_id: VALID_UUID,
        reason: 'spam',
        detail: 'x'.repeat(501),
      }) as any
    );

    expect(res.status).toBe(400);
  });

  test('valid report (authenticated) → 200 with success', async () => {
    const res = await POST(makeRequest(validReport) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('valid report with detail → 200', async () => {
    const res = await POST(
      makeRequest({
        ...validReport,
        detail: 'This review contains offensive language',
      }) as any
    );

    expect(res.status).toBe(200);
  });

  test('valid report with max-length detail (500) → 200', async () => {
    const res = await POST(
      makeRequest({
        ...validReport,
        detail: 'x'.repeat(500),
      }) as any
    );

    expect(res.status).toBe(200);
  });

  test('all valid target_types accepted', async () => {
    const types = ['review', 'facility', 'photo'];

    for (const type of types) {
      const res = await POST(
        makeRequest({
          target_type: type,
          target_id: VALID_UUID,
          reason: 'spam',
        }) as any
      );

      expect(res.status).toBe(200);
    }
  });

  test('all valid reasons accepted', async () => {
    const reasons = ['spam', 'inappropriate', 'fake', 'offensive', 'other'];

    for (const reason of reasons) {
      const res = await POST(
        makeRequest({
          target_type: 'review',
          target_id: VALID_UUID,
          reason: reason,
        }) as any
      );

      expect(res.status).toBe(200);
    }
  });

  test('authenticated report → includes user_id（通報者の追跡性）', async () => {
    setupDefaultMocks(true);

    await POST(makeRequest(validReport) as any);

    const insertCall = mockInsert.mock.calls[0];
    expect(insertCall[0].reporter_user_id).toBe('user-123');
  });

  test('report includes IP address', async () => {
    await POST(makeRequest(validReport, '10.20.30.40') as any);

    const insertCall = mockInsert.mock.calls[0];
    expect(insertCall[0].reporter_ip).toBe('10.20.30.40');
  });

  test('duplicate report (unique constraint 23505) → 409', async () => {
    setupDefaultMocks(true, false);
    mockInsert.mockResolvedValueOnce({
      error: { code: '23505', message: 'Unique constraint violation' },
    });

    const res = await POST(makeRequest(validReport) as any);

    expect(res.status).toBe(409);
  });

  test('other DB error → 500', async () => {
    setupDefaultMocks(true, false);
    mockInsert.mockResolvedValueOnce({
      error: { code: 'some-other-error', message: 'Some error' },
    });

    const res = await POST(makeRequest(validReport) as any);

    expect(res.status).toBe(500);
  });

  test('invalid JSON → 400', async () => {
    const req = new Request('http://localhost/api/report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '192.168.1.1',
      },
      body: 'invalid {',
    });

    const res = await POST(req as any);

    expect(res.status).toBe(400);
  });

  test('rate limit params (5 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(makeRequest(validReport, '192.168.1.1') as any);

    expect(checkRateLimit).toHaveBeenCalled();
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(5);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('report');
  });

  test('extracts last (trusted) IP from x-forwarded-for', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(
      makeRequest(validReport, '10.0.0.1, 192.168.1.1') as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('uses unknown IP when x-forwarded-for missing', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    const req = new Request('http://localhost/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validReport),
    });

    await POST(req as any);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('detail optional (null when omitted)', async () => {
    await POST(
      makeRequest({
        target_type: 'review',
        target_id: VALID_UUID,
        reason: 'spam',
      }) as any
    );

    const insertCall = mockInsert.mock.calls[0];
    expect(insertCall[0].detail).toBeNull();
  });
});
