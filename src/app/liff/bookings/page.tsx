'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import { useLiff } from '@/hooks/useLiff';
import LiffNotLinked from '@/components/liff/LiffNotLinked';
import { statusChipClass, bookingStatusLabel, canCustomerCancelBooking } from '@/lib/booking-status';

type Booking = {
  id: string;
  booking_date: string;
  end_date?: string | null;
  start_time: string;
  end_time: string;
  status: string;
  menu_name: string | null;
  total_price: number | null;
  facility_profiles?: { name: string } | null;
};

export default function LiffBookingsPage() {
  const liff = useLiff();
  const [bookings, setBookings] = useState<Booking[]>([]);
  // liff.status は 'loading' から 'ready' へ一度だけ遷移する（useLiff 参照）ため、
  // この effect は最大1回しか走らない。「読み込み中」の初期値を state の初期値に
  // 持たせることで、effect 内の同期 setState（React Compiler の
  // set-state-in-effect 違反＝カスケードレンダリングの原因）を無くす。
  // 旧実装は初期値 false のまま liff.status==='ready' の初回描画を一瞬挟んでから
  // setLoading(true) していたため、実際には「予約はありません」が一瞬見えてから
  // スピナーに切り替わるカスケードが起きていた（本修正で解消・表示内容自体は不変）。
  const [loading, setLoading] = useState(true);
  // 取得失敗を握り潰すと「予約はありません」と障害が区別不能になるため明示する
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (liff.status !== 'ready') return;
    fetch('/api/liff/bookings', {
        headers: { Authorization: `Bearer ${liff.accessToken}` },
      })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { setBookings(d.bookings || []); setLoading(false); })
      .catch(() => { setLoadError(true); setLoading(false); });
  }, [liff]);

  if (liff.status === 'loading') {
    return <LiffLoading />;
  }
  if (liff.status === 'error') {
    return <LiffError message={liff.message} />;
  }
  if (liff.status === 'not_linked') {
    return <LiffNotLinked />;
  }
  if (loadError) {
    return <LiffError message="予約情報の取得に失敗しました。時間をおいて再度お試しください。" />;
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-lg font-bold text-gray-900 mb-4">予約確認</h1>

      {loading ? (
        <div className="text-center py-12 text-gray-500 text-sm">読み込み中...</div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-500 text-sm">予約はありません</p>
          <Button
            href="/search"
            prefetch="auto"
            className="mt-4"
          >
            施設を探す
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => {
            const facilityName = b.facility_profiles?.name ?? '';
            return (
              <div key={b.id} className="bg-white rounded-2xl shadow-xs p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusChipClass(b.status)}`}>
                    {bookingStatusLabel(b.status)}
                  </span>
                  <span className="text-xs text-gray-500">{b.booking_date}</span>
                </div>
                {facilityName && (
                  <p className="text-sm font-bold text-gray-900">{facilityName}</p>
                )}
                <p className="text-sm text-gray-600 mt-0.5">{b.menu_name ?? '施術'}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-gray-500">
                    {b.start_time?.slice(0, 5)}〜{b.end_date && b.end_date !== b.booking_date ? '翌' : ''}{b.end_time?.slice(0, 5)}
                  </span>
                  {b.total_price != null && (
                    <span className="text-sm font-bold text-sky-700">¥{b.total_price.toLocaleString()}</span>
                  )}
                </div>
                {/* リッチメニューの「キャンセル」は予約を指定せずに /liff/cancel を開き、そこから一覧へ戻る。
                    以前は一覧の予約が選べず（リンクが無く）、キャンセルにたどり着けなかった。
                    開始後・ネットでのキャンセル不可の予約は、キャンセル画面が店舗の連絡先を案内する。 */}
                {canCustomerCancelBooking(b.status) && (
                  <Link
                    href={`/liff/cancel?booking_id=${encodeURIComponent(b.id)}`}
                    className="mt-3 block rounded-lg border border-gray-200 py-2 text-center text-sm font-bold text-red-700 hover:bg-red-50"
                  >
                    キャンセル手続きへ
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LiffLoading() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-sky-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-gray-500">読み込み中...</p>
      </div>
    </div>
  );
}

function LiffError({ message }: { message: string }) {
  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="text-center">
        <p role="alert" className="text-red-600 text-sm">{message}</p>
      </div>
    </div>
  );
}
