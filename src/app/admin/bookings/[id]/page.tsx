'use client';

import { useEffect, useState, use, useCallback } from 'react';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import LoadError from '@/components/admin/LoadError';
import AdjustRequestButtons from '@/components/admin/AdjustRequestButtons';
import type { Booking } from '@/types';
import { statusBannerClass, bookingStatusLabel } from '@/lib/booking-status';

// ステータス変更ボタンに表示する選択肢（既存挙動を維持。遷移可否は API 側で検証）
const STATUS_OPTIONS = ['pending', 'confirmed', 'completed', 'cancelled', 'cancel_fee_paid', 'no_show'] as const;

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00+09:00');
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（${days[d.getDay()]}）`;
}

export default function AdminBookingDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [menuName, setMenuName] = useState<string | null>(null);
  const [staffName, setStaffName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const load = useCallback(async () => {
      const supabase = createBrowserSupabaseClient();
      setLoadError(false);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: membership, error: memErr } = await supabase
        .from('facility_members')
        .select('facility_id')
        .eq('user_id', user.id)
        .limit(1)
        .single();
      if (memErr && memErr.code !== 'PGRST116') { setLoadError(true); setLoading(false); return; }
      if (!membership) { setLoading(false); return; }

      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .eq('id', params.id)
        .eq('facility_id', membership.facility_id)
        .single();

      // PGRST116（行なし）は真の「見つからない」として下の not-found 表示に委ねる。
      // それ以外（通信/権限エラー）は「見つかりません」に偽装せず失敗として明示する。
      if (error && error.code !== 'PGRST116') { setLoadError(true); setLoading(false); return; }
      if (data) {
        setBooking(data as Booking);
        if (data.menu_id) {
          // メニュー名は補助表示。取得失敗時は名称未表示で予約詳細本体は継続表示する。
          // eslint-disable-next-line carelink-safety/no-discarded-supabase-error
          const { data: menu } = await supabase.from('facility_menus').select('name').eq('id', data.menu_id).single();
          if (menu) setMenuName(menu.name);
        }
        if (data.staff_id) {
          // 担当スタッフ名は補助表示。取得失敗時は名称未表示で予約詳細本体は継続表示する。
          // eslint-disable-next-line carelink-safety/no-discarded-supabase-error
          const { data: staff } = await supabase.from('staff_profiles').select('name').eq('id', data.staff_id).single();
          if (staff) setStaffName(staff.name);
        }
      }
      setLoading(false);
  }, [params.id]);

  useEffect(() => {
    load().catch(() => { setLoadError(true); setLoading(false); });
  }, [load]);

  const handleStatusChange = async (newStatus: string) => {
    if (updating || !booking) return;
    setUpdating(true);

    try {
      const res = await fetch('/api/admin/booking-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: booking.id, status: newStatus }),
      });

      if (!res.ok) {
        const data = await res.json();
        setToast({ type: 'error', message: data.error || '更新に失敗しました' });
      } else {
        setBooking((prev) => prev ? { ...prev, status: newStatus as Booking['status'] } : null);
        const label = bookingStatusLabel(newStatus);
        setToast({ type: 'success', message: `ステータスを「${label}」に変更し、お客様に通知しました` });
      }
    } catch {
      setToast({ type: 'error', message: '通信エラーが発生しました' });
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return <div className="bg-white rounded-xl p-6 animate-pulse"><div className="h-6 bg-gray-200 rounded w-1/3" /></div>;
  }

  if (loadError) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-6">
          <Link href="/admin/bookings" className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </Link>
          <h1 className="text-2xl font-bold">予約詳細</h1>
        </div>
        <LoadError onRetry={load} message="予約の読み込みに失敗しました" />
      </div>
    );
  }

  if (!booking) {
    return <div className="bg-white rounded-xl p-8 text-center"><p className="text-gray-400">予約が見つかりません</p></div>;
  }

  const banner = statusBannerClass(booking.status);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin/bookings" className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </Link>
        <h1 className="text-2xl font-bold">予約詳細</h1>
        <span className={`ml-auto text-xs font-bold px-3 py-1 rounded-full border ${banner.bg} ${banner.text}`}>{bookingStatusLabel(booking.status)}</span>
      </div>

      {/* 承認アクション（pending時） */}
      {booking.status === 'pending' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
          <p className="text-sm font-bold text-amber-800 mb-3">この予約を承認しますか？</p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => handleStatusChange('confirmed')}
              disabled={updating}
              className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
            >
              {updating ? '処理中...' : '承認する'}
            </button>
            <button
              type="button"
              onClick={() => handleStatusChange('cancelled')}
              disabled={updating}
              className="flex-1 py-3 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 font-bold rounded-xl text-sm transition-colors disabled:opacity-50"
            >
              お断りする
            </button>
          </div>
          <p className="text-xs text-amber-600 mt-2">※ステータス変更時にお客様へメールが自動送信されます</p>
        </div>
      )}

      {/* 予約情報 */}
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-4">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">お客様名</p>
            <p className="font-medium text-base">{booking.customer_name}</p>
          </div>
          <div>
            <p className="text-gray-500">メール</p>
            <p className="font-medium">{booking.email}</p>
          </div>
          <div>
            <p className="text-gray-500">日時</p>
            <p className="font-medium">{formatDate(booking.booking_date)}</p>
            <p className="text-sky-600 font-bold">{booking.start_time?.slice(0, 5)}〜{booking.end_time?.slice(0, 5)}</p>
          </div>
          {booking.phone && (
            <div>
              <p className="text-gray-500">電話</p>
              <p className="font-medium">{booking.phone}</p>
            </div>
          )}
          {menuName && (
            <div>
              <p className="text-gray-500">メニュー</p>
              <p className="font-medium">{menuName}</p>
            </div>
          )}
          {staffName && (
            <div>
              <p className="text-gray-500">担当スタッフ</p>
              <p className="font-medium">{staffName}</p>
            </div>
          )}
          {booking.total_price !== null && (
            <div>
              <p className="text-gray-500">金額</p>
              <p className="font-bold text-lg text-sky-600">¥{booking.total_price.toLocaleString()}</p>
            </div>
          )}
        </div>

        {booking.note && (
          <div className="border-t pt-4">
            <p className="text-sm text-gray-500">備考</p>
            <p className="text-sm mt-1 bg-gray-50 p-3 rounded-lg">{booking.note}</p>
          </div>
        )}

        {/* ステータス変更（承認後） */}
        {booking.status !== 'pending' && (
          <div className="border-t pt-4">
            <p className="text-sm text-gray-500 mb-2">ステータス変更</p>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((value) => {
                const cfg = statusBannerClass(value);
                return (
                  <button
                    type="button"
                    key={value}
                    onClick={() => handleStatusChange(value)}
                    disabled={updating || booking.status === value}
                    className={`text-xs px-4 py-2 rounded-full font-bold transition-colors ${
                      booking.status === value
                        ? `${cfg.bg} ${cfg.text} border`
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {bookingStatusLabel(value)}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-400 mt-2">※変更時にお客様へメール通知されます</p>
          </div>
        )}
      </div>

      {/* 時間調整のお願い（メール無料/LINE有料オプション） */}
      <AdjustRequestButtons bookingId={booking.id} status={booking.status} />

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
