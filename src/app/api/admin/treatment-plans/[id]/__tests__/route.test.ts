/**
 * @jest-environment node
 *
 * Tests for PATCH /api/admin/treatment-plans/[id]
 * Key assertions:
 *   - CSRF check
 *   - Rate limiting
 *   - UUID validation (plan id, facility_id)
 *   - Admin authorization check
 *   - Zod schema validation (status enum, completed_sessions bounds)
 *   - Facility ownership verification
 *   - Audit logging
 */

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/audit-logger', () => ({
  writeAuditLog: jest.fn(),
}));

const mockGetUser = jest.fn();
const mockFacilitySelect = jest.fn().mockReturnThis();
const mockTreatmentUpdate = jest.fn();

jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: jest.fn((table: string) => {
      if (table === 'facility_members') {
        return {
          select: mockFacilitySelect,
        };
      }
    }),
  })),
}));

jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(() => ({
    from: jest.fn((table: string) => {
      if (table === 'treatment_plans') {
        return { update: mockTreatmentUpdate };
      }
    }),
  })),
}));

import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { writeAuditLog } from '@/lib/audit-logger';
import { PATCH } from '../route';

const PLAN_UUID = '11111111-1111-1111-1111-111111111111';
const FACILITY_UUID = '22222222-2222-2222-2222-222222222222';
const USER_ID = '33333333-3333-3333-3333-333333333333';

function makeRequest(body: object, searchParams = '') {
  return new NextRequest(
    `http://localhost/api/admin/treatment-plans/${PLAN_UUID}${searchParams}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.1' },
      body: JSON.stringify(body),
    }
  );
}

import { NextRequest } from 'next/server';

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });

  mockFacilitySelect.mockReturnValue({
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: { facility_id: FACILITY_UUID },
      error: null,
    }),
  });

  mockTreatmentUpdate.mockReturnValue({
    eq: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({
      data: { id: PLAN_UUID, status: 'active' },
      error: null,
    }),
  });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

describe('PATCH /api/admin/treatment-plans/[id]', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF failed' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await PATCH(makeRequest({ status: 'active' }), {
      params: Promise.resolve({ id: PLAN_UUID }),
    });

    expect(res.status).toBe(403);
    (checkCsrf as jest.Mock).mockReturnValue(null);
  });

  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await PATCH(makeRequest({ status: 'active' }), {
      params: Promise.resolve({ id: PLAN_UUID }),
    });

    expect(res.status).toBe(429);
  });

  test('invalid plan ID UUID → 400', async () => {
    const res = await PATCH(makeRequest({ status: 'active' }), {
      params: Promise.resolve({ id: 'bad-uuid' }),
    });

    expect(res.status).toBe(400);
  });

  test('unauthenticated → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await PATCH(makeRequest({ status: 'active' }), {
      params: Promise.resolve({ id: PLAN_UUID }),
    });

    expect(res.status).toBe(401);
  });

  test('missing facility_id query param → 401', async () => {
    const res = await PATCH(makeRequest({ status: 'active' }), {
      params: Promise.resolve({ id: PLAN_UUID }),
    });

    expect(res.status).toBe(401);
  });

  test('invalid facility_id UUID → 401', async () => {
    const res = await PATCH(makeRequest({ status: 'active' }, '?facility_id=bad-uuid'), {
      params: Promise.resolve({ id: PLAN_UUID }),
    });

    expect(res.status).toBe(401);
  });

  test('user not facility admin → 401', async () => {
    mockFacilitySelect.mockReturnValue({
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    });

    const res = await PATCH(makeRequest({ status: 'active' }, `?facility_id=${FACILITY_UUID}`), {
      params: Promise.resolve({ id: PLAN_UUID }),
    });

    expect(res.status).toBe(401);
  });

  test('invalid status enum → 400', async () => {
    const res = await PATCH(
      makeRequest({ status: 'invalid_status' }, `?facility_id=${FACILITY_UUID}`),
      { params: Promise.resolve({ id: PLAN_UUID }) }
    );

    expect(res.status).toBe(400);
  });

  test('completed_sessions negative → 400', async () => {
    const res = await PATCH(
      makeRequest({ completed_sessions: -1 }, `?facility_id=${FACILITY_UUID}`),
      { params: Promise.resolve({ id: PLAN_UUID }) }
    );

    expect(res.status).toBe(400);
  });

  test('completed_sessions too high → 400', async () => {
    const res = await PATCH(
      makeRequest({ completed_sessions: 10000 }, `?facility_id=${FACILITY_UUID}`),
      { params: Promise.resolve({ id: PLAN_UUID }) }
    );

    expect(res.status).toBe(400);
  });

  test('valid status update → 200', async () => {
    const res = await PATCH(
      makeRequest({ status: 'completed' }, `?facility_id=${FACILITY_UUID}`),
      { params: Promise.resolve({ id: PLAN_UUID }) }
    );

    expect(res.status).toBe(200);
  });

  test('valid completed_sessions update → 200', async () => {
    const res = await PATCH(
      makeRequest({ completed_sessions: 5 }, `?facility_id=${FACILITY_UUID}`),
      { params: Promise.resolve({ id: PLAN_UUID }) }
    );

    expect(res.status).toBe(200);
  });

  test('all valid statuses accepted', async () => {
    const statuses = ['active', 'completed', 'discontinued', 'paused'];

    for (const status of statuses) {
      mockTreatmentUpdate.mockReturnValue({
        eq: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { id: PLAN_UUID, status },
          error: null,
        }),
      });

      const res = await PATCH(
        makeRequest({ status }, `?facility_id=${FACILITY_UUID}`),
        { params: Promise.resolve({ id: PLAN_UUID }) }
      );

      expect(res.status).toBe(200);
    }
  });

  test('plan not found → 404', async () => {
    mockTreatmentUpdate.mockReturnValue({
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    });

    const res = await PATCH(
      makeRequest({ status: 'active' }, `?facility_id=${FACILITY_UUID}`),
      { params: Promise.resolve({ id: PLAN_UUID }) }
    );

    expect(res.status).toBe(404);
  });

  test('DB error → 500', async () => {
    mockTreatmentUpdate.mockReturnValue({
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { message: 'DB error' },
      }),
    });

    const res = await PATCH(
      makeRequest({ status: 'active' }, `?facility_id=${FACILITY_UUID}`),
      { params: Promise.resolve({ id: PLAN_UUID }) }
    );

    expect(res.status).toBe(500);
  });

  test('writes audit log on success', async () => {
    await PATCH(
      makeRequest({ status: 'completed' }, `?facility_id=${FACILITY_UUID}`),
      { params: Promise.resolve({ id: PLAN_UUID }) }
    );

    expect(writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        facilityId: FACILITY_UUID,
        action: 'update',
        tableName: 'treatment_plans',
        recordId: PLAN_UUID,
      })
    );
  });

  test('invalid JSON → 400', async () => {
    const req = new NextRequest(
      `http://localhost/api/admin/treatment-plans/${PLAN_UUID}?facility_id=${FACILITY_UUID}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json {',
      }
    );

    const res = await PATCH(req, { params: Promise.resolve({ id: PLAN_UUID }) });

    expect(res.status).toBe(400);
  });

  test('empty body → 200 (no-op update)', async () => {
    const res = await PATCH(
      makeRequest({}, `?facility_id=${FACILITY_UUID}`),
      { params: Promise.resolve({ id: PLAN_UUID }) }
    );

    expect(res.status).toBe(200);
  });
});
