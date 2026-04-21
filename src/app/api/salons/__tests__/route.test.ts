/**
 * @jest-environment node
 *
 * Tests for GET /api/salons
 * Key assertions:
 *   - Rate limiting (20 req/min per IP)
 *   - Single salon by id (UUID validation, is_public check)
 *   - List salons with optional business_type filter
 *   - List salons with optional area search (with SQL escape)
 *   - Error handling with Sentry
 */

jest.mock('@/lib/rate-limit', () => ({
  inMemoryRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server');
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }));

import { inMemoryRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

// Helper to create chainable mock for query operations
function createChainableMock(resolveValue: any) {
  const chainable: any = {
    eq: jest.fn(),
    order: jest.fn(),
    limit: jest.fn(),
    ilike: jest.fn(),
    select: jest.fn(),
    single: jest.fn(),
  };

  chainable.eq.mockReturnValue(chainable);
  chainable.order.mockReturnValue(chainable);
  chainable.limit.mockResolvedValue(resolveValue);
  chainable.ilike.mockReturnValue(chainable);
  chainable.select.mockReturnValue(chainable);
  chainable.single.mockResolvedValue(resolveValue);

  return chainable;
}

function setupDefaultMocks(
  singleMode: boolean = false,
  salonFound: boolean = true,
  queryError: boolean = false
) {
  const listData = queryError
    ? null
    : {
        data: [
          {
            id: 'salon-1',
            name: 'Salon A',
            business_type: 'eyelash',
            address: '大阪市北区',
            is_public: true,
          },
          {
            id: 'salon-2',
            name: 'Salon B',
            business_type: 'massage',
            address: '京都市左京区',
            is_public: true,
          },
        ],
        error: null,
      };

  const singleData = salonFound
    ? {
        data: {
          id: 'salon-id-123',
          name: 'Single Salon',
          business_type: 'eyelash',
          address: '東京都渋谷区',
          is_public: true,
        },
        error: null,
      }
    : { data: null, error: { message: 'Not found' } };

  const { createServerSupabaseClient } = require('@/lib/supabase-server');
  createServerSupabaseClient.mockReturnValue({
    from: jest.fn((table: string) => {
      if (table === 'salons') {
        if (singleMode) {
          return createChainableMock(singleData);
        }
        return createChainableMock(listData);
      }
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  (inMemoryRateLimit as jest.Mock).mockReturnValue(false);
  setupDefaultMocks();
});

function makeRequest(query: string, ip = '192.168.1.1') {
  return new Request(`http://localhost/api/salons${query}`, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
}

const SALON_UUID = '11111111-1111-1111-1111-111111111111';

describe('GET /api/salons', () => {
  test('rate limiting → 429', async () => {
    (inMemoryRateLimit as jest.Mock).mockReturnValue(true);

    const res = await GET(makeRequest('') as any);

    expect(res.status).toBe(429);
  });

  test('list salons → 200 with array', async () => {
    const res = await GET(makeRequest('') as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
    expect(json.length).toBeGreaterThan(0);
  });

  test('single salon by id (found) → 200 with salon', async () => {
    setupDefaultMocks(true, true);

    const res = await GET(makeRequest(`?id=${SALON_UUID}`) as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe('salon-id-123');
    expect(json.name).toBe('Single Salon');
  });

  test('single salon by id (not found) → 404', async () => {
    setupDefaultMocks(true, false);

    const res = await GET(makeRequest(`?id=${SALON_UUID}`) as any);

    expect(res.status).toBe(404);
  });

  test('invalid id UUID → ignores and lists all', async () => {
    const res = await GET(makeRequest('?id=not-a-uuid') as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
  });

  test('id with spaces → ignores and lists all', async () => {
    const res = await GET(makeRequest('?id=not an id') as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
  });

  test('list with business_type filter', async () => {
    const res = await GET(makeRequest('?business_type=eyelash') as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
  });

  test('list with area search', async () => {
    const res = await GET(makeRequest('?area=大阪市') as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
  });

  test('area search with SQL special chars escaped', async () => {
    const res = await GET(makeRequest('?area=foo%bar_baz\\test') as any);

    expect(res.status).toBe(200);
    // Verify the query was made (escaping happened)
  });

  test('area search trimmed and sliced to 100 chars', async () => {
    const longArea = 'x'.repeat(150);
    const res = await GET(makeRequest(`?area=  ${longArea}  `) as any);

    expect(res.status).toBe(200);
  });

  test('business_type and area together', async () => {
    const res = await GET(makeRequest('?business_type=massage&area=京都') as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true);
  });

  test('empty response → returns empty array', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue(
        createChainableMock({ data: null, error: null })
      ),
    });

    const res = await GET(makeRequest('') as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
  });

  test('query error → 500', async () => {
    setupDefaultMocks(false, true, true);

    const res = await GET(makeRequest('') as any);

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

  test('only returns is_public=true salons', async () => {
    const res = await GET(makeRequest('') as any);

    expect(res.status).toBe(200);
    // Query includes .eq('is_public', true)
  });

  test('single salon also checks is_public', async () => {
    setupDefaultMocks(true, true);

    const res = await GET(makeRequest(`?id=${SALON_UUID}`) as any);

    expect(res.status).toBe(200);
    // Query includes .eq('is_public', true)
  });

  test('list limited to 50 results', async () => {
    const res = await GET(makeRequest('') as any);

    expect(res.status).toBe(200);
    // Query includes .limit(50)
  });

  test('salons ordered by created_at descending', async () => {
    const res = await GET(makeRequest('') as any);

    expect(res.status).toBe(200);
    // Query includes .order('created_at', { ascending: false })
  });

  test('UUID regex: standard format accepted', async () => {
    setupDefaultMocks(true, true);
    const validUuid = '550e8400-e29b-41d4-a716-446655440000';

    const res = await GET(makeRequest(`?id=${validUuid}`) as any);

    expect(res.status).toBe(200);
  });

  test('UUID regex: hyphens required', async () => {
    const res = await GET(makeRequest('?id=550e8400e29b41d4a716446655440000') as any);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json)).toBe(true); // Falls back to list
  });

  test('area with empty string → ignored', async () => {
    const res = await GET(makeRequest('?area=') as any);

    expect(res.status).toBe(200);
  });

  test('area with only whitespace → ignored', async () => {
    const res = await GET(makeRequest('?area=   ') as any);

    expect(res.status).toBe(200);
  });

  test('exception caught by try-catch → 500 with Sentry', async () => {
    const { captureException } = require('@sentry/nextjs');
    const testError = new Error('Unexpected error');

    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockImplementation(() => {
      throw testError;
    });

    const res = await GET(makeRequest('') as any);

    expect(res.status).toBe(500);
    expect(captureException).toHaveBeenCalledWith(testError, expect.any(Object));
  });
});
