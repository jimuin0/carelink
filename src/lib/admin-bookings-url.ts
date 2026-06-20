/**
 * 予約一覧（/admin/bookings）の URL を組み立てる純粋関数（単一ソース）。
 *
 * 検索フォーム（日付範囲・ステータス複数・お客様名・スタッフ）とページネーションが
 * 各自で URL を手組みすると、一方だけがパラメータを取りこぼす不具合が起きる。
 * 両者をこの関数に集約し再発を構造的に防ぐ。
 *
 * - 各パラメータは truthy のときのみ付与（null/未指定/空文字は付けない）
 * - statuses は要素があるときのみ `status=a,b,c` 形式で付与
 * - page は 2 以上のときのみ付与（1 ページ目は無パラメータが正規形）
 */
export function bookingsHref(params: {
  from?: string | null;
  to?: string | null;
  q?: string | null;
  staff?: string | null;
  statuses?: string[] | null;
  page?: number | null;
}): string {
  const sp = new URLSearchParams();
  if (params.from) sp.set('from', params.from);
  if (params.to) sp.set('to', params.to);
  if (params.statuses && params.statuses.length > 0) sp.set('status', params.statuses.join(','));
  if (params.q) sp.set('q', params.q);
  if (params.staff) sp.set('staff', params.staff);
  if (params.page && params.page > 1) sp.set('page', String(params.page));
  const qs = sp.toString();
  return qs ? `/admin/bookings?${qs}` : '/admin/bookings';
}
