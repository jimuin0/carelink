import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Booking } from '@/types';

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: '確認待ち', color: 'bg-yellow-100 text-yellow-800' },
  confirmed: { label: '確定', color: 'bg-green-100 text-green-800' },
  completed: { label: '完了', color: 'bg-gray-100 text-gray-800' },
  cancelled: { label: 'キャンセル', color: 'bg-red-100 text-red-800' },
  no_show: { label: '無断キャンセル', color: 'bg-red-100 text-red-800' },
};

export default async function BookingsPage() {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data } = await supabase
    .from('bookings')
    .select('*')
    .eq('user_id', user.id)
    .order('booking_date', { ascending: false });

  const bookings = (data ?? []) as Booking[];

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">予約履歴</h1>

      {bookings.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
          <p className="text-gray-400 mb-2">予約履歴がありません</p>
          <Link href="/search" className="text-sm text-primary hover:underline">
            施設を探す
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((booking) => {
            const status = statusLabels[booking.status] ?? statusLabels.pending;
            return (
              <Link
                key={booking.id}
                href={`/mypage/bookings/${booking.id}`}
                className="block bg-white rounded-xl shadow-sm p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold">{booking.booking_date}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${status.color}`}>
                    {status.label}
                  </span>
                </div>
                <p className="text-sm text-gray-600">
                  {booking.start_time?.slice(0, 5)}〜{booking.end_time?.slice(0, 5)}
                </p>
                {booking.total_price !== null && (
                  <p className="text-sm font-bold mt-1">¥{booking.total_price.toLocaleString()}</p>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
