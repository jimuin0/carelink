/**
 * 予約一覧（/admin/bookings）の URL を組み立てる純粋関数（単一ソース）。
 *
 * フィルタ切替リンクとページネーションリンクが各自で URL を手組みすると、
 * 一方だけが date 等のパラメータを取りこぼす不具合が起きる（実際にステータス
 * フィルタが date を落としていた）。両者をこの関数に集約し再発を構造的に防ぐ。
 *
 * - status / date は truthy のときのみ付与（null/未指定/空文字は付けない）
 * - page は 2 以上のときのみ付与（1 ページ目は無パラメータが正規形）
 */
export function bookingsHref(params: {
  status?: string | null;
  date?: string | null;
  page?: number | null;
}): string {
  const sp = new URLSearchParams();
  if (params.status) sp.set('status', params.status);
  if (params.date) sp.set('date', params.date);
  if (params.page && params.page > 1) sp.set('page', String(params.page));
  const qs = sp.toString();
  return qs ? `/admin/bookings?${qs}` : '/admin/bookings';
}
