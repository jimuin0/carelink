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

import { getPublishedFeatures, getFeatureBySlug } from '../features';

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
    expect(limitFn).toHaveBeenCalledWith(10); // default limit
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
});

describe('getFeatureBySlug()', () => {
  test('スラッグで特集を返す', async () => {
    const feature = { id: 'f1', slug: 'feature-1', title: '特集1', is_published: true, display_order: 1 };
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
