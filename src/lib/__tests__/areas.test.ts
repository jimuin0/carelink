/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/areas.ts
 * Covers: getAreasByParent, getAreaBySlug, getAreaBreadcrumb
 */

jest.mock('../supabase-server');

import { getAreasByParent, getAreaBySlug, getAreaBreadcrumb, buildAreaSearchParam } from '../areas';
import type { Area } from '@/types';

const { createServerSupabaseClient } = require('../supabase-server');

const ROOT_AREA: Area = { id: 'root-1', slug: 'tokyo', name: '東京都', parent_id: null, sort_order: 1 } as Area;
const CHILD_AREA: Area = { id: 'child-1', slug: 'shinjuku', name: '新宿区', parent_id: 'root-1', sort_order: 1 } as Area;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getAreasByParent', () => {
  test('returns root areas when parentId is null', async () => {
    const mockIs = jest.fn().mockResolvedValue({ data: [ROOT_AREA] });
    const mockOrder = jest.fn().mockReturnValue({ is: mockIs });
    const mockSelect = jest.fn().mockReturnValue({ order: mockOrder });
    createServerSupabaseClient.mockReturnValue({ from: jest.fn().mockReturnValue({ select: mockSelect }) });

    const result = await getAreasByParent(null);
    expect(mockIs).toHaveBeenCalledWith('parent_id', null);
    expect(result).toEqual([ROOT_AREA]);
  });

  test('returns child areas when parentId is provided', async () => {
    const mockEq = jest.fn().mockResolvedValue({ data: [CHILD_AREA] });
    const mockOrder = jest.fn().mockReturnValue({ eq: mockEq });
    const mockSelect = jest.fn().mockReturnValue({ order: mockOrder });
    createServerSupabaseClient.mockReturnValue({ from: jest.fn().mockReturnValue({ select: mockSelect }) });

    const result = await getAreasByParent('root-1');
    expect(mockEq).toHaveBeenCalledWith('parent_id', 'root-1');
    expect(result).toEqual([CHILD_AREA]);
  });

  test('returns empty array when data is null', async () => {
    const mockIs = jest.fn().mockResolvedValue({ data: null });
    const mockOrder = jest.fn().mockReturnValue({ is: mockIs });
    const mockSelect = jest.fn().mockReturnValue({ order: mockOrder });
    createServerSupabaseClient.mockReturnValue({ from: jest.fn().mockReturnValue({ select: mockSelect }) });

    const result = await getAreasByParent(null);
    expect(result).toEqual([]);
  });
});

describe('getAreaBySlug', () => {
  test('returns area when found', async () => {
    const mockSingle = jest.fn().mockResolvedValue({ data: ROOT_AREA });
    const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
    const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
    createServerSupabaseClient.mockReturnValue({ from: jest.fn().mockReturnValue({ select: mockSelect }) });

    const result = await getAreaBySlug('tokyo');
    expect(mockEq).toHaveBeenCalledWith('slug', 'tokyo');
    expect(result).toEqual(ROOT_AREA);
  });

  test('returns null when not found', async () => {
    const mockSingle = jest.fn().mockResolvedValue({ data: null });
    const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
    const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
    createServerSupabaseClient.mockReturnValue({ from: jest.fn().mockReturnValue({ select: mockSelect }) });

    const result = await getAreaBySlug('nonexistent');
    expect(result).toBeNull();
  });
});

describe('getAreaBreadcrumb', () => {
  test('returns just the area when it has no parent', async () => {
    const mockSelect = jest.fn().mockResolvedValue({ data: [ROOT_AREA, CHILD_AREA] });
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({ select: mockSelect }),
    });

    const result = await getAreaBreadcrumb(ROOT_AREA);
    expect(result).toEqual([ROOT_AREA]);
  });

  test('returns parent then child in breadcrumb', async () => {
    const mockSelect = jest.fn().mockResolvedValue({ data: [ROOT_AREA, CHILD_AREA] });
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({ select: mockSelect }),
    });

    const result = await getAreaBreadcrumb(CHILD_AREA);
    expect(result[0]).toEqual(ROOT_AREA);
    expect(result[result.length - 1]).toEqual(CHILD_AREA);
  });

  test('returns only the area when allAreas data is null', async () => {
    const mockSelect = jest.fn().mockResolvedValue({ data: null });
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({ select: mockSelect }),
    });

    const result = await getAreaBreadcrumb(ROOT_AREA);
    expect(result).toEqual([ROOT_AREA]);
  });

  test('breaks loop when parent_id points to non-existent area', async () => {
    // child の parent_id が allAreas にない → !parent ブランチで break
    const ORPHAN: Area = { id: 'orphan-1', slug: 'orphan', name: '孤児区', parent_id: 'missing-parent-id', sort_order: 1 } as Area;
    const mockSelect = jest.fn().mockResolvedValue({ data: [ORPHAN] });
    createServerSupabaseClient.mockReturnValue({
      from: jest.fn().mockReturnValue({ select: mockSelect }),
    });
    const result = await getAreaBreadcrumb(ORPHAN);
    // missing-parent-id は areaMap になく filter で外れるので、結果は ORPHAN のみ
    expect(result).toEqual([ORPHAN]);
  });
});

describe('buildAreaSearchParam', () => {
  // 【2026年7月8日 恒久根治の回帰防止】city タイプが完全一致フィルタ(city)を返すことを固定する。
  // 旧実装は keyword（曖昧ILIKE検索）を返しており、無関係施設の混入や取りこぼしがあった。
  test('prefecture タイプは { prefecture } を返す', () => {
    expect(buildAreaSearchParam({ area_type: 'prefecture', name: '大阪府' })).toEqual({ prefecture: '大阪府' });
  });

  test('city タイプは { city } を返す（keyword ではない）', () => {
    const result = buildAreaSearchParam({ area_type: 'city', name: '豊中市' });
    expect(result).toEqual({ city: '豊中市' });
    expect(result).not.toHaveProperty('keyword');
  });

  test('region/station タイプは空オブジェクトを返す', () => {
    expect(buildAreaSearchParam({ area_type: 'region', name: '関西' })).toEqual({});
    expect(buildAreaSearchParam({ area_type: 'station', name: '梅田駅' })).toEqual({});
  });
});
