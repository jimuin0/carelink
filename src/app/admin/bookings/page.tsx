import { notFound } from 'next/navigation';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import Link from 'next/link';
import type { Booking } from '@/types';
import { SbStatusChip } from '@/components/admin/SbUi';

const PER_PAGE = 20;

interface Props {
  searchParams: Promise<{ status?: string; date?: string; page?: string }>;
}

export default async function AdminBookingsPage(props: Props) {
  const searchParams = await props.searchParams;
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();
  if (!membership) notFound();

  const page = Math.max(1, parseInt(searchParams.page || '1') || 1);
  const from = (page - 1) * PER_PAGE;
  const to = from + PER_PAGE - 1;

  let query = supabase
    .from('bookings')
    .select('*', { count: 'exact' })
    .eq('facility_id', membership.facility_id)
    .order('booking_date', { ascending: false })
    .range(from, to);

  const validStatuses = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];
  if (searchParams.status && validStatuses.includes(searchParams.status)) {
    query = query.eq('status', searchParams.status);
  }
  if (searchParams.date && /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date)) {
    query = query.eq('booking_date', searchParams.date);
  }

  const { data, count, error } = await query;
  // 取得失敗を「予約がありません」に偽装しない（error.tsx に委ねる）
  if (error) {
    throw new Error(`予約一覧の取得に失敗しました: ${error.message}`);
  }
  const bookings = (data ?? []) as Booking[];
  const total = count ?? 0;
  const totalPages = Math.ceil(total / PER_PAGE);

  // Build pagination base URL
  const baseParams = new URLSearchParams();
  if (searchParams.status) baseParams.set('status', searchParams.status);
  if (searchParams.date) baseParams.set('date', searchParams.date);
  const paramStr = baseParams.toString();
  const baseUrl = paramStr ? `/admin/bookings?${paramStr}` : '/admin/bookings';

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">予約管理</h1>
        <p className="text-sm text-gray-500">{total}件</p>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        <FilterLink label="全て" href="/admin/bookings" active={!searchParams.status} />
        <FilterLink label="確認待ち" href="/admin/bookings?status=pending" active={searchParams.status === 'pending'} />
        <FilterLink label="確定" href="/admin/bookings?status=confirmed" active={searchParams.status === 'confirmed'} />
        <FilterLink label="完了" href="/admin/bookings?status=completed" active={searchParams.status === 'completed'} />
        <FilterLink label="キャンセル" href="/admin/bookings?status=cancelled" active={searchParams.status === 'cancelled'} />
      </div>

      {bookings.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center">
          <p className="text-gray-400">予約がありません</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">日時</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">お客様</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">ステータス</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">金額</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((booking) => {
                  return (
                    <tr key={booking.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link href={`/admin/bookings/${booking.id}`} className="hover:text-primary">
                          <p className="font-medium">{booking.booking_date}</p>
                          <p className="text-xs text-gray-500">{booking.start_time?.slice(0, 5)}〜{booking.end_time?.slice(0, 5)}</p>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <p>{booking.customer_name}</p>
                        <p className="text-xs text-gray-400">{booking.email}</p>
                      </td>
                      <td className="px-4 py-3">
                        <SbStatusChip status={booking.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {booking.total_price !== null ? `¥${booking.total_price.toLocaleString()}` : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          {page > 1 && (
            <Link href={`${baseUrl}${paramStr ? '&' : '?'}page=${page - 1}`} className="px-3 py-2 text-sm bg-white border rounded-lg hover:bg-gray-50">前へ</Link>
          )}
          <span className="text-sm text-gray-500">{page} / {totalPages}</span>
          {page < totalPages && (
            <Link href={`${baseUrl}${paramStr ? '&' : '?'}page=${page + 1}`} className="px-3 py-2 text-sm bg-white border rounded-lg hover:bg-gray-50">次へ</Link>
          )}
        </div>
      )}
    </div>
  );
}

function FilterLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`text-sm px-4 py-2 rounded-full whitespace-nowrap ${
        active ? 'bg-primary text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'
      }`}
    >
      {label}
    </Link>
  );
}
