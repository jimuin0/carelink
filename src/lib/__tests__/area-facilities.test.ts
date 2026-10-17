/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
jest.mock('../redis');

import { searchAreaFacilities } from '../area-facilities';

const mockQuery = {
  select: jest.fn(), eq: jest.fn(), in: jest.fn(), ilike: jest.fn(), order: jest.fn(), range: jest.fn(), then: jest.fn(),
};
const mockCreateServerClient = jest.fn(() => ({ from: () => mockQuery }));
let result: { data: unknown; count: number | null; error: unknown; status?: number };
jest.mock('../supabase-server', () => ({ createServerSupabaseClient: () => mockCreateServerClient() }));

beforeEach(() => {
  jest.clearAllMocks(); result = { data: [], count: 0, error: null };
  for (const method of ['select', 'eq', 'in', 'ilike', 'order']) mockQuery[method as keyof typeof mockQuery].mockReturnValue(mockQuery);
  mockQuery.range.mockImplementation(async () => result);
  mockQuery.then.mockImplementation((resolve: (value: unknown) => unknown) => Promise.resolve({ count: 1, error: null }).then(resolve));
});

test.each([
  [{ kind: 'prefecture', prefecture: '大阪府' }, [['eq', 'prefecture', '大阪府']]],
  [{ kind: 'city', prefecture: '大阪府', city: '堺市堺区' }, [['eq', 'prefecture', '大阪府'], ['eq', 'city', '堺市堺区']]],
  [{ kind: 'station', prefecture: '大阪府', city: '大阪市中央区', station: '本町駅' },
    [['eq', 'prefecture', '大阪府'], ['eq', 'city', '大阪市中央区'], ['ilike', 'nearest_station', '%本町駅%']]],
  [{ kind: 'station', prefecture: '大阪府', station: '本町駅' }, [['eq', 'prefecture', '大阪府'], ['ilike', 'nearest_station', '%本町駅%']]],
  [{ kind: 'region', prefectures: ['大阪府', '京都府'] }, [['in', 'prefecture', ['大阪府', '京都府']]]],
])('scopes %j by its geography and published state', async (scope, expected) => {
  const data = { id: 'synthetic' }; result = { data: [data], count: 1, error: null };
  await expect(searchAreaFacilities(scope as never, 1)).resolves.toMatchObject({ facilities: [data], total: 1, perPage: 20 });
  expect(mockQuery.select).toHaveBeenCalledWith(expect.stringContaining('id'), { count: 'exact' });
  expect(mockQuery.eq).toHaveBeenCalledWith('status', 'published');
  for (const [method, ...args] of expected as [string, ...unknown[]][]) {
    expect(mockQuery[method as keyof typeof mockQuery]).toHaveBeenCalledWith(...args);
  }
  expect(mockQuery.order.mock.calls).toEqual([
    ['rating_avg', { ascending: false, nullsFirst: false }], ['id', { ascending: true }],
  ]);
});

test('empty known region list produces a real empty result without a nationwide query', async () => {
  await expect(searchAreaFacilities({ kind: 'region', prefectures: [] }, 1)).resolves.toEqual({ facilities: [], total: 0, perPage: 20 });
  expect(mockCreateServerClient).not.toHaveBeenCalled();
});

test.each([0, -1, 1.2, Number.MAX_SAFE_INTEGER, Infinity])('rejects invalid page %s before querying', async page => {
  await expect(searchAreaFacilities({ kind: 'prefecture', prefecture: '大阪府' }, page)).rejects.toThrow('Invalid area search page');
  expect(mockCreateServerClient).not.toHaveBeenCalled();
});

test.each([
  ['literal LIKE metacharacters', '本町%_\\駅', '%本町\\%\\_\\\\駅%'],
  ['database failure', '本町駅', '%本町駅%'],
])('%s remains safe and incomplete query results fail closed', async (label, station, pattern) => {
  if (label === 'database failure') result = { data: [], count: null, error: { code: 'DB' } };
  else {
    result = { data: [], count: 1, error: null };
  }
  const pending = searchAreaFacilities({ kind: 'station', prefecture: '大阪府', station }, 1);
  expect(mockQuery.ilike).toHaveBeenCalledWith('nearest_station', pattern);
  if (label === 'database failure') await expect(pending).rejects.toThrow('Area facilities unavailable');
  else await expect(pending).resolves.toMatchObject({ total: 1 });
});

test('rejects null or invalid counts, non-array rows, and query errors instead of reporting no facilities', async () => {
  const overrides = [
    { data: [], count: null, error: null }, { data: [], count: -1, error: null },
    { data: {}, count: 0, error: null }, { data: [], count: 0, error: { code: 'DB' } },
    { data: [{ id: 'unexpected' }], count: 0, error: null },
  ];
  for (const item of overrides) {
    result = item;
    await expect(searchAreaFacilities({ kind: 'prefecture', prefecture: '大阪府' }, 1)).rejects.toThrow('Area facilities unavailable');
  }
});

test('uses exact count and stable ordered pagination', async () => {
  result = { data: [], count: 41, error: null };
  await expect(searchAreaFacilities({ kind: 'prefecture', prefecture: '大阪府' }, 3)).resolves.toMatchObject({ total: 41, perPage: 20 });
  expect(mockQuery.range).toHaveBeenCalledWith(40, 59);
});

test('out-of-range 416 requires a successful scoped recount before returning the empty page', async () => {
  result = { data: null, count: null, error: { code: 'PGRST103' }, status: 416 };
  await expect(searchAreaFacilities({ kind: 'city', prefecture: '大阪府', city: '堺市堺区' }, 2))
    .resolves.toEqual({ facilities: [], total: 1, perPage: 20 });
  expect(mockQuery.select).toHaveBeenLastCalledWith(expect.any(String), { count: 'exact', head: true });
  expect(mockQuery.eq.mock.calls.filter(([key]) => key === 'city')).toEqual([['city', '堺市堺区'], ['city', '堺市堺区']]);
});

test.each([
  { count: null, error: null }, { count: -1, error: null }, { count: 1.5, error: null },
  { count: 21, error: null }, { count: 1, error: { code: 'DB' } },
])('unverified or now in-range recount cannot disguise the failed query %#', async recount => {
  result = { data: null, count: null, error: { code: 'PGRST103' }, status: 416 };
  mockQuery.then.mockImplementation((resolve: (value: unknown) => unknown) => Promise.resolve(recount).then(resolve));
  await expect(searchAreaFacilities({ kind: 'prefecture', prefecture: '大阪府' }, 2)).rejects.toThrow('Area facilities unavailable');
});

test.each([
  { status: 500, error: { code: 'PGRST103' }, page: 2 },
  { status: 416, error: { code: 'OTHER' }, page: 2 },
  { status: 416, error: null, page: 2 },
  { status: 416, error: { code: 'PGRST103' }, page: 1 },
])('only a classified later-page range error can trigger recount %#', async ({ status, error, page }) => {
  result = { data: null, count: null, error, status };
  await expect(searchAreaFacilities({ kind: 'prefecture', prefecture: '大阪府' }, page)).rejects.toThrow('Area facilities unavailable');
  expect(mockQuery.then).not.toHaveBeenCalled();
});
