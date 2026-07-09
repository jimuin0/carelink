'use client';

import { useState, useEffect } from 'react';

interface Props {
  businessHours: Record<string, { open: string; close: string } | null> | null;
  regularHoliday?: string | null;
}

/**
 * 当日の営業時間と現在時刻(HH:MM)から営業状態を判定する純粋関数（TZ非依存・テスト容易化のため分離）。
 * close <= open は翌日にまたぐ深夜営業（例 20:00→翌02:00）。この場合 open〜24:00 と 00:00〜close の
 * 2区間が営業時間になるため、単純な「open<=t<close」だと常に closed になる。OR 判定でラップアラウンドを扱う。
 */
export function computeBusinessStatus(
  currentTime: string,
  todayHours: { open: string; close: string } | null | undefined,
): 'open' | 'closed' | 'holiday' {
  if (!todayHours) return 'holiday';
  const { open, close } = todayHours;
  const isOpen = close > open
    ? currentTime >= open && currentTime < close
    : currentTime >= open || currentTime < close; // 深夜営業（翌日跨ぎ）
  return isOpen ? 'open' : 'closed';
}

export default function BusinessStatusBadge({ businessHours }: Props) {
  // 現在時刻(new Date())は SSR ではサーバのタイムゾーン(通常UTC)、クライアントでは閲覧者の
  // ローカル時刻(日本ならJST)で評価されるため、描画中に判定するとサーバHTMLとクライアント描画で
  // 営業状態テキスト(営業中/営業時間外/定休日)が食い違い hydration mismatch を起こす。判定は
  // マウント後(クライアントのみ=閲覧者のローカル時刻)に確定し、初期描画は null にして一致させる。
  const [status, setStatus] = useState<'open' | 'closed' | 'holiday' | 'unknown' | null>(null);

  useEffect(() => {
    if (!businessHours) { setStatus('unknown'); return; }
    const now = new Date();
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const today = days[now.getDay()];
    const todayHours = businessHours[today];

    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentTime = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;

    setStatus(computeBusinessStatus(currentTime, todayHours));
  }, [businessHours]);

  if (status === null || status === 'unknown') return null;

  const config = {
    open: { text: '営業中', className: 'bg-emerald-100 text-emerald-700' },
    closed: { text: '営業時間外', className: 'bg-gray-100 text-gray-500' },
    holiday: { text: '定休日', className: 'bg-red-50 text-red-500' },
  };

  const { text, className } = config[status];

  return (
    <span role="status" className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${status === 'open' ? 'bg-emerald-500' : status === 'holiday' ? 'bg-red-400' : 'bg-gray-400'}`} />
      {text}
    </span>
  );
}
