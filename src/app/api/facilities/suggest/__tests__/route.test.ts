/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';

const mockFrom = jest.fn();

jest.mock('@/lib/supabase-server', () => ({
  createServerSupabaseClient: () => ({ from: mockFrom }),
}));

import { GET } from '../route';

beforeEach(() => {
  mockFrom.mockReset();
});

function fluent(resolvedValue: unknown) {
  const self: Record<string, jest.Mock> = {};
  const handler = jest.fn(() => self);
  self.select = handler;
  self.eq = handler;
  self.ilike = handler;
  self.not = handler;
  self.limit = jest.fn(() => Promise.resolve(resolvedValue));
  return self;
}

function makeRequest(q?: string) {
  const url = q ? `http://localhost/api/facilities/suggest?q=${encodeURIComponent(q)}` : 'http://localhost/api/facilities/suggest';
  return new NextRequest(url);
}

describe('GET /api/facilities/suggest', () => {
  test('qパラメータで施設名を検索する', async () => {
    const facilities = [
      { id: 'f-1', name: 'テストサロン', slug: 'test', city: '渋谷区', nearest_station: '渋谷駅', business_type: 'ヘアサロン' },
    ];
    const facilityChain = fluent({ data: facilities });
    const cityChain = fluent({ data: [{ city: '渋谷区' }] });
    const stationChain = fluent({ data: [{ nearest_station: '渋谷駅' }] });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return facilityChain;
      if (callNum === 2) return cityChain;
      return stationChain;
    });

    const res = await GET(makeRequest('テスト'));
    const json = await res.json();
    expect(json.facilities).toHaveLength(1);
    expect(json.facilities[0].name).toBe('テストサロン');
    expect(json.areas).toContain('渋谷区');
  });

  test('qが空の場合は空配列を返す', async () => {
    const res = await GET(makeRequest(''));
    const json = await res.json();
    expect(json.facilities).toEqual([]);
    expect(json.areas).toEqual([]);
  });

  test('qパラメータなしの場合は空配列を返す', async () => {
    const res = await GET(makeRequest());
    const json = await res.json();
    expect(json.facilities).toEqual([]);
  });

  test('エリアの重複が排除される', async () => {
    const facilityChain = fluent({ data: [] });
    const cityChain = fluent({ data: [{ city: '渋谷区' }, { city: '渋谷区' }] });
    const stationChain = fluent({ data: [{ nearest_station: '渋谷駅' }] });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return facilityChain;
      if (callNum === 2) return cityChain;
      return stationChain;
    });

    const res = await GET(makeRequest('渋谷'));
    const json = await res.json();
    // 渋谷区 should appear once, + 渋谷駅 = 2
    expect(json.areas).toHaveLength(2);
  });

  test('areas上限5件', async () => {
    const facilityChain = fluent({ data: [] });
    const cityChain = fluent({ data: Array.from({ length: 10 }, (_, i) => ({ city: `City${i}` })) });
    const stationChain = fluent({ data: [] });

    let callNum = 0;
    mockFrom.mockImplementation(() => {
      callNum++;
      if (callNum === 1) return facilityChain;
      if (callNum === 2) return cityChain;
      return stationChain;
    });

    const res = await GET(makeRequest('test'));
    const json = await res.json();
    expect(json.areas.length).toBeLessThanOrEqual(5);
  });
});
