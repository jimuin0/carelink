'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLiff } from '@/hooks/useLiff';

type Booking = {
  id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  status: string;
  menu_name: string | null;
  total_price: number | null;
  facility_profiles?: { name: string } | null;
};

const statusLabel: Record<string, { label: string; color: string }> = {
  pending: { label: '確認待ち', color: 'text-yellow-600 bg-yellow-50' },
  confirmed: { label: '確定', color: 'text-green-600 bg-green-50' },
  completed: { label: '完了', color: 'text-gray-500 bg-gray-50' },
  cancelled: { label: 'キャンセル', color: 'text-red-500 bg-red-50' },
  cancel_fee_paid: { label: 'キャンセル料支払済', color: 'text-orange-600 bg-orange-50' },
};

export default function LiffBookingsPage() {
  const liff = useLiff();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (liff.status !== 'ready') return;
    setLoading(true);
    fetch('/api/liff/bookings', {
        headers: { Authorization: `Bearer ${liff.accessToken}` },
      })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => { setBookings(d.bookings || []); setLoading(false); })
      .catch(() => setLoading(false));
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

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h1 className="text-lg font-bold text-gray-900 mb-4">予約確認</h1>

      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">読み込み中...</div>
      ) : bookings.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-400 text-sm">予約はありません</p>
          <Link
            href="/search"
            className="mt-4 inline-block bg-sky-500 text-white px-6 py-2.5 rounded-full text-sm font-bold"
          >
            施設を探す
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => {
            const s = statusLabel[b.status] ?? statusLabel.pending;
            const facilityName = b.facility_profiles?.name ?? '';
            return (
              <div key={b.id} className="bg-white rounded-2xl shadow-sm p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.color}`}>
                    {s.label}
                  </span>
                  <span className="text-xs text-gray-400">{b.booking_date}</span>
                </div>
                {facilityName && (
                  <p className="text-sm font-bold text-gray-900">{facilityName}</p>
                )}
                <p className="text-sm text-gray-600 mt-0.5">{b.menu_name ?? '施術'}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-gray-400">
                    {b.start_time?.slice(0, 5)}〜{b.end_time?.slice(0, 5)}
                  </span>
                  {b.total_price != null && (
                    <span className="text-sm font-bold text-sky-600">¥{b.total_price.toLocaleString()}</span>
                  )}
                </div>
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
        <p role="alert" className="text-red-500 text-sm">{message}</p>
      </div>
    </div>
  );
}

function LiffNotLinked() {
  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <div className="text-center space-y-4">
        <p className="text-2xl">🔗</p>
        <p className="font-bold text-gray-900">LINE連携が必要です</p>
        <p className="text-sm text-gray-500">CareLinkアカウントとLINEを連携するには、マイページの設定から行ってください。</p>
        <Link
          href="/mypage/settings"
          className="inline-block bg-[#06C755] text-white px-6 py-2.5 rounded-full text-sm font-bold"
        >
          設定ページへ
        </Link>
      </div>
    </div>
  );
}
