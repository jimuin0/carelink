/**
 * PostgREST の db-max-rows(既定1000) を越えて全件取得するページングヘルパ（round6）。
 * 集計/エクスポート/全件通知で「全件処理」を前提にする箇所の取りこぼしを防ぐ単一ユーティリティ。
 *
 * fetchPage(offset, limit) は supabase の .range(offset, offset+limit-1) 等を実行し
 * { data, error } を返すこと。error が出たらそこまでの rows とともに即返す。
 */
export async function fetchAllPaged<T>(
  fetchPage: (offset: number, limit: number) => Promise<{ data: T[] | null; error: unknown }>,
  opts?: { pageSize?: number; maxRows?: number },
): Promise<{ rows: T[]; error: unknown }> {
  const pageSize = opts?.pageSize ?? 1000;
  const maxRows = opts?.maxRows ?? 100000;
  const rows: T[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await fetchPage(offset, pageSize);
    if (error) return { rows, error };
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break; // 端数ページ＝最終ページ
  }
  return { rows, error: null };
}
