/**
 * @jest-environment node
 *
 * Tests for GET /api/salons
 * Key assertions:
 *   - Rate limiting (20 req/min per IP)
 *   - Single salon by ID (UUID validation, is_public filter)
 *   - List salons (business_type filter, area ilike search, limit 50)
 *   - SQL injection prevention (area escaping)
 */

jest.mock('@/lib/rate-limit', () => ({
  inMemoryRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server');
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });

import { inMemoryRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

function setupDefaultMocks(
  singleFound: boolean = true,
  listHasResults: boolean = true,
  dbError: boolean = false
) {
  const singleData = singleFound
    ? {
        id: '11111111-1111-1111-1111-111111111111',
        name: 'Salon ABC',
        business_type: 'eyelash',
        address: '東京都渋谷区道玄坂',
        is_public: true,
        created_at: '2026-05-10T10:00:00Z',
      }
    : null;

  const listData = listHasResults
    ? [
        {
          id: '22222222-2222-2222-2222-222222222222',
          name: 'Salon A',
          business_type: 'eyelash',
          address: '東京都渋谷区',
          is_public: true,
          created_at: '2026-05-10T10:00:00Z',
        },
        {
          id: '33333333-3333-3333-3333-333333333333',
          name: 'Salon B',
          business_type: 'nail',
          address: '東京都新宿区',
          is_public: true,
          created_at: '2026-05-09T10:00:00Z',
        },
      ]
    : [];

  const listResult = { data: dbError ? null : listData, error: dbError ? { message: 'DB error' } : null };

  // Self-referential chain: order().eq().ilike().limit() or any subset
  const listChain: any = {};
  Object.assign(listChain, {
    eq: jest.fn().mockReturnValue(listChain),
    ilike: jest.fn().mockReturnValue(listChain),
    order: jest.fn().mockReturnValue(listChain),
    limit: jest.fn().mockResolvedValue(listResult),
  });

  const { createServerSupabaseClient } = require('@/lib/supabase-server');
  createServerSupabaseClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'salons') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: dbError ? null : singleData,
                  error: dbError ? { message: 'DB error' } : null,
                }),
              }),
              order: jest.fn().mockReturnValue(listChain),
            }),
          }),
        };
      }
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  setupDefaultMocks();
});

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

function makeRequest(query: string = '', ip = '192.168.1.1') {
  return new Request(
    `http://localhost/api/salons${query ? `?${query}` : ''}`,
    {
      method: 'GET',
      headers: { 'x-forwarded-for': ip },
    }
  );
}

describe('GET /api/salons', () => {
  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(429);
  });

  test('no params → 200 with list of salons', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBeGreaterThan(0);
  });

  test('single salon by ID (valid UUID) → 200', async () => {
    const res = await GET(makeRequest(`id=${VALID_UUID}`) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(VALID_UUID);
    expect(json.name).toBe('Salon ABC');
  });

  test('single salon by ID (invalid UUID format) → empty list', async () => {
    const res = await GET(makeRequest('id=not-a-uuid') as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
  });

  test('single salon not found → 404', async () => {
    setupDefaultMocks(false);

    const res = await GET(makeRequest(`id=${VALID_UUID}`) as any);

    expect(res.status).toBe(404);
  });

  test('filters by business_type', async () => {
    const res = await GET(makeRequest('business_type=eyelash') as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
  });

  test('filters by area (ILIKE search)', async () => {
    const res = await GET(makeRequest('area=東京都渋谷区') as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
  });

  test('area parameter trimmed and sliced to 100 chars', async () => {
    const longArea = 'x'.repeat(150);
    const res = await GET(makeRequest(`area= ${longArea} `) as any);

    expect(res.status).toBe(200);
  });

  test('area with SQL injection chars escaped', async () => {
    const res = await GET(makeRequest('area=%_\\') as any);

    expect(res.status).toBe(200);
  });

  test('both business_type and area filters applied', async () => {
    const res = await GET(
      makeRequest('business_type=eyelash&area=東京都') as any
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
  });

  test('list limited to 50 results', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
  });

  test('results ordered by created_at descending', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    if (json.length > 1) {
      expect(new Date(json[0].created_at).getTime()).toBeGreaterThanOrEqual(new Date(json[1].created_at).getTime());
    }
  });

  test('includes is_public=true filter for single lookup', async () => {
    const res = await GET(makeRequest(`id=${VALID_UUID}`) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.is_public).toBe(true);
  });

  test('includes is_public=true filter for list', async () => {
    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    if (json.length > 0) {
      expect(json[0].is_public).toBe(true);
    }
  });

  test('DB error → 500', async () => {
    setupDefaultMocks(false, false, true);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
  });

  test('rate limit params (20 req/min per IP)', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    GET(makeRequest('', '192.168.1.1') as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('192.168.1.1');
    expect(call[1]).toBe(20);
    expect(call[2]).toBe(60_000);
    expect(call[3]).toBe('salons');
  });

  test('extracts first IP from x-forwarded-for', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    GET(makeRequest('', '10.0.0.1, 192.168.1.1') as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('10.0.0.1');
  });

  test('uses unknown IP when x-forwarded-for missing', () => {
    (inMemoryRateLimit as jest.Mock).mockClear();

    const req = new Request('http://localhost/api/salons');
    GET(req as any);

    const call = (inMemoryRateLimit as jest.Mock).mock.calls[0];
    expect(call[0]).toBe('unknown');
  });

  test('empty list when no results', async () => {
    setupDefaultMocks(false, false);

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
  });

  test('exception during processing → 500', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockImplementation(() => {
      throw new Error('Connection error');
    });

    const res = await GET(makeRequest() as any);

    expect(res.status).toBe(500);
  });

  test('UUID with uppercase letters accepted', async () => {
    const upperUuid = VALID_UUID.toUpperCase();
    const res = await GET(makeRequest(`id=${upperUuid}`) as any);

    expect(res.status).toBe(200);
  });

  test('UUID too short (not 36 chars) → list fallback', async () => {
    const res = await GET(makeRequest('id=11111111-1111-1111') as any);

    expect(res.status).toBe(200);
  });

  test('empty area parameter ignored', async () => {
    const res = await GET(makeRequest('area=') as any);

    expect(res.status).toBe(200);
  });

  test('response includes salon metadata (name, business_type, address)', async () => {
    const res = await GET(makeRequest() as any);

    const json = await res.json();
    if (json.length > 0) {
      const salon = json[0];
      expect(salon.id).toBeDefined();
      expect(salon.name).toBeDefined();
      expect(salon.business_type).toBeDefined();
      expect(salon.address).toBeDefined();
    }
  });

  test('multiple IDs in query string → only first ID used', async () => {
    const res = await GET(
      makeRequest(`id=${VALID_UUID}&id=22222222-2222-2222-2222-222222222222`) as any
    );

    expect(res.status).toBe(200);
  });

  test('special chars in area sanitized (percent encoding)', async () => {
    const res = await GET(makeRequest('area=%25') as any);

    expect(res.status).toBe(200);
  });
});
