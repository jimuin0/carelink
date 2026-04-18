'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface GroupInfo {
  group: {
    id: string;
    share_code: string;
    booking_date: string;
    start_time: string;
    end_time: string;
    total_members: number;
    confirmed_members: number;
    status: string;
    facility_profiles: { name: string; slug: string } | null;
    facility_menus: { name: string; price: number | null } | null;
  };
  members: { id: string; guest_name: string | null; status: string; is_organizer: boolean }[];
}

export default function JoinGroupBookingPage({ params }: { params: { code: string } }) {
  const router = useRouter();
  const [info, setInfo] = useState<GroupInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    fetch(`/api/group-booking?code=${encodeURIComponent(params.code)}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data) => {
        if (data.error) setError(data.error);
        else setInfo(data);
      })
      .catch(() => setError('読み込みに失敗しました'))
      .finally(() => setLoading(false));
  }, [params.code]);

  const handleJoin = async () => {
    setJoining(true);
    try {
      const res = await fetch('/api/group-booking/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ share_code: params.code }),
      });
      const data = await res.json();
      if (res.status === 401) {
        router.push(`/auth/login?next=/group-booking/join/${params.code}`);
        return;
      }
      if (!res.ok) { setError(data.error || '参加に失敗しました'); return; }
      setJoined(true);
    } catch {
      setError('参加に失敗しました');
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse space-y-4 w-full max-w-md px-4">
          <div className="h-8 bg-gray-200 rounded w-2/3 mx-auto" />
          <div className="h-40 bg-gray-200 rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-sm p-8 max-w-md w-full text-center">
          <p className="text-2xl mb-3">😕</p>
          <p className="font-bold text-gray-800 mb-2">予約が見つかりません</p>
          <p className="text-sm text-gray-500 mb-6">{error}</p>
          <Link href="/" className="px-5 py-2.5 bg-sky-500 text-white rounded-xl text-sm font-bold">
            トップへ戻る
          </Link>
        </div>
      </div>
    );
  }

  if (!info) return null;

  const facility = Array.isArray(info.group.facility_profiles) ? info.group.facility_profiles[0] : info.group.facility_profiles;
  const menu = Array.isArray(info.group.facility_menus) ? info.group.facility_menus[0] : info.group.facility_menus;
  const confirmedCount = info.members.filter((m) => m.status === 'confirmed').length;
  const spotsLeft = info.group.total_members - confirmedCount;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="bg-white rounded-2xl shadow-sm p-8 max-w-md w-full">
        {joined ? (
          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">グループに参加しました！</h1>
            <p className="text-sm text-gray-500 mb-6">予約の詳細はマイページから確認できます。</p>
            <Link href="/mypage/bookings" className="block w-full py-3 bg-sky-500 text-white rounded-xl font-bold text-center hover:bg-sky-600 transition-colors">
              マイページで確認する
            </Link>
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-sky-100 text-sky-700 mb-3">
                グループ予約招待
              </span>
              <h1 className="text-xl font-bold text-gray-900">{facility?.name ?? '施設'}</h1>
            </div>

            <div className="bg-gray-50 rounded-xl p-5 space-y-3 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">日付</span>
                <span className="font-medium">
                  {new Date(info.group.booking_date).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">時間</span>
                <span className="font-medium">{info.group.start_time.slice(0, 5)}〜{info.group.end_time.slice(0, 5)}</span>
              </div>
              {menu && (
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">メニュー</span>
                  <span className="font-medium">{menu.name}{menu.price !== null && ` ¥${menu.price.toLocaleString()}`}</span>
                </div>
              )}
              <div className="flex justify-between text-sm border-t pt-3">
                <span className="text-gray-500">参加状況</span>
                <span className="font-medium text-sky-600">{confirmedCount} / {info.group.total_members}名 参加済み</span>
              </div>
              {spotsLeft > 0 && (
                <p className="text-xs text-amber-600 text-right">残り{spotsLeft}名</p>
              )}
            </div>

            <div className="space-y-2 mb-6">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">参加メンバー ({confirmedCount}名)</p>
              {info.members.filter((m) => m.status === 'confirmed').map((m, i) => (
                <div key={m.id} className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="w-7 h-7 rounded-full bg-sky-100 text-sky-700 text-xs font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  {m.is_organizer ? '主催者' : m.guest_name ?? 'メンバー'}
                  {m.is_organizer && <span className="text-xs text-sky-500 font-medium">（主催）</span>}
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={handleJoin}
              disabled={joining || spotsLeft <= 0}
              className="w-full py-3 bg-sky-500 text-white rounded-xl font-bold hover:bg-sky-600 disabled:opacity-50 transition-colors"
            >
              {joining ? '参加中...' : spotsLeft <= 0 ? '満員です' : 'このグループに参加する'}
            </button>
            <p className="text-xs text-gray-400 text-center mt-3">参加にはCareLinKアカウントが必要です</p>
          </>
        )}
      </div>
    </div>
  );
}
