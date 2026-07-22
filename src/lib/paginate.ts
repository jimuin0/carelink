/**
 * PostgREST の db-max-rows(既定1000) を越えて全件取得するページングヘルパ（round6）。
 * 集計/エクスポート/全件通知で「全件処理」を前提にする箇所の取りこぼしを防ぐ単一ユーティリティ。
 *
 * fetchPage(offset, limit) は supabase の .range(offset, offset+limit-1) 等を実行し
 * { data, error } を返すこと。error が出たらそこまでの rows とともに即返す。
 */
export async function fetchAllPaged<T>(
  fetchPage: (offset: number, limit: number) => Promise<{ data: T[] | null; error: unknown }>,
  opts?: { pageSize?: number; maxRows?: number; failOnTruncation?: boolean },
): Promise<{ rows: T[]; error: unknown; truncated: boolean }> {
  const pageSize = opts?.pageSize ?? 1000;
  const maxRows = opts?.maxRows ?? 100000;
  const rows: T[] = [];
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await fetchPage(offset, pageSize);
    if (error) return { rows, error, truncated: false };
    if (!data || data.length === 0) return { rows, error: null, truncated: false };
    rows.push(...data);
    if (data.length < pageSize) return { rows, error: null, truncated: false }; // 端数ページ＝最終ページ＝全件取得
  }
  // ここに到達＝全ページが満杯のまま maxRows 上限で打ち切られた（＝続きが残り得る）。
  // 監査M4 low：「全件取得」を契約とする呼び出し元（配信停止リスト等）は failOnTruncation を指定し、
  // 打ち切りを error として受け取り fail-safe に中止すべき。無視すると maxRows 超で suppression が
  // 無音打ち切りされ opted-out へ誤送信する（fail-open）。
  const truncationError = opts?.failOnTruncation
    ? new Error(`fetchAllPaged: 全件取得できず maxRows=${maxRows} で打ち切り（failOnTruncation）`)
    : null;
  return { rows, error: truncationError, truncated: true };
}
