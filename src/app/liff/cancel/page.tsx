'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useLiff } from '@/hooks/useLiff';
import LiffNotLinked from '@/components/liff/LiffNotLinked';
import { canCustomerCancelBooking } from '@/lib/booking-status';
import {
  hasBookingStarted, hoursUntilBookingStart, describeCancelFeeEstimate, describeConfirmedCancelFee,
  ONLINE_CANCEL_DISABLED_MESSAGE, BOOKING_STARTED_CONTACT_MESSAGE, type CancelPolicy,
} from '@/lib/cancel-fee';
import ShopContactNotice from '@/components/booking/ShopContactNotice';

type Booking = {
  id: string;
  booking_date: string;
  start_time: string;
  menu_name: string | null;
  status: string;
  total_price?: number | null;
  facility_profiles?: { name: string } | null;
  /** 公開中の店舗の連絡先（/api/liff/bookings が返す）。非公開の店舗では null。 */
  facility_contact?: { slug: string; phone: string | null } | null;
  /** false: 店舗が「ネットでのキャンセル不可（店舗へ直接ご連絡）」を選んでいる（/api/liff/bookings が返す）。 */
  online_cancel_allowed?: boolean;
  /** 店舗のキャンセルポリシー。null は未設定（無料）、省略はポリシーを読めなかった（金額を推測しない）。 */
  cancel_policy?: CancelPolicy | null;
};

/** いまキャンセルした場合のキャンセル料の見込み（キャンセル API と同じ computeCancelFee・同じ店舗のポリシー）。 */
function feeEstimate(b: Booking, nowMs: number): string {
  return describeCancelFeeEstimate(b.cancel_policy, b.total_price, hoursUntilBookingStart(b.booking_date, b.start_time, nowMs));
}

function LiffLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
    </div>
  );
}
function LiffError({ message }: { message: string }) {
  return <div className="flex items-center justify-center min-h-screen p-4"><p role="alert" className="text-red-600 text-sm">{message}</p></div>;
}

function CancelContent() {
  const liff = useLiff();
  const router = useRouter();
  const searchParams = useSearchParams();
  const bookingId = searchParams.get('booking_id');

  // リッチメニューの「キャンセル」は予約を指定せずにこの画面を開く。予約を選べる一覧へ移す
  // （以前は「予約IDが指定されていません」で行き止まりになり、一覧の予約も選べなかった）。
  useEffect(() => {
    if (!bookingId) router.replace('/liff/bookings');
  }, [bookingId, router]);

  const [booking, setBooking] = useState<Booking | null>(null);
  // liff.status は 'loading' から 'ready' へ一度だけ遷移し、bookingId は外部（LINE
  // 側の深いリンク）からの初回ロードでのみ決まる（アプリ内に別 booking_id への
  // 遷移導線が無い＝同一マウント中に値が変わることはない）ため、この effect は
  // 実質1回しか走らない。「読み込み中」を state の初期値に持たせることで、
  // effect 内の同期 setState（React Compiler の set-state-in-effect 違反＝
  // カスケードレンダリングの原因）を無くす。旧実装は初期値 false のまま
  // liff.status==='ready' の初回描画を一瞬挟んでから setLoading(true) していたため、
  // 実際には「予約が見つかりません」が一瞬見えてからスピナーに切り替わる
  // カスケードが起きていた（本修正で解消・表示内容自体は不変）。
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [result, setResult] = useState<'success' | 'error' | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  // 取得失敗を握り潰すと「予約が見つかりません」と障害が区別不能になるため明示する
  const [loadError, setLoadError] = useState(false);
  // キャンセル料の見込み・開始時刻を過ぎたかを判定した時刻（描画中に Date.now() を読まない）。
  // 押した瞬間に計算し直し、見込みが変わっていたら（無料期限を過ぎた等）取り消さずに見せ直す。
  const [estimateAt, setEstimateAt] = useState(0);
  const [estimateChanged, setEstimateChanged] = useState(false);
  // キャンセル API が返した確定額のお知らせ。
  const [receipt, setReceipt] = useState<string | null>(null);

  useEffect(() => {
    if (liff.status !== 'ready' || !bookingId) return;
    fetch(`/api/liff/bookings?booking_id=${bookingId}`, {
        headers: { Authorization: `Bearer ${liff.accessToken}` },
      })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { setBooking(d.booking ?? null); setEstimateAt(Date.now()); setLoading(false); })
      .catch(() => { setLoadError(true); setLoading(false); });
  }, [liff, bookingId]);

  const handleCancel = useCallback(async () => {
    if (!booking || cancelling || liff.status !== 'ready') return;
    const now = Date.now();
    if (feeEstimate(booking, now) !== feeEstimate(booking, estimateAt)) {
      setEstimateAt(now);
      setEstimateChanged(true);
      return;
    }
    setCancelling(true);
    try {
      // LIFF（LINE内ブラウザ）は Supabase セッション Cookie を持たないため、予約取得と同じく
      // LINE access token を Bearer で送って本人認証する（無いと cancel API が常に 401）。
      const res = await fetch(`/api/booking/${booking.id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${liff.accessToken}` },
      });
      if (res.ok) {
        // 応答の cancelFee はキャンセルを受け付けたトランザクションで確定した額（お客様宛メールと同じ）。
        const data = await res.json().catch(() => null);
        setReceipt(describeConfirmedCancelFee(data?.cancelFee));
        setResult('success');
      } else {
        const data = await res.json().catch(() => null);
        setErrorMsg(data?.error ?? 'キャンセルに失敗しました');
        setResult('error');
      }
    } catch {
      setErrorMsg('キャンセルに失敗しました');
      setResult('error');
    } finally {
      setCancelling(false);
    }
  }, [booking, cancelling, liff, estimateAt]);

  if (liff.status === 'loading') return <LiffLoading />;
  if (liff.status === 'error') return <LiffError message={liff.message} />;
  if (liff.status === 'not_linked') return <LiffNotLinked />;
  if (loadError) return <LiffError message="予約情報の取得に失敗しました。時間をおいて再度お試しください。" />;

  if (result === 'success') {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="text-center space-y-4">
          <p className="text-4xl">✅</p>
          <p className="font-bold text-gray-900">キャンセルが完了しました</p>
          {receipt && <p role="status" className="text-sm text-gray-700">{receipt}</p>}
          <Link href="/liff/bookings" className="inline-block bg-sky-500 text-white px-6 py-2.5 rounded-full text-sm font-bold">予約一覧へ</Link>
        </div>
      </div>
    );
  }

  if (result === 'error') {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="text-center space-y-4">
          <p className="text-4xl">❌</p>
          <p className="font-bold text-gray-900">エラーが発生しました</p>
          <p className="text-sm text-gray-500">{errorMsg}</p>
          <button type="button" onClick={() => setResult(null)} className="bg-gray-100 text-gray-700 px-6 py-2.5 rounded-full text-sm font-bold">戻る</button>
        </div>
      </div>
    );
  }

  // 開始時刻を過ぎた予約はキャンセル API が必ず断る（BOOKING_ALREADY_STARTED）。ネットでのキャンセル不可の店舗も同じ。
  const contactMessage = !booking || !canCustomerCancelBooking(booking.status) ? null
    : hasBookingStarted(booking.booking_date, booking.start_time, estimateAt) ? BOOKING_STARTED_CONTACT_MESSAGE
    : booking.online_cancel_allowed === false ? ONLINE_CANCEL_DISABLED_MESSAGE : null;

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-lg font-bold text-gray-900 mb-4">予約キャンセル</h1>

      {!bookingId ? (
        <div className="text-center py-12">
          <p className="text-gray-500 text-sm">キャンセルする予約を、予約一覧から選んでください。</p>
          <Link href="/liff/bookings" className="mt-4 inline-block text-sky-700 text-sm">予約一覧へ</Link>
        </div>
      ) : loading ? (
        <div className="text-center py-12 text-gray-500 text-sm">読み込み中...</div>
      ) : !booking ? (
        <div className="text-center py-12 text-gray-500 text-sm">予約が見つかりません</div>
      ) : (
        <>
          <div className="bg-white rounded-2xl shadow-xs p-5 mb-6">
            <p className="text-sm font-bold text-gray-900">{booking.facility_profiles?.name ?? '施設'}</p>
            <p className="text-sm text-gray-600 mt-1">{booking.menu_name ?? '施術'}</p>
            <div className="flex items-center gap-3 mt-3 text-sm text-gray-500">
              <span>📅 {booking.booking_date}</span>
              <span>🕐 {booking.start_time?.slice(0, 5)}</span>
            </div>
          </div>

          {contactMessage ? (
            // 開始時刻を過ぎた予約・ネットでのキャンセル不可の店舗は、ボタンを出しても API が必ず断るので、
            // 押す前に店舗への連絡を、電話番号と店舗ページと一緒にご案内する。
            <div className="space-y-3">
              <ShopContactNotice message={contactMessage} phone={booking.facility_contact?.phone} slug={booking.facility_contact?.slug} />
              <Link href="/liff/bookings" className="block text-center text-sm text-gray-500 py-2">戻る</Link>
            </div>
          ) : canCustomerCancelBooking(booking.status) ? (
            <div className="space-y-3">
              <div role="status" className="bg-red-50 rounded-xl p-4 text-sm text-red-700">
                {estimateChanged && 'キャンセル料の条件が変わりました。内容をご確認ください。'}
                キャンセルすると元に戻せません。{feeEstimate(booking, estimateAt)}
              </div>
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="w-full py-3 bg-red-500 text-white rounded-2xl font-bold disabled:opacity-50"
              >
                {cancelling ? 'キャンセル中...' : 'この予約をキャンセルする'}
              </button>
              <Link href="/liff/bookings" className="block text-center text-sm text-gray-500 py-2">戻る</Link>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500 text-sm">
              この予約はキャンセルできません（ステータス: {booking.status}）
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function LiffCancelPage() {
  return (
    <Suspense fallback={<LiffLoading />}>
      <CancelContent />
    </Suspense>
  );
}
