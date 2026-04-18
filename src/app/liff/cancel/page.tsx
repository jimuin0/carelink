'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { useLiff } from '@/hooks/useLiff';

type Booking = {
  id: string;
  booking_date: string;
  start_time: string;
  menu_name: string | null;
  status: string;
  facility_profiles?: { name: string } | null;
};

function LiffLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto" />
    </div>
  );
}
function LiffError({ message }: { message: string }) {
  return <div className="flex items-center justify-center min-h-screen p-4"><p role="alert" className="text-red-500 text-sm">{message}</p></div>;
}
function LiffNotLinked() {
  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="text-center space-y-4">
        <p className="text-2xl">🔗</p>
        <p className="font-bold text-gray-900">LINE連携が必要です</p>
        <a href="/mypage/settings" className="inline-block bg-[#06C755] text-white px-6 py-2.5 rounded-full text-sm font-bold">設定ページへ</a>
      </div>
    </div>
  );
}

function CancelContent() {
  const liff = useLiff();
  const searchParams = useSearchParams();
  const bookingId = searchParams.get('booking_id');

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [result, setResult] = useState<'success' | 'error' | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (liff.status !== 'ready' || !bookingId) return;
    setLoading(true);
    fetch(`/api/liff/bookings?booking_id=${bookingId}`, {
        headers: { Authorization: `Bearer ${liff.accessToken}` },
      })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { setBooking(d.booking ?? null); setLoading(false); })
      .catch(() => setLoading(false));
  }, [liff, bookingId]);

  const handleCancel = useCallback(async () => {
    if (!booking || cancelling) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/booking/${booking.id}/cancel`, { method: 'POST' });
      if (res.ok) {
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
  }, [booking, cancelling]);

  if (liff.status === 'loading') return <LiffLoading />;
  if (liff.status === 'error') return <LiffError message={liff.message} />;
  if (liff.status === 'not_linked') return <LiffNotLinked />;

  if (result === 'success') {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="text-center space-y-4">
          <p className="text-4xl">✅</p>
          <p className="font-bold text-gray-900">キャンセルが完了しました</p>
          <a href="/liff/bookings" className="inline-block bg-sky-500 text-white px-6 py-2.5 rounded-full text-sm font-bold">予約一覧へ</a>
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

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-lg font-bold text-gray-900 mb-4">予約キャンセル</h1>

      {!bookingId ? (
        <div className="text-center py-12">
          <p className="text-gray-400 text-sm">予約IDが指定されていません</p>
          <a href="/liff/bookings" className="mt-4 inline-block text-sky-500 text-sm">予約一覧から選択する</a>
        </div>
      ) : loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">読み込み中...</div>
      ) : !booking ? (
        <div className="text-center py-12 text-gray-400 text-sm">予約が見つかりません</div>
      ) : (
        <>
          <div className="bg-white rounded-2xl shadow-sm p-5 mb-6">
            <p className="text-sm font-bold text-gray-900">{booking.facility_profiles?.name ?? '施設'}</p>
            <p className="text-sm text-gray-600 mt-1">{booking.menu_name ?? '施術'}</p>
            <div className="flex items-center gap-3 mt-3 text-sm text-gray-500">
              <span>📅 {booking.booking_date}</span>
              <span>🕐 {booking.start_time?.slice(0, 5)}</span>
            </div>
          </div>

          {['pending', 'confirmed'].includes(booking.status) ? (
            <div className="space-y-3">
              <div className="bg-red-50 rounded-xl p-4 text-sm text-red-700">
                キャンセルすると元に戻せません。キャンセルポリシーによってはキャンセル料が発生する場合があります。
              </div>
              <button
                type="button"
                onClick={handleCancel}
                disabled={cancelling}
                className="w-full py-3 bg-red-500 text-white rounded-2xl font-bold disabled:opacity-50"
              >
                {cancelling ? 'キャンセル中...' : 'この予約をキャンセルする'}
              </button>
              <a href="/liff/bookings" className="block text-center text-sm text-gray-400 py-2">戻る</a>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400 text-sm">
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
