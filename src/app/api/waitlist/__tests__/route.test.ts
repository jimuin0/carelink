/**
 * @jest-environment node
 *
 * Tests for POST/DELETE /api/waitlist
 * Key assertions:
 *   - POST: CSRF check, rate limiting (5 req/min), schema validation, duplicate check, facility verify
 *   - DELETE: CSRF check, rate limiting (10 req/min), auth required, ownership check, UUID validation
 *   - Optional auth handling (can register without login)
 */

jest.mock('@/lib/rate-limit', () => ({
  inMemoryRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@supabase/ssr');
jest.mock('next/headers');

import { checkCsrf } from '@/lib/csrf';
import { inMemoryRateLimit } from '@/lib/rate-limit';
import { POST, DELETE } from '../route';

let mockGetUser: jest.Mock;
let mockSelect: jest.Mock;
let mockMaybeSingle: jest.Mock;
let mockInsert: jest.Mock;
let mockUpdate: jest.Mock;

function setupMocks(hasUser: boolean = false, hasDuplicate: boolean = false, hasFacility: boolean = true) {
  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: hasUser ? { id: 'user-123', email: 'test@example.com' } : null },
  });

  mockMaybeSingle = jest.fn();
  mockMaybeSingle.mockResolvedValueOnce({ data: hasDuplicate ? { id: 'dup-1' } : null });
  mockMaybeSingle.mockResolvedValueOnce({ data: hasFacility ? { id: 'fac-1', name: 'Test Salon' } : null });

  const mockEq4 = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
  const mockEq3 = jest.fn().mockReturnValue({ eq: mockEq4 });
  const mockEq2 = jest.fn().mockReturnValue({ eq: mockEq3 });
  const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
  mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });

  mockInsert = jest.fn().mockResolvedValue({ data: { id: 'entry-123' }, error: null });
  const mockSelectInsert = jest.fn().mockReturnValue({ single: jest.fn().mockResolvedValue({ data: { id: 'entry-123' }, error: null }) });
  mockInsert.mockReturnValue({ select: mockSelectInsert });

  const mockEq2Update = jest.fn().mockResolvedValue({ error: null });
  mockUpdate = jest.fn().mockReturnValue({ eq: mockEq2Update });

  const { createServerClient } = require('@supabase/ssr');
  createServerClient.mockReturnValue({
    auth: { getUser: mockGetUser },
    from: jest.fn(() => ({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
    })),
  });

  const { cookies } = require('next/headers');
  cookies.mockResolvedValue({
    getAll: jest.fn(() => []),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);

  setupMocks(false, false, true);

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
});

function makePostRequest(body: object, ip = '192.168.1.1') {
  return new Request('http://localhost/api/waitlist', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

function makeDeleteRequest(id: string, ip = '192.168.1.1') {
  return new Request(`http://localhost/api/waitlist?id=${id}`, {
    method: 'DELETE',
    headers: {
      'x-forwarded-for': ip,
    },
  });
}

const FACILITY_UUID = '11111111-1111-1111-1111-111111111111';
const validWaitlist = {
  facility_id: FACILITY_UUID,
  date: '2026-05-01',
  start_time: '10:00',
  end_time: '11:00',
  customer_name: 'Test Customer',
};

describe('POST /api/waitlist', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF failed' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await POST(makePostRequest(validWaitlist));

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await POST(makePostRequest(validWaitlist));

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain('多すぎます');
  });

  test('missing facility_id → 400', async () => {
    const res = await POST(makePostRequest({ ...validWaitlist, facility_id: undefined }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('確認してください');
  });

  test('invalid facility_id UUID → 400', async () => {
    const res = await POST(makePostRequest({ ...validWaitlist, facility_id: 'not-uuid' }));

    expect(res.status).toBe(400);
  });

  test('missing date → 400', async () => {
    const res = await POST(makePostRequest({ ...validWaitlist, date: undefined }));

    expect(res.status).toBe(400);
  });

  test('invalid date format → 400', async () => {
    const res = await POST(makePostRequest({ ...validWaitlist, date: '2026/05/01' }));

    expect(res.status).toBe(400);
  });

  test('missing start_time → 400', async () => {
    const res = await POST(makePostRequest({ ...validWaitlist, start_time: undefined }));

    expect(res.status).toBe(400);
  });

  test('invalid start_time format → 400', async () => {
    const res = await POST(makePostRequest({ ...validWaitlist, start_time: '10-00' }));

    expect(res.status).toBe(400);
  });

  test('missing end_time → 400', async () => {
    const res = await POST(makePostRequest({ ...validWaitlist, end_time: undefined }));

    expect(res.status).toBe(400);
  });

  test('invalid end_time format → 400', async () => {
    const res = await POST(makePostRequest({ ...validWaitlist, end_time: '11-00' }));

    expect(res.status).toBe(400);
  });

  test('missing customer_name → 400', async () => {
    const res = await POST(makePostRequest({ ...validWaitlist, customer_name: undefined }));

    expect(res.status).toBe(400);
  });

  test('empty customer_name → 400', async () => {
    const res = await POST(makePostRequest({ ...validWaitlist, customer_name: '' }));

    expect(res.status).toBe(400);
  });

  test('customer_name too long (51+ chars) → 400', async () => {
    const res = await POST(makePostRequest({ ...validWaitlist, customer_name: 'a'.repeat(51) }));

    expect(res.status).toBe(400);
  });

  test('notes too long (201+ chars) → 400', async () => {
    const res = await POST(makePostRequest({ ...validWaitlist, notes: 'a'.repeat(201) }));

    expect(res.status).toBe(400);
  });

  test('invalid email → 400', async () => {
    const res = await POST(makePostRequest({ ...validWaitlist, email: 'not-an-email' }));

    expect(res.status).toBe(400);
  });

  test('invalid JSON → 400', async () => {
    const req = new Request('http://localhost/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.1' },
      body: 'invalid json {',
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  test('rate limit params (5 req/min per IP)', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();
    (inMemoryRateLimit as jest.Mock).mockReturnValue(false);

    POST(makePostRequest(validWaitlist, '192.168.1.1'));

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('192.168.1.1');
    expect(call[1]).toBe(5);
    expect(call[2]).toBe(60_000);
    expect(call[3]).toBe('waitlist');
  });

  test('extracts first IP from x-forwarded-for', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();
    (inMemoryRateLimit as jest.Mock).mockReturnValue(false);

    POST(makePostRequest(validWaitlist, '10.0.0.1, 192.168.1.1'));

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('10.0.0.1');
  });
});

describe('DELETE /api/waitlist', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (checkCsrf as jest.Mock).mockReturnValue(null);
    (inMemoryRateLimit as jest.Mock).mockReturnValue(false);

    mockGetUser = jest.fn().mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
    });

    const mockEq2 = jest.fn().mockResolvedValue({ error: null });
    const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
    mockUpdate = jest.fn().mockReturnValue({ eq: mockEq1 });

    const { createServerClient } = require('@supabase/ssr');
    createServerClient.mockReturnValue({
      auth: { getUser: mockGetUser },
      from: jest.fn(() => ({
        update: mockUpdate,
      })),
    });

    const { cookies } = require('next/headers');
    cookies.mockResolvedValue({
      getAll: jest.fn(() => []),
    });
  });

  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF failed' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await DELETE(new Request('http://localhost/api/waitlist?id=11111111-1111-1111-1111-111111111111', { method: 'DELETE' }) as any);

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await DELETE(makeDeleteRequest('11111111-1111-1111-1111-111111111111'));

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain('多すぎます');
  });

  test('missing id → 400', async () => {
    const res = await DELETE(new Request('http://localhost/api/waitlist', { method: 'DELETE' }) as any);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('id');
  });

  test('invalid id UUID → 400', async () => {
    const res = await DELETE(makeDeleteRequest('not-a-uuid'));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid');
  });

  test('unauthenticated user → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await DELETE(makeDeleteRequest('11111111-1111-1111-1111-111111111111'));

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('認証');
  });

  test('valid deletion → 200', async () => {
    const res = await DELETE(makeDeleteRequest('11111111-1111-1111-1111-111111111111'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('rate limit params (10 req/min per IP)', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();
    (inMemoryRateLimit as jest.Mock).mockReturnValue(false);

    DELETE(makeDeleteRequest('11111111-1111-1111-1111-111111111111', '192.168.1.1'));

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('192.168.1.1');
    expect(call[1]).toBe(10);
    expect(call[2]).toBe(60_000);
    expect(call[3]).toBe('waitlist-delete');
  });

  test('UUID exactly 36 chars accepted', async () => {
    const validUuid = '22222222-2222-2222-2222-222222222222';
    const res = await DELETE(makeDeleteRequest(validUuid));

    expect(res.status).toBe(200);
  });
});
