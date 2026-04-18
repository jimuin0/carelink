import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { notFound } from 'next/navigation';
import Link from 'next/link';

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: '確認待ち', color: 'bg-yellow-100 text-yellow-800' },
  confirmed: { label: '確定', color: 'bg-green-100 text-green-800' },
  completed: { label: '完了', color: 'bg-gray-100 text-gray-800' },
  cancelled: { label: 'キャンセル', color: 'bg-red-100 text-red-800' },
  cancel_fee_paid: { label: 'キャンセル料支払済', color: 'bg-orange-100 text-orange-800' },
  no_show: { label: '無断キャンセル', color: 'bg-red-100 text-red-800' },
};

export default async function BookingsPage() {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data } = await supabase
    .from('bookings')
    .select('id, booking_date, start_time, end_time, status, total_price, facility_id, menu_id, staff_id')
    .eq('user_id', user.id)
    .order('booking_date', { ascending: false });

  const bookings = data ?? [];

  // 施設スラグを一括取得
  const facilityIds = Array.from(new Set(bookings.map((b) => b.facility_id).filter(Boolean)));
  const slugMap = new Map<string, string>();
  if (facilityIds.length > 0) {
    const { data: facilityData } = await supabase
      .from('facility_profiles')
      .select('id, slug, name')
      .in('id', facilityIds);
    for (const f of facilityData ?? []) {
      slugMap.set(f.id, f.slug);
    }
  }

  const canRebook = (status: string) => ['completed', 'cancelled', 'no_show'].includes(status);

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
            const facilitySlug = slugMap.get(booking.facility_id);
            const rebookUrl = facilitySlug
              ? `/facility/${facilitySlug}?${booking.menu_id ? `menu_id=${booking.menu_id}&` : ''}${booking.staff_id ? `staff_id=${booking.staff_id}` : ''}`
              : null;

            return (
              <div key={booking.id} className="bg-white rounded-xl shadow-sm p-4 hover:shadow-md transition-shadow">
                <Link href={`/mypage/bookings/${booking.id}`} className="block">
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
                {canRebook(booking.status) && rebookUrl && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <Link
                      href={rebookUrl}
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:text-sky-800 hover:underline"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      同じ施設・メニューで再予約
                    </Link>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
