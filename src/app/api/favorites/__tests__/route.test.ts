/**
 * @jest-environment node
 *
 * Tests for POST /api/favorites
 * Key assertions:
 *   - CSRF check → returns checkCsrf result
 *   - Rate limiting → 429 (10 req/min per IP)
 *   - Schema validation (facilityId UUID)
 *   - Auth required → 401
 *   - Facility existence check (status='published') → 404
 *   - Toggle favorite: add new / remove existing
 *   - Database error handling → 500
 *   - Fire-and-forget operation
 */

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(),
  mutationRateLimit: 'mutationLimit'
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@supabase/ssr');
jest.mock('next/headers');

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST } from '../route';

let mockGetUser: jest.Mock;
let mockMaybeSingle: jest.Mock;
let mockDelete: jest.Mock;
let mockInsert: jest.Mock;

function setupDefaultMocks() {
  mockMaybeSingle = jest.fn();
  mockMaybeSingle.mockResolvedValueOnce({ data: { id: 'facility-id-1' } });
  mockMaybeSingle.mockResolvedValueOnce({ data: null });

  const mockEq2 = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
  const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
  const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });

  const mockDeleteEq = jest.fn().mockResolvedValue({ error: null });
  mockDelete = jest.fn().mockReturnValue({ eq: mockDeleteEq });

  mockInsert = jest.fn().mockResolvedValue({ error: null });

  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: { id: 'user-123', email: 'test@example.com' } },
  });

  const { createServerClient } = require('@supabase/ssr');
  createServerClient.mockReturnValue({
    auth: { getUser: mockGetUser },
    from: jest.fn((table: string) => {
      if (table === 'facility_profiles' || table === 'favorites') {
        return {
          select: mockSelect,
          delete: mockDelete,
          insert: mockInsert,
        };
      }
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
  return new Request('http://localhost/api/favorites', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

const FACILITY_UUID = '11111111-1111-1111-1111-111111111111';

describe('POST /api/favorites', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF failed' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await POST(makeRequest({ facilityId: FACILITY_UUID }));

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(makeRequest({ facilityId: FACILITY_UUID }));

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain('リクエスト');
  });

  test('missing facilityId → 400', async () => {
    const res = await POST(makeRequest({}));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('無効な施設ID');
  });

  test('invalid facilityId UUID → 400', async () => {
    const res = await POST(makeRequest({ facilityId: 'not-a-uuid' }));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('無効な施設ID');
  });

  test('invalid JSON body → 400', async () => {
    const req = new Request('http://localhost/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.1' },
      body: 'invalid json {',
    });

    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  test('unauthenticated user → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(makeRequest({ facilityId: FACILITY_UUID }));

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('認証が必要');
  });

  test('facility not found → 404', async () => {
    jest.clearAllMocks();
    (checkCsrf as jest.Mock).mockReturnValue(null);
    (checkRateLimit as jest.Mock).mockResolvedValue(false);

    mockMaybeSingle = jest.fn().mockResolvedValue({ data: null });
    const mockEq2 = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
    const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });

    mockGetUser = jest.fn().mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
    });

    const { createServerClient } = require('@supabase/ssr');
    createServerClient.mockReturnValue({
      auth: { getUser: mockGetUser },
      from: jest.fn(() => ({
        select: mockSelect,
        delete: jest.fn(),
        insert: jest.fn(),
      })),
    });

    const { cookies } = require('next/headers');
    cookies.mockResolvedValue({
      getAll: jest.fn(() => []),
      set: jest.fn(),
    });

    const res = await POST(makeRequest({ facilityId: FACILITY_UUID }));

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain('施設が見つかりません');
  });

  test('facility not published → 404', async () => {
    jest.clearAllMocks();
    (checkCsrf as jest.Mock).mockReturnValue(null);
    (checkRateLimit as jest.Mock).mockResolvedValue(false);

    mockMaybeSingle = jest.fn().mockResolvedValue({ data: null });
    const mockEq2 = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
    const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });

    mockGetUser = jest.fn().mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
    });

    const { createServerClient } = require('@supabase/ssr');
    createServerClient.mockReturnValue({
      auth: { getUser: mockGetUser },
      from: jest.fn(() => ({
        select: mockSelect,
        delete: jest.fn(),
        insert: jest.fn(),
      })),
    });

    const { cookies } = require('next/headers');
    cookies.mockResolvedValue({
      getAll: jest.fn(() => []),
      set: jest.fn(),
    });

    const res = await POST(makeRequest({ facilityId: FACILITY_UUID }));

    expect(res.status).toBe(404);
  });

  test('add favorite (not exists) → 200 with isFavorited=true', async () => {
    const res = await POST(makeRequest({ facilityId: FACILITY_UUID }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.isFavorited).toBe(true);
    expect(mockInsert).toHaveBeenCalledWith({
      user_id: 'user-123',
      facility_id: FACILITY_UUID,
    });
  });

  test('remove favorite (exists) → 200 with isFavorited=false', async () => {
    jest.clearAllMocks();
    (checkCsrf as jest.Mock).mockReturnValue(null);
    (checkRateLimit as jest.Mock).mockResolvedValue(false);

    mockMaybeSingle = jest.fn();
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: FACILITY_UUID } });
    mockMaybeSingle.mockResolvedValueOnce({ data: { id: 'fav-123' } });

    const mockEq2 = jest.fn().mockReturnValue({ maybeSingle: mockMaybeSingle });
    const mockEq1 = jest.fn().mockReturnValue({ eq: mockEq2 });
    const mockSelect = jest.fn().mockReturnValue({ eq: mockEq1 });

    const mockDeleteEq = jest.fn().mockResolvedValue({ error: null });
    mockDelete = jest.fn().mockReturnValue({ eq: mockDeleteEq });

    mockGetUser = jest.fn().mockResolvedValue({
      data: { user: { id: 'user-123', email: 'test@example.com' } },
    });

    const { createServerClient } = require('@supabase/ssr');
    createServerClient.mockReturnValue({
      auth: { getUser: mockGetUser },
      from: jest.fn(() => ({
        select: mockSelect,
        delete: mockDelete,
        insert: jest.fn(),
      })),
    });

    const { cookies } = require('next/headers');
    cookies.mockResolvedValue({
      getAll: jest.fn(() => []),
      set: jest.fn(),
    });

    const res = await POST(makeRequest({ facilityId: FACILITY_UUID }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.isFavorited).toBe(false);
  });

  test('database error handling → 500', async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: 'Insert failed' } });

    const res = await POST(makeRequest({ facilityId: FACILITY_UUID }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('失敗');
  });

  test('rate limit params (10 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    (checkRateLimit as jest.Mock).mockResolvedValue(false);

    await POST(makeRequest({ facilityId: FACILITY_UUID }));

    expect(checkRateLimit).toHaveBeenCalled();
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(10);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('favorites');
  });

  test('extracts first IP from x-forwarded-for', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    (checkRateLimit as jest.Mock).mockResolvedValue(false);

    await POST(makeRequest({ facilityId: FACILITY_UUID }, '10.0.0.1, 192.168.1.1'));

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('10.0.0.1');
  });

  test('uses unknown IP when x-forwarded-for missing', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    (checkRateLimit as jest.Mock).mockResolvedValue(false);

    const req = new Request('http://localhost/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facilityId: FACILITY_UUID }),
    });

    await POST(req);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('facility ID exactly 36 chars UUID → 200', async () => {
    const validUuid = '22222222-2222-2222-2222-222222222222';
    const res = await POST(makeRequest({ facilityId: validUuid }));

    expect(res.status).toBe(200);
  });

  test('facility ID with uppercase letters → accepted', async () => {
    const uppercaseUuid = 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA';
    const res = await POST(makeRequest({ facilityId: uppercaseUuid }));

    expect(res.status).toBe(200);
  });

  test('exception during processing → 500', async () => {
    mockGetUser.mockRejectedValue(new Error('Auth failed'));

    const res = await POST(makeRequest({ facilityId: FACILITY_UUID }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('サーバーエラー');
  });
});
