/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { buildAreaSearchParam, getAreaBreadcrumb, getAreaBySlug, getAreasByParent } from '../areas';
import type { Area } from '@/types';

const region: Area = { id: 'r', slug: 'kinki', name: '近畿', parent_id: null, area_type: 'region', sort_order: 1 };
const pref: Area = { id: 'p', slug: 'osaka', name: '大阪府', parent_id: 'r', area_type: 'prefecture', sort_order: 1 };
const city: Area = { id: 'c', slug: 'toy', name: '豊中市', parent_id: 'p', area_type: 'city', sort_order: 1 };
const station: Area = { id: 's', slug: 'honmachi', name: '本町駅', parent_id: 'c', area_type: 'station', sort_order: 1 };
let rows: Area[] = [region, pref, city, station];
let response: { data: unknown; error: unknown; count: number | null } = { data: [], error: null, count: 0 };
let singleOverride: Area | null | undefined;
let parentFilter: string | null = null;
let readRoots = false;
let idFilter: string | null = null;
let slugFilter: string | null = null;

jest.mock('../supabase-server', () => ({ createServerSupabaseClient: () => ({ from: () => {
  parentFilter = null; idFilter = null; slugFilter = null;
  const query: Record<string, unknown> = {
    select: jest.fn(() => query), order: jest.fn(() => query),
    eq: jest.fn((column: string, value: string) => {
      if (column === 'parent_id') parentFilter = value;
      if (column === 'id') idFilter = value;
      if (column === 'slug') slugFilter = value;
      return query;
    }),
    is: jest.fn((_column: string, _value: null) => { readRoots = true; return query; }),
    maybeSingle: jest.fn(async () => ({ data: singleOverride !== undefined ? singleOverride : rows.find(row => row.id === idFilter || row.slug === slugFilter) ?? null, error: response.error })),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
      return Promise.resolve(response).then(resolve, reject);
    },
  };
  return query;
} }) }));

beforeEach(() => {
  jest.clearAllMocks(); rows = [region, pref, city, station];
  response = { data: [], error: null, count: 0 }; singleOverride = undefined;
  parentFilter = null; readRoots = false;
});

describe('area database reads', () => {
  test('ordered child/root lists must be complete and typed as arrays', async () => {
    response = { data: [region], error: null, count: 1 };
    expect(await getAreasByParent(null)).toEqual([region]);
    expect(readRoots).toBe(true);
    response = { data: [pref], error: null, count: 1 };
    expect(await getAreasByParent('r')).toEqual([pref]);
    expect(parentFilter).toBe('r');
    response = { data: [], error: null, count: 0 };
    expect(await getAreasByParent('missing')).toEqual([]);
  });

  test.each([
    [{ data: [], error: { code: 'DB' }, count: 0 }, 'Area list unavailable or truncated'],
    [{ data: null, error: null, count: 0 }, 'Area list unavailable or truncated'],
    [{ data: {}, error: null, count: 0 }, 'Area list unavailable or truncated'],
    [{ data: [pref], error: null, count: 2 }, 'Area list unavailable or truncated'],
  ])('list failure or truncation throws a controlled error', async (result, message) => {
    response = result as typeof response;
    await expect(getAreasByParent(null)).rejects.toThrow(message as string);
  });

  test('slug lookup distinguishes not-found from database failure', async () => {
    expect(await getAreaBySlug('absent')).toBeNull();
    expect(await getAreaBySlug('osaka')).toEqual(pref);
    response = { data: [], error: { code: 'DB' }, count: null };
    await expect(getAreaBySlug('osaka')).rejects.toThrow('Area lookup unavailable');
  });

  test('breadcrumb fetches parents by ID and fails closed for missing rows, errors and cycles', async () => {
    expect(await getAreaBreadcrumb(station)).toEqual([region, pref, city, station]);
    rows = [region, pref, city, { ...station, parent_id: 'missing' }];
    await expect(getAreaBreadcrumb(rows[3])).rejects.toThrow('Area ancestor unavailable');
    rows = [region, pref, city, station];
    response = { data: null, error: { code: 'DB' }, count: null };
    await expect(getAreaBreadcrumb(station)).rejects.toThrow('Area ancestor unavailable');
    response = { data: [], error: null, count: null }; singleOverride = undefined;
    rows = [{ ...region, parent_id: 'p' }, pref, city, station];
    await expect(getAreaBreadcrumb(rows[3])).rejects.toThrow('Area hierarchy cycle or depth limit');
  });

  test('breadcrumb rejects excessive depth rather than returning a partial path', async () => {
    const deep = Array.from({ length: 17 }, (_, i) => ({ ...region, id: `d${i}`, parent_id: i ? `d${i - 1}` : null }));
    rows = deep;
    await expect(getAreaBreadcrumb(deep[16])).rejects.toThrow('Area hierarchy cycle or depth limit');
  });
});

describe('buildAreaSearchParam', () => {
  test('returns explicit scopes for prefecture, city with prefecture, station, and known region children', () => {
    expect(buildAreaSearchParam(pref, [region, pref], [])).toEqual({ kind: 'prefecture', prefecture: '大阪府' });
    expect(buildAreaSearchParam(city, [region, pref, city], [])).toEqual({ kind: 'city', prefecture: '大阪府', city: '豊中市' });
    expect(buildAreaSearchParam(station, [region, pref, city, station], [])).toEqual({ kind: 'station', prefecture: '大阪府', city: '豊中市', station: '本町駅' });
    expect(buildAreaSearchParam({ ...station, parent_id: 'p' }, [region, pref, { ...station, parent_id: 'p' }], []))
      .toEqual({ kind: 'station', prefecture: '大阪府', station: '本町駅' });
    expect(buildAreaSearchParam(region, [region], [pref, { ...pref, id: 'p2', name: '京都府' }]))
      .toEqual({ kind: 'region', prefectures: ['大阪府', '京都府'] });
    expect(buildAreaSearchParam(region, [region], [])).toEqual({ kind: 'region', prefectures: [] });
  });

  test.each([
    [[pref], 'Area hierarchy is incomplete'],
    [[{ ...pref, parent_id: null }, { ...station, parent_id: pref.id }], 'Area station hierarchy is invalid'],
    [[region, pref, city, station, station], 'Area hierarchy is incomplete'],
    [[{ ...region, parent_id: 'x' }], 'Area hierarchy is incomplete'],
    [[region, { ...pref, parent_id: 'x' }], 'Area hierarchy type or link is invalid'],
    [[region, { ...pref, area_type: 'city' as const }, city], 'Area hierarchy type or link is invalid'],
    [[{ ...region, area_type: 'prefecture' as const }], 'Area prefecture scope is unavailable'],
    [[{ ...pref, parent_id: null }], 'Area prefecture hierarchy is invalid'],
    [[{ ...pref, parent_id: null }, { ...city, parent_id: pref.id }], 'Area city hierarchy is invalid'],
    [[region, { ...pref, name: 'Not a prefecture' }], 'Area prefecture scope is unavailable'],
    [[pref, { ...city, parent_id: pref.id }], 'Area hierarchy is incomplete'],
    [[region, pref, city, station, { ...station, id: 's2', name: '別駅', parent_id: 's' }], 'Area hierarchy type or link is invalid'],
  ])('invalid ancestry never produces a broad search', (path, message) => {
    const target = (path as Area[]).at(-1)!;
    expect(() => buildAreaSearchParam(target, path as Area[], [])).toThrow(message as string);
  });

  test.each([
    [{ ...pref, name: '偽県' }, 'Area prefecture scope is unavailable'],
    [{ ...city, parent_id: 'r' }, 'Area hierarchy type or link is invalid'],
    [{ ...station, parent_id: 'p' }, undefined],
  ])('checks prefecture and parent-area type for leaf scope', (leaf, message) => {
    const target = leaf as Area;
    const path = target.area_type === 'prefecture' ? [region, target]
      : target.area_type === 'city' ? [region, pref, target]
        : [region, pref, target];
    if (message) expect(() => buildAreaSearchParam(target, path, [])).toThrow(message as string);
    else expect(buildAreaSearchParam(target, path, [])).toEqual({ kind: 'station', prefecture: '大阪府', station: '本町駅' });
  });

  test('rejects unexpected or non-prefecture children for a region', () => {
    expect(() => buildAreaSearchParam(region, [region], [{ ...pref, parent_id: 'other' }])).toThrow('Area region hierarchy is invalid');
    expect(() => buildAreaSearchParam(region, [region], [{ ...pref, area_type: 'city' }])).toThrow('Area region hierarchy is invalid');
    expect(() => buildAreaSearchParam(region, [region], [{ ...pref, name: 'Not a prefecture' }])).toThrow('Area region hierarchy is invalid');
  });
});
