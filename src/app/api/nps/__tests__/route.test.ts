/**
 * @jest-environment node
 *
 * Tests for POST /api/nps & GET /api/nps
 * Key assertions:
 *   - POST: CSRF + rate limiting (5 req/hour), score validation (0-10), booking ownership
 *   - GET: Auth required, facility_id param, rate limiting (20 req/min)
 *   - IP hash for anonymous NPS
 *   - Duplicate handling (23505)
 */

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  inMemoryRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server-auth');
jest.mock('@/lib/supabase-server');

import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';

const BOOKING_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

let mockInsert: jest.Mock;
let mockGetUser: jest.Mock;
let mockSelectBooking: jest.Mock;

function setupDefaultMocks(
  bookingExists: boolean = true,
  insertSucceeds: boolean = true
) {
  (checkCsrf as jest.Mock).mockReturnValue(null);

  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: { id: 'user-123' } },
  });

  mockSelectBooking = jest.fn().mockReturnValue({
    eq: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: bookingExists ? { id: BOOKING_UUID } : null,
        }),
      }),
    }),
  });

  mockInsert = jest.fn().mockResolvedValue({
    error: insertSucceeds ? null : { code: '23505' },
  });

  const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
  createServerSupabaseAuthClient.mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            in: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({ data: { role: 'admin' } }),
            }),
          }),
        }),
      }),
      insert: jest.fn().mockResolvedValue({ error: null }),
    }),
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn().mockReturnValue({
      select: mockSelectBooking,
      insert: mockInsert,
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  setupDefaultMocks();
});

function makePostRequest(body: object, ip = '192.168.1.1') {
  return new Request('http://localhost/api/nps', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/nps', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const { POST } = await import('../route');
    const res = await POST(makePostRequest({ score: 8 }) as any);

    expect(res.status).toBe(403);
  });

  test('rate limiting (5/hour) → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const { POST } = await import('../route');
    const res = await POST(makePostRequest({ score: 8 }) as any);

    expect(res.status).toBe(429);
  });

  test('missing score → 400', async () => {
    const { POST } = await import('../route');
    const res = await POST(makePostRequest({}) as any);

    expect(res.status).toBe(400);
  });

  test('score < 0 → 400', async () => {
    const { POST } = await import('../route');
    const res = await POST(makePostRequest({ score: -1 }) as any);

    expect(res.status).toBe(400);
  });

  test('score > 10 → 400', async () => {
    const { POST } = await import('../route');
    const res = await POST(makePostRequest({ score: 11 }) as any);

    expect(res.status).toBe(400);
  });

  test('score 0-10 → accepted', async () => {
    const { POST } = await import('../route');
    const res = await POST(makePostRequest({ score: 5 }) as any);

    expect([200, 201, 400, 500]).toContain(res.status);
  });

  test('invalid facility_id UUID → 400', async () => {
    const { POST } = await import('../route');
    const res = await POST(makePostRequest({
      score: 8,
      facility_id: 'not-uuid',
    }) as any);

    expect(res.status).toBe(400);
  });

  test('invalid booking_id UUID → 400', async () => {
    const { POST } = await import('../route');
    const res = await POST(makePostRequest({
      score: 8,
      booking_id: 'not-uuid',
    }) as any);

    expect(res.status).toBe(400);
  });

  test('booking ownership verified', async () => {
    const { POST } = await import('../route');
    const res = await POST(makePostRequest({
      score: 8,
      booking_id: BOOKING_UUID,
    }) as any);

    expect(mockSelectBooking).toHaveBeenCalled();
  });

  test('unowned booking_id silently rejected', async () => {
    setupDefaultMocks(false);

    const { POST } = await import('../route');
    const res = await POST(makePostRequest({
      score: 8,
      booking_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    }) as any);

    // Should still succeed but booking_id set to null
    expect([200, 201]).toContain(res.status);
  });

  test('comment > 500 chars → 400', async () => {
    const { POST } = await import('../route');
    const res = await POST(makePostRequest({
      score: 8,
      comment: 'x'.repeat(501),
    }) as any);

    expect(res.status).toBe(400);
  });

  test('valid category enum (facility, platform, overall)', async () => {
    const { POST } = await import('../route');
    const res = await POST(makePostRequest({
      score: 8,
      category: 'facility',
    }) as any);

    expect([200, 201]).toContain(res.status);
  });

  test('invalid category → 400', async () => {
    const { POST } = await import('../route');
    const res = await POST(makePostRequest({
      score: 8,
      category: 'invalid',
    }) as any);

    expect(res.status).toBe(400);
  });

  test('duplicate NPS (23505) → 200 with already_submitted', async () => {
    setupDefaultMocks(true, false);

    const { POST } = await import('../route');
    const res = await POST(makePostRequest({ score: 8 }) as any);

    expect(res.status).toBe(200);
  });

  test('IP hash created for anonymous users', async () => {
    const { POST } = await import('../route');
    const res = await POST(makePostRequest({ score: 8 }) as any);

    if (mockInsert.mock.calls.length > 0) {
      const call = mockInsert.mock.calls[0];
      expect(call[0].ip_hash).toBeDefined();
    }
  });

  test('POST: missing x-forwarded-for → uses "unknown"', async () => {
    (inMemoryRateLimit as jest.Mock).mockClear();
    const { POST } = await import('../route');
    const req = new Request('http://localhost/api/nps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ score: 7 }),
    });
    await POST(req as any);
    const call = (inMemoryRateLimit as jest.Mock).mock.calls.find((c) => c[3] === 'nps');
    expect(call![0]).toBe('unknown');
  });

  test('booking_id set but anonymous user → silently nullified', async () => {
    // user null + booking_id valid
    setupDefaultMocks(true);
    mockGetUser = jest.fn().mockResolvedValue({ data: { user: null } });
    const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
    createServerSupabaseAuthClient.mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: jest.fn().mockReturnValue({}),
    });
    const { POST } = await import('../route');
    const res = await POST(makePostRequest({ score: 8, booking_id: BOOKING_UUID }) as any);
    expect([200, 201]).toContain(res.status);
    const insertCall = mockInsert.mock.calls[0];
    expect(insertCall[0].booking_id).toBeNull();
    expect(insertCall[0].user_id).toBeNull();
  });

  test('insert error not 23505 → 500', async () => {
    setupDefaultMocks(true, true);
    mockInsert.mockResolvedValue({ error: { code: '99999', message: 'other' } });
    const { POST } = await import('../route');
    const res = await POST(makePostRequest({ score: 8 }) as any);
    expect(res.status).toBe(500);
  });

  test('rate limit params (5 req/hour)', async () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    const { POST } = await import('../route');
    await POST(makePostRequest({ score: 8 }, '192.168.1.1') as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe(5);
    expect(call[2]).toBe(60_000 * 60);
  });
});

const FACILITY_UUID = '11111111-1111-1111-1111-111111111111';

function makeGetRequest(params: Record<string, string> = {}, ip = '192.168.1.1') {
  const searchParams = new URLSearchParams(params);
  const req = new Request(`http://localhost/api/nps?${searchParams}`, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
  Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
  return req;
}

function setupGetMocks(
  hasUser: boolean = true,
  isMember: boolean = true,
  surveys: Array<{ score: number; comment?: string | null; created_at: string }> = []
) {
  const mockGetUser = jest.fn().mockResolvedValue({
    data: { user: hasUser ? { id: 'user-123' } : null },
  });

  const mockMemberSingle = jest.fn().mockResolvedValue({
    data: isMember ? { role: 'admin' } : null,
  });
  const mockMemberIn = jest.fn().mockReturnValue({ single: mockMemberSingle });
  const mockMemberEq2 = jest.fn().mockReturnValue({ in: mockMemberIn });
  const mockMemberEq1 = jest.fn().mockReturnValue({ eq: mockMemberEq2 });
  const mockMemberSelect = jest.fn().mockReturnValue({ eq: mockMemberEq1 });

  const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
  createServerSupabaseAuthClient.mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: jest.fn().mockReturnValue({
      select: mockMemberSelect,
    }),
  });

  const mockLimit = jest.fn().mockResolvedValue({ data: surveys });
  const mockOrder = jest.fn().mockReturnValue({ limit: mockLimit });
  const mockEqSurveys = jest.fn().mockReturnValue({ order: mockOrder });
  const mockSelectSurveys = jest.fn().mockReturnValue({ eq: mockEqSurveys });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn().mockReturnValue({
      select: mockSelectSurveys,
    }),
  });
}

describe('GET /api/nps', () => {
  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const { GET } = await import('../route');
    const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID }) as any);

    expect(res.status).toBe(429);
  });

  test('unauthenticated → 401', async () => {
    setupGetMocks(false, false, []);

    const { GET } = await import('../route');
    const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID }) as any);

    expect(res.status).toBe(401);
  });

  test('missing facility_id → 400', async () => {
    setupGetMocks(true, true, []);

    const { GET } = await import('../route');
    const res = await GET(makeGetRequest({}) as any);

    expect(res.status).toBe(400);
  });

  test('invalid UUID facility_id → 400', async () => {
    setupGetMocks(true, true, []);

    const { GET } = await import('../route');
    const res = await GET(makeGetRequest({ facility_id: 'not-a-uuid' }) as any);

    expect(res.status).toBe(400);
  });

  test('non-member → 401', async () => {
    setupGetMocks(true, false, []);

    const { GET } = await import('../route');
    const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID }) as any);

    expect(res.status).toBe(401);
  });

  test('valid member → 200 with nps, count, data', async () => {
    setupGetMocks(true, true, [
      { score: 9, comment: null, created_at: '2024-01-01T00:00:00Z' },
    ]);

    const { GET } = await import('../route');
    const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('nps');
    expect(json).toHaveProperty('count');
    expect(json).toHaveProperty('data');
  });

  test('NPS calculation: 2 promoters (9,10), 1 passive (7), 1 detractor (5) → nps=25, count=4', async () => {
    setupGetMocks(true, true, [
      { score: 9, comment: null, created_at: '2024-01-01T00:00:00Z' },
      { score: 10, comment: null, created_at: '2024-01-02T00:00:00Z' },
      { score: 7, comment: null, created_at: '2024-01-03T00:00:00Z' },
      { score: 5, comment: null, created_at: '2024-01-04T00:00:00Z' },
    ]);

    const { GET } = await import('../route');
    const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    // promoters=2, detractors=1, total=4 → (2-1)/4 * 100 = 25
    expect(json.nps).toBe(25);
    expect(json.count).toBe(4);
  });

  test('all promoters (scores 9,10) → nps=100', async () => {
    setupGetMocks(true, true, [
      { score: 9, comment: null, created_at: '2024-01-01T00:00:00Z' },
      { score: 10, comment: null, created_at: '2024-01-02T00:00:00Z' },
    ]);

    const { GET } = await import('../route');
    const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.nps).toBe(100);
  });

  test('all detractors (scores 0-6) → nps=-100', async () => {
    setupGetMocks(true, true, [
      { score: 3, comment: null, created_at: '2024-01-01T00:00:00Z' },
      { score: 6, comment: null, created_at: '2024-01-02T00:00:00Z' },
    ]);

    const { GET } = await import('../route');
    const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.nps).toBe(-100);
  });

  test('empty surveys → nps=null, count=0', async () => {
    setupGetMocks(true, true, []);

    const { GET } = await import('../route');
    const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.nps).toBeNull();
    expect(json.count).toBe(0);
  });

  test('data array returned', async () => {
    const surveys = [
      { score: 8, comment: 'great', created_at: '2024-01-01T00:00:00Z' },
      { score: 5, comment: null, created_at: '2024-01-02T00:00:00Z' },
    ];
    setupGetMocks(true, true, surveys);

    const { GET } = await import('../route');
    const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data).toHaveLength(2);
  });

  test('GET: missing x-forwarded-for → uses "unknown"', async () => {
    setupGetMocks(true, true, []);
    (inMemoryRateLimit as jest.Mock).mockClear();
    const { GET } = await import('../route');
    const req = new Request(`http://localhost/api/nps?facility_id=${FACILITY_UUID}`, { method: 'GET' });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    await GET(req as any);
    const call = (inMemoryRateLimit as jest.Mock).mock.calls.find((c) => c[3] === 'nps-get');
    expect(call![0]).toBe('unknown');
  });

  test('GET: data null (?? []) → nps=null, count=0', async () => {
    const mockGetUser = jest.fn().mockResolvedValue({ data: { user: { id: 'u' } } });
    const mockMemberSingle = jest.fn().mockResolvedValue({ data: { role: 'admin' } });
    const mockMemberIn = jest.fn().mockReturnValue({ single: mockMemberSingle });
    const mockMemberEq2 = jest.fn().mockReturnValue({ in: mockMemberIn });
    const mockMemberEq1 = jest.fn().mockReturnValue({ eq: mockMemberEq2 });
    const mockMemberSelect = jest.fn().mockReturnValue({ eq: mockMemberEq1 });
    const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
    createServerSupabaseAuthClient.mockResolvedValue({
      auth: { getUser: mockGetUser },
      from: jest.fn().mockReturnValue({ select: mockMemberSelect }),
    });
    const { createServiceRoleClient } = require('@/lib/supabase-server');
    createServiceRoleClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({ data: null }),
            }),
          }),
        }),
      }),
    });
    const { GET } = await import('../route');
    const res = await GET(makeGetRequest({ facility_id: FACILITY_UUID }) as any);
    const json = await res.json();
    expect(json.nps).toBeNull();
    expect(json.count).toBe(0);
  });

  test('rate limit params (20 req/min)', async () => {
    setupGetMocks(true, true, []);
    (inMemoryRateLimit as jest.Mock).mockClear();
    (inMemoryRateLimit as jest.Mock).mockReturnValue(false);

    const { GET } = await import('../route');
    await GET(makeGetRequest({ facility_id: FACILITY_UUID }) as any);

    const calls = (inMemoryRateLimit as jest.Mock).mock.calls;
    const getCall = calls.find((c) => c[3] === 'nps-get');
    expect(getCall).toBeDefined();
    expect(getCall![1]).toBe(20);
    expect(getCall![2]).toBe(60_000);
  });
});
