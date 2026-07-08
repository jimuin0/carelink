const mockFrom = jest.fn();

jest.mock('../supabase-server', () => ({
  createServerSupabaseClient: () => ({ from: mockFrom }),
}));

import { getRankedFacilities } from '../rankings';

beforeEach(() => {
  mockFrom.mockReset();
});

// Supabase builder is lazy: all methods return `this`, and `await builder` fetches data.
function buildChain(data: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'gt', 'order', 'limit'];
  for (const m of methods) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  // Make the chain thenable so `await chain` resolves the query
  chain.then = jest.fn().mockImplementation((resolve: (v: unknown) => void) => resolve({ data }));
  return chain as Record<string, jest.Mock>;
}

describe('getRankedFacilities', () => {
  it('returns facilities sorted by rating with default limit 20', async () => {
    const facilities = [
      { id: 'f1', slug: 'sl1', name: '施設A', rating_avg: 4.9, rating_count: 50 },
      { id: 'f2', slug: 'sl2', name: '施設B', rating_avg: 4.5, rating_count: 30 },
    ];
    const chain = buildChain(facilities);
    mockFrom.mockReturnValue(chain);

    const result = await getRankedFacilities();
    expect(result).toEqual(facilities);
    expect(chain.limit).toHaveBeenCalledWith(20);
    expect(chain.eq).toHaveBeenCalledWith('status', 'published');
    expect(chain.gt).toHaveBeenCalledWith('rating_count', 0);
  });

  // 【2026年7月8日 恒久根治の回帰防止】rating_avg のみの単一列ORDER BYだと同点施設の順序を
  // PostgreSQLが保証せず、「1位/2位/3位」の順位バッジがISR再生成毎に入れ替わりうる。
  // idを二次キーにして順序を決定的にする。
  it('rating_avg降順に加えidを二次キー(昇順)として付与し、同点施設の順序を決定的にする', async () => {
    const chain = buildChain([]);
    mockFrom.mockReturnValue(chain);

    await getRankedFacilities();
    expect(chain.order).toHaveBeenCalledWith('rating_avg', { ascending: false });
    expect(chain.order).toHaveBeenCalledWith('id', { ascending: true });
  });

  it('filters by prefecture when provided', async () => {
    const chain = buildChain([]);
    mockFrom.mockReturnValue(chain);

    await getRankedFacilities('大阪府');
    expect(chain.eq).toHaveBeenCalledWith('prefecture', '大阪府');
  });

  it('respects custom limit', async () => {
    const chain = buildChain([]);
    mockFrom.mockReturnValue(chain);

    await getRankedFacilities(undefined, 5);
    expect(chain.limit).toHaveBeenCalledWith(5);
  });

  it('returns empty array when no data', async () => {
    const chain = buildChain(null);
    mockFrom.mockReturnValue(chain);

    const result = await getRankedFacilities();
    expect(result).toEqual([]);
  });

  it('does not call eq with prefecture when undefined', async () => {
    const chain = buildChain([]);
    mockFrom.mockReturnValue(chain);

    await getRankedFacilities();
    const prefectureCall = (chain.eq as jest.Mock).mock.calls.find(([col]) => col === 'prefecture');
    expect(prefectureCall).toBeUndefined();
  });
});
