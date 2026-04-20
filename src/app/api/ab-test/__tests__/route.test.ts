/**
 * @jest-environment node
 *
 * Tests for POST/GET /api/ab-test
 * POST Key assertions:
 *   - Rate limiting → silent ignore (ok: true)
 *   - Invalid schema → silent ignore (ok: true)
 *   - user_id from auth session (not from body)
 *   - All valid event types accepted
 *   - All valid variants accepted
 *   - Session ID optional
 *   - Metadata optional and flexible
 *
 * GET Key assertions:
 *   - Rate limiting → 429
 *   - Unauthenticated → 401
 *   - Non-admin user → 403
 *   - Missing key param → 400
 *   - Key too long → 400
 *   - Admin user → 200 with stats
 *   - Conversion rate calculation
 *   - Lift calculation
 */

jest.mock('@/lib/rate-limit', () => ({ inMemoryRateLimit: jest.fn(() => false) }));
jest.mock('@/lib/supabase-server-auth', () => ({
  createServerSupabaseAuthClient: jest.fn(() => ({
    auth: { getUser: jest.fn() },
    from: jest.fn(),
  })),
}));
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(),
  })),
}));

import { inMemoryRateLimit } from '@/lib/rate-limit';
import { POST, GET } from '../route';

let mockGetUser: jest.Mock;
let mockAuthFrom: jest.Mock;
let mockAdminFrom: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
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

  const { createClient } = require('@supabase/supabase-js');
  mockAdminFrom = jest.fn();
  createClient.mockReturnValue({
    from: mockAdminFrom,
  });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

function makePostRequest(body: object, ip = '192.168.1.1') {
  return new Request('http://localhost/api/ab-test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(key?: string, ip = '192.168.1.1') {
  const { NextRequest } = require('next/server');
  const url = key
    ? `http://localhost/api/ab-test?key=${encodeURIComponent(key)}`
    : 'http://localhost/api/ab-test';
  const req = new NextRequest(url, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
  return req;
}

describe('POST /api/ab-test', () => {
  test('rate limiting → silent ignore with ok: true', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const mockInsert = jest.fn().mockResolvedValue({ data: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makePostRequest({
      experiment_key: 'exp_1',
      variant: 'control',
      event_type: 'impression',
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('invalid schema → silent ignore with ok: true', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ data: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makePostRequest({
      // missing experiment_key
      variant: 'control',
      event_type: 'impression',
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('invalid JSON → silent ignore with ok: true', async () => {
    const req = new Request('http://localhost/api/ab-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.1' },
      body: 'invalid json {',
    });

    const res = await POST(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  test('valid event → inserts with user_id from session', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ data: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    await POST(makePostRequest({
      experiment_key: 'exp_1',
      variant: 'control',
      event_type: 'impression',
    }));

    expect(mockInsert).toHaveBeenCalledWith({
      experiment_key: 'exp_1',
      variant: 'control',
      event_type: 'impression',
      user_id: 'user-123',
      session_id: null,
      page_path: null,
      metadata: {},
    });
  });

  test('variant: treatment accepted', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ data: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    await POST(makePostRequest({
      experiment_key: 'exp_1',
      variant: 'treatment',
      event_type: 'conversion',
    }));

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'treatment' })
    );
  });

  test('event_type: conversion accepted', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ data: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    await POST(makePostRequest({
      experiment_key: 'exp_1',
      variant: 'control',
      event_type: 'conversion',
    }));

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'conversion' })
    );
  });

  test('event_type: click accepted', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ data: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    await POST(makePostRequest({
      experiment_key: 'exp_1',
      variant: 'control',
      event_type: 'click',
    }));

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'click' })
    );
  });

  test('event_type: booking accepted', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ data: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    await POST(makePostRequest({
      experiment_key: 'exp_1',
      variant: 'control',
      event_type: 'booking',
    }));

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'booking' })
    );
  });

  test('session_id optional → 200', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ data: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makePostRequest({
      experiment_key: 'exp_1',
      variant: 'control',
      event_type: 'impression',
      session_id: 'session-abc',
    }));

    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: 'session-abc' })
    );
  });

  test('session_id too long → silent ignore', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ data: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makePostRequest({
      experiment_key: 'exp_1',
      variant: 'control',
      event_type: 'impression',
      session_id: 'a'.repeat(101),
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('page_path optional → 200', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ data: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makePostRequest({
      experiment_key: 'exp_1',
      variant: 'control',
      event_type: 'impression',
      page_path: '/services/haircut',
    }));

    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ page_path: '/services/haircut' })
    );
  });

  test('page_path too long → silent ignore', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ data: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makePostRequest({
      experiment_key: 'exp_1',
      variant: 'control',
      event_type: 'impression',
      page_path: 'a'.repeat(501),
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('metadata optional → 200', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ data: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makePostRequest({
      experiment_key: 'exp_1',
      variant: 'control',
      event_type: 'impression',
      metadata: { country: 'JP', device: 'mobile' },
    }));

    expect(res.status).toBe(200);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { country: 'JP', device: 'mobile' },
      })
    );
  });

  test('user_id from body ignored (IDOR prevention)', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ data: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    await POST(makePostRequest({
      experiment_key: 'exp_1',
      variant: 'control',
      event_type: 'impression',
      user_id: 'attacker-user-id', // This should be ignored
    } as any));

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-123', // From session, not from body
      })
    );
  });

  test('anonymous user (no session) → user_id null', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const mockInsert = jest.fn().mockResolvedValue({ data: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    await POST(makePostRequest({
      experiment_key: 'exp_1',
      variant: 'control',
      event_type: 'impression',
    }));

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: null })
    );
  });

  test('experiment_key too long → silent ignore', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ data: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makePostRequest({
      experiment_key: 'a'.repeat(101),
      variant: 'control',
      event_type: 'impression',
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('invalid variant → silent ignore', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ data: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makePostRequest({
      experiment_key: 'exp_1',
      variant: 'invalid',
      event_type: 'impression',
    } as any));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('invalid event_type → silent ignore', async () => {
    const mockInsert = jest.fn().mockResolvedValue({ data: null });
    mockAdminFrom.mockReturnValue({ insert: mockInsert });

    const res = await POST(makePostRequest({
      experiment_key: 'exp_1',
      variant: 'control',
      event_type: 'invalid',
    } as any));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe('GET /api/ab-test', () => {
  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await GET(makeGetRequest('test_exp'));

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain('多すぎます');
  });

  test('unauthenticated → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await GET(makeGetRequest('test_exp'));

    expect(res.status).toBe(401);
  });

  test('non-admin user → 403', async () => {
    const mockSelect = jest.fn().mockReturnThis();
    const mockEq = jest.fn().mockReturnThis();
    const mockSingle = jest.fn().mockResolvedValue({
      data: { is_platform_admin: false },
    });

    mockSelect.mockReturnValue({
      eq: mockEq,
    });
    mockEq.mockReturnValue({
      single: mockSingle,
    });

    mockAuthFrom.mockReturnValue({
      select: mockSelect,
    });

    const res = await GET(makeGetRequest('test_exp'));

    expect(res.status).toBe(403);
  });

  test('missing key param → 400', async () => {
    const mockSelect = jest.fn().mockReturnThis();
    const mockEq = jest.fn().mockReturnThis();
    const mockSingle = jest.fn().mockResolvedValue({
      data: { is_platform_admin: true },
    });

    mockSelect.mockReturnValue({
      eq: mockEq,
    });
    mockEq.mockReturnValue({
      single: mockSingle,
    });

    mockAuthFrom.mockReturnValue({
      select: mockSelect,
    });

    const res = await GET(makeGetRequest());

    expect(res.status).toBe(400);
  });

  test('key too long → 400', async () => {
    const mockSelect = jest.fn().mockReturnThis();
    const mockEq = jest.fn().mockReturnThis();
    const mockSingle = jest.fn().mockResolvedValue({
      data: { is_platform_admin: true },
    });

    mockSelect.mockReturnValue({
      eq: mockEq,
    });
    mockEq.mockReturnValue({
      single: mockSingle,
    });

    mockAuthFrom.mockReturnValue({
      select: mockSelect,
    });

    const res = await GET(makeGetRequest('a'.repeat(101)));

    expect(res.status).toBe(400);
  });

  test('admin user with valid key → 200 with stats', async () => {
    const mockSelect = jest.fn().mockReturnThis();
    const mockEq = jest.fn().mockReturnThis();
    const mockSingle = jest.fn().mockResolvedValue({
      data: { is_platform_admin: true },
    });
    const mockSelectEvents = jest.fn().mockReturnThis();
    const mockEqEvents = jest.fn().mockResolvedValue({
      data: [
        { variant: 'control', event_type: 'impression' },
        { variant: 'control', event_type: 'impression' },
        { variant: 'control', event_type: 'conversion' },
        { variant: 'treatment', event_type: 'impression' },
        { variant: 'treatment', event_type: 'impression' },
        { variant: 'treatment', event_type: 'impression' },
        { variant: 'treatment', event_type: 'conversion' },
        { variant: 'treatment', event_type: 'conversion' },
      ],
    });

    mockSelect.mockReturnValue({
      eq: mockEq,
    });
    mockEq.mockReturnValue({
      single: mockSingle,
    });

    mockAuthFrom.mockReturnValue({
      select: mockSelect,
    });

    mockSelectEvents.mockReturnValue({
      eq: mockEqEvents,
    });

    mockAdminFrom.mockReturnValue({
      select: mockSelectEvents,
    });

    const res = await GET(makeGetRequest('test_exp'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.experiment_key).toBe('test_exp');
    expect(json.control).toBeDefined();
    expect(json.treatment).toBeDefined();
    expect(json.lift).toBeDefined();
  });

  test('conversion rate calculation: control 50%', async () => {
    const mockSelect = jest.fn().mockReturnThis();
    const mockEq = jest.fn().mockReturnThis();
    const mockSingle = jest.fn().mockResolvedValue({
      data: { is_platform_admin: true },
    });
    const mockSelectEvents = jest.fn().mockReturnThis();
    const mockEqEvents = jest.fn().mockResolvedValue({
      data: [
        { variant: 'control', event_type: 'impression' },
        { variant: 'control', event_type: 'impression' },
        { variant: 'control', event_type: 'conversion' },
      ],
    });

    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ single: mockSingle });
    mockAuthFrom.mockReturnValue({ select: mockSelect });

    mockSelectEvents.mockReturnValue({ eq: mockEqEvents });
    mockAdminFrom.mockReturnValue({ select: mockSelectEvents });

    const res = await GET(makeGetRequest('test_exp'));

    const json = await res.json();
    expect(json.control.conversion_rate).toBe(50);
  });

  test('conversion rate: treatment 66.7%', async () => {
    const mockSelect = jest.fn().mockReturnThis();
    const mockEq = jest.fn().mockReturnThis();
    const mockSingle = jest.fn().mockResolvedValue({
      data: { is_platform_admin: true },
    });
    const mockSelectEvents = jest.fn().mockReturnThis();
    const mockEqEvents = jest.fn().mockResolvedValue({
      data: [
        { variant: 'treatment', event_type: 'impression' },
        { variant: 'treatment', event_type: 'impression' },
        { variant: 'treatment', event_type: 'impression' },
        { variant: 'treatment', event_type: 'conversion' },
        { variant: 'treatment', event_type: 'conversion' },
      ],
    });

    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ single: mockSingle });
    mockAuthFrom.mockReturnValue({ select: mockSelect });

    mockSelectEvents.mockReturnValue({ eq: mockEqEvents });
    mockAdminFrom.mockReturnValue({ select: mockSelectEvents });

    const res = await GET(makeGetRequest('test_exp'));

    const json = await res.json();
    expect(json.treatment.conversion_rate).toBe(66.7);
  });

  test('lift calculation: treatment beats control', async () => {
    const mockSelect = jest.fn().mockReturnThis();
    const mockEq = jest.fn().mockReturnThis();
    const mockSingle = jest.fn().mockResolvedValue({
      data: { is_platform_admin: true },
    });
    const mockSelectEvents = jest.fn().mockReturnThis();
    const mockEqEvents = jest.fn().mockResolvedValue({
      data: [
        { variant: 'control', event_type: 'impression' },
        { variant: 'control', event_type: 'impression' },
        { variant: 'control', event_type: 'conversion' },
        { variant: 'treatment', event_type: 'impression' },
        { variant: 'treatment', event_type: 'impression' },
        { variant: 'treatment', event_type: 'impression' },
        { variant: 'treatment', event_type: 'conversion' },
        { variant: 'treatment', event_type: 'conversion' },
      ],
    });

    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ single: mockSingle });
    mockAuthFrom.mockReturnValue({ select: mockSelect });

    mockSelectEvents.mockReturnValue({ eq: mockEqEvents });
    mockAdminFrom.mockReturnValue({ select: mockSelectEvents });

    const res = await GET(makeGetRequest('test_exp'));

    const json = await res.json();
    // control: 1/2 = 50%, treatment: 2/3 = 66.7%, lift = 16.7%
    expect(json.lift).toBeGreaterThan(0);
    expect(json.treatment.conversion_rate).toBeGreaterThan(
      json.control.conversion_rate
    );
  });

  test('no data for experiment → results null', async () => {
    const mockSelect = jest.fn().mockReturnThis();
    const mockEq = jest.fn().mockReturnThis();
    const mockSingle = jest.fn().mockResolvedValue({
      data: { is_platform_admin: true },
    });
    const mockSelectEvents = jest.fn().mockReturnThis();
    const mockEqEvents = jest.fn().mockResolvedValue({
      data: null,
    });

    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ single: mockSingle });
    mockAuthFrom.mockReturnValue({ select: mockSelect });

    mockSelectEvents.mockReturnValue({ eq: mockEqEvents });
    mockAdminFrom.mockReturnValue({ select: mockSelectEvents });

    const res = await GET(makeGetRequest('nonexistent_exp'));

    const json = await res.json();
    expect(json.results).toBeNull();
  });

  test('rate limit called on GET', async () => {
    (inMemoryRateLimit as jest.Mock).mockClear();
    (inMemoryRateLimit as jest.Mock).mockReturnValue(false);

    const mockSelect = jest.fn().mockReturnThis();
    const mockEq = jest.fn().mockReturnThis();
    const mockSingle = jest.fn().mockResolvedValue({
      data: { is_platform_admin: true },
    });

    mockSelect.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ single: mockSingle });
    mockAuthFrom.mockReturnValue({ select: mockSelect });

    mockAdminFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ data: null }),
      }),
    });

    await GET(makeGetRequest('test_exp'));

    expect(inMemoryRateLimit).toHaveBeenCalled();
  });
});
