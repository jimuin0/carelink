/**
 * @jest-environment node
 *
 * Tests for lib/areas.ts
 * Covers: getAreasByParent, getAreaBySlug, getAreaBreadcrumb
 */

jest.mock('../supabase-server');

import { getAreasByParent, getAreaBySlug, getAreaBreadcrumb } from '../areas';
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
});
