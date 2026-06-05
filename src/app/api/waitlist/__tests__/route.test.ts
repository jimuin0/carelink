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
  checkRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@supabase/ssr');
jest.mock('next/headers');
// POST の DB 書き込み・参照は service_role に集約されたため、その経路を
// 既存の createServerClient モックに委譲する（auth 判定は anon クライアント）。
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(),
}));

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
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

  // Self-referential chain: .eq() always returns the same chainable object
  const flexChain: any = {};
  flexChain.eq = jest.fn(() => flexChain);
  flexChain.maybeSingle = mockMaybeSingle;
  mockSelect = jest.fn(() => flexChain);

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

  // service_role クライアントは現行の createServerClient モックへ委譲する
  // （cookies は無関係なのでダミーを渡す）。POST の重複確認・施設確認・insert は
  // 各テストが createServerClient に組んだ from チェーンを共有する。
  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockImplementation(() =>
    require('@supabase/ssr').createServerClient('url', 'key', { cookies: { getAll: () => [] } })
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkCsrf as jest.Mock).mockReturnValue(null);
  (checkRateLimit as jest.Mock).mockReturnValue(false);

  setupMocks(false, false, true);

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
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

const FACILITY_UUID = '550e8400-e29b-41d4-a716-446655440000';
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
    (checkRateLimit as jest.Mock).mockReturnValue(true);

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

  test('rate limit params (5 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);

    await POST(makePostRequest(validWaitlist, '192.168.1.1'));

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(5);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('waitlist');
  });

  test('extracts last (trusted) IP from x-forwarded-for', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);

    await POST(makePostRequest(validWaitlist, '10.0.0.1, 192.168.1.1'));

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('non-auth user + facility found + insert success → 200', async () => {
    const { createServerClient } = require('@supabase/ssr');
    const singleFn = jest.fn().mockResolvedValue({ data: { id: 'entry-123' }, error: null });
    const selectInsert = jest.fn().mockReturnValue({ single: singleFn });
    const insertFn = jest.fn().mockReturnValue({ select: selectInsert });
    const maybeSingleFn = jest.fn().mockResolvedValue({ data: { id: 'fac-1', name: 'Test Salon' } });
    const eqStatus = jest.fn().mockReturnValue({ maybeSingle: maybeSingleFn });
    const eqId = jest.fn().mockReturnValue({ eq: eqStatus });
    const selectFn = jest.fn().mockReturnValue({ eq: eqId });
    createServerClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
      from: jest.fn((table: string) => table === 'facility_profiles'
        ? { select: selectFn }
        : { insert: insertFn }),
    });

    const res = await POST(makePostRequest(validWaitlist));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.id).toBe('entry-123');
  });

  test('auth user + duplicate registration → 409', async () => {
    const { createServerClient } = require('@supabase/ssr');
    const dupMaybeSingle = jest.fn().mockResolvedValue({ data: { id: 'dup-1' } });
    const eq5 = jest.fn().mockReturnValue({ maybeSingle: dupMaybeSingle });
    const eq4 = jest.fn().mockReturnValue({ eq: eq5 });
    const eq3 = jest.fn().mockReturnValue({ eq: eq4 });
    const eq2 = jest.fn().mockReturnValue({ eq: eq3 });
    const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
    const selectFn = jest.fn().mockReturnValue({ eq: eq1 });
    createServerClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-123' } } }) },
      from: jest.fn(() => ({ select: selectFn })),
    });

    const res = await POST(makePostRequest(validWaitlist));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain('登録済み');
  });

  test('facility not found → 404', async () => {
    const { createServerClient } = require('@supabase/ssr');
    const maybeSingleFn = jest.fn().mockResolvedValue({ data: null });
    const eqStatus = jest.fn().mockReturnValue({ maybeSingle: maybeSingleFn });
    const eqId = jest.fn().mockReturnValue({ eq: eqStatus });
    const selectFn = jest.fn().mockReturnValue({ eq: eqId });
    createServerClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
      from: jest.fn(() => ({ select: selectFn })),
    });

    const res = await POST(makePostRequest(validWaitlist));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toContain('施設が見つかりません');
  });

  test('insert error → 500', async () => {
    const { createServerClient } = require('@supabase/ssr');
    const singleFn = jest.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } });
    const selectInsert = jest.fn().mockReturnValue({ single: singleFn });
    const insertFn = jest.fn().mockReturnValue({ select: selectInsert });
    const facilityMaybeSingle = jest.fn().mockResolvedValue({ data: { id: 'fac-1', name: 'Test Salon' } });
    const eqStatus = jest.fn().mockReturnValue({ maybeSingle: facilityMaybeSingle });
    const eqId = jest.fn().mockReturnValue({ eq: eqStatus });
    const selectFn = jest.fn().mockReturnValue({ eq: eqId });
    createServerClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
      from: jest.fn((table: string) => table === 'facility_profiles'
        ? { select: selectFn }
        : { insert: insertFn }),
    });

    const res = await POST(makePostRequest(validWaitlist));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('登録に失敗');
  });

  test('auth user, no duplicate, facility found → 200 with user_id', async () => {
    const { createServerClient } = require('@supabase/ssr');
    const dupMaybeSingle = jest.fn().mockResolvedValue({ data: null });
    const eq5 = jest.fn().mockReturnValue({ maybeSingle: dupMaybeSingle });
    const eq4 = jest.fn().mockReturnValue({ eq: eq5 });
    const eq3 = jest.fn().mockReturnValue({ eq: eq4 });
    const eq2Dup = jest.fn().mockReturnValue({ eq: eq3 });
    const eq1Dup = jest.fn().mockReturnValue({ eq: eq2Dup });
    const selectDup = jest.fn().mockReturnValue({ eq: eq1Dup });

    const facilityMaybeSingle = jest.fn().mockResolvedValue({ data: { id: 'fac-1', name: 'Test Salon' } });
    const eqStatus = jest.fn().mockReturnValue({ maybeSingle: facilityMaybeSingle });
    const eqIdFac = jest.fn().mockReturnValue({ eq: eqStatus });
    const selectFac = jest.fn().mockReturnValue({ eq: eqIdFac });

    const insertSingle = jest.fn().mockResolvedValue({ data: { id: 'entry-123' }, error: null });
    const insertSelect = jest.fn().mockReturnValue({ single: insertSingle });
    const insertFn = jest.fn().mockReturnValue({ select: insertSelect });

    let callCount = 0;
    createServerClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-123' } } }) },
      from: jest.fn((table: string) => {
        if (table === 'booking_waitlist') {
          callCount++;
          if (callCount === 1) return { select: selectDup };
          return { insert: insertFn };
        }
        return { select: selectFac };
      }),
    });

    const res = await POST(makePostRequest(validWaitlist));
    expect(res.status).toBe(200);
    expect(insertFn).toHaveBeenCalled();
    const insertArg = insertFn.mock.calls[0][0];
    expect(insertArg.user_id).toBe('user-123');
  });

  test('insert returns no entry but no error → 500', async () => {
    const { createServerClient } = require('@supabase/ssr');
    const singleFn = jest.fn().mockResolvedValue({ data: null, error: null });
    const selectInsert = jest.fn().mockReturnValue({ single: singleFn });
    const insertFn = jest.fn().mockReturnValue({ select: selectInsert });
    const facilityMaybeSingle = jest.fn().mockResolvedValue({ data: { id: 'fac-1', name: 'Test Salon' } });
    const eqStatus = jest.fn().mockReturnValue({ maybeSingle: facilityMaybeSingle });
    const eqId = jest.fn().mockReturnValue({ eq: eqStatus });
    const selectFn = jest.fn().mockReturnValue({ eq: eqId });
    createServerClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
      from: jest.fn((table: string) => table === 'facility_profiles'
        ? { select: selectFn }
        : { insert: insertFn }),
    });

    const res = await POST(makePostRequest(validWaitlist));
    expect(res.status).toBe(500);
  });

  test('POST: x-forwarded-for missing → unknown IP', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);
    const req = new Request('http://localhost/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validWaitlist),
    });
    await POST(req);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('POST: cookie getAll callback is invocable', async () => {
    const { createServerClient } = require('@supabase/ssr');
    const { cookies } = require('next/headers');
    const mockCookieStore = { getAll: jest.fn(() => [] as any[]) };
    cookies.mockResolvedValue(mockCookieStore);

    const maybeSingleFn = jest.fn().mockResolvedValue({ data: null });
    const eqFn = jest.fn().mockReturnThis();
    const chain: any = { select: jest.fn().mockReturnThis(), eq: eqFn, maybeSingle: maybeSingleFn, insert: jest.fn().mockReturnThis() };

    createServerClient.mockImplementation((_url: string, _key: string, opts: any) => {
      opts.cookies.getAll();
      return {
        auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) },
        from: jest.fn(() => chain),
      };
    });

    const res = await POST(makePostRequest(validWaitlist));
    expect(res.status).toBe(404); // facility not found → 404
    expect(mockCookieStore.getAll).toHaveBeenCalled();
  });
});

describe('DELETE /api/waitlist', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (checkCsrf as jest.Mock).mockReturnValue(null);
    (checkRateLimit as jest.Mock).mockReturnValue(false);

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
    (checkRateLimit as jest.Mock).mockReturnValue(true);

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

  test('rate limit params (10 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);

    await DELETE(makeDeleteRequest('550e8400-e29b-41d4-a716-446655440000', '192.168.1.1'));

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(10);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('waitlist-delete');
  });

  test('UUID exactly 36 chars accepted', async () => {
    const validUuid = '22222222-2222-2222-2222-222222222222';
    const res = await DELETE(makeDeleteRequest(validUuid));

    expect(res.status).toBe(200);
  });

  test('update error → 500', async () => {
    const mockEq2Error = jest.fn().mockResolvedValue({ error: { message: 'DB error' } });
    const mockEq1Error = jest.fn().mockReturnValue({ eq: mockEq2Error });
    const mockUpdateError = jest.fn().mockReturnValue({ eq: mockEq1Error });

    const { createServerClient } = require('@supabase/ssr');
    createServerClient.mockReturnValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'user-123' } } }) },
      from: jest.fn(() => ({ update: mockUpdateError })),
    });

    const res = await DELETE(makeDeleteRequest('11111111-1111-1111-1111-111111111111'));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('削除に失敗');
  });

  test('DELETE: x-forwarded-for missing → unknown IP', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);
    const a = '2'.repeat(8);
    const b = '2'.repeat(4);
    const validId = `${a}-${b}-${b}-${b}-${'2'.repeat(12)}`;
    const req = new Request(`http://localhost/api/waitlist?id=${validId}`, { method: 'DELETE' });
    await DELETE(req as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('DELETE: cookie getAll callback is invocable', async () => {
    const { createServerClient } = require('@supabase/ssr');
    const { cookies } = require('next/headers');
    const mockCookieStore = { getAll: jest.fn(() => [] as any[]) };
    cookies.mockResolvedValue(mockCookieStore);

    createServerClient.mockImplementation((_url: string, _key: string, opts: any) => {
      opts.cookies.getAll();
      return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) }, from: jest.fn() };
    });

    const res = await DELETE(makeDeleteRequest('550e8400-e29b-41d4-a716-446655440000'));
    expect(res.status).toBe(401);
    expect(mockCookieStore.getAll).toHaveBeenCalled();
  });
});
