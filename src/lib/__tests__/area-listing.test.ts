/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
/**
 * エリア・業種の一覧ページの検索結果を metadata と本文で共有する（2026年10月22日）。
 *
 * Next 16 の metadata は本文と別に描画される。metadata だけが別の問い合わせで件数を数えていると、
 * それだけが一時障害で落ちたとき本文が 200 で返り、title・canonical・robots が欠ける。
 * metadata（countAreaListing）と本文（loadAreaListingPage）が同じ 1 ページ目の検索を通ることを固定する。
 */
import { countAreaListing, loadAreaListingPage } from '../area-listing';
import { searchFacilities } from '../facilities';

jest.mock('../facilities', () => ({ searchFacilities: jest.fn() }));

const ok = (total: number, page = 1) => ({ facilities: [{ id: `f-${page}` }], total, perPage: 20, error: null });
const failure = { code: 'PGRST003', message: 'Timed out acquiring connection from connection pool.' };

beforeEach(() => {
  jest.clearAllMocks();
  (searchFacilities as jest.Mock).mockImplementation(async ({ page }: { page: number }) => ok(21, page));
});

describe('countAreaListing（metadata 用）', () => {
  test('1 ページ目の検索の total を返す（評価順・公開施設の絞り込みは検索側）', async () => {
    await expect(countAreaListing('大阪府', '豊中市', 'ネイル・まつげサロン')).resolves.toBe(21);
    expect(searchFacilities).toHaveBeenCalledTimes(1);
    expect(searchFacilities).toHaveBeenCalledWith({
      prefecture: '大阪府', city: '豊中市', type: 'ネイル・まつげサロン', sort: 'rating', page: 1,
    });
  });

  test('本当に 0 件なら 0（noindex の判定に使える）', async () => {
    (searchFacilities as jest.Mock).mockResolvedValue({ facilities: [], total: 0, perPage: 20, error: null });
    await expect(countAreaListing(undefined, undefined, '鍼灸院・整骨院')).resolves.toBe(0);
  });

  test('読み取りに失敗したら 0 と取り違えず例外にする', async () => {
    (searchFacilities as jest.Mock).mockResolvedValue({ facilities: [], total: 0, perPage: 20, error: failure });
    await expect(countAreaListing('大阪府', undefined, undefined)).rejects.toThrow('AREA_RESULTS_UNAVAILABLE');
  });
});

describe('loadAreaListingPage（本文用）', () => {
  test('表示するページの結果を返し、metadata が使う 1 ページ目も同じ引数で読む', async () => {
    const result = await loadAreaListingPage('大阪府', undefined, 'ネイル・まつげサロン', 2);
    expect(result.facilities).toEqual([{ id: 'f-2' }]);
    const calls = (searchFacilities as jest.Mock).mock.calls.map(([params]) => params);
    expect(calls).toEqual([
      { prefecture: '大阪府', city: undefined, type: 'ネイル・まつげサロン', sort: 'rating', page: 2 },
      { prefecture: '大阪府', city: undefined, type: 'ネイル・まつげサロン', sort: 'rating', page: 1 },
    ]);
  });

  test('表示するページが読めても、1 ページ目（metadata の件数）が読めなければ例外にする', async () => {
    (searchFacilities as jest.Mock).mockImplementation(async ({ page }: { page: number }) => (
      page === 1 ? { facilities: [], total: 0, perPage: 20, error: failure } : ok(21, page)
    ));
    await expect(loadAreaListingPage('大阪府', '豊中市', undefined, 2)).rejects.toThrow('AREA_RESULTS_UNAVAILABLE');
  });

  test('表示するページが読めなければ例外にする（「0件・掲載なし」を 200 で返さない）', async () => {
    (searchFacilities as jest.Mock).mockImplementation(async ({ page }: { page: number }) => (
      page === 2 ? { facilities: [], total: 0, perPage: 20, error: failure } : ok(21, page)
    ));
    await expect(loadAreaListingPage('大阪府', '豊中市', undefined, 2)).rejects.toThrow('AREA_RESULTS_UNAVAILABLE');
  });
});
