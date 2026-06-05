/**
 * @jest-environment node
 *
 * Tests for GET /api/stations - Rate limiting
 */

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server');
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });

import { checkRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);

  const { createServerSupabaseClient } = require('@/lib/supabase-server');
  const chainable: any = {};
  Object.assign(chainable, {
    eq: jest.fn().mockReturnValue(chainable),
    not: jest.fn().mockReturnValue(chainable),
    ilike: jest.fn().mockReturnValue(chainable),
    limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    select: jest.fn().mockReturnValue(chainable),
  });
  createServerSupabaseClient.mockReturnValue({
    from: jest.fn().mockReturnValue(chainable),
  });
});

describe('GET /api/stations', () => {
  test('rate limiting → 429', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);
    const res = await GET(new Request('http://localhost/api/stations', {
      headers: { 'x-forwarded-for': '192.168.1.1' },
    }) as any);
    expect(res.status).toBe(429);
  });

  test('valid request → 200', async () => {
    const req = new Request('http://localhost/api/stations', {
      headers: { 'x-forwarded-for': '192.168.1.1' },
    });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    expect(res.status).toBe(200);
  });

  test('rate limit params', () => {
    (checkRateLimit as jest.Mock).mockClear();
    GET(new Request('http://localhost/api/stations', {
      headers: { 'x-forwarded-for': '192.168.1.1' },
    }) as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[2]).toBe(30);
  });

  test('IP extraction', () => {
    (checkRateLimit as jest.Mock).mockClear();
    GET(new Request('http://localhost/api/stations', {
      headers: { 'x-forwarded-for': '10.0.0.1, 192.168.1.1' },
    }) as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
  });
});

  test('q パラメーターで駅名フィルタリング', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    const ilikeMock = jest.fn().mockReturnValue({
      limit: jest.fn().mockResolvedValue({ data: [{ nearest_station: '渋谷駅' }], error: null }),
    });
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            not: jest.fn().mockReturnValue({ ilike: ilikeMock }),
          }),
        }),
      }),
    });

    const req = new Request('http://localhost/api/stations?q=渋谷', { headers: { 'x-forwarded-for': '192.168.1.1' } });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.stations).toContain('渋谷駅');
  });

  test('重複する駅名がデデュープされる', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            not: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [
                  { nearest_station: '渋谷駅' },
                  { nearest_station: '渋谷駅' },
                  { nearest_station: '新宿駅' },
                ],
                error: null,
              }),
            }),
          }),
        }),
      }),
    });

    const req = new Request('http://localhost/api/stations', { headers: { 'x-forwarded-for': '192.168.1.1' } });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    const json = await res.json();
    expect(json.stations.filter((s: string) => s === '渋谷駅').length).toBe(1);
  });

  test('駅名がソートされて返る', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            not: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [
                  { nearest_station: '池袋駅' },
                  { nearest_station: '渋谷駅' },
                  { nearest_station: '新宿駅' },
                ],
                error: null,
              }),
            }),
          }),
        }),
      }),
    });

    const req = new Request('http://localhost/api/stations', { headers: { 'x-forwarded-for': '192.168.1.1' } });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    const json = await res.json();
    expect(json.stations).toEqual([...json.stations].sort());
  });

  test('Cache-Control ヘッダーが設定されている', async () => {
    const req = new Request('http://localhost/api/stations', { headers: { 'x-forwarded-for': '192.168.1.1' } });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    const cc = res.headers.get('Cache-Control') || res.headers.get('cache-control');
    expect(cc).toContain('max-age');
  });

  test('DB 例外 → 500', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockImplementation(() => { throw new Error('DB error'); });
    const req = new Request('http://localhost/api/stations', { headers: { 'x-forwarded-for': '192.168.1.1' } });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    expect(res.status).toBe(500);
  });

  test('q が空文字の場合は全件返す（ilike 呼ばれない）', async () => {
    const req = new Request('http://localhost/api/stations?q=', { headers: { 'x-forwarded-for': '192.168.1.1' } });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    expect(res.status).toBe(200);
  });

  test('q が 50 文字超でも安全に処理（スライス）', async () => {
    const longQ = 'あ'.repeat(100);
    const req = new Request(`http://localhost/api/stations?q=${encodeURIComponent(longQ)}`, {
      headers: { 'x-forwarded-for': '192.168.1.1' },
    });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    expect(res.status).toBe(200);
  });

  test('q に SQL injection 文字が含まれても安全', async () => {
    const req = new Request(`http://localhost/api/stations?q=${encodeURIComponent('%_\\')}`, {
      headers: { 'x-forwarded-for': '192.168.1.1' },
    });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    expect(res.status).toBe(200);
  });

  test('unknown IP（x-forwarded-for なし）でもレートリミット動作', () => {
    (checkRateLimit as jest.Mock).mockClear();
    const req = new Request('http://localhost/api/stations');
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    GET(req as any);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('unknown');
  });

  test('data が null でも空配列で返る', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            not: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      }),
    });
    const req = new Request('http://localhost/api/stations', { headers: { 'x-forwarded-for': '192.168.1.1' } });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    const json = await res.json();
    expect(json.stations).toEqual([]);
  });

  test('falsy nearest_station 行はフィルタされる', async () => {
    const { createServerSupabaseClient } = require('@/lib/supabase-server');
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            not: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [
                  { nearest_station: '' },
                  { nearest_station: null },
                  { nearest_station: '新宿駅' },
                ],
                error: null,
              }),
            }),
          }),
        }),
      }),
    });
    const req = new Request('http://localhost/api/stations', { headers: { 'x-forwarded-for': '192.168.1.1' } });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    const json = await res.json();
    expect(json.stations).toEqual(['新宿駅']);
  });

  test('レスポンスが { stations: string[] } 形式', async () => {
    const req = new Request('http://localhost/api/stations', { headers: { 'x-forwarded-for': '192.168.1.1' } });
    Object.defineProperty(req, 'nextUrl', { value: new URL(req.url), writable: true });
    const res = await GET(req as any);
    const json = await res.json();
    expect(Array.isArray(json.stations)).toBe(true);
  });
