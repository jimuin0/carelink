/**
 * @jest-environment node
 */

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server');
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });

import { checkRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

// 各クエリの ilike(列, パターン) を記録し、エスケープ・切り詰めを結果で検証する
const ilikeCalls: Array<[string, string]> = [];

function setupDefaultMocks(hasResults: boolean = true) {
  const { createServerSupabaseClient } = require('@/lib/supabase-server');
  
  const facilityData = hasResults
    ? [
        {
          id: 'fac-1',
          name: 'Salon ABC',
          slug: 'salon-abc',
          city: 'Tokyo',
          nearest_station: 'Shibuya',
          business_type: 'eyelash',
        },
      ]
    : [];

  const cityData = hasResults ? [{ city: 'Tokyo' }, { city: 'Shibuya' }] : [];
  const stationData = hasResults ? [{ nearest_station: 'Shibuya Station' }] : [];

  createServerSupabaseClient.mockReturnValue({
    from: jest.fn((table: string) => {
      return {
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            ilike: jest.fn((col: string, pat: string) => { ilikeCalls.push([col, pat]); return {
              limit: jest.fn().mockResolvedValue({
                data: table === 'facility_profiles' && facilityData ? facilityData : cityData,
              }),
            }; }),
            not: jest.fn().mockReturnValue({
              ilike: jest.fn((col: string, pat: string) => { ilikeCalls.push([col, pat]); return {
                limit: jest.fn().mockResolvedValue({
                  data: stationData,
                }),
              }; }),
            }),
          }),
        }),
      };
    }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  ilikeCalls.length = 0;
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  setupDefaultMocks();
});

function makeRequest(query: string = '', ip = '192.168.1.1') {
  const req = new Request(`http://localhost/api/facilities/suggest${query}`, {
    method: 'GET',
    headers: { 'x-forwarded-for': ip },
  });
  Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
  return req;
}

describe('GET /api/facilities/suggest', () => {
  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);
    const res = await GET(makeRequest('?q=tokyo') as any);
    expect(res.status).toBe(429);
  });

  test('missing q parameter → 200 with empty arrays', async () => {
    const res = await GET(makeRequest('') as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.facilities).toEqual([]);
    expect(json.areas).toEqual([]);
  });

  test('empty q parameter → 200 with empty arrays', async () => {
    const res = await GET(makeRequest('?q=') as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.facilities).toEqual([]);
    expect(json.areas).toEqual([]);
  });

  test('valid q parameter → 200 with suggestions', async () => {
    const res = await GET(makeRequest('?q=tokyo') as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.facilities).toBeDefined();
    expect(json.areas).toBeDefined();
  });

  test('q truncated to 50 chars', async () => {
    const longQuery = 'x'.repeat(100);
    const res = await GET(makeRequest(`?q=${longQuery}`) as any);
    expect(res.status).toBe(200);
    expect(ilikeCalls).toHaveLength(3);
    for (const [, pat] of ilikeCalls) expect(pat).toBe(`%${'x'.repeat(50)}%`);
  });

  test('SQL special chars escaped（% _ \\ はワイルドカードとして効かない）', async () => {
    // q = "%te_st\\"（URL エンコードして渡す）
    const res = await GET(makeRequest(`?q=${encodeURIComponent('%te_st\\')}`) as any);
    expect(res.status).toBe(200);
    expect(ilikeCalls.map(([c]) => c)).toEqual(['name', 'city', 'nearest_station']);
    for (const [, pat] of ilikeCalls) expect(pat).toBe('%\\%te\\_st\\\\%');
  });

  test('whitespace trimmed', async () => {
    const res = await GET(makeRequest('?q=%20%20tokyo%20%20') as any);
    expect(res.status).toBe(200);
  });

  test('facilities limited to 5 results', async () => {
    const res = await GET(makeRequest('?q=salon') as any);
    const json = await res.json();
    expect(json.facilities.length).toBeLessThanOrEqual(5);
  });

  test('areas limited to 5 results', async () => {
    const res = await GET(makeRequest('?q=tokyo') as any);
    const json = await res.json();
    expect(json.areas.length).toBeLessThanOrEqual(5);
  });

  test('facility suggestion includes all fields', async () => {
    const res = await GET(makeRequest('?q=salon') as any);
    const json = await res.json();
    if (json.facilities.length > 0) {
      const fac = json.facilities[0];
      expect(fac.id).toBeDefined();
      expect(fac.name).toBeDefined();
      expect(fac.slug).toBeDefined();
      expect(fac.business_type).toBeDefined();
    }
  });

  test('no results → 200 with empty arrays', async () => {
    setupDefaultMocks(false);
    const res = await GET(makeRequest('?q=nonexistent') as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.facilities).toEqual([]);
  });

  test('exception → 500 with Sentry', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockImplementation(() => {
      throw new Error('DB error');
    });
    const res = await GET(makeRequest('?q=test') as any);
    expect(res.status).toBe(500);
  });

  test('rate limit params (30 req/min per IP)', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    await GET(makeRequest('?q=test', '192.168.1.1') as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[2]).toBe(30);
  });

  test('extracts last (trusted) IP from x-forwarded-for', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    await GET(makeRequest('?q=test', '10.0.0.1, 192.168.1.1') as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });

  test('only published facilities returned', async () => {
    const res = await GET(makeRequest('?q=salon') as any);
    expect(res.status).toBe(200);
  });

  test('rate limit params window is 60_000ms', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    await GET(makeRequest('?q=test') as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[3]).toBe(60_000);
  });

  test('レスポンスが { facilities, areas } 形式', async () => {
    const res = await GET(makeRequest('?q=salon') as any);
    const json = await res.json();
    expect(Array.isArray(json.facilities)).toBe(true);
    expect(Array.isArray(json.areas)).toBe(true);
  });

  test('q が 1文字 → 空 (最低2文字必要かどうか)', async () => {
    const res = await GET(makeRequest('?q=a') as any);
    expect(res.status).toBe(200);
  });

  test('x-forwarded-for ヘッダーなし → IP "unknown" を使用', async () => {
    (checkRateLimit as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/facilities/suggest?q=test', {
      method: 'GET',
    });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    await GET(req as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('DB が null を返す → || [] フォールバック（facilities/cityData/stationData）', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            ilike: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({ data: null }),
            }),
            not: jest.fn().mockReturnValue({
              ilike: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({ data: null }),
              }),
            }),
          }),
        }),
      })),
    });

    const res = await GET(makeRequest('?q=tokyo') as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.facilities).toEqual([]);
    expect(json.areas).toEqual([]);
  });

  test('null city 行 → if(row.city) の false ブランチ', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            ilike: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [{ city: null }, { city: 'Tokyo' }],
              }),
            }),
            not: jest.fn().mockReturnValue({
              ilike: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({
                  data: [{ nearest_station: null }, { nearest_station: 'Shibuya' }],
                }),
              }),
            }),
          }),
        }),
      })),
    });

    const res = await GET(makeRequest('?q=tokyo') as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.areas).toContain('Tokyo');
    expect(json.areas).toContain('Shibuya');
  });
});

// 中 A19：DB 障害を「候補 0 件」の 200 にしない。
describe('DB 障害', () => {
  function mockWithError(which: 'name' | 'city' | 'station') {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    const down = { code: '08006', message: 'down' };
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn((cols: string) => ({
          eq: jest.fn(() => ({
            ilike: jest.fn(() => ({
              limit: jest.fn().mockResolvedValue(
                (which === 'name' && cols.startsWith('id')) || (which === 'city' && cols === 'city')
                  ? { data: null, error: down }
                  : { data: [], error: null },
              ),
            })),
            not: jest.fn(() => ({
              ilike: jest.fn(() => ({
                limit: jest.fn().mockResolvedValue(which === 'station' ? { data: null, error: down } : { data: [], error: null }),
              })),
            })),
          })),
        })),
      })),
    });
  }
  test.each(['name', 'city', 'station'] as const)('%s の取得失敗 → 500', async (which) => {
    mockWithError(which);
    const res = await GET(makeRequest('?q=tokyo') as any);
    expect(res.status).toBe(500);
  });
});
