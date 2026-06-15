'use client';

import { useEffect, useState, use, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import LoadError from '@/components/admin/LoadError';
import type { Booking } from '@/types';
import { statusChipClass, bookingStatusLabel } from '@/lib/booking-status';

export default function BookingDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const router = useRouter();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [gcalConnected, setGcalConnected] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const load = useCallback(async () => {
      const supabase = createBrowserSupabaseClient();
      setLoadError(false);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', params.id)
        .eq('user_id', user.id)
        .single();
      // PGRST116（行なし）は真の「見つからない」として下の not-found 表示に委ね、
      // 通信/権限エラーは「見つかりません」に偽装せず失敗として明示する。
      if (error && error.code !== 'PGRST116') { setLoadError(true); setLoading(false); return; }
      setBooking(data as Booking | null);
      setLoading(false);
      // Check Google Calendar connection
      fetch('/api/google-calendar')
        .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
        .then((d) => setGcalConnected(d.connected && !d.isExpired))
        .catch(() => {});
  }, [params.id]);

  useEffect(() => { load().catch(() => { setLoadError(true); setLoading(false); }); }, [load]);

  const handleCancel = async () => {
    if (cancelling) return;
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

  if (loadError) {
    return (
      <LoadError onRetry={() => { load().catch(() => { setLoadError(true); setLoading(false); }); }} message="予約の読み込みに失敗しました" />
    );
  }

  if (!booking) {
    return (
      <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
        <p className="text-gray-400">予約が見つかりません</p>
      </div>
    );
  }

  const canCancel = booking.status === 'pending' || booking.status === 'confirmed';

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">予約詳細</h1>
      <div className="bg-white rounded-2xl shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">ステータス</span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${statusChipClass(booking.status)}`}>
            {bookingStatusLabel(booking.status)}
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
      {/* カレンダー追加 */}
      {booking && booking.booking_date && booking.start_time && (
        <div className="flex gap-2 mt-4">
          {gcalConnected ? (
            <button
              type="button"
              disabled={syncing}
              onClick={async () => {
                setSyncing(true);
                try {
                  const res = await fetch('/api/google-calendar/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bookingId: booking.id }),
                  });
                  if (res.ok) {
                    setToast({ type: 'success', message: 'Googleカレンダーに同期しました' });
                  } else {
                    setToast({ type: 'error', message: '同期に失敗しました' });
                  }
                } catch {
                  setToast({ type: 'error', message: '同期に失敗しました' });
                } finally {
                  setSyncing(false);
                }
              }}
              className="flex-1 py-2.5 text-center rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {syncing ? '同期中...' : '📅 カレンダーに同期'}
            </button>
          ) : (
            <a
              href={(() => {
                const date = booking.booking_date.replace(/-/g, '');
                const start = (booking.start_time || '').replace(/:/g, '').slice(0, 4);
                const end = (booking.end_time || '').replace(/:/g, '').slice(0, 4);
                const title = encodeURIComponent('予約 - CareLink');
                return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${date}T${start}00/${date}T${end}00&ctz=Asia/Tokyo`;
              })()}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-2.5 text-center rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              📅 Googleカレンダーに追加
            </a>
          )}
          <a
            href={`/api/booking/${booking.id}/ical`}
            download={`carelink-booking-${booking.id.slice(0, 8)}.ics`}
            className="flex-1 py-2.5 text-center rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            📥 iCalダウンロード
          </a>
        </div>
      )}
      {canCancel && (
        <button
          type="button"
          onClick={() => setShowCancelConfirm(true)}
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
          className="w-full mt-3 py-3 rounded-xl bg-sky-600 text-white font-bold hover:bg-sky-700 transition-colors"
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
      <ConfirmDialog
        open={showCancelConfirm}
        title="予約をキャンセル"
        message="この予約をキャンセルしますか？キャンセルポリシーによりキャンセル料が発生する場合があります。"
        confirmLabel="キャンセルする"
        cancelLabel="戻る"
        onConfirm={() => { setShowCancelConfirm(false); handleCancel(); }}
        onCancel={() => setShowCancelConfirm(false)}
      />
    </div>
  );
}
