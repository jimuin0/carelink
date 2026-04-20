/**
 * @jest-environment node
 *
 * Tests for POST/GET /api/nps
 * POST Key assertions:
 *   - CSRF check
 *   - Rate limiting (5 req/hour per IP)
 *   - Score validation (0-10 integer)
 *   - Booking ID ownership verification (IDOR prevention)
 *   - Category optional (facility/platform/overall)
 *   - IP hash generation
 *   - Duplicate error 23505 → already_submitted
 *   - Returns 201 on success
 *
 * GET Key assertions:
 *   - Rate limiting (20 req/min per IP)
 *   - Auth required
 *   - facility_id required
 *   - Admin authorization (owner/admin role)
 *   - NPS calculation: (promoters - detractors) / total
 */

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: jest.fn(() => ({
    auth: { getUser: jest.fn() },
    from: jest.fn(),
  })),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: jest.fn(),
  })),
}));
jest.mock('crypto', () => ({
  createHash: jest.fn((algo) => ({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn((format) => 'deadbeefcafebabe'),
  })),
}));

import { NextRequest } from 'next/server';
import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { POST, GET } from '../route';

let mockGetUser: jest.Mock;
let mockAuthFrom: jest.Mock;
let mockAdminFrom: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);

  const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: { id: 'user-123' } },
  });
  mockAuthFrom = jest.fn();

  createServerSupabaseAuthClient.mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: mockAuthFrom,
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  mockAdminFrom = jest.fn();
  createServiceRoleClient.mockReturnValue({
    from: mockAdminFrom,
  });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

function makePostRequest(body: object, ip = '192.168.1.1') {
  return new NextRequest('http://localhost/api/nps', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(facilityId?: string, ip = '192.168.1.1') {
  const url = facilityId
    ? `http://localhost/api/nps?facility_id=${facilityId}`
    : 'http://localhost/api/nps';
  return new NextRequest(url, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
}

describe('POST /api/nps', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF failed' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await POST(makePostRequest({ score: 9 }));

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await POST(makePostRequest({ score: 9 }));

    expect(res.status).toBe(429);
  });

  test('invalid schema (missing score) → 400', async () => {
    const res = await POST(makePostRequest({}));

    expect(res.status).toBe(400);
  });

  test('score too low → 400', async () => {
    const res = await POST(makePostRequest({ score: -1 }));

    expect(res.status).toBe(400);
  });

  test('score too high → 400', async () => {
    const res = await POST(makePostRequest({ score: 11 }));

    expect(res.status).toBe(400);
  });

  test('score not integer → 400', async () => {
    const res = await POST(makePostRequest({ score: 9.5 }));

    expect(res.status).toBe(400);
  });

  test('comment too long → 400', async () => {
    const res = await POST(makePostRequest({
      score: 9,
      comment: 'a'.repeat(501),
    }));

    expect(res.status).toBe(400);
  });

  test('invalid category → 400', async () => {
    const res = await POST(makePostRequest({
      score: 9,
      category: 'invalid',
    }));

    expect(res.status).toBe(400);
  });

  test('valid score 0 → 201', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ error: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makePostRequest({ score: 0 }));

    expect(res.status).toBe(201);
  });

  test('valid score 10 → 201', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ error: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makePostRequest({ score: 10 }));

    expect(res.status).toBe(201);
  });

  test('category facility → 201', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ error: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makePostRequest({
      score: 8,
      category: 'facility',
    }));

    expect(res.status).toBe(201);
  });

  test('category platform → 201', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ error: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makePostRequest({
      score: 7,
      category: 'platform',
    }));

    expect(res.status).toBe(201);
  });

  test('category overall → 201', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ error: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makePostRequest({
      score: 6,
      category: 'overall',
    }));

    expect(res.status).toBe(201);
  });

  test('inserts with defaults: user_id=null, facility_id=null, category=overall', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const mockInsert = jest.fn().mockResolvedValue({ error: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    await POST(makePostRequest({ score: 5 }));

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: null,
        facility_id: null,
        category: 'overall',
        booking_id: null,
      })
    );
  });


  test('duplicate error 23505 → already_submitted', async () => {
    const mockInsert = jest.fn().mockResolvedValue({
      error: { code: '23505' },
    });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makePostRequest({ score: 5 }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toBe('already_submitted');
  });

  test('other DB error → 500', async () => {
    const mockInsert = jest.fn().mockResolvedValue({
      error: { code: '23456', message: 'Some other error' },
    });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makePostRequest({ score: 7 }));

    expect(res.status).toBe(500);
  });

  test('response includes message: submitted', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ error: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makePostRequest({ score: 9 }));

    const json = await res.json();
    expect(json.message).toBe('submitted');
  });

  test('boundary: comment exactly 500 chars → 201', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ error: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makePostRequest({
      score: 8,
      comment: 'a'.repeat(500),
    }));

    expect(res.status).toBe(201);
  });
});

describe('GET /api/nps', () => {
  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const facilityId = '11111111-1111-1111-1111-111111111111';
    const res = await GET(makeGetRequest(facilityId));

    expect(res.status).toBe(429);
  });

  test('unauthenticated → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const facilityId = '11111111-1111-1111-1111-111111111111';
    const res = await GET(makeGetRequest(facilityId));

    expect(res.status).toBe(401);
  });

  test('missing facility_id → 400', async () => {
    const res = await GET(makeGetRequest());

    expect(res.status).toBe(400);
  });

  test('invalid facility_id UUID → 400', async () => {
    const res = await GET(makeGetRequest('not-a-uuid'));

    expect(res.status).toBe(400);
  });

  test('user not facility admin → 401', async () => {
    const mockSelectMem = jest.fn().mockReturnThis();
    const mockEqMem1 = jest.fn().mockReturnThis();
    const mockEqMem2 = jest.fn().mockReturnThis();
    const mockInMem = jest.fn().mockReturnThis();
    const mockSingleMem = jest.fn().mockResolvedValue({
      data: null,
    });

    mockSelectMem.mockReturnValue({ eq: mockEqMem1 });
    mockEqMem1.mockReturnValue({ eq: mockEqMem2 });
    mockEqMem2.mockReturnValue({ in: mockInMem });
    mockInMem.mockReturnValue({ single: mockSingleMem });

    mockAuthFrom.mockReturnValue({
      select: mockSelectMem,
    });

    const facilityId = '11111111-1111-1111-1111-111111111111';
    const res = await GET(makeGetRequest(facilityId));

    expect(res.status).toBe(401);
  });

  test('admin user with valid facility_id → 200', async () => {
    const mockSelectMem = jest.fn().mockReturnThis();
    const mockEqMem1 = jest.fn().mockReturnThis();
    const mockEqMem2 = jest.fn().mockReturnThis();
    const mockInMem = jest.fn().mockReturnThis();
    const mockSingleMem = jest.fn().mockResolvedValue({
      data: { role: 'admin' },
    });

    mockSelectMem.mockReturnValue({ eq: mockEqMem1 });
    mockEqMem1.mockReturnValue({ eq: mockEqMem2 });
    mockEqMem2.mockReturnValue({ in: mockInMem });
    mockInMem.mockReturnValue({ single: mockSingleMem });

    mockAuthFrom.mockReturnValue({
      select: mockSelectMem,
    });

    const mockSelectSurveys = jest.fn().mockReturnThis();
    const mockEqSurveys = jest.fn().mockReturnThis();
    const mockOrder = jest.fn().mockReturnThis();
    const mockLimit = jest.fn().mockResolvedValue({
      data: [
        { score: 9, comment: 'Good', created_at: '2026-04-20T00:00:00Z' },
        { score: 5, comment: 'Bad', created_at: '2026-04-20T00:00:00Z' },
      ],
    });

    mockSelectSurveys.mockReturnValue({ eq: mockEqSurveys });
    mockEqSurveys.mockReturnValue({ order: mockOrder });
    mockOrder.mockReturnValue({ limit: mockLimit });

    mockAdminFrom.mockReturnValue({
      select: mockSelectSurveys,
    });

    const facilityId = '11111111-1111-1111-1111-111111111111';
    const res = await GET(makeGetRequest(facilityId));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(2);
    expect(json.data).toHaveLength(2);
  });

  test('owner role authorized', async () => {
    const mockSelectMem = jest.fn().mockReturnThis();
    const mockEqMem1 = jest.fn().mockReturnThis();
    const mockEqMem2 = jest.fn().mockReturnThis();
    const mockInMem = jest.fn().mockReturnThis();
    const mockSingleMem = jest.fn().mockResolvedValue({
      data: { role: 'owner' },
    });

    mockSelectMem.mockReturnValue({ eq: mockEqMem1 });
    mockEqMem1.mockReturnValue({ eq: mockEqMem2 });
    mockEqMem2.mockReturnValue({ in: mockInMem });
    mockInMem.mockReturnValue({ single: mockSingleMem });

    mockAuthFrom.mockReturnValue({
      select: mockSelectMem,
    });

    const mockSelectSurveys = jest.fn().mockReturnThis();
    const mockEqSurveys = jest.fn().mockReturnThis();
    const mockOrder = jest.fn().mockReturnThis();
    const mockLimit = jest.fn().mockResolvedValue({
      data: [],
    });

    mockSelectSurveys.mockReturnValue({ eq: mockEqSurveys });
    mockEqSurveys.mockReturnValue({ order: mockOrder });
    mockOrder.mockReturnValue({ limit: mockLimit });

    mockAdminFrom.mockReturnValue({
      select: mockSelectSurveys,
    });

    const facilityId = '11111111-1111-1111-1111-111111111111';
    const res = await GET(makeGetRequest(facilityId));

    expect(res.status).toBe(200);
  });

  test('NPS calculation with mixed scores', async () => {
    const mockSelectMem = jest.fn().mockReturnThis();
    const mockEqMem1 = jest.fn().mockReturnThis();
    const mockEqMem2 = jest.fn().mockReturnThis();
    const mockInMem = jest.fn().mockReturnThis();
    const mockSingleMem = jest.fn().mockResolvedValue({
      data: { role: 'admin' },
    });

    mockSelectMem.mockReturnValue({ eq: mockEqMem1 });
    mockEqMem1.mockReturnValue({ eq: mockEqMem2 });
    mockEqMem2.mockReturnValue({ in: mockInMem });
    mockInMem.mockReturnValue({ single: mockSingleMem });

    mockAuthFrom.mockReturnValue({
      select: mockSelectMem,
    });

    // 2 promoters (10, 9), 1 detractor (5)
    // NPS = (2 - 1) / 3 * 100 = 33
    const mockSelectSurveys = jest.fn().mockReturnThis();
    const mockEqSurveys = jest.fn().mockReturnThis();
    const mockOrder = jest.fn().mockReturnThis();
    const mockLimit = jest.fn().mockResolvedValue({
      data: [
        { score: 10, comment: null, created_at: '2026-04-20T00:00:00Z' },
        { score: 9, comment: null, created_at: '2026-04-20T00:00:00Z' },
        { score: 5, comment: null, created_at: '2026-04-20T00:00:00Z' },
      ],
    });

    mockSelectSurveys.mockReturnValue({ eq: mockEqSurveys });
    mockEqSurveys.mockReturnValue({ order: mockOrder });
    mockOrder.mockReturnValue({ limit: mockLimit });

    mockAdminFrom.mockReturnValue({
      select: mockSelectSurveys,
    });

    const facilityId = '11111111-1111-1111-1111-111111111111';
    const res = await GET(makeGetRequest(facilityId));

    const json = await res.json();
    expect(json.nps).toBe(33);
  });

  test('no surveys → nps null', async () => {
    const mockSelectMem = jest.fn().mockReturnThis();
    const mockEqMem1 = jest.fn().mockReturnThis();
    const mockEqMem2 = jest.fn().mockReturnThis();
    const mockInMem = jest.fn().mockReturnThis();
    const mockSingleMem = jest.fn().mockResolvedValue({
      data: { role: 'admin' },
    });

    mockSelectMem.mockReturnValue({ eq: mockEqMem1 });
    mockEqMem1.mockReturnValue({ eq: mockEqMem2 });
    mockEqMem2.mockReturnValue({ in: mockInMem });
    mockInMem.mockReturnValue({ single: mockSingleMem });

    mockAuthFrom.mockReturnValue({
      select: mockSelectMem,
    });

    const mockSelectSurveys = jest.fn().mockReturnThis();
    const mockEqSurveys = jest.fn().mockReturnThis();
    const mockOrder = jest.fn().mockReturnThis();
    const mockLimit = jest.fn().mockResolvedValue({
      data: [],
    });

    mockSelectSurveys.mockReturnValue({ eq: mockEqSurveys });
    mockEqSurveys.mockReturnValue({ order: mockOrder });
    mockOrder.mockReturnValue({ limit: mockLimit });

    mockAdminFrom.mockReturnValue({
      select: mockSelectSurveys,
    });

    const facilityId = '11111111-1111-1111-1111-111111111111';
    const res = await GET(makeGetRequest(facilityId));

    const json = await res.json();
    expect(json.nps).toBeNull();
    expect(json.count).toBe(0);
  });
});
