/**
 * @jest-environment node
 */
jest.mock('@/lib/csrf', () => ({ checkCsrf: jest.fn(() => null) }));
jest.mock('@/lib/rate-limit', () => ({
  inMemoryRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server-auth');
jest.mock('@/lib/supabase-server');

import { inMemoryRateLimit } from '@/lib/rate-limit';
import { POST, GET } from '../route';

let mockGetUser: jest.Mock;
let mockInsert: jest.Mock;

function setupDefaultMocks(hasUser: boolean = false, isAdmin: boolean = false) {
  mockGetUser = jest.fn().mockResolvedValue({
    data: { user: hasUser ? { id: 'user-123' } : null },
  });

  mockInsert = jest.fn().mockResolvedValue({
    data: { id: 'event-123' },
    error: null,
  });

  const { createServerSupabaseAuthClient } = require('@/lib/supabase-server-auth');
  createServerSupabaseAuthClient.mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: jest.fn((table: string) => {
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: isAdmin ? { id: 'user-123', is_platform_admin: true } : null,
              }),
            }),
          }),
        };
      } else if (table === 'ab_test_events') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockResolvedValue({
              data: [
                { variant: 'control', event_type: 'impression' },
                { variant: 'control', event_type: 'conversion' },
                { variant: 'treatment', event_type: 'impression' },
              ],
            }),
          }),
        };
      }
    }),
  });

  const { createServiceRoleClient } = require('@/lib/supabase-server');
  createServiceRoleClient.mockReturnValue({
    from: jest.fn().mockReturnValue({
      insert: mockInsert,
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({
          data: [
            { variant: 'control', event_type: 'impression' },
            { variant: 'control', event_type: 'conversion' },
            { variant: 'treatment', event_type: 'impression' },
            { variant: 'treatment', event_type: 'conversion' },
          ],
        }),
      }),
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  setupDefaultMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
});

function makePostRequest(body: object, ip = '192.168.1.1') {
  return new Request('http://localhost/api/ab-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(key: string = 'exp-123', ip = '192.168.1.1') {
  const req = new Request(`http://localhost/api/ab-test?key=${key}`, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
  Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
  return req;
}

const validEvent = {
  experiment_key: 'exp-button-color',
  variant: 'control',
  event_type: 'impression',
};

describe('POST /api/ab-test', () => {
  test('rate limiting → silent 200 ok=true', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
    const res = await POST(makePostRequest(validEvent) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  test('invalid schema → silent 200 ok=true', async () => {
    const res = await POST(makePostRequest({ invalid: 'data' }) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  test('missing experiment_key → 200 (silently ignored)', async () => {
    const res = await POST(makePostRequest({ variant: 'control', event_type: 'impression' }) as any);
    expect(res.status).toBe(200);
  });

  test('invalid variant → 200 (silently ignored)', async () => {
    const res = await POST(makePostRequest({ ...validEvent, variant: 'invalid' }) as any);
    expect(res.status).toBe(200);
  });

  test('invalid event_type → 200 (silently ignored)', async () => {
    const res = await POST(makePostRequest({ ...validEvent, event_type: 'invalid' }) as any);
    expect(res.status).toBe(200);
  });

  test('valid event → 200 ok=true', async () => {
    const res = await POST(makePostRequest(validEvent) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  test('user_id taken from session, not body', async () => {
    setupDefaultMocks(true);
    await POST(makePostRequest(validEvent) as any);
    const call = mockInsert.mock.calls[0];
    expect(call[0].user_id).toBe('user-123');
  });

  test('anonymous event allowed (user_id null)', async () => {
    const res = await POST(makePostRequest(validEvent) as any);
    expect(res.status).toBe(200);
  });

  test('rate limit params (100 req/min per IP)', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();
    POST(makePostRequest(validEvent, '192.168.1.1') as any);
    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe(100);
  });

  test('invalid JSON body → 200 (silently ignored via .catch)', async () => {
    const req = new Request('http://localhost/api/ab-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
      body: 'not-valid-json{{{',
    });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});

describe('GET /api/ab-test', () => {
  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);
    const res = await GET(makeGetRequest() as any);
    expect(res.status).toBe(429);
  });

  test('unauthenticated → 401', async () => {
    setupDefaultMocks(false);
    const res = await GET(makeGetRequest() as any);
    expect(res.status).toBe(401);
  });

  test('authenticated but not admin → 403', async () => {
    setupDefaultMocks(true, false);
    const res = await GET(makeGetRequest() as any);
    expect(res.status).toBe(403);
  });

  test('missing key parameter → 400', async () => {
    setupDefaultMocks(true, true);
    const req = new Request('http://localhost/api/ab-test', {
      method: 'GET',
      headers: { 'x-forwarded-for': '192.168.1.1' },
    });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    expect(res.status).toBe(400);
  });

  test('admin can retrieve results → 200', async () => {
    setupDefaultMocks(true, true);
    const res = await GET(makeGetRequest() as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.experiment_key).toBe('exp-123');
  });

  test('results include control and treatment', async () => {
    setupDefaultMocks(true, true);
    const res = await GET(makeGetRequest() as any);
    const json = await res.json();
    expect(json.control).toBeDefined();
    expect(json.treatment).toBeDefined();
  });

  test('conversion rate calculated', async () => {
    setupDefaultMocks(true, true);
    const res = await GET(makeGetRequest() as any);
    const json = await res.json();
    expect(json.control.conversion_rate).toBeDefined();
    expect(json.treatment.conversion_rate).toBeDefined();
  });

  test('lift calculated (treatment - control)', async () => {
    setupDefaultMocks(true, true);
    const res = await GET(makeGetRequest() as any);
    const json = await res.json();
    expect(json.lift).toBeDefined();
  });

  test('rate limit params (20 req/min per IP)', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();
    setupDefaultMocks(true, true);
    GET(makeGetRequest('exp-123', '192.168.1.1') as any);
    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe(20);
  });
});
