'use client';

/**
 * 指名スタッフの「指名登録」／「指名を解除」ボタン（2026年10月22日 新設）。
 *
 * マイページの「指名スタッフ」は「施設のスタッフページから指名登録できます」と案内していたのに、
 * そのボタンがどこにも無かった。スタッフ詳細とスタッフ一覧のカードにこのボタンを置く。
 *
 * - 状態の読み取り（自分が指名済みか）は Provider が 1 回だけ行う。一覧のカードごとに
 *   ログイン確認と問い合わせを走らせないため。
 * - 書き込みは必ず /api/preferred-staff を通す（公開施設の在籍スタッフかをサーバーで確かめるため）。
 * - 未ログインならログイン画面へ、戻り先として今のページを渡す。
 * - ログイン状態や指名状態を確かめられない時は、「未登録」と決めつけず押せない表示にする。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Link from '@/components/BrowseLink';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { verifyAuthUser } from '@/lib/auth-verification';
import { readAuthorization } from '@/lib/authorization-read';

type Status = 'loading' | 'guest' | 'ready' | 'unavailable';

interface PreferredStaffStore {
  status: Status;
  nominated: ReadonlySet<string>;
  setNominated: (staffId: string, value: boolean) => void;
}

const PreferredStaffContext = createContext<PreferredStaffStore | null>(null);

export function PreferredStaffProvider({ staffIds, children }: { staffIds: string[]; children: ReactNode }) {
  const idsKey = staffIds.join(',');
  const [status, setStatus] = useState<Status>('loading');
  const [nominated, setNominatedIds] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    let active = true;
    const ids = idsKey ? idsKey.split(',') : [];
    (async () => {
      const supabase = createBrowserSupabaseClient();
      const identity = await verifyAuthUser(supabase.auth);
      if (!active) return;
      if (identity.state === 'unavailable') throw new Error('identity unavailable');
      if (identity.state === 'unauthenticated') { setStatus('guest'); return; }
      // 読めなかった＝「未登録」ではない。失敗は押せない表示にする。
      const { data, error } = await readAuthorization(supabase
        .from('user_preferred_staff')
        .select('staff_id')
        .eq('user_id', identity.user.id)
        .in('staff_id', ids));
      if (!active) return;
      if (error || !Array.isArray(data)) throw new Error('preferred staff state unavailable');
      setNominatedIds(new Set(data.map((row) => row.staff_id)));
      setStatus('ready');
    })().catch(() => { if (active) setStatus('unavailable'); });
    return () => { active = false; };
  }, [idsKey]);

  const setNominated = useCallback((staffId: string, value: boolean) => {
    setNominatedIds((prev) => {
      const next = new Set(prev);
      if (value) next.add(staffId);
      else next.delete(staffId);
      return next;
    });
  }, []);

  const store = useMemo(() => ({ status, nominated, setNominated }), [status, nominated, setNominated]);
  return <PreferredStaffContext.Provider value={store}>{children}</PreferredStaffContext.Provider>;
}

type Variant = 'detail' | 'card';

const BUTTON_BASE = 'inline-flex items-center justify-center rounded-full font-bold transition-colors disabled:cursor-not-allowed';
const SIZE: Record<Variant, string> = {
  detail: 'min-h-[44px] px-5 text-sm',
  card: 'min-h-[32px] w-full px-3 text-xs',
};
const FILLED = 'bg-sky-700 text-white hover:bg-sky-800 disabled:opacity-60';
const OUTLINED = 'border border-sky-700 bg-white text-sky-700 hover:bg-sky-50 disabled:opacity-60';
const MUTED = 'border border-gray-300 bg-white text-gray-600';

export default function PreferredStaffButton({ staffId, staffName, variant = 'detail' }: {
  staffId: string;
  staffName: string;
  variant?: Variant;
}) {
  const store = useContext(PreferredStaffContext);
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string; registered?: boolean } | null>(null);
  const inFlight = useRef(false);

  if (!store) return null;
  const who = `（${staffName}さん）`;
  const size = SIZE[variant];

  if (store.status === 'guest') {
    return (
      <Link
        href={`/auth/login?redirect=${encodeURIComponent(pathname)}`}
        className={`${BUTTON_BASE} ${size} ${OUTLINED}`}
        aria-label={`ログインして指名登録${who}`}
      >
        ログインして指名登録
      </Link>
    );
  }

  if (store.status !== 'ready') {
    const unavailable = store.status === 'unavailable';
    return (
      <button
        type="button"
        disabled
        className={`${BUTTON_BASE} ${size} ${MUTED}`}
        aria-label={unavailable ? `指名の状態を確認できません${who}` : `指名の状態を確認しています${who}`}
        title={unavailable ? 'ページを再読み込みしてください' : undefined}
      >
        {unavailable ? '指名の状態を確認できません' : '指名登録'}
      </button>
    );
  }

  const isNominated = store.nominated.has(staffId);
  const label = isNominated ? '指名を解除' : '指名登録';

  const toggle = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setMessage(null);
    const next = !isNominated;
    try {
      const res = await fetch('/api/preferred-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId, nominated: next }),
        signal: AbortSignal.timeout(10000),
      });
      const body: unknown = await res.json().catch(() => null);
      const record = body !== null && typeof body === 'object' ? body as Record<string, unknown> : {};
      if (res.ok && record.nominated === next) {
        store.setNominated(staffId, next);
        setMessage(next
          ? { type: 'success', text: '指名スタッフに登録しました。', registered: true }
          : { type: 'success', text: '指名を解除しました。' });
      } else if (res.status === 401) {
        setMessage({ type: 'error', text: 'ログインの有効期限が切れました。ページを再読み込みしてください。' });
      } else {
        setMessage({
          type: 'error',
          text: typeof record.error === 'string' ? record.error : '指名を変更できませんでした。時間をおいて再度お試しください。',
        });
      }
    } catch {
      setMessage({ type: 'error', text: '指名を変更できませんでした。通信状況を確認して再度お試しください。' });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };

  return (
    <div className={variant === 'card' ? 'w-full' : undefined}>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-busy={pending}
        className={`${BUTTON_BASE} ${size} ${isNominated ? OUTLINED : FILLED}`}
        aria-label={`${label}${who}`}
      >
        {label}
      </button>
      <p role="status" aria-live="polite" className={`text-xs mt-1.5 ${message?.type === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
        {message?.text}
        {message?.registered && variant === 'detail' && (
          <>
            {' '}
            <Link href="/mypage/staff" className="inline-flex min-h-[24px] items-center text-sky-700 underline">
              マイページで確認する
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
