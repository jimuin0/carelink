'use client';

import { useSyncExternalStore } from 'react';
import { businessMinute, businessPeriods, businessWindows, periodWindow, type BusinessDay } from '@/lib/business-hours';

interface Props {
  businessHours: Record<string, BusinessDay | null> | null;
  regularHoliday?: string | null;
}

/**
 * 当日の営業時間と現在時刻(HH:MM)から営業状態を判定する純粋関数（TZ非依存・テスト容易化のため分離）。
 * close <= open は翌日にまたぐ深夜営業（例 20:00→翌02:00）。この場合 open〜24:00 と 00:00〜close の
 * 2区間が営業時間になるため、単純な「open<=t<close」だと常に closed になる。OR 判定でラップアラウンドを扱う。
 */
export function computeBusinessStatus(
  currentTime: string,
  todayHours: BusinessDay | null | undefined,
): 'open' | 'closed' | 'holiday' {
  if (!todayHours) return 'holiday';
  const minute = businessMinute(currentTime);
  const isOpen = minute !== null && (businessPeriods(todayHours) ?? []).some(period => {
    const window = periodWindow(period)!;
    return window.end > 1440 ? minute >= window.start || minute < window.end - 1440
      : minute >= window.start && minute < window.end;
  });
  return isOpen ? 'open' : 'closed';
}

/** A public badge needs confirmed periods; missing legacy day data is not proof of opening. */
export function computeCalendarBusinessStatus(businessHours: Props['businessHours'], timestamp: number): 'open' | 'closed' | 'holiday' | 'unknown' {
  if (!businessHours) return 'unknown';
  const now = new Date(timestamp + 9 * 3_600_000);
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const today = days[now.getUTCDay()];
  const todayHours = businessHours[today];
  const periods = businessPeriods(todayHours);
  // Availability keeps an unrestricted legacy fallback. A badge must not turn
  // missing/invalid hours into a positive claim that a shop is open all day.
  const windows = businessWindows({ ...businessHours, [today]: periods === null ? null : todayHours }, now.getUTCDay());
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (windows.some(window => minute >= window.start && minute < window.end)) return 'open';
  if (periods === null) return 'unknown';
  return todayHours ? 'closed' : 'holiday';
}

// 時刻の境界をまたいだ画面も更新する。通信やサーバー側の定期実行は使わない。
function subscribeClock(onChange: () => void) {
  const timer = setInterval(onChange, 30_000);
  return () => clearInterval(timer);
}

function getServerStatusSnapshot(): 'open' | 'closed' | 'holiday' | 'unknown' {
  return 'unknown';
}

export default function BusinessStatusBadge({ businessHours }: Props) {
  // 現在時刻(new Date())は SSR ではサーバのタイムゾーン(通常UTC)、クライアントでは閲覧者の
  // ローカル時刻(日本ならJST)で評価されるため、描画中に判定するとサーバHTMLとクライアント描画で
  // 営業状態テキスト(営業中/営業時間外/定休日)が食い違い hydration mismatch を起こす。
  // 従来は useEffect + setState でマウント後(クライアントのみ)に確定していたが、React Compiler の
  // set-state-in-effect に検出されるため、React公式が「サーバ/クライアントで異なる値を安全に
  // 出し分ける」ために用意している useSyncExternalStore（getServerSnapshot 引数）に置き換える。
  // 判定結果は 'open'|'closed'|'holiday'|'unknown' という文字列（プリミティブ値）なので、
  // getSnapshot が呼び出しごとに新しい値を返しても参照比較(Object.is)は値で一致し、
  // 無限再レンダーの心配はない。
  const status = useSyncExternalStore(
    subscribeClock,
    () => computeCalendarBusinessStatus(businessHours, Date.now()),
    getServerStatusSnapshot,
  );

  if (status === 'unknown') return null;

  const config = {
    open: { text: '営業中', className: 'bg-emerald-100 text-emerald-700' },
    closed: { text: '営業時間外', className: 'bg-gray-100 text-gray-600' },
    holiday: { text: '定休日', className: 'bg-red-50 text-red-700' },
  };

  const { text, className } = config[status];

  return (
    <span role="status" className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full ${status === 'open' ? 'bg-emerald-500' : status === 'holiday' ? 'bg-red-400' : 'bg-gray-400'}`} />
      {text}
    </span>
  );
}
