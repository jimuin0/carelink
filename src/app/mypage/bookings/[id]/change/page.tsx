'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import LoadError from '@/components/admin/LoadError';
import type { AvailableSlot } from '@/types';

// 予約の実所要時間（分）を start_time/end_time（"HH:MM[:SS]"）の差から求める。
// 単一 menu_id の duration_minutes では複数メニュー予約（例: カット+カラー120分）の実長を表せず、
// 先頭メニュー分（例60分）に縮んでしまう。その duration で /api/slots を引くと本来120分ぶんの空きが
// 必要な枠を60分基準で提示し、確定すると120分予約が60分に縮む／後半がダブルブッキングされ得る。
// 予約行の start/end（確定済みの実枠）が唯一の真実なので、そこから所要時間を導出する。
function durationMinutes(start: string, end: string): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const diff = toMin(end) - toMin(start);
  return diff > 0 ? diff : 60;
}

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
  const [loadError, setLoadError] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const load = useCallback(async () => {
      const supabase = createBrowserSupabaseClient();
      setLoadError(false);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.push('/auth/login'); return; }

      const { data: b, error: bErr } = await supabase
        .from('bookings')
        .select('id, facility_id, staff_id, menu_id, booking_date, start_time, end_time, total_price, status')
        .eq('id', bookingId)
        .eq('user_id', user.id)
        .single();
      // 通信/権限エラーは一覧へ戻さず失敗として明示（PGRST116=行なし・無効ステータスは従来どおり一覧へ）
      if (bErr && bErr.code !== 'PGRST116') { setLoadError(true); setLoading(false); return; }
      if (!b || !['pending', 'confirmed'].includes(b.status)) { router.push('/mypage/bookings'); return; }

      // 施設名は補助表示。取得失敗時は空表示で本体は継続。
      // eslint-disable-next-line carelink-safety/no-discarded-supabase-error
      const { data: facility } = await supabase.from('facility_profiles').select('name').eq('id', b.facility_id).single();
      const { data: menu } = b.menu_id
        ? await supabase.from('facility_menus').select('name').eq('id', b.menu_id).single()
        : { data: null };
      const { data: staff } = b.staff_id
        ? await supabase.from('staff_profiles').select('name').eq('id', b.staff_id).single()
        : { data: null };

      setBooking({
        ...b,
        facility_name: facility?.name || '',
        menu_name: menu?.name || '',
        staff_name: staff?.name || '',
        duration: durationMinutes(b.start_time, b.end_time),
      });
      setLoading(false);
  }, [bookingId, router]);

  useEffect(() => { load().catch(() => { setLoadError(true); setLoading(false); }); }, [load]);

  const slotsAbortRef = useRef<AbortController | null>(null);

  const loadSlots = useCallback(async (date: string) => {
    if (!booking) return;
    slotsAbortRef.current?.abort();
    const controller = new AbortController();
    slotsAbortRef.current = controller;
    setSlotsLoading(true);
    setSlots([]);
    setSelectedSlot(null);
    try {
      let merged: AvailableSlot[];
      if (booking.staff_id) {
        // 指名予約: 当該スタッフの空き枠のみ（従来挙動）。
        const res = await fetch(`/api/slots?facilityId=${booking.facility_id}&staffId=${booking.staff_id}&date=${date}&duration=${booking.duration}`, {
          signal: controller.signal,
        });
        // res.ok を検証しないと、エラー応答(JSON)でも data.slots=undefined → 空配列となり
        // 「空き枠なし」と障害が区別不能になる。失敗は catch のエラートーストへ流す。
        if (!res.ok) throw new Error();
        const data = await res.json();
        merged = data.slots ?? [];
      } else {
        // おまかせ予約(staff_id=NULL): 施設の全予約可能スタッフ分をマージする（作成側 BookingFlow と同一挙動）。
        // slots API は staffId 必須で空文字だと必ず空配列を返すため、これをしないと全日「空き枠なし」に
        // なり、おまかせ予約の顧客は日時変更が一切できなくなる（A-1 の根治）。
        const supabase = createBrowserSupabaseClient();
        const { data: staffList, error: staffErr } = await supabase
          .from('staff_profiles')
          .select('id')
          .eq('facility_id', booking.facility_id)
          .eq('is_active', true)
          .order('sort_order');
        // スタッフ取得失敗を空リスト＝「空き枠なし」に偽装すると障害と区別できないため、
        // 失敗は下の catch のエラートーストへ流す（取得失敗の空状態偽装の予防）。
        if (staffErr) throw new Error();
        const ids = ((staffList ?? []) as { id: string }[]).map((s) => s.id);
        const results = await Promise.all(ids.map((sid) =>
          fetch(`/api/slots?facilityId=${booking.facility_id}&staffId=${sid}&date=${date}&duration=${booking.duration}`, { signal: controller.signal })
            .then((r) => (r.ok ? r.json() : { slots: [] }))
            .catch(() => ({ slots: [] }))
        ));
        const map = new Map<string, AvailableSlot>();
        results.forEach((data, i) => {
          for (const slot of ((data.slots ?? []) as AvailableSlot[])) {
            // 同一開始時刻は最初に見つかったスタッフの枠を採用（作成側と同じ）。
            if (!map.has(slot.slot_start)) map.set(slot.slot_start, { ...slot, staff_id: ids[i] });
          }
        });
        merged = Array.from(map.values()).sort((a, b) => a.slot_start.localeCompare(b.slot_start));
      }
      if (!controller.signal.aborted) setSlots(merged);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setToast({ type: 'error', message: '空き枠の取得に失敗しました' });
    }
    if (!controller.signal.aborted) setSlotsLoading(false);
  }, [booking]);

  useEffect(() => { if (selectedDate) loadSlots(selectedDate); }, [selectedDate, loadSlots]);
  useEffect(() => () => { slotsAbortRef.current?.abort(); }, []);

  const handleSubmit = async () => {
    if (!booking || !selectedSlot || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/booking/${bookingId}/change`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': '1',
        },
        body: JSON.stringify({
          booking_date: selectedDate,
          start_time: selectedSlot.slot_start,
          end_time: selectedSlot.slot_end,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ type: 'error', message: data.error || '変更に失敗しました' });
      } else {
        setToast({ type: 'success', message: '日時を変更しました' });
        setTimeout(() => router.push('/mypage/bookings'), 1500);
      }
    } catch { setToast({ type: 'error', message: '変更に失敗しました' }); }
    setSubmitting(false);
  };

  const dateOptions = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-8 bg-gray-200 rounded w-1/3" /><div className="h-64 bg-gray-200 rounded-xl" /></div>;
  if (loadError) return <LoadError onRetry={() => { load().catch(() => { setLoadError(true); setLoading(false); }); }} message="予約情報の読み込みに失敗しました" />;
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
              <button type="button" key={date} onClick={() => setSelectedDate(date)}
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
                <button type="button" key={slot.slot_start} onClick={() => setSelectedSlot(slot)}
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
          <button type="button" onClick={() => router.back()} className="flex-1 py-3 text-sm text-gray-500 hover:bg-gray-100 rounded-xl transition-colors">キャンセル</button>
          <button type="button" onClick={handleSubmit} disabled={submitting} className="btn-primary flex-1 !py-3">
            {submitting ? '変更中...' : `${selectedDate} ${selectedSlot.slot_start.slice(0, 5)}に変更する`}
          </button>
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
