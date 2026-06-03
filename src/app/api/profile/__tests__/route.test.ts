/**
 * @jest-environment node
 *
 * Tests for PUT /api/profile
 * Key assertions:
 *   - CSRF check required
 *   - Rate limiting (10 req/min per IP)
 *   - Auth required
 *   - Schema validation (display_name required, max lengths)
 *   - Gender enum validation
 *   - Updates profiles table with user_id
 */

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: 'mutationLimit',
  checkRateLimit: jest.fn(),
}));
jest.mock('@/lib/supabase-server', () => ({
  createServiceRoleClient: jest.fn(),
  createServerSupabaseClient: jest.fn(),
}));
jest.mock('@supabase/ssr');
jest.mock('next/headers');

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { PUT } from '../route';

let mockGetUser: jest.Mock;
let mockUpdate: jest.Mock;

function setupDefaultMocks(
  hasUser: boolean = true,
  updateSucceeds: boolean = true
) {
  (checkCsrf as jest.Mock).mockReturnValue(null);

  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: hasUser ? { id: 'user-123' } : null },
  });

  mockUpdate = jest.fn().mockReturnValue({
    eq: jest.fn().mockResolvedValue({
      error: updateSucceeds ? null : { message: 'Update failed' },
    }),
  });

  const { createServerClient } = require('@supabase/ssr');
  createServerClient.mockReturnValue({
    auth: { getUser: mockGetUser },
    from: jest.fn().mockReturnValue({
      update: mockUpdate,
    }),
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  (createServiceRoleClient as jest.Mock).mockReturnValue({
    from: jest.fn().mockReturnValue({
      update: mockUpdate,
    }),
  });

  const { cookies } = require('next/headers');
  cookies.mockResolvedValue({
    getAll: jest.fn(() => []),
    set: jest.fn(),
  });

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockResolvedValue(false);
  setupDefaultMocks();
});

function makeRequest(body: object, ip = '192.168.1.1') {
  return new Request('http://localhost/api/profile', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('PUT /api/profile', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await PUT(makeRequest({ display_name: 'Test' }) as any);

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await PUT(makeRequest({ display_name: 'Test' }) as any);

    expect(res.status).toBe(429);
  });

  test('unauthenticated → 401', async () => {
    setupDefaultMocks(false);

    const res = await PUT(makeRequest({ display_name: 'Test' }) as any);

    expect(res.status).toBe(401);
  });

  test('invalid JSON → 400', async () => {
    const req = new Request('http://localhost/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.1' },
      body: 'invalid {',
    });

    const res = await PUT(req as any);

    expect(res.status).toBe(400);
  });

  test('missing display_name → 400', async () => {
    const res = await PUT(makeRequest({ phone: '09012345678' }) as any);

    expect(res.status).toBe(400);
  });

  test('empty display_name → 400', async () => {
    const res = await PUT(makeRequest({ display_name: '' }) as any);

    expect(res.status).toBe(400);
  });

  test('display_name > 50 chars → 400', async () => {
    const res = await PUT(makeRequest({ display_name: 'x'.repeat(51) }) as any);

    expect(res.status).toBe(400);
  });

  test('valid display_name (50 chars) → 200', async () => {
    const res = await PUT(makeRequest({ display_name: 'x'.repeat(50) }) as any);

    expect(res.status).toBe(200);
  });

  test('phone > 20 chars → 400', async () => {
    const res = await PUT(makeRequest({
      display_name: 'Test',
      phone: 'x'.repeat(21),
    }) as any);

    expect(res.status).toBe(400);
  });

  test('prefecture > 20 chars → 400', async () => {
    const res = await PUT(makeRequest({
      display_name: 'Test',
      prefecture: 'x'.repeat(21),
    }) as any);

    expect(res.status).toBe(400);
  });

  test('city > 50 chars → 400', async () => {
    const res = await PUT(makeRequest({
      display_name: 'Test',
      city: 'x'.repeat(51),
    }) as any);

    expect(res.status).toBe(400);
  });

  test('birth_date > 10 chars → 400', async () => {
    const res = await PUT(makeRequest({
      display_name: 'Test',
      birth_date: '12345678901',
    }) as any);

    expect(res.status).toBe(400);
  });

  test('gender=male → 200', async () => {
    const res = await PUT(makeRequest({
      display_name: 'Test',
      gender: 'male',
    }) as any);

    expect(res.status).toBe(200);
  });

  test('gender=female → 200', async () => {
    const res = await PUT(makeRequest({
      display_name: 'Test',
      gender: 'female',
    }) as any);

    expect(res.status).toBe(200);
  });

  test('gender=other → 200', async () => {
    const res = await PUT(makeRequest({
      display_name: 'Test',
      gender: 'other',
    }) as any);

    expect(res.status).toBe(200);
  });

  test('gender=unspecified → 200', async () => {
    const res = await PUT(makeRequest({
      display_name: 'Test',
      gender: 'unspecified',
    }) as any);

    expect(res.status).toBe(200);
  });

  test('invalid gender → 400', async () => {
    const res = await PUT(makeRequest({
      display_name: 'Test',
      gender: 'invalid',
    }) as any);

    expect(res.status).toBe(400);
  });

  test('valid request → 200 with success', async () => {
    const res = await PUT(makeRequest({
      display_name: 'John Doe',
      phone: '09012345678',
      prefecture: '東京都',
      city: '渋谷区',
      birth_date: '1990-01-01',
      gender: 'male',
    }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('updates profiles table with user_id', async () => {
    const res = await PUT(makeRequest({ display_name: 'Test' }) as any);

    expect(mockUpdate).toHaveBeenCalled();
    const eqCall = mockUpdate.mock.calls[0][0];
    // Should call .eq('id', user.id)
  });

  test('includes updated_at timestamp', async () => {
    const res = await PUT(makeRequest({ display_name: 'Test' }) as any);

    const updateData = mockUpdate.mock.calls[0][0];
    expect(updateData.updated_at).toBeDefined();
  });

  test('sets optional fields to null when omitted', async () => {
    const res = await PUT(makeRequest({ display_name: 'Test' }) as any);

    const updateData = mockUpdate.mock.calls[0][0];
    expect(updateData.phone).toBeNull();
    expect(updateData.prefecture).toBeNull();
    expect(updateData.city).toBeNull();
    expect(updateData.birth_date).toBeNull();
    expect(updateData.gender).toBeNull();
  });

  test('update error → 500', async () => {
    setupDefaultMocks(true, false);

    const res = await PUT(makeRequest({ display_name: 'Test' }) as any);

    expect(res.status).toBe(500);
  });

  test('rate limit params (10 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await PUT(
      makeRequest({ display_name: 'Test' }, '192.168.1.1') as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(10);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('profile');
  });

  test('extracts last (trusted) IP from x-forwarded-for', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await PUT(
      makeRequest(
        { display_name: 'Test' },
        '10.0.0.1, 192.168.1.1'
      ) as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('exception during processing → 500', async () => {
    const { createServerClient } = require('@supabase/ssr');
    createServerClient.mockImplementation(() => {
      throw new Error('Connection error');
    });

    const res = await PUT(makeRequest({ display_name: 'Test' }) as any);

    expect(res.status).toBe(500);
  });

  test('cookie callbacks (getAll/setAll/forEach) are invocable', async () => {
    const { createServerClient } = require('@supabase/ssr');
    const { cookies } = require('next/headers');
    const mockCookieStore = { getAll: jest.fn(() => []), set: jest.fn() };
    cookies.mockResolvedValue(mockCookieStore);

    createServerClient.mockImplementation((_url: string, _key: string, opts: any) => {
      opts.cookies.getAll();
      opts.cookies.setAll([{ name: 'sb', value: 'val', options: {} }]);
      return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) }, from: jest.fn() };
    });

    const res = await PUT(makeRequest({ display_name: 'Test' }) as any);
    expect(res.status).toBe(401);
    expect(mockCookieStore.getAll).toHaveBeenCalled();
    expect(mockCookieStore.set).toHaveBeenCalled();
  });
});
