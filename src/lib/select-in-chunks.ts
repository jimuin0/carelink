/**
 * `.in(列, ids)` を ids の小分けごとに発行して結果をつなぐ。
 *
 * 1 回の `.in()` に全 ID を渡すと、PostgREST の db-max-rows（既定 1000）や URL 長の上限で
 * 後半が無音で落ちる（エラーにならず、返ってきた分だけで処理が進む）。小分けにして各回の
 * 行数・URL 長を上限の内側に収める。1 回でも失敗したら、途中までの行は返さずに error を返す
 * （部分的な結果を「全件」として扱わせない）。
 */
export const IN_CHUNK_SIZE = 200;

export async function selectInChunks<T>(
  ids: readonly string[],
  run: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
  chunkSize: number = IN_CHUNK_SIZE,
): Promise<{ data: T[]; error: unknown }> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const { data, error } = await run(ids.slice(i, i + chunkSize));
    if (error) return { data: [], error };
    rows.push(...(data ?? []));
  }
  return { data: rows, error: null };
}
