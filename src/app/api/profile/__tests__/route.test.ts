/**
 * @jest-environment node
 *
 * Tests for PUT /api/profile
 * Key assertions:
 *   - CSRF check → returns checkCsrf result
 *   - Rate limiting → 429 (10 req/min per IP)
 *   - Schema validation (display_name 1-50, phone max 20, prefecture max 20, city max 50, birth_date max 10, gender enum)
 *   - Auth required → 401
 *   - Database update error → 500
 *   - Successful update → 200
 *   - Optional fields handling
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
import { PUT } from '../route';

let mockGetUser: jest.Mock;
let mockUpdate: jest.Mock;

function setupDefaultMocks() {
  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: { id: 'user-123', email: 'test@example.com' } },
  });

  mockUpdate = jest.fn().mockResolvedValue({ error: null });
  const mockEq = jest.fn().mockResolvedValue({ error: null });
  mockUpdate.mockReturnValue({ eq: mockEq });

  const { createServerClient } = require('@supabase/ssr');
  createServerClient.mockReturnValue({
    auth: { getUser: mockGetUser },
    from: jest.fn().mockReturnValue({
      update: mockUpdate,
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
    const csrfError = new Response(JSON.stringify({ error: 'CSRF failed' }), { status: 403 });
    (checkCsrf as jest.Mock).mockReturnValue(csrfError);

    const res = await PUT(makeRequest({ display_name: 'John' }));

    expect(res.status).toBe(403);
  });

  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockResolvedValue(true);

    const res = await PUT(makeRequest({ display_name: 'John' }));

    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toContain('リクエスト');
  });

  test('missing display_name → 400', async () => {
    const res = await PUT(makeRequest({}));

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('不正');
  });

  test('display_name empty string → 400', async () => {
    const res = await PUT(makeRequest({ display_name: '' }));

    expect(res.status).toBe(400);
  });

  test('display_name too long (51+ chars) → 400', async () => {
    const res = await PUT(makeRequest({ display_name: 'a'.repeat(51) }));

    expect(res.status).toBe(400);
  });

  test('phone too long (21+ chars) → 400', async () => {
    const res = await PUT(makeRequest({
      display_name: 'John',
      phone: 'a'.repeat(21),
    }));

    expect(res.status).toBe(400);
  });

  test('prefecture too long (21+ chars) → 400', async () => {
    const res = await PUT(makeRequest({
      display_name: 'John',
      prefecture: 'a'.repeat(21),
    }));

    expect(res.status).toBe(400);
  });

  test('city too long (51+ chars) → 400', async () => {
    const res = await PUT(makeRequest({
      display_name: 'John',
      city: 'a'.repeat(51),
    }));

    expect(res.status).toBe(400);
  });

  test('birth_date too long (11+ chars) → 400', async () => {
    const res = await PUT(makeRequest({
      display_name: 'John',
      birth_date: 'a'.repeat(11),
    }));

    expect(res.status).toBe(400);
  });

  test('invalid gender enum → 400', async () => {
    const res = await PUT(makeRequest({
      display_name: 'John',
      gender: 'invalid',
    }));

    expect(res.status).toBe(400);
  });

  test('invalid JSON → 400', async () => {
    const req = new Request('http://localhost/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '192.168.1.1' },
      body: 'invalid json {',
    });

    const res = await PUT(req);

    expect(res.status).toBe(400);
  });

  test('unauthenticated user → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });

    const res = await PUT(makeRequest({ display_name: 'John' }));

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toContain('認証');
  });

  test('database error → 500', async () => {
    mockUpdate.mockReturnValueOnce({
      eq: jest.fn().mockResolvedValueOnce({ error: { message: 'Update failed' } })
    });

    const res = await PUT(makeRequest({ display_name: 'John' }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('失敗');
  });

  test('valid minimal request → 200', async () => {
    const res = await PUT(makeRequest({ display_name: 'John' }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('valid request with all fields → 200', async () => {
    const res = await PUT(makeRequest({
      display_name: 'John Doe',
      phone: '09012345678',
      prefecture: 'Tokyo',
      city: 'Shibuya',
      birth_date: '1990-01-01',
      gender: 'male',
    }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test('gender enum valid values accepted', async () => {
    const validGenders = ['male', 'female', 'other', 'unspecified'];

    for (const gender of validGenders) {
      const res = await PUT(makeRequest({
        display_name: 'John',
        gender,
      }));

      expect(res.status).toBe(200);
    }
  });

  test('optional phone can be null → 200', async () => {
    const res = await PUT(makeRequest({
      display_name: 'John',
      phone: null,
    }));

    expect(res.status).toBe(200);
  });

  test('optional prefecture can be null → 200', async () => {
    const res = await PUT(makeRequest({
      display_name: 'John',
      prefecture: null,
    }));

    expect(res.status).toBe(200);
  });

  test('optional city can be null → 200', async () => {
    const res = await PUT(makeRequest({
      display_name: 'John',
      city: null,
    }));

    expect(res.status).toBe(200);
  });

  test('optional birth_date can be null → 200', async () => {
    const res = await PUT(makeRequest({
      display_name: 'John',
      birth_date: null,
    }));

    expect(res.status).toBe(200);
  });

  test('optional gender can be null → 200', async () => {
    const res = await PUT(makeRequest({
      display_name: 'John',
      gender: null,
    }));

    expect(res.status).toBe(200);
  });

  test('optional fields can be omitted → 200', async () => {
    const res = await PUT(makeRequest({ display_name: 'John' }));

    expect(res.status).toBe(200);
  });

  test('display_name exactly 1 char → 200', async () => {
    const res = await PUT(makeRequest({ display_name: 'a' }));

    expect(res.status).toBe(200);
  });

  test('display_name exactly 50 chars → 200', async () => {
    const res = await PUT(makeRequest({ display_name: 'a'.repeat(50) }));

    expect(res.status).toBe(200);
  });

  test('phone exactly 20 chars → 200', async () => {
    const res = await PUT(makeRequest({
      display_name: 'John',
      phone: 'a'.repeat(20),
    }));

    expect(res.status).toBe(200);
  });

  test('prefecture exactly 20 chars → 200', async () => {
    const res = await PUT(makeRequest({
      display_name: 'John',
      prefecture: 'a'.repeat(20),
    }));

    expect(res.status).toBe(200);
  });

  test('city exactly 50 chars → 200', async () => {
    const res = await PUT(makeRequest({
      display_name: 'John',
      city: 'a'.repeat(50),
    }));

    expect(res.status).toBe(200);
  });

  test('birth_date exactly 10 chars → 200', async () => {
    const res = await PUT(makeRequest({
      display_name: 'John',
      birth_date: '1990-01-01',
    }));

    expect(res.status).toBe(200);
  });

  test('rate limit params (10 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    (checkRateLimit as jest.Mock).mockResolvedValue(false);

    await PUT(makeRequest({ display_name: 'John' }));

    expect(checkRateLimit).toHaveBeenCalled();
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(10);
    expect(call[3]).toBe(60_000);
    expect(call[4]).toBe('profile');
  });

  test('extracts first IP from x-forwarded-for', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    (checkRateLimit as jest.Mock).mockResolvedValue(false);

    await PUT(makeRequest({ display_name: 'John' }, '10.0.0.1, 192.168.1.1'));

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('10.0.0.1');
  });

  test('uses unknown IP when x-forwarded-for missing', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    (checkRateLimit as jest.Mock).mockResolvedValue(false);

    const req = new Request('http://localhost/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ display_name: 'John' }),
    });

    await PUT(req);

    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('exception during processing → 500', async () => {
    mockGetUser.mockRejectedValue(new Error('Auth failed'));

    const res = await PUT(makeRequest({ display_name: 'John' }));

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('サーバーエラー');
  });
});
