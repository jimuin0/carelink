'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import LoadError from '@/components/admin/LoadError';
import type { AvailableSlot } from '@/types';
import { fetchSlotsWeek, mergeSlotsInStaffOrder } from '@/lib/slots-week';
import { buildMenuStaffMap, filterEligibleStaff, type MenuStaffRow } from '@/lib/menu-staff';
import { isCustomerChangeableStatus } from '@/lib/booking-status';
import { hasBookingStarted } from '@/lib/cancel-fee';
import { bookingStaffLabel, isNominatedBooking } from '@/lib/booking-nomination';
import { needsSlotReselection, rescheduleDurationMinutes } from '@/lib/booking-slot-rules';

// 予約の実所要時間（分）は start_time/end_time の差から求める（rescheduleDurationMinutes）。
// 単一 menu_id の duration_minutes では複数メニュー予約（例: カット+カラー120分）の実長を表せず、
// 先頭メニュー分（例60分）に縮んでしまう。その duration で空き枠を引くと本来120分ぶんの空きが
// 必要な枠を60分基準で提示し、確定すると120分予約が60分に縮む／後半がダブルブッキングされ得る。
// 予約行の start/end（確定済みの実枠）が唯一の真実なので、そこから所要時間を導出する。
// 変更 API も同じ関数で長さを照合する（長さの違う時間は受け付けない）。

/** JST の今日から days 日分の日付（YYYY-MM-DD）。予約画面（BookingFlow）と同じく当日から並べる。 */
function jstDateOptions(nowMs: number, days: number): string[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(nowMs + 9 * 60 * 60 * 1000);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

type ChangeableBooking = {
  id: string; facility_id: string; staff_id: string | null; staff_auto_assigned: boolean;
  menu_id: string | null; menu_ids: string[] | null;
  booking_date: string; start_time: string; end_time: string; total_price: number | null;
  facility_name: string; menu_name: string; staff_name: string; duration: number;
};

/** 今の予約と同じ日・同じ開始時刻の枠か（長さは予約と同じなので、同じ枠＝変更にならない）。 */
function isCurrentBookingSlot(booking: ChangeableBooking, date: string, slotStart: string): boolean {
  return date === booking.booking_date && slotStart.slice(0, 5) === booking.start_time.slice(0, 5);
}

/**
 * 指名なし（おまかせ）予約で空き枠を集計するスタッフ。予約 RPC が割り当てた担当者
 * （staff_auto_assigned）は指名ではないので、その人の空きに限らない（変更時に RPC が割り当て直す）。施設の受付中スタッフのうち、
 * 予約したメニューを担当できる人だけ（menu_staff・予約画面 BookingFlow と同じ判定）。
 * 担当外のスタッフの空きを数えると、実際には施術できない時間が「空き」に見える。
 * 取得に失敗したら例外にする（空リスト＝「空きなし」に見せない）。
 */
async function eligibleStaffIds(booking: ChangeableBooking): Promise<string[]> {
  const supabase = createBrowserSupabaseClient();
  const { data: staffList, error: staffErr } = await supabase
    .from('staff_profiles')
    .select('id')
    .eq('facility_id', booking.facility_id)
    .eq('is_active', true)
    .order('sort_order');
  if (staffErr) throw staffErr;
  const staff = (staffList ?? []) as { id: string }[];
  // 複数メニューの予約は menu_ids に全メニューが入る（無い旧予約は menu_id だけ）。
  const menuIds = booking.menu_ids && booking.menu_ids.length > 0
    ? booking.menu_ids
    : booking.menu_id ? [booking.menu_id] : [];
  if (menuIds.length === 0 || staff.length === 0) return staff.map((s) => s.id);
  const { data: rows, error: menuStaffErr } = await supabase
    .from('menu_staff')
    .select('menu_id, staff_id')
    .in('menu_id', menuIds);
  if (menuStaffErr) throw menuStaffErr;
  return filterEligibleStaff(staff, buildMenuStaffMap((rows ?? []) as MenuStaffRow[]), menuIds).map((s) => s.id);
}

/** 空き枠の取得結果。'error' は取得失敗（429 を含む）、'not_ready' は店舗のネット予約が準備中。 */
type SlotsResult = { key: string; slots: AvailableSlot[]; status: 'ok' | 'error' | 'not_ready' };

export default function BookingChangePage() {
  const router = useRouter();
  const params = useParams();
  const bookingId = params.id as string;

  const [booking, setBooking] = useState<ChangeableBooking | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);
  // 空き枠の取得結果を「どの条件で取ったか（key）」と一緒に持つ。レンダー中に現在の条件と
  // 突き合わせ（slotsPending）、一致するまでは取得中として描く。ローディング用の boolean を
  // effect で立てる形はペイント後にしか反映されず、最初のフレームで前日の枠や誤った「空きなし」を
  // 見せるためやめた（2026年8月16日 実測）。
  const [slotsResult, setSlotsResult] = useState<SlotsResult | null>(null);
  // 空き枠の取得に失敗したときの「再試行」。条件のキーに含め、押すと取り直す。
  const [slotsRetry, setSlotsRetry] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  // 日付の候補はマウント時の時刻から作る（描画のたびに時刻を読まない）。
  const [mountedAtMs] = useState(() => Date.now());

  // load 相当の処理は「マウント時の初回読み込み」と「読み込み失敗後の再試行」の2箇所からしか
  // 呼ばれず、どちらも同じ処理を求める呼び出しなので、reloadKey を effect の依存に置いて
  // 再試行時はキーをインクリメントするだけにする（処理本体は effect 内に1箇所だけ inline する）。
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createBrowserSupabaseClient();
        setLoadError(false);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { router.push('/auth/login'); return; }

        const { data: b, error: bErr } = await supabase
          .from('bookings')
          .select('id, facility_id, staff_id, staff_auto_assigned, menu_id, menu_ids, booking_date, start_time, end_time, total_price, status')
          .eq('id', bookingId)
          .eq('user_id', user.id)
          .single();
        // 通信/権限エラーは一覧へ戻さず失敗として明示（PGRST116=行なし・無効ステータスは従来どおり一覧へ）
        if (bErr && bErr.code !== 'PGRST116') { if (!cancelled) { setLoadError(true); setLoading(false); } return; }
        if (!b || !isCustomerChangeableStatus(b.status)) { router.push('/mypage/bookings'); return; }
        // 開始時刻を過ぎた予約は API・DB とも変更を拒否する。枠を選ばせてから失敗させず、
        // 「施設へ直接ご連絡ください」の案内がある予約詳細へ戻す。
        if (hasBookingStarted(b.booking_date, b.start_time, Date.now())) { router.push(`/mypage/bookings/${bookingId}`); return; }
        if (cancelled) return;

        // 施設名は補助表示。取得失敗時は空表示で本体は継続。
        // eslint-disable-next-line carelink-safety/no-discarded-supabase-error
        const { data: facility } = await supabase.from('facility_profiles').select('name').eq('id', b.facility_id).single();
        const { data: menu } = b.menu_id
          ? await supabase.from('facility_menus').select('name').eq('id', b.menu_id).single()
          : { data: null };
        const { data: staff } = b.staff_id
          ? await supabase.from('staff_profiles').select('name').eq('id', b.staff_id).single()
          : { data: null };

        if (cancelled) return;
        setBooking({
          ...b,
          facility_name: facility?.name || '',
          menu_name: menu?.name || '',
          staff_name: staff?.name || '',
          duration: rescheduleDurationMinutes(b.start_time, b.end_time),
        });
        setLoading(false);
      } catch {
        if (!cancelled) { setLoadError(true); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [bookingId, router, reloadKey]);

  // 空き枠の取得条件を表すキー。下の effect の依存（selectedDate / booking / 再試行）と一致させる。
  // 条件が揃っていない間は null にして、取得が走らない状態を「取得中」と誤判定しないようにする
  // （さもないとスピナーが永久に回る）。
  const slotsQueryKey = selectedDate && booking ? `${selectedDate}|${booking.id}|${booking.duration}|${slotsRetry}` : null;

  // 🔴 取得中かどうかを【レンダー中に導出する】。boolean state を effect で立てる形だと
  // ペイント後にしか反映されず、最初のフレームで前日の枠や誤った「空きなし」を見せてしまう。
  const slotsPending = slotsQueryKey !== null && slotsResult?.key !== slotsQueryKey;
  const shownSlots = slotsPending ? null : slotsResult;

  useEffect(() => {
    if (!selectedDate || !booking || slotsQueryKey === null) return;
    const controller = new AbortController();

    // 🔴 ここで「取得中」を立てない。取得中かどうかは描画時に slotsPending で判定する（上の定義）。
    // why（2026年8月16日 実機で確認）: useEffect はブラウザのペイント後に走るため、effect の中で
    // ローディングを立てても【最初のフレームには間に合わない】。初回は「この日は予約可能な
    // 時間帯がありません」という誤った断定が、2 回目以降は【前の日付の時間枠がそのまま】
    // 1 フレーム見える。選択解除は日付ボタンの onClick で行う（イベントハンドラなのでレンダー前に反映される）。
    //
    // 空き枠は /api/slots/week でまとめて取る（2026年10月22日）。以前のおまかせ予約はスタッフの
    // 人数ぶん /api/slots を同時に叩き、失敗や 429 を空配列として扱っていたため、上限に当たると
    // 「この日は予約可能な時間帯がありません」と表示されていた。今は取得に失敗したら
    // 「空きなし」ではなく失敗として表示し、再試行できるようにする。指名予約も同じ経路で取る。
    (async () => {
      let next: Omit<SlotsResult, 'key'>;
      try {
        // 指名予約は当該スタッフの空きだけ。指名なし（割り当て済みを含む）は担当できるスタッフ全員分。
        const staffIds = isNominatedBooking(booking) && booking.staff_id
          ? [booking.staff_id]
          : await eligibleStaffIds(booking);
        if (staffIds.length === 0) {
          // 担当できるスタッフがいない＝この予約内容で選べる時間は本当に無い。
          next = { slots: [], status: 'ok' };
        } else {
          const week = await fetchSlotsWeek({
            facilityId: booking.facility_id,
            staffIds,
            dates: [selectedDate],
            duration: booking.duration,
            // 変更する予約そのものは「埋まっている枠」に数えない。数えると、今の時間と重なる
            // 時刻（30分〜1時間ずらす変更）が「空きなし」に見えて選べなかった（2026年10月23日）。
            excludeBookingId: booking.id,
            signal: controller.signal,
          });
          if (!week.ok) next = { slots: [], status: 'error' };
          else if (!week.bookingAvailable) next = { slots: [], status: 'not_ready' };
          // 同じ開始時刻に複数のスタッフが空いていれば、表示順で先のスタッフの枠を採る（予約画面と同じ）。
          else next = { slots: mergeSlotsInStaffOrder(staffIds, week.days[selectedDate]), status: 'ok' };
        }
      } catch {
        // 中断（日付の切り替え・画面を離れた）は失敗ではない。それ以外の例外は取得失敗として見せる。
        if (controller.signal.aborted) return;
        next = { slots: [], status: 'error' };
      }
      if (!controller.signal.aborted) setSlotsResult({ key: slotsQueryKey, ...next });
    })();

    return () => controller.abort();
  }, [selectedDate, booking, slotsQueryKey]);

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
        // 監査F10: 新規予約(BookingFlow)と同様にタイムアウトを付与。
        // 未設定だとサーバ/プロキシのハング時に「変更中...」のまま無限待機になる。
        signal: AbortSignal.timeout(15000),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ type: 'error', message: data.error || '変更に失敗しました' });
        // 開始時刻を過ぎた・長さが合わない時間だった場合は、選択を外して空き枠を取り直す。
        if (needsSlotReselection(data.error)) { setSelectedSlot(null); setSlotsRetry((n) => n + 1); }
      } else {
        setToast({ type: 'success', message: '日時を変更しました' });
        setTimeout(() => router.push('/mypage/bookings'), 1500);
      }
    } catch { setToast({ type: 'error', message: '変更に失敗しました' }); }
    setSubmitting(false);
  };

  // 当日から 30 日分（以前は翌日始まりで、当日中の時刻変更が画面から選べなかった。API は当日を
  // 受け付け、当日の開始済みの時刻は空き枠 API が出さない）。
  const dateOptions = jstDateOptions(mountedAtMs, 30);

  if (loading) return <div className="animate-pulse space-y-4"><div className="h-8 bg-gray-200 rounded-sm w-1/3" /><div className="h-64 bg-gray-200 rounded-xl" /></div>;
  if (loadError) return <LoadError onRetry={() => setReloadKey((k) => k + 1)} message="予約情報の読み込みに失敗しました" />;
  if (!booking) return null;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl shadow-xs p-6">
        <h1 className="text-xl font-bold mb-4">予約日時の変更</h1>
        <div className="text-sm space-y-1 text-gray-600">
          <p>施設: <span className="font-medium text-gray-900">{booking.facility_name}</span></p>
          <p>メニュー: <span className="font-medium">{booking.menu_name || '-'}</span></p>
          <p>スタッフ: <span className="font-medium">{bookingStaffLabel(booking.staff_name, booking.staff_auto_assigned)}</span></p>
          <p>現在の日時: <span className="font-medium">{booking.booking_date} {booking.start_time.slice(0, 5)}</span></p>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-xs p-6">
        <h2 className="font-bold mb-3">新しい日付を選択</h2>
        <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
          {dateOptions.map((date) => {
            // 日付文字列は JST の暦日。端末のタイムゾーンに左右されないよう UTC として読む。
            const d = new Date(`${date}T00:00:00Z`);
            const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
            const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
            return (
              <button type="button" key={date} onClick={() => { setSelectedSlot(null); setSelectedDate(date); }}
                className={`p-2 rounded-xl border text-center transition-colors ${selectedDate === date ? 'border-sky-500 bg-sky-50' : 'border-gray-200 hover:border-sky-300'}`}>
                <p className="text-xs text-gray-500">{d.getUTCMonth() + 1}/{d.getUTCDate()}</p>
                <p className={`text-sm font-bold ${isWeekend ? 'text-red-600' : ''}`}>{dayNames[d.getUTCDay()]}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* data-testid は e2e/first-paint-loading.spec.ts が「枠の表示領域だけ」を観測するために使う。
          ページ全体を見ると既存予約の時刻表示（10:00 等）を拾ってしまい検査にならない。 */}
      {selectedDate && (
        <div className="bg-white rounded-2xl shadow-xs p-6" data-testid="slot-picker">
          <h2 className="font-bold mb-3">時間を選択</h2>
          {shownSlots === null ? (
            <div className="text-center py-8"><div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
          ) : shownSlots.status === 'error' ? (
            // 取得の失敗は「空きなし」と区別する（失敗を満席に見せると、空いている日をあきらめさせてしまう）。
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 flex items-center justify-between gap-2 flex-wrap" role="alert">
              <span>空き枠を取得できませんでした。通信状況をご確認のうえ、再度お試しください。</span>
              <button
                type="button"
                onClick={() => { setSelectedSlot(null); setSlotsRetry((n) => n + 1); }}
                className="text-red-700 font-bold underline shrink-0"
              >
                再試行
              </button>
            </div>
          ) : shownSlots.status === 'not_ready' ? (
            <p className="text-gray-600 text-sm text-center py-4">この店舗のネット予約は準備中です。日時の変更は店舗へ直接お問い合わせください。</p>
          ) : shownSlots.slots.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">この日は予約可能な時間帯がありません</p>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
              {shownSlots.slots.map((slot) => {
                // 今の予約と同じ日・同じ開始時刻は「変更」にならない。変更する予約を空きの計算から
                // 外したので候補に出るが、送ると同じ内容の再送として成功扱いになり、何も変わらないのに
                // 「日時を変更しました」と表示されてしまう。現在の予約として示し、選べないようにする。
                const isCurrent = isCurrentBookingSlot(booking, selectedDate, slot.slot_start);
                return (
                  <button type="button" key={slot.slot_start} onClick={() => setSelectedSlot(slot)} disabled={isCurrent}
                    className={`p-3 rounded-xl border text-center transition-colors ${isCurrent ? 'border-gray-200 bg-gray-100 text-gray-600 cursor-not-allowed' : selectedSlot?.slot_start === slot.slot_start ? 'border-sky-500 bg-sky-50' : 'border-gray-200 hover:border-sky-300'}`}>
                    <p className="font-bold text-sm">{slot.slot_start.slice(0, 5)}</p>
                    {isCurrent && <p className="text-xs">現在の予約</p>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {selectedSlot && (
        <div className="flex gap-3">
          <button type="button" onClick={() => router.back()} className="flex-1 py-3 text-sm text-gray-500 hover:bg-gray-100 rounded-xl transition-colors">キャンセル</button>
          <button type="button" onClick={handleSubmit} disabled={submitting} className="btn-primary flex-1 py-3!">
            {submitting ? '変更中...' : `${selectedDate} ${selectedSlot.slot_start.slice(0, 5)}に変更する`}
          </button>
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
