'use client';

import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { verifyAuthUser } from '@/lib/auth-verification';
import { loadAdminFacilitySelection, type AdminFacilityChoice } from '@/lib/admin-facility-selection';
import FacilitySelector, { type FacilitySelectorPath } from '@/components/admin/FacilitySelector';
import AdminPageLoading from '@/components/admin/AdminPageLoading';
import LoadError from '@/components/admin/LoadError';
import { SbPageHeader } from '@/components/admin/SbUi';

/** 店舗が決まったあとに画面本体へ渡すもの。facilityId は所属（owner/admin）を確かめ済み。 */
export type AdminFacilityScopeValue = { facilityId: string; choices: AdminFacilityChoice[]; userId: string };

type Selection =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'unselected'; choices: AdminFacilityChoice[] }
  | ({ status: 'selected' } & AdminFacilityScopeValue);

/**
 * 管理画面（クライアント）の「どの店舗を扱うか」を決める共通の入口（2026年10月22日）。
 *
 * 以前は各画面が facility_members を `.limit(1).single()` で 1 行だけ読み、複数店舗のオーナーには
 * 行の並び次第でどれか 1 店舗のデータを出していた（ヘッダーは「店舗未選択」なのに本文は別の店舗、
 * ブログは別の店舗に保存、求人は作成できない、など）。口コミ・問い合わせと同じく ?facility_id= を尊重し、
 * 店舗が複数で未指定なら選択だけを出す。自分の店舗でない facility_id やログイン・所属を確認できない
 * ときは失敗として表示し、どの店舗のデータも読まない。
 */
export default function AdminFacilityScope({ title, path, children }: {
  title: string;
  path: FacilitySelectorPath;
  children: (scope: AdminFacilityScopeValue) => ReactNode;
}) {
  return <Suspense fallback={<AdminPageLoading />}><ScopeRoute title={title} path={path}>{children}</ScopeRoute></Suspense>;
}

// 店舗を切り替えたら中身を作り直し、前の店舗のデータや入力中の内容が残らないようにする。
function ScopeRoute(props: { title: string; path: FacilitySelectorPath; children: (scope: AdminFacilityScopeValue) => ReactNode }) {
  const requested = useSearchParams().get('facility_id');
  return <ScopeResolver key={requested ?? 'unselected'} requested={requested} {...props} />;
}

function ScopeResolver({ requested, title, path, children }: {
  requested: string | null; title: string; path: FacilitySelectorPath;
  children: (scope: AdminFacilityScopeValue) => ReactNode;
}) {
  const [selection, setSelection] = useState<Selection>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createBrowserSupabaseClient();
      const identity = await verifyAuthUser(supabase.auth);
      if (identity.state !== 'verified') throw new Error('ADMIN_IDENTITY_UNAVAILABLE');
      const { choices, selectedId } = await loadAdminFacilitySelection(supabase, identity.user.id, requested);
      if (cancelled) return;
      setSelection(selectedId
        ? { status: 'selected', facilityId: selectedId, choices, userId: identity.user.id }
        : { status: 'unselected', choices });
    })().catch(() => { if (!cancelled) setSelection({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [requested, attempt]);

  const retry = useCallback(() => { setSelection({ status: 'loading' }); setAttempt((n) => n + 1); }, []);

  if (selection.status === 'loading') return <AdminPageLoading />;
  if (selection.status === 'selected') {
    return <>{children({ facilityId: selection.facilityId, choices: selection.choices, userId: selection.userId })}</>;
  }
  return (
    <div>
      <SbPageHeader title={title} />
      {selection.status === 'error'
        ? <LoadError onRetry={retry} message="管理する店舗の確認に失敗しました" />
        : <FacilitySelector choices={selection.choices} selectedId={null} path={path} />}
    </div>
  );
}
