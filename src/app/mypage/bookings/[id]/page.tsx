'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import type { Booking } from '@/types';

const statusLabels: Record<string, { label: string; color: string }> = {
  pending: { label: '確認待ち', color: 'bg-yellow-100 text-yellow-800' },
  confirmed: { label: '確定', color: 'bg-green-100 text-green-800' },
  completed: { label: '完了', color: 'bg-gray-100 text-gray-800' },
  cancelled: { label: 'キャンセル', color: 'bg-red-100 text-red-800' },
  no_show: { label: '無断キャンセル', color: 'bg-red-100 text-red-800' },
};

export default function BookingDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', params.id)
        .eq('user_id', user.id)
        .single();
      setBooking(data as Booking | null);
      setLoading(false);
    };
    load().catch(() => setLoading(false));
  }, [params.id]);

  const handleCancel = async () => {
    if (cancelling) return;
    if (!confirm('この予約をキャンセルしますか？')) return;
    setCancelling(true);

    try {
      const res = await fetch(`/api/booking/${params.id}/cancel`, { method: 'POST', signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        setToast({ type: 'success', message: '予約をキャンセルしました' });
        setBooking((prev) => prev ? { ...prev, status: 'cancelled' } : null);
      } else {
        const body = await res.json().catch(() => null);
        setToast({ type: 'error', message: body?.error || 'キャンセルに失敗しました' });
      }
    } catch {
      setToast({ type: 'error', message: 'キャンセルに失敗しました' });
    } finally {
      setCancelling(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-6 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-1/3 mb-4" />
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => <div key={i} className="h-4 bg-gray-200 rounded" />)}
        </div>
      </div>
    );
  }

  if (!booking) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
        <p className="text-gray-400">予約が見つかりません</p>
      </div>
    );
  }

  const status = statusLabels[booking.status] ?? statusLabels.pending;
  const canCancel = booking.status === 'pending' || booking.status === 'confirmed';

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">予約詳細</h1>

      <div className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">ステータス</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${status.color}`}>
            {status.label}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">日付</span>
          <span className="font-medium">{booking.booking_date}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">時間</span>
          <span className="font-medium">{booking.start_time?.slice(0, 5)}〜{booking.end_time?.slice(0, 5)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">お名前</span>
          <span className="font-medium">{booking.customer_name}</span>
        </div>
        {booking.total_price !== null && (
          <div className="flex justify-between text-sm border-t pt-3">
            <span className="text-gray-500">合計</span>
            <span className="font-bold text-lg">¥{booking.total_price.toLocaleString()}</span>
          </div>
        )}
        {booking.note && (
          <div className="border-t pt-3">
            <span className="text-sm text-gray-500">備考</span>
            <p className="text-sm mt-1">{booking.note}</p>
          </div>
        )}
      </div>

      {canCancel && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={cancelling}
          className="w-full mt-4 py-3 rounded-xl border border-red-300 text-red-600 font-bold hover:bg-red-50 transition-colors"
        >
          {cancelling ? 'キャンセル中...' : 'この予約をキャンセル'}
        </button>
      )}

      {/* リピート予約（v8.6） */}
      {booking && ['completed', 'cancelled'].includes(booking.status) && booking.facility_id && (
        <button
          type="button"
          onClick={() => {
            const params = new URLSearchParams();
            if (booking.menu_id) params.set('menu', booking.menu_id);
            if (booking.staff_id) params.set('staff', booking.staff_id);
            router.push(`/facility/${(booking as unknown as { facility_slug?: string }).facility_slug || booking.facility_id}/booking?${params.toString()}`);
          }}
          className="w-full mt-3 py-3 rounded-xl bg-sky-500 text-white font-bold hover:bg-sky-600 transition-colors"
        >
          同じ内容で再予約する
        </button>
      )}

      <button
        type="button"
        onClick={() => router.push('/mypage/bookings')}
        className="w-full mt-3 text-sm text-gray-500 hover:underline text-center py-2"
      >
        予約一覧に戻る
      </button>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
