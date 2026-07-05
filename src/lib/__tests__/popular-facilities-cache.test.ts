/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 */
import { getPopularFacilitiesCached, clearPopularFacilitiesCache } from '../popular-facilities-cache';

function makeAdmin(rows: unknown[]) {
  const order = jest.fn().mockReturnThis();
  const limit = jest.fn().mockResolvedValue({ data: rows });
  const eq = jest.fn(() => ({ order, limit }));
  const select = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select }));
  return { from, select, eq, order, limit } as unknown as import('@supabase/supabase-js').SupabaseClient;
}

beforeEach(() => {
  clearPopularFacilitiesCache();
});

test('初回呼び出しはDBを叩く', async () => {
  const admin = makeAdmin([{ id: 'fac-1' }]);
  const result = await getPopularFacilitiesCached(admin, 6);
  expect(result).toEqual([{ id: 'fac-1' }]);
  expect((admin as unknown as { from: jest.Mock }).from).toHaveBeenCalledWith('facility_card_view');
});

test('TTL内の同一limitはキャッシュを返しDBを叩かない', async () => {
  const admin = makeAdmin([{ id: 'fac-1' }]);
  await getPopularFacilitiesCached(admin, 6);
  const admin2 = makeAdmin([{ id: 'fac-2' }]); // 2回目呼ばれたらこちらが返るはず
  const result = await getPopularFacilitiesCached(admin2, 6);
  expect(result).toEqual([{ id: 'fac-1' }]); // キャッシュ由来（admin2は未使用）
  expect((admin2 as unknown as { from: jest.Mock }).from).not.toHaveBeenCalled();
});

test('異なるlimitは別キャッシュキー（取り違えない）', async () => {
  const admin6 = makeAdmin([{ id: 'fac-6' }]);
  const admin12 = makeAdmin([{ id: 'fac-12' }]);
  const r6 = await getPopularFacilitiesCached(admin6, 6);
  const r12 = await getPopularFacilitiesCached(admin12, 12);
  expect(r6).toEqual([{ id: 'fac-6' }]);
  expect(r12).toEqual([{ id: 'fac-12' }]);
});

test('TTL(5分)経過後は再度DBを叩く', async () => {
  const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  try {
    const admin = makeAdmin([{ id: 'fac-1' }]);
    await getPopularFacilitiesCached(admin, 6);

    nowSpy.mockReturnValue(1_000_000 + 5 * 60 * 1000 + 1); // TTL超過
    const admin2 = makeAdmin([{ id: 'fac-2' }]);
    const result = await getPopularFacilitiesCached(admin2, 6);
    expect(result).toEqual([{ id: 'fac-2' }]);
    expect((admin2 as unknown as { from: jest.Mock }).from).toHaveBeenCalled();
  } finally {
    nowSpy.mockRestore();
  }
});

test('data が null なら空配列を返す', async () => {
  const admin = makeAdmin(null as unknown as unknown[]);
  const result = await getPopularFacilitiesCached(admin, 6);
  expect(result).toEqual([]);
});

test('clearPopularFacilitiesCache でキャッシュを強制無効化できる', async () => {
  const admin = makeAdmin([{ id: 'fac-1' }]);
  await getPopularFacilitiesCached(admin, 6);
  clearPopularFacilitiesCache();
  const admin2 = makeAdmin([{ id: 'fac-2' }]);
  const result = await getPopularFacilitiesCached(admin2, 6);
  expect(result).toEqual([{ id: 'fac-2' }]);
});
