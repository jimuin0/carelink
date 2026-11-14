/**
 * @jest-environment node
 *
 * Tests for GET /api/stations
 * 駅候補は RPC list_published_stations（公開施設・重複なし・最大 200 件）から取る（点検 B3-4）。
 */

jest.mock('@/lib/rate-limit', () => ({
  checkRateLimit: jest.fn(() => false),
}));
jest.mock('@/lib/supabase-server');
jest.mock('@/lib/alert', () => ({ alertCaughtError: jest.fn() }));
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn() }), { virtual: true });

import { checkRateLimit } from '@/lib/rate-limit';
import { GET } from '../route';

let mockRpc: jest.Mock;

function request(q?: string, headers: Record<string, string> = { 'x-forwarded-for': '192.168.1.1' }) {
  const url = `http://localhost/api/stations${q === undefined ? '' : `?q=${encodeURIComponent(q)}`}`;
  const req = new Request(url, { headers });
  Object.defineProperty(req, 'nextUrl', { value: new URL(url), writable: true });
  return req as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  (checkRateLimit as jest.Mock).mockReturnValue(false);
  mockRpc = jest.fn().mockResolvedValue({ data: [], error: null });
  const { createServerSupabaseClient } = require('@/lib/supabase-server');
  createServerSupabaseClient.mockReturnValue({ rpc: mockRpc });
});

describe('GET /api/stations', () => {
  test('rate limiting → 429（IP とレート上限を渡す）', async () => {
    (checkRateLimit as jest.Mock).mockReturnValue(true);
    const res = await GET(request(undefined, { 'x-forwarded-for': '10.0.0.1, 192.168.1.1' }));
    expect(res.status).toBe(429);
    const call = (checkRateLimit as jest.Mock).mock.calls[0];
    expect(call[1]).toBe('192.168.1.1');
    expect(call[2]).toBe(30);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test('q なしは絞り込まずに RPC を呼び、駅名の配列を返す', async () => {
    mockRpc.mockResolvedValue({ data: [{ nearest_station: '渋谷駅' }, { nearest_station: '新宿駅' }], error: null });
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('list_published_stations', {});
    expect(await res.json()).toEqual({ stations: ['渋谷駅', '新宿駅'] });
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, s-maxage=3600');
  });

  test('空白だけの q は絞り込まない', async () => {
    await GET(request('   '));
    expect(mockRpc).toHaveBeenCalledWith('list_published_stations', {});
  });

  test('q は前後の空白を除き 50 文字に切り詰めて渡す（エスケープは RPC が行う）', async () => {
    await GET(request(` ${'あ'.repeat(60)}%_ `));
    expect(mockRpc).toHaveBeenCalledWith('list_published_stations', { p_query: 'あ'.repeat(50) });
    await GET(request('渋谷'));
    expect(mockRpc).toHaveBeenLastCalledWith('list_published_stations', { p_query: '渋谷' });
  });

  test('data が null でも空配列・空の駅名は除く', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await (await GET(request())).json()).toEqual({ stations: [] });
    mockRpc.mockResolvedValueOnce({ data: [{ nearest_station: '' }, { nearest_station: '池袋駅' }], error: null });
    expect(await (await GET(request())).json()).toEqual({ stations: ['池袋駅'] });
  });

  test('DB 障害 → 500・キャッシュさせない', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '08006', message: 'down' } });
    const res = await GET(request());
    expect(res.status).toBe(500);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});
