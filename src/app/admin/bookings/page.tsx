import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import Link from 'next/link';
import type { Booking } from '@/types';

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: '確認待ち', color: 'bg-yellow-100 text-yellow-800' },
  confirmed: { label: '確定', color: 'bg-green-100 text-green-800' },
  completed: { label: '完了', color: 'bg-gray-100 text-gray-800' },
  cancelled: { label: 'キャンセル', color: 'bg-red-100 text-red-800' },
  no_show: { label: '無断キャンセル', color: 'bg-red-100 text-red-800' },
};

interface Props {
  searchParams: { status?: string; date?: string };
}

export default async function AdminBookingsPage({ searchParams }: Props) {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user!.id)
    .single();

  let query = supabase
    .from('bookings')
    .select('*')
    .eq('facility_id', membership!.facility_id)
    .order('booking_date', { ascending: false });

  if (searchParams.status) query = query.eq('status', searchParams.status);
  if (searchParams.date) query = query.eq('booking_date', searchParams.date);

  const { data } = await query;
  const bookings = (data ?? []) as Booking[];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">予約管理</h1>

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
                  const status = statusLabels[booking.status] ?? statusLabels.pending;
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
                        <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${status.color}`}>
                          {status.label}
                        </span>
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
