/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/features.ts
 * Covers getPublishedFeatures and getFeatureBySlug
 */

const mockFrom = jest.fn();

jest.mock('../supabase-server', () => ({
  createServerSupabaseClient: jest.fn(() => ({ from: mockFrom })),
}));

import { getPublishedFeatures, getPublishedFeaturesStrict, getFeatureBySlug } from '../features';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getPublishedFeatures()', () => {
  test('データあり → 特集一覧を返す', async () => {
    const features = [
      { id: 'f1', title: '特集1', slug: 'feature-1', display_order: 1 },
      { id: 'f2', title: '特集2', slug: 'feature-2', display_order: 2 },
    ];

    const limitFn = jest.fn(() => Promise.resolve({ data: features }));

    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: limitFn,
    };

    mockFrom.mockReturnValue(chain);

    const result = await getPublishedFeatures();

    expect(result).toEqual(features);
    expect(limitFn).toHaveBeenCalledWith(10);
  });

  test('data が null → 空配列を返す', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: null })),
    };

    mockFrom.mockReturnValue(chain);

    const result = await getPublishedFeatures();

    expect(result).toEqual([]);
  });

  test('カスタムlimitを渡せる', async () => {
    const limitFn = jest.fn(() => Promise.resolve({ data: [] }));

    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: limitFn,
    };

    mockFrom.mockReturnValue(chain);

    await getPublishedFeatures(5);

    expect(limitFn).toHaveBeenCalledWith(5);
  });

  test('データなし → 空配列', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: [] })),
    };

    mockFrom.mockReturnValue(chain);

    const result = await getPublishedFeatures(20);

    expect(result).toEqual([]);
  });

  test('Supabase が error を返した場合 → 空配列を返す', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn(() =>
        Promise.resolve({
          data: null,
          error: { message: 'database error' },
        }),
      ),
    };

    mockFrom.mockReturnValue(chain);

    const result = await getPublishedFeatures();

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[features] getPublishedFeatures failed:',
      'database error',
    );

    consoleSpy.mockRestore();
  });

  test('Supabase query が Error で reject → 空配列を返す', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.reject(new Error('query failed'))),
    };

    mockFrom.mockReturnValue(chain);

    const result = await getPublishedFeatures();

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[features] getPublishedFeatures failed:',
      'query failed',
    );

    consoleSpy.mockRestore();
  });

  test('Supabase query が Error 以外で reject → 空配列を返す', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.reject('query failed')),
    };

    mockFrom.mockReturnValue(chain);

    const result = await getPublishedFeatures();

    expect(result).toEqual([]);
    expect(consoleSpy).toHaveBeenCalledWith(
      '[features] getPublishedFeatures failed:',
      'query failed',
    );

    consoleSpy.mockRestore();
  });
});

describe('getFeatureBySlug()', () => {
  test('スラッグで特集を返す', async () => {
    const feature = {
      id: 'f1',
      slug: 'feature-1',
      title: '特集1',
      is_published: true,
      display_order: 1,
    };

    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(() => Promise.resolve({ data: feature })),
    };

    mockFrom.mockReturnValue(chain);

    const result = await getFeatureBySlug('feature-1');

    expect(result).toEqual(feature);
  });

  test('見つからない → null を返す', async () => {
    const chain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(() => Promise.resolve({ data: null })),
    };

    mockFrom.mockReturnValue(chain);

    const result = await getFeatureBySlug('nonexistent');

    expect(result).toBeNull();
  });
});
// 障害を「特集0件（準備中・noindex）」や 404 として ISR にキャッシュさせないための例外化。
describe('読み取り失敗を空・不在に偽装しない', () => {
  test('getPublishedFeaturesStrict は error で例外にする', async () => {
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(),
      limit: jest.fn(() => Promise.resolve({ data: null, error: { message: 'database error' } })),
    });
    await expect(getPublishedFeaturesStrict()).rejects.toThrow('database error');
  });
  test('getFeatureBySlug は error で例外にする（null＝404 にしない）', async () => {
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: { message: 'db down' } })),
    });
    await expect(getFeatureBySlug('x')).rejects.toThrow('getFeatureBySlug failed');
  });
});
// 中 A52：DB 障害を「見つからない」（→ 公開中の特集が 404）に化けさせない。
describe('getFeatureBySlug() 障害時', () => {
  test('DB 障害 → 例外（null にしない）', async () => {
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: { code: '57014', message: 'timeout' } })),
    });
    await expect(getFeatureBySlug('feature-1')).rejects.toThrow('getFeatureBySlug failed');
  });

  test.each(['', 'x'.repeat(201), 'bad\u0000slug'])('slug になり得ない入力は問い合わせずに null %#', async (slug) => {
    mockFrom.mockClear();
    await expect(getFeatureBySlug(slug)).resolves.toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
