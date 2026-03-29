'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import type { AvailableSlot } from '@/types';

export default function BookingChangePage() {
  const router = useRouter();
  const params = useParams();
  const bookingId = params.id as string;

  const [booking, setBooking] = useState<{
    id: string; facility_id: string; staff_id: string | null; menu_id: string | null;
    booking_date: string; start_time: string; end_time: string; total_price: number | null;
    facility_name: string; menu_name: string; staff_name: string; duration: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const load = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/auth/login'); return; }

      const { data: b } = await supabase
        .from('bookings')
        .select('id, facility_id, staff_id, menu_id, booking_date, start_time, end_time, total_price, status')
        .eq('id', bookingId)
        .eq('user_id', user.id)
        .single();
      if (!b || !['pending', 'confirmed'].includes(b.status)) { router.push('/mypage/bookings'); return; }

      const { data: facility } = await supabase.from('facility_profiles').select('name').eq('id', b.facility_id).single();
      const { data: menu } = b.menu_id
        ? await supabase.from('facility_menus').select('name, duration_minutes').eq('id', b.menu_id).single()
        : { data: null };
      const { data: staff } = b.staff_id
        ? await supabase.from('staff_profiles').select('name').eq('id', b.staff_id).single()
        : { data: null };

      setBooking({
        ...b,
        facility_name: facility?.name || '',
        menu_name: menu?.name || '',
        staff_name: staff?.name || '',
        duration: menu?.duration_minutes || 60,
      });
      setLoading(false);
    };
    load().catch(() => setLoading(false));
  }, [bookingId, router]);

  const loadSlots = useCallback(async (date: string) => {
    if (!booking) return;
    setSlotsLoading(true);
    setSlots([]);
    setSelectedSlot(null);
    try {
      const res = await fetch(`/api/slots?facilityId=${booking.facility_id}&staffId=${booking.staff_id || ''}&date=${date}&duration=${booking.duration}`, {
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json();
      setSlots(data.slots ?? []);
    } catch { setToast({ type: 'error', message: '空き枠の取得に失敗しました' }); }
    setSlotsLoading(false);
  }, [booking]);

  useEffect(() => { if (selectedDate) loadSlots(selectedDate); }, [selectedDate, loadSlots]);

  const handleSubmit = async () => {
    if (!booking || !selectedSlot || submitting) return;
    setSubmitting(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.from('bookings').update({
        booking_date: selectedDate,
        start_time: selectedSlot.slot_start,
        end_time: selectedSlot.slot_end,
        updated_at: new Date().toISOString(),
      }).eq('id', bookingId);
      if (error) throw error;
      setToast({ type: 'success', message: '日時を変更しました' });
      setTimeout(() => router.push('/mypage/bookings'), 1500);
    } catch { setToast({ type: 'error', message: '変更に失敗しました' }); }
    setSubmitting(false);
  };

  const dateOptions = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-8 bg-gray-200 rounded w-1/3" /><div className="h-64 bg-gray-200 rounded-xl" /></div>;
  if (!booking) return null;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h1 className="text-xl font-bold mb-4">予約日時の変更</h1>
        <div className="text-sm space-y-1 text-gray-600">
          <p>施設: <span className="font-medium text-gray-900">{booking.facility_name}</span></p>
          <p>メニュー: <span className="font-medium">{booking.menu_name || '-'}</span></p>
          <p>スタッフ: <span className="font-medium">{booking.staff_name || '指名なし'}</span></p>
          <p>現在の日時: <span className="font-medium">{booking.booking_date} {booking.start_time.slice(0, 5)}</span></p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="font-bold mb-3">新しい日付を選択</h2>
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
          {dateOptions.map((date) => {
            const d = new Date(date);
            const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
            const isWeekend = d.getDay() === 0 || d.getDay() === 6;
            return (
              <button key={date} onClick={() => setSelectedDate(date)}
                className={`p-2 rounded-xl border text-center transition-colors ${selectedDate === date ? 'border-sky-500 bg-sky-50' : 'border-gray-200 hover:border-sky-300'}`}>
                <p className="text-xs text-gray-500">{d.getMonth() + 1}/{d.getDate()}</p>
                <p className={`text-sm font-bold ${isWeekend ? 'text-red-500' : ''}`}>{dayNames[d.getDay()]}</p>
              </button>
            );
          })}
        </div>
      </div>

      {selectedDate && (
        <div className="bg-white rounded-2xl shadow-sm p-6">
          <h2 className="font-bold mb-3">時間を選択</h2>
          {slotsLoading ? (
            <div className="text-center py-8"><div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
          ) : slots.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-4">この日は予約可能な時間帯がありません</p>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {slots.map((slot) => (
                <button key={slot.slot_start} onClick={() => setSelectedSlot(slot)}
                  className={`p-3 rounded-xl border text-center transition-colors ${selectedSlot?.slot_start === slot.slot_start ? 'border-sky-500 bg-sky-50' : 'border-gray-200 hover:border-sky-300'}`}>
                  <p className="font-bold text-sm">{slot.slot_start.slice(0, 5)}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedSlot && (
        <div className="flex gap-3">
          <button onClick={() => router.back()} className="flex-1 py-3 text-sm text-gray-500 hover:bg-gray-100 rounded-xl transition-colors">キャンセル</button>
          <button onClick={handleSubmit} disabled={submitting} className="btn-primary flex-1 !py-3">
            {submitting ? '変更中...' : `${selectedDate} ${selectedSlot.slot_start.slice(0, 5)}に変更する`}
          </button>
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
