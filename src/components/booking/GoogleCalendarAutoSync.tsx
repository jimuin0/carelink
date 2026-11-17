'use client';

import { useEffect, useRef, useState } from 'react';
import { UUID_REGEX } from '@/lib/constants';
import { beginStaffOperation, finishStaffOperation } from '@/lib/staff-operation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

type State = 'idle' | 'syncing' | 'done' | 'failed';

/**
 * 予約完了画面で、Google カレンダーと連携済みのお客様だけ予約を自動で同期する（本人決定・2026年11月18日）。
 * 連携していない方・連携が切れている方には何もしない（同意のないカレンダーへは書けない）。
 * 操作 ID は予約詳細の「Googleカレンダーに同期」ボタンと同じキーで持つので、
 * 結果が分からなかったときは詳細画面のボタンが同じ操作として結果を確かめ直せる（二重登録しない）。
 */
export default function GoogleCalendarAutoSync({ bookingId }: { bookingId: string }) {
  const [state, setState] = useState<State>('idle');
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !UUID_REGEX.test(bookingId)) return;
    started.current = true;
    let active = true;
    (async () => {
      try {
        const status = await fetch('/api/google-calendar', { cache: 'no-store' });
        if (!status.ok) return;
        const connection = await status.json();
        if (!connection?.connected || connection.isExpired) return;
        const { data: { user } } = await createBrowserSupabaseClient().auth.getUser();
        if (!user) return;
        if (active) setState('syncing');
        const key = `carelink-calendar-operation:${user.id}:${bookingId}:sync`;
        const operationId = beginStaffOperation(key);
        const res = await fetch('/api/google-calendar/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bookingId, operationId }),
          signal: AbortSignal.timeout(30000),
        });
        const outcome = await res.json().catch(() => null);
        if (res.ok && outcome?.ok === true && outcome.operationId === operationId) {
          finishStaffOperation(key);
          if (active) setState('done');
        } else {
          if (outcome?.code === 'CALENDAR_BUSY' && typeof outcome.pendingOperationId === 'string' && UUID_REGEX.test(outcome.pendingOperationId)) {
            sessionStorage.setItem(key, outcome.pendingOperationId);
          }
          if (active) setState('failed');
        }
      } catch {
        if (active) setState((prev) => (prev === 'syncing' ? 'failed' : prev));
      }
    })();
    return () => { active = false; };
  }, [bookingId]);

  if (state === 'idle') return null;
  return (
    <p role="status" className={`text-xs ${state === 'failed' ? 'text-red-600' : 'text-gray-500'}`}>
      {state === 'syncing' && 'Googleカレンダーに登録しています…'}
      {state === 'done' && 'Googleカレンダーに登録しました。'}
      {state === 'failed' && 'Googleカレンダーへの登録を確認できませんでした。予約履歴の詳細から「Googleカレンダーに同期」を押してください。'}
    </p>
  );
}
