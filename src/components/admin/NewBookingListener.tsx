'use client';

import { useEffect, useState } from 'react';
import { NEW_BOOKING_POLL_INTERVAL_MS, initialSince, serverMountTime, sinceAfter, takeUnseen, type NewBookingNotice } from '@/lib/new-booking-poll';

type Problem = 'signed-out' | 'forbidden' | 'failed' | null;

const PROBLEM_TEXT: Record<Exclude<Problem, null>, string> = {
  'signed-out': 'ログインが切れたため、新規予約の確認を止めました。再ログインしてください。',
  forbidden: 'この店舗の予約を確認する権限がないため、新規予約の確認を止めました。',
  failed: '新規予約を確認できませんでした。自動で再試行しています。',
};

/**
 * 管理画面を開いている間、選択中の店舗の新しい予約を確認して右上に知らせる。
 * 通常表示中は 1 分ごと、画面に戻った時と通信が戻った時はすぐに確認する。
 * 確認できなかった時は「新規予約なし」と扱わず、その旨を表示する。
 * 店舗を切り替えると親が key を変えて作り直すので、前の店舗の通知・通信はここで破棄される。
 */
export default function NewBookingListener({ facilityId }: { facilityId: string }) {
  const [notices, setNotices] = useState<NewBookingNotice[]>([]);
  const [problem, setProblem] = useState<Problem>(null);

  useEffect(() => {
    const seen = new Set<string>();
    const mountedAt = Date.now();
    // 画面を開いた時刻（サーバーの時計）。これより前に作られた予約は「開く前からあった」ものとして通知しない。
    let mountedAtServer: number | null = null;
    let since: string = initialSince(mountedAt);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: AbortController | null = null;

    const schedule = (delay = NEW_BOOKING_POLL_INTERVAL_MS) => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(() => void check(), delay);
    };

    const check = async () => {
      if (stopped || inFlight) return;
      if (document.visibilityState !== 'visible') { schedule(); return; }
      const controller = new AbortController();
      inFlight = controller;
      let more = false;
      try {
        const query = new URLSearchParams({ facility_id: facilityId, since });
        const res = await fetch(`/api/admin/bookings/recent?${query}`, { cache: 'no-store', signal: controller.signal });
        if (stopped) return;
        if (res.status === 401 || res.status === 403) {
          stopped = true;
          setProblem(res.status === 401 ? 'signed-out' : 'forbidden');
          return;
        }
        const body = res.ok ? await res.json().catch(() => null) : null;
        if (stopped) return;
        if (!body || typeof body.now !== 'string' || !Array.isArray(body.bookings) || typeof body.more !== 'boolean') { setProblem('failed'); return; }
        mountedAtServer ??= serverMountTime(mountedAt, body.now, Date.now());
        const after = mountedAtServer;
        const fresh = takeUnseen(body.bookings as NewBookingNotice[], seen)
          .filter(row => Date.parse(row.created_at) >= after);
        if (fresh.length > 0) setNotices(prev => [...fresh.reverse(), ...prev].slice(0, 5));
        since = sinceAfter(body, since);
        more = body.more;
        setProblem(null);
      } catch {
        if (!stopped) setProblem('failed');
      } finally {
        if (inFlight === controller) inFlight = null;
        // 上限で切れていたら、読んでいない予約が窓から外れる前に続きをすぐ読む。
        schedule(more ? 0 : NEW_BOOKING_POLL_INTERVAL_MS);
      }
    };

    const checkNow = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', checkNow);
    window.addEventListener('online', checkNow);
    void check();

    return () => {
      stopped = true;
      clearTimeout(timer);
      inFlight?.abort();
      document.removeEventListener('visibilitychange', checkNow);
      window.removeEventListener('online', checkNow);
    };
  }, [facilityId]);

  if (notices.length === 0 && problem === null) return null;

  return (
    <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm" aria-live="polite">
      {problem && (
        <div role="status" className="bg-white border-l-4 border-amber-500 shadow-lg rounded-lg p-4">
          <p className="text-xs text-gray-700">{PROBLEM_TEXT[problem]}</p>
        </div>
      )}
      {notices.map((b) => (
        <div
          key={b.id}
          className="bg-white border-l-4 border-sky-500 shadow-lg rounded-lg p-4 animate-slide-in-right"
        >
          <p className="text-sm font-bold text-gray-800">新規予約</p>
          <p className="text-xs text-gray-600 mt-1">
            {b.customer_name}様 {b.booking_date} {b.start_time.slice(0, 5)}〜
          </p>
        </div>
      ))}
    </div>
  );
}
