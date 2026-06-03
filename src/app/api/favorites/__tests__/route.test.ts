/**
 * @jest-environment node
 *
 * Tests for POST /api/favorites (toggle)
 * Key assertions:
 *   - CSRF + rate limiting (10 req/min), auth required
 *   - facilityId UUID validation
 *   - Published facility verification
 *   - Toggle logic (insert/delete)
 *   - isFavorited response
 */

jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  mutationRateLimit: 'mutationLimit',
  checkRateLimit: jest.fn(),
}));
jest.mock('@supabase/ssr');
jest.mock('next/headers');

import { checkCsrf } from '@/lib/csrf';
import { checkRateLimit } from '@/lib/rate-limit';
import { POST } from '../route';

let mockGetUser: jest.Mock;
let mockSelectFacility: jest.Mock;
let mockSelectFavorite: jest.Mock;
let mockInsert: jest.Mock;
let mockDelete: jest.Mock;

function setupDefaultMocks(
  hasUser: boolean = true,
  facilityExists: boolean = true,
  isFavorited: boolean = false
) {
  (checkCsrf as jest.Mock).mockReturnValue(null);

  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: hasUser ? { id: 'user-123' } : null },
  });

  mockInsert = jest.fn().mockResolvedValue({ error: null });

  mockDelete = jest.fn().mockReturnValue({
    eq: jest.fn(() => Promise.resolve({ error: null })),
  });

  const facilityMaybeSingle = jest.fn().mockResolvedValue({ data: facilityExists ? { id: 'fac-123' } : null });
  const favoriteMaybeSingle = jest.fn().mockResolvedValue({ data: isFavorited ? { id: 'fav-123' } : null });

  const { createServerClient } = require('@supabase/ssr');
  createServerClient.mockReturnValue({
    auth: { getUser: mockGetUser },
    from: jest.fn().mockReturnValue({
      select: jest.fn()
        .mockReturnValueOnce({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({ maybeSingle: facilityMaybeSingle }),
          }),
        })
        .mockReturnValueOnce({
          eq: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({ maybeSingle: favoriteMaybeSingle }),
          }),
        }),
      insert: mockInsert,
      delete: mockDelete,
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
  return new Request('http://localhost/api/favorites', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/favorites', () => {
  test('CSRF check failed → returns error', async () => {
    const csrfError = new Response(JSON.stringify({ error: 'CSRF' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await POST(makeRequest({ facilityId: '11111111-1111-1111-1111-111111111111' }) as any);

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await POST(makeRequest({ facilityId: '11111111-1111-1111-1111-111111111111' }) as any);

    expect(res.status).toBe(429);
  });

  test('unauthenticated → 401', async () => {
    setupDefaultMocks(false);

    const res = await POST(makeRequest({ facilityId: '11111111-1111-1111-1111-111111111111' }) as any);

    expect(res.status).toBe(401);
  });

  test('missing facilityId → 400', async () => {
    const res = await POST(makeRequest({}) as any);

    expect(res.status).toBe(400);
  });

  test('invalid facilityId UUID → 400', async () => {
    const res = await POST(makeRequest({ facilityId: 'not-uuid' }) as any);

    expect(res.status).toBe(400);
  });

  test('facility not found → 404', async () => {
    setupDefaultMocks(true, false);

    const res = await POST(makeRequest({ facilityId: '11111111-1111-1111-1111-111111111111' }) as any);

    expect(res.status).toBe(404);
  });

  test('facility not published → 404', async () => {
    setupDefaultMocks(true, false);

    const res = await POST(makeRequest({ facilityId: '11111111-1111-1111-1111-111111111111' }) as any);

    expect(res.status).toBe(404);
  });

  test('add favorite → 200 with isFavorited=true', async () => {
    const res = await POST(makeRequest({ facilityId: '11111111-1111-1111-1111-111111111111' }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.isFavorited).toBe(true);
  });

  test('remove favorite → 200 with isFavorited=false', async () => {
    setupDefaultMocks(true, true, true);

    const res = await POST(makeRequest({ facilityId: '11111111-1111-1111-1111-111111111111' }) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.isFavorited).toBe(false);
  });

  test('inserts when not favorited', async () => {
    const res = await POST(makeRequest({ facilityId: '11111111-1111-1111-1111-111111111111' }) as any);

    expect(mockInsert).toHaveBeenCalled();
  });

  test('deletes when already favorited', async () => {
    setupDefaultMocks(true, true, true);

    const res = await POST(makeRequest({ facilityId: '11111111-1111-1111-1111-111111111111' }) as any);

    expect(mockDelete).toHaveBeenCalled();
  });

  test('rate limit params (10 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(
      makeRequest(
        { facilityId: '11111111-1111-1111-1111-111111111111' },
        '192.168.1.1'
      ) as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(10);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('favorites');
  });

  test('extracts last (trusted) IP from x-forwarded-for', async () => {
    (checkRateLimit as jest.Mock).mockClear();

    await POST(
      makeRequest(
        { facilityId: '11111111-1111-1111-1111-111111111111' },
        '10.0.0.1, 192.168.1.1'
      ) as any
    );

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('insert error → 500', async () => {
    mockInsert.mockResolvedValue({ error: { message: 'insert failed' } });

    const res = await POST(makeRequest({ facilityId: '11111111-1111-1111-1111-111111111111' }) as any);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('追加に失敗');
  });

  test('delete error → 500', async () => {
    setupDefaultMocks(true, true, true); // isFavorited=true → delete path
    mockDelete.mockReturnValue({
      eq: jest.fn(() => Promise.resolve({ error: { message: 'delete failed' } })),
    });

    const res = await POST(makeRequest({ facilityId: '11111111-1111-1111-1111-111111111111' }) as any);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('削除に失敗');
  });

  test('exception during processing → 500', async () => {
    const { createServerClient } = require('@supabase/ssr');
    createServerClient.mockImplementation(() => {
      throw new Error('Connection error');
    });

    const res = await POST(makeRequest({ facilityId: '11111111-1111-1111-1111-111111111111' }) as any);

    expect(res.status).toBe(500);
  });

  test('invalid JSON body → 400 (via .catch(() => ({})))', async () => {
    const req = new Request('http://localhost/api/favorites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: 'not-json{',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(400);
  });

  test('cookie callbacks (getAll/setAll/forEach) invoked during client creation', async () => {
    const { createServerClient } = require('@supabase/ssr');
    const { cookies } = require('next/headers');
    const mockCookieStore = { getAll: jest.fn(() => [] as any[]), set: jest.fn() };
    cookies.mockResolvedValue(mockCookieStore);

    createServerClient.mockImplementation((_url: string, _key: string, opts: any) => {
      opts.cookies.getAll();
      opts.cookies.setAll([{ name: 'sb', value: 'val', options: {} }]);
      return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null } }) }, from: jest.fn() };
    });

    const res = await POST(makeRequest({ facilityId: '11111111-1111-1111-1111-111111111111' }) as any);
    expect(res.status).toBe(401);
    expect(mockCookieStore.getAll).toHaveBeenCalled();
    expect(mockCookieStore.set).toHaveBeenCalled();
  });
});
