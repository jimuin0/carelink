import { selectInChunks, IN_CHUNK_SIZE } from '../select-in-chunks';

describe('selectInChunks', () => {
  test('小分けにして全件をつなぐ（1 回の .in に上限を超える ID を渡さない）', async () => {
    const ids = Array.from({ length: IN_CHUNK_SIZE * 2 + 1 }, (_, i) => `id-${i}`);
    const run = jest.fn(async (chunk: string[]) => ({ data: chunk.map((id) => ({ id })), error: null }));
    const { data, error } = await selectInChunks(ids, run);
    expect(error).toBeNull();
    expect(data.map((r) => r.id)).toEqual(ids);
    expect(run).toHaveBeenCalledTimes(3);
    expect(Math.max(...run.mock.calls.map((c) => c[0].length))).toBe(IN_CHUNK_SIZE);
  });

  test('途中で失敗したら部分結果を返さず error を返す', async () => {
    const run = jest.fn()
      .mockResolvedValueOnce({ data: [{ id: 'a' }], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    const { data, error } = await selectInChunks(['a', 'b'], run, 1);
    expect(error).toEqual({ message: 'down' });
    expect(data).toEqual([]);
  });

  test('data が null の回は 0 行として扱い、ID が空なら問い合わせない', async () => {
    const run = jest.fn(async () => ({ data: null, error: null }));
    expect(await selectInChunks(['a'], run)).toEqual({ data: [], error: null });
    run.mockClear();
    expect(await selectInChunks([], run)).toEqual({ data: [], error: null });
    expect(run).not.toHaveBeenCalled();
  });
});
