/**
 * @jest-environment node
 *
 * Tests for GET/POST /api/intake
 * Key assertions:
 *   - GET: Rate limiting (30 req/min), facility_id UUID validation, template lookup
 *   - POST: CSRF check, rate limiting (5 req/min), schema validation (template_id, facility_id, customer_name UUIDs)
 *   - POST: booking_id IDOR prevention, auth requirement for booking_id
 *   - POST: responses size limit (50KB), responses storage
 */

jest.mock('@/lib/rate-limit', () => ({
  inMemoryRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@supabase/ssr');
jest.mock('next/headers');

import { inMemoryRateLimit } from '@/lib/rate-limit';
import { checkCsrf } from '@/lib/csrf';
import { GET, POST } from '../route';

let mockGetUser: jest.Mock;
let mockSelect: jest.Mock;
let mockInsert: jest.Mock;

function setupDefaultMocks(
  hasTemplate: boolean = true,
  hasUser: boolean = false,
  hasBooking: boolean = true,
  insertError: boolean = false
) {
  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: hasUser ? { id: 'user-123', email: 'test@example.com' } : null },
  });

  // Template query: .select().eq().eq().maybeSingle()
  const mockTemplateMaybeSingle = jest.fn().mockResolvedValue({
    data: hasTemplate
      ? {
          id: 'template-123',
          title: 'Health Intake',
          description: 'Customer health form',
          fields: [{ name: 'age', type: 'number' }],
        }
      : null,
  });
  const mockTemplateEq2 = jest.fn().mockReturnValue({ maybeSingle: mockTemplateMaybeSingle });
  const mockTemplateEq1 = jest.fn().mockReturnValue({ eq: mockTemplateEq2 });
  mockSelect = jest.fn().mockReturnValue({ eq: mockTemplateEq1 });

  // Booking query (POST): .select().eq().eq().maybeSingle()
  const mockBookingMaybeSingle = jest.fn().mockResolvedValue({
    data: hasBooking ? { id: 'booking-123' } : null,
  });
  const mockBookingEq2 = jest.fn().mockReturnValue({ maybeSingle: mockBookingMaybeSingle });
  const mockBookingEq1 = jest.fn().mockReturnValue({ eq: mockBookingEq2 });

  // Insert query (POST): .insert().select().single()
  const mockInsertSingle = jest
    .fn()
    .mockResolvedValue(
      insertError
        ? { data: null, error: { message: 'Insert failed' } }
        : { data: { id: 'response-123' }, error: null }
    );
  const mockInsertSelect = jest.fn().mockReturnValue({ single: mockInsertSingle });
  mockInsert = jest.fn().mockReturnValue({ select: mockInsertSelect });

  const { createServerClient } = require('@supabase/ssr');
  createServerClient.mockReturnValue({
    auth: { getUser: mockGetUser },
    from: jest.fn((table: string) => {
      if (table === 'intake_form_templates') {
        return { select: mockSelect };
      } else if (table === 'bookings') {
        return { select: jest.fn().mockReturnValue({ eq: mockBookingEq1 }) };
      } else if (table === 'intake_form_responses') {
        return { insert: mockInsert };
      }
    }),
  });

  const { cookies } = require('next/headers');
  cookies.mockResolvedValue({
    getAll: jest.fn(() => []),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  (checkCsrf as jest.Mock).mockReturnValue(null);
  setupDefaultMocks();

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
});

function makeGetRequest(query: string, ip = '192.168.1.1') {
  return new Request(`http://localhost/api/intake${query}`, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
}

function makePostRequest(body: object, ip = '192.168.1.1') {
  return new Request('http://localhost/api/intake', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

const FACILITY_UUID = '11111111-1111-1111-1111-111111111111';
const TEMPLATE_UUID = '22222222-2222-2222-2222-222222222222';
const BOOKING_UUID = '33333333-3333-3333-3333-333333333333';

describe('GET /api/intake', () => {
  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await GET(
      makeGetRequest(`?facility_id=${FACILITY_UUID}`) as any
    );

    expect(res.status).toBe(429);
  });

  test('missing facility_id → 400', async () => {
    const res = await GET(makeGetRequest('') as any);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('facility_id');
  });

  test('invalid facility_id UUID → 400', async () => {
    const res = await GET(makeGetRequest('?facility_id=not-uuid') as any);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid');
  });

  test('no template found → 200 with null template', async () => {
    setupDefaultMocks(false);

    const res = await GET(
      makeGetRequest(`?facility_id=${FACILITY_UUID}`) as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.template).toBeNull();
  });

  test('template found → 200 with template', async () => {
    const res = await GET(
      makeGetRequest(`?facility_id=${FACILITY_UUID}`) as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.template).toBeDefined();
    expect(json.template.id).toBe('template-123');
    expect(json.template.title).toBe('Health Intake');
  });

  test('rate limit params (30 req/min per IP)', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    GET(makeGetRequest(`?facility_id=${FACILITY_UUID}`, '192.168.1.1') as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('192.168.1.1');
    expect(call[1]).toBe(30);
    expect(call[2]).toBe(60_000);
    expect(call[3]).toBe('intake-get');
  });

  test('extracts first IP from x-forwarded-for', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    GET(
      makeGetRequest(
        `?facility_id=${FACILITY_UUID}`,
        '10.0.0.1, 192.168.1.1'
      ) as any
    );

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('10.0.0.1');
  });
});

describe('POST /api/intake', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF failed' }), {
      status: 403,
    });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await POST(
      makePostRequest({
        template_id: TEMPLATE_UUID,
        facility_id: FACILITY_UUID,
        customer_name: 'Test',
        responses: {},
      })
    );

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await POST(
      makePostRequest({
        template_id: TEMPLATE_UUID,
        facility_id: FACILITY_UUID,
        customer_name: 'Test',
        responses: {},
      })
    );

    expect(res.status).toBe(429);
  });

  test('missing template_id → 400', async () => {
    const res = await POST(
      makePostRequest({
        facility_id: FACILITY_UUID,
        customer_name: 'Test',
        responses: {},
      })
    );

    expect(res.status).toBe(400);
  });

  test('missing facility_id → 400', async () => {
    const res = await POST(
      makePostRequest({
        template_id: TEMPLATE_UUID,
        customer_name: 'Test',
        responses: {},
      })
    );

    expect(res.status).toBe(400);
  });

  test('missing customer_name → 400', async () => {
    const res = await POST(
      makePostRequest({
        template_id: TEMPLATE_UUID,
        facility_id: FACILITY_UUID,
        responses: {},
      })
    );

    expect(res.status).toBe(400);
  });

  test('invalid template_id UUID → 400', async () => {
    const res = await POST(
      makePostRequest({
        template_id: 'not-uuid',
        facility_id: FACILITY_UUID,
        customer_name: 'Test',
        responses: {},
      })
    );

    expect(res.status).toBe(400);
  });

  test('invalid facility_id UUID → 400', async () => {
    const res = await POST(
      makePostRequest({
        template_id: TEMPLATE_UUID,
        facility_id: 'not-uuid',
        customer_name: 'Test',
        responses: {},
      })
    );

    expect(res.status).toBe(400);
  });

  test('invalid booking_id UUID → 400', async () => {
    const res = await POST(
      makePostRequest({
        template_id: TEMPLATE_UUID,
        facility_id: FACILITY_UUID,
        customer_name: 'Test',
        booking_id: 'not-uuid',
        responses: {},
      })
    );

    expect(res.status).toBe(400);
  });

  test('responses too large (>50KB) → 400', async () => {
    const res = await POST(
      makePostRequest({
        template_id: TEMPLATE_UUID,
        facility_id: FACILITY_UUID,
        customer_name: 'Test',
        responses: { data: 'x'.repeat(60000) },
      })
    );

    expect(res.status).toBe(400);
  });

  test('invalid JSON → 400', async () => {
    const req = new Request('http://localhost/api/intake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.1' },
      body: 'invalid json {',
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  test('booking_id without auth → 401', async () => {
    const res = await POST(
      makePostRequest({
        template_id: TEMPLATE_UUID,
        facility_id: FACILITY_UUID,
        customer_name: 'Test',
        booking_id: BOOKING_UUID,
        responses: {},
      })
    );

    expect(res.status).toBe(401);
  });

  test('booking_id with auth but booking not found → 403', async () => {
    setupDefaultMocks(true, true, false);

    const res = await POST(
      makePostRequest({
        template_id: TEMPLATE_UUID,
        facility_id: FACILITY_UUID,
        customer_name: 'Test',
        booking_id: BOOKING_UUID,
        responses: {},
      })
    );

    expect(res.status).toBe(403);
  });

  test('valid minimal request → 200', async () => {
    const res = await POST(
      makePostRequest({
        template_id: TEMPLATE_UUID,
        facility_id: FACILITY_UUID,
        customer_name: 'Test User',
        responses: {},
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.id).toBe('response-123');
  });

  test('valid request with booking_id → 200', async () => {
    setupDefaultMocks(true, true, true);

    const res = await POST(
      makePostRequest({
        template_id: TEMPLATE_UUID,
        facility_id: FACILITY_UUID,
        customer_name: 'Test User',
        booking_id: BOOKING_UUID,
        responses: { age: 30, health: 'good' },
      })
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('customer_name truncated to 50 chars on insert', async () => {
    await POST(
      makePostRequest({
        template_id: TEMPLATE_UUID,
        facility_id: FACILITY_UUID,
        customer_name: 'x'.repeat(100),
        responses: {},
      })
    );

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        customer_name: 'x'.repeat(50),
      })
    );
  });

  test('null booking_id converted to null on insert', async () => {
    await POST(
      makePostRequest({
        template_id: TEMPLATE_UUID,
        facility_id: FACILITY_UUID,
        customer_name: 'Test',
        booking_id: null,
        responses: {},
      })
    );

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        booking_id: null,
      })
    );
  });

  test('optional user_id set when authenticated', async () => {
    setupDefaultMocks(true, true, true);

    await POST(
      makePostRequest({
        template_id: TEMPLATE_UUID,
        facility_id: FACILITY_UUID,
        customer_name: 'Test',
        responses: {},
      })
    );

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-123',
      })
    );
  });

  test('user_id null when not authenticated', async () => {
    await POST(
      makePostRequest({
        template_id: TEMPLATE_UUID,
        facility_id: FACILITY_UUID,
        customer_name: 'Test',
        responses: {},
      })
    );

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: null,
      })
    );
  });

  test('Supabase insert error → 500', async () => {
    setupDefaultMocks(true, false, false, true);

    const res = await POST(
      makePostRequest({
        template_id: TEMPLATE_UUID,
        facility_id: FACILITY_UUID,
        customer_name: 'Test',
        responses: {},
      })
    );

    expect(res.status).toBe(500);
  });

  test('rate limit params (5 req/min per IP)', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    POST(makePostRequest(
      {
        template_id: TEMPLATE_UUID,
        facility_id: FACILITY_UUID,
        customer_name: 'Test',
        responses: {},
      },
      '192.168.1.1'
    ));

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('192.168.1.1');
    expect(call[1]).toBe(5);
    expect(call[2]).toBe(60_000);
    expect(call[3]).toBe('intake');
  });

  test('extracts first IP from x-forwarded-for', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    POST(makePostRequest(
      {
        template_id: TEMPLATE_UUID,
        facility_id: FACILITY_UUID,
        customer_name: 'Test',
        responses: {},
      },
      '10.0.0.1, 192.168.1.1'
    ));

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('10.0.0.1');
  });

  test('complex responses object preserved', async () => {
    const complexResponses = {
      section1: { q1: 'yes', q2: 30 },
      section2: ['a', 'b', 'c'],
      notes: 'Additional notes',
    };

    await POST(
      makePostRequest({
        template_id: TEMPLATE_UUID,
        facility_id: FACILITY_UUID,
        customer_name: 'Test',
        responses: complexResponses,
      })
    );

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        responses: complexResponses,
      })
    );
  });

  test('responses defaults to empty object if not provided', async () => {
    await POST(
      makePostRequest({
        template_id: TEMPLATE_UUID,
        facility_id: FACILITY_UUID,
        customer_name: 'Test',
      })
    );

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        responses: {},
      })
    );
  });
});
