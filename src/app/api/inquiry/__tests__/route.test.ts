/**
 * @jest-environment node
 *
 * Tests for POST /api/inquiry (施設問い合わせの唯一の登録経路)
 * Key assertions:
 *   - CSRF check required (withRoute csrf:true)
 *   - Rate limiting (5 req/min per IP, prefix 'facility-inquiry')
 *   - Schema validation (required fields, email/phone format, max lengths)
 *   - Facility existence/published check (server-authoritative facility_name)
 *   - service_role insert → returns { success, id }
 *   - Insert error / no-data / exception → 500
 */

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: 'mutationLimit',
  checkRateLimit: jest.fn(),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(),
}));

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { POST } from '../route';

const FACILITY_ID = '550e8400-e29b-41d4-a716-446655440000';

let mockInsert: jest.Mock;
let mockInsertSingle: jest.Mock;
let mockFacilityMaybeSingle: jest.Mock;

function setupDefaultMocks(
  opts: { insertError?: boolean; noData?: boolean; noFacility?: boolean } = {}
) {
  (checkCsrf as jest.Mock).mockReturnValue(null);

  mockFacilityMaybeSingle = jest.fn().mockResolvedValue({
    data: opts.noFacility ? null : { id: FACILITY_ID, name: 'リラクサロン ABC' },
  });
  const facilityEqStatus = jest.fn().mockReturnValue({ maybeSingle: mockFacilityMaybeSingle });
  const facilityEqId = jest.fn().mockReturnValue({ eq: facilityEqStatus });
  const facilitySelect = jest.fn().mockReturnValue({ eq: facilityEqId });

  mockInsertSingle = jest.fn().mockResolvedValue({
    data: opts.noData ? null : { id: 'new-inquiry-id' },
    error: opts.insertError ? { message: 'Insert failed' } : null,
  });
  mockInsert = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({ single: mockInsertSingle }),
  });

  (createServiceRoleClient as jest.Mock).mockReturnValue({
    from: jest.fn((table: string) =>
      table === 'facility_profiles'
        ? { select: facilitySelect }
        : { insert: mockInsert }
    ),
  });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  setupDefaultMocks();
});

const validInquiry = {
  facility_id: FACILITY_ID,
  name: '山田 太郎',
  email: 'owner@example.com',
  phone: '090-1234-5678',
  message: 'ご予約について質問があります。',
};

function makeRequest(body: unknown, ip = '192.168.1.1') {
  return new Request('http://localhost/api/inquiry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

describe('POST /api/inquiry', () => {
  test('CSRF check failed → 403', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError as any);

    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(403);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(429);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('rate limit configured with facility-inquiry prefix, limit 5', async () => {
    await POST(makeRequest(validInquiry) as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[2]).toBe(5);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('facility-inquiry');
  });

  test('valid payload → 200 with id', async () => {
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.id).toBe('new-inquiry-id');
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  test('insert uses server-authoritative facility_name and maps empty phone to null', async () => {
    await POST(makeRequest({ ...validInquiry, phone: '' }) as any);
    const inserted = mockInsert.mock.calls[0][0];
    expect(inserted.facility_id).toBe(FACILITY_ID);
    expect(inserted.facility_name).toBe('リラクサロン ABC'); // from facility_profiles, not client
    expect(inserted.phone).toBeNull();
    expect(inserted.name).toBe(validInquiry.name);
    expect(inserted.message).toBe(validInquiry.message);
  });

  test('omitted phone → inserted as null', async () => {
    const { phone, ...rest } = validInquiry;
    void phone;
    const res = await POST(makeRequest(rest) as any);
    expect(res.status).toBe(200);
    const inserted = mockInsert.mock.calls[0][0];
    expect(inserted.phone).toBeNull();
  });

  test('facility not found / unpublished → 404', async () => {
    setupDefaultMocks({ noFacility: true });
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(404);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('missing required name → 400', async () => {
    const { name, ...rest } = validInquiry;
    void name;
    const res = await POST(makeRequest(rest) as any);
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  test('invalid facility_id (not uuid) → 400', async () => {
    const res = await POST(makeRequest({ ...validInquiry, facility_id: 'not-uuid' }) as any);
    expect(res.status).toBe(400);
  });

  test('invalid email → 400', async () => {
    const res = await POST(makeRequest({ ...validInquiry, email: 'not-an-email' }) as any);
    expect(res.status).toBe(400);
  });

  test('invalid phone format → 400', async () => {
    const res = await POST(makeRequest({ ...validInquiry, phone: 'abc-def' }) as any);
    expect(res.status).toBe(400);
  });

  test('empty message → 400', async () => {
    const res = await POST(makeRequest({ ...validInquiry, message: '' }) as any);
    expect(res.status).toBe(400);
  });

  test('message over 1000 chars → 400', async () => {
    const res = await POST(makeRequest({ ...validInquiry, message: 'a'.repeat(1001) }) as any);
    expect(res.status).toBe(400);
  });

  test('null body (invalid JSON) → 400', async () => {
    const req = new Request('http://localhost/api/inquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: 'not json',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  test('DB insert error → 500', async () => {
    setupDefaultMocks({ insertError: true });
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(500);
  });

  test('insert returns no data → 500', async () => {
    setupDefaultMocks({ noData: true });
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(500);
  });

  test('exception (createServiceRoleClient throws) → 500', async () => {
    (createServiceRoleClient as jest.Mock).mockImplementation(() => {
      throw new Error('boom');
    });
    const res = await POST(makeRequest(validInquiry) as any);
    expect(res.status).toBe(500);
  });
});
