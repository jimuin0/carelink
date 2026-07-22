/**
 * @jest-environment @stryker-mutator/jest-runner/jest-env/node
 *
 * Tests for lib/paginate.ts（全件ページングヘルパ・round6）
 */
import { fetchAllPaged } from '../paginate';

describe('fetchAllPaged', () => {
  test('単一ページ（端数）→ 1回で全件返す', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ data: [1, 2, 3], error: null });
    const { rows, error } = await fetchAllPaged<number>(fetchPage, { pageSize: 1000 });
    expect(error).toBeNull();
    expect(rows).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(1); // 端数ページで終了
  });

  test('複数ページ → フルページが続く限り継続し空/端数で終了', async () => {
    const full = Array.from({ length: 2 }, (_, i) => i);
    let call = 0;
    const fetchPage = jest.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve({ data: full, error: null });       // フルページ→継続
      return Promise.resolve({ data: [99], error: null });                        // 端数→終了
    });
    const { rows } = await fetchAllPaged<number>(fetchPage, { pageSize: 2 });
    expect(rows).toEqual([0, 1, 99]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  test('空ページ → break（push せず終了）', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ data: [], error: null });
    const { rows } = await fetchAllPaged<number>(fetchPage, { pageSize: 2 });
    expect(rows).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  test('data=null → break', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ data: null, error: null });
    const { rows } = await fetchAllPaged<number>(fetchPage, { pageSize: 2 });
    expect(rows).toEqual([]);
  });

  test('error → そこまでの rows と error を返す', async () => {
    let call = 0;
    const fetchPage = jest.fn().mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve({ data: [1, 2], error: null }); // フルページ
      return Promise.resolve({ data: null, error: { message: 'boom' } });    // 2ページ目でerror
    });
    const { rows, error } = await fetchAllPaged<number>(fetchPage, { pageSize: 2 });
    expect(rows).toEqual([1, 2]);
    expect(error).toEqual({ message: 'boom' });
  });

  test('maxRows 上限で打ち切る（フルページが続いても暴走しない）→ truncated=true・error=null', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ data: [1, 2], error: null }); // 常にフルページ
    const { rows, error, truncated } = await fetchAllPaged<number>(fetchPage, { pageSize: 2, maxRows: 4 });
    // offset 0,2 の2回で maxRows(4) 到達 → 計4件で停止
    expect(rows).toEqual([1, 2, 1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(truncated).toBe(true); // 続きが残り得る＝打ち切り
    expect(error).toBeNull();     // failOnTruncation 未指定なら error にしない
  });

  test('【監査M4】failOnTruncation:true + 打ち切り → error を返す（fail-safe用）', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ data: [1, 2], error: null }); // 常にフルページ
    const { rows, error, truncated } = await fetchAllPaged<number>(fetchPage, { pageSize: 2, maxRows: 4, failOnTruncation: true });
    expect(rows).toEqual([1, 2, 1, 2]);
    expect(truncated).toBe(true);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('打ち切り');
  });

  test('【監査M4】failOnTruncation:true でも全件取得できれば error=null・truncated=false', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ data: [1], error: null }); // 端数＝全件
    const { error, truncated } = await fetchAllPaged<number>(fetchPage, { pageSize: 2, maxRows: 4, failOnTruncation: true });
    expect(error).toBeNull();
    expect(truncated).toBe(false);
  });

  test('既定 pageSize/maxRows で動作', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ data: [1], error: null });
    const { rows } = await fetchAllPaged<number>(fetchPage);
    expect(rows).toEqual([1]);
  });
});
