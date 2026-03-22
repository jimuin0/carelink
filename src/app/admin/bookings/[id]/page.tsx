'use client';

import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import type { Booking } from '@/types';

const statusOptions = [
  { value: 'pending', label: '確認待ち' },
  { value: 'confirmed', label: '確定' },
  { value: 'completed', label: '完了' },
  { value: 'cancelled', label: 'キャンセル' },
  { value: 'no_show', label: '無断キャンセル' },
];

export default function AdminBookingDetailPage({ params }: { params: { id: string } }) {
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: membership } = await supabase
        .from('facility_members')
        .select('facility_id')
        .eq('user_id', user.id)
        .single();
      if (!membership) { setLoading(false); return; }

      const { data } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', params.id)
        .eq('facility_id', membership.facility_id)
        .single();
      setBooking(data as Booking | null);
      setLoading(false);
    };
    load().catch(() => setLoading(false));
  }, [params.id]);

  const handleStatusChange = async (newStatus: string) => {
    if (updating) return;
    setUpdating(true);

    try {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: membership } = await supabase
        .from('facility_members')
        .select('facility_id')
        .eq('user_id', user.id)
        .single();
      if (!membership) return;

      const { error } = await supabase
        .from('bookings')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', params.id)
        .eq('facility_id', membership.facility_id);

      if (error) {
        setToast({ type: 'error', message: '更新に失敗しました' });
      } else {
        setBooking((prev) => prev ? { ...prev, status: newStatus as Booking['status'] } : null);
        setToast({ type: 'success', message: 'ステータスを更新しました' });
      }
    } catch {
      setToast({ type: 'error', message: '更新に失敗しました' });
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return <div className="bg-white rounded-xl p-6 animate-pulse"><div className="h-6 bg-gray-200 rounded w-1/3" /></div>;
  }

  if (!booking) {
    return <div className="bg-white rounded-xl p-8 text-center"><p className="text-gray-400">予約が見つかりません</p></div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">予約詳細</h1>

      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">お客様名</p>
            <p className="font-medium">{booking.customer_name}</p>
          </div>
          <div>
            <p className="text-gray-500">メール</p>
            <p className="font-medium">{booking.email}</p>
          </div>
          <div>
            <p className="text-gray-500">日付</p>
            <p className="font-medium">{booking.booking_date}</p>
          </div>
          <div>
            <p className="text-gray-500">時間</p>
            <p className="font-medium">{booking.start_time?.slice(0, 5)}〜{booking.end_time?.slice(0, 5)}</p>
          </div>
          {booking.phone && (
            <div>
              <p className="text-gray-500">電話</p>
              <p className="font-medium">{booking.phone}</p>
            </div>
          )}
          {booking.total_price !== null && (
            <div>
              <p className="text-gray-500">金額</p>
              <p className="font-bold text-lg">¥{booking.total_price.toLocaleString()}</p>
            </div>
          )}
        </div>

        {booking.note && (
          <div className="border-t pt-4">
            <p className="text-sm text-gray-500">備考</p>
            <p className="text-sm mt-1">{booking.note}</p>
          </div>
        )}

        <div className="border-t pt-4">
          <p className="text-sm text-gray-500 mb-2">ステータス変更</p>
          <div className="flex flex-wrap gap-2">
            {statusOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleStatusChange(opt.value)}
                disabled={updating || booking.status === opt.value}
                className={`text-xs px-4 py-2 rounded-full font-bold transition-colors ${
                  booking.status === opt.value
                    ? 'bg-primary text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
