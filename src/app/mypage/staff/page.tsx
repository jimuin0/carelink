'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Link from 'next/link';
import Button from '@/components/ui/Button';
import Toast from '@/components/Toast';
import LoadError from '@/components/admin/LoadError';

interface PreferredStaff {
  id: string;
  staff_id: string;
  staff_name: string;
  staff_photo: string | null;
  facility_name: string;
  facility_slug: string;
  position: string | null;
  /** 公開中のスタッフ詳細ページ。非表示になったスタッフや非公開施設では null（リンク先が 404 になるため出さない） */
  profile_href: string | null;
  /** 施設へのリンクの代わり／横に出す補足（読み込み失敗・非公開施設・掲載終了）。無ければ null */
  notice: string | null;
}

/** スタッフ・施設の補助読み込みが失敗したとき。「非公開」などと事実と違う理由を出さない */
const NOTICE_DETAILS_UNAVAILABLE = '施設情報を読み込めませんでした';
const NOTICE_FACILITY_UNPUBLISHED = '現在公開されていない施設のスタッフです';
const NOTICE_STAFF_HIDDEN = '現在このスタッフは掲載されていません';

export default function PreferredStaffPage() {
  const [staff, setStaff] = useState<PreferredStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  // load 相当の処理は「マウント時の初回読み込み」と「読み込み失敗後の再試行」の2箇所からしか
  // 呼ばれず、どちらも同じ処理を求める呼び出しなので、reloadKey を effect の依存に置いて
  // 再試行時はキーをインクリメントするだけにする（処理本体は effect 内に1箇所だけ inline する）。
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createBrowserSupabaseClient();
        setLoadError(false);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { if (!cancelled) setLoading(false); return; }

        const { data: prefs, error: prefsErr } = await supabase
          .from('user_preferred_staff')
          .select('id, staff_id')
          .eq('user_id', user.id);

        if (prefsErr) { if (!cancelled) { setLoadError(true); setLoading(false); } return; }
        if (!prefs || prefs.length === 0) { if (!cancelled) setLoading(false); return; }

        const staffIds = prefs.map((p) => p.staff_id);
        // スタッフ詳細・施設名は補助（失敗しても一覧と「指名を解除」は使えるようにする）。
        // ただし失敗は記録しておき、行が欠けた理由を「非公開」と取り違えて表示しない。
        const { data: staffData, error: staffErr } = await supabase
          .from('staff_profiles')
          .select('id, name, slug, photo_url, position, facility_id, is_active')
          .in('id', staffIds);

        const facilityIds = Array.from(new Set((staffData || []).map((s) => s.facility_id)));
        const { data: facilities, error: facilitiesErr } = await supabase
          .from('facility_profiles')
          .select('id, name, slug')
          .in('id', facilityIds);
        const facilityMap = Object.fromEntries((facilities || []).map((f) => [f.id, f]));
        const detailsUnavailable = Boolean(staffErr || facilitiesErr);

        if (cancelled) return;
        setStaff(prefs.map((p) => {
          const s = staffData?.find((st) => st.id === p.staff_id);
          const f = s ? facilityMap[s.facility_id] : null;
          // 施設行が無い理由は「非公開（RLS で見えない）」とは限らない。読み取りが失敗していれば中立に伝える。
          let notice: string | null = null;
          if (!s || !f) notice = detailsUnavailable ? NOTICE_DETAILS_UNAVAILABLE : (s ? NOTICE_FACILITY_UNPUBLISHED : NOTICE_STAFF_HIDDEN);
          else if (s.is_active !== true) notice = NOTICE_STAFF_HIDDEN;
          return {
            id: p.id,
            staff_id: p.staff_id,
            staff_name: s?.name || '不明',
            staff_photo: s?.photo_url || null,
            facility_name: f?.name || '',
            facility_slug: f?.slug || '',
            position: s?.position || null,
            profile_href: s && f && s.is_active === true ? `/facility/${f.slug}/staff/${s.slug}` : null,
            notice,
          };
        }));
        setLoading(false);
      } catch {
        if (!cancelled) { setLoadError(true); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  // 解除は登録と同じ /api/preferred-staff を通す（書き込み経路を 1 本にそろえる）。
  const handleRemove = async (target: PreferredStaff) => {
    if (removing) return;
    setRemoving(target.id);
    try {
      const res = await fetch('/api/preferred-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ staffId: target.staff_id, nominated: false }),
        signal: AbortSignal.timeout(10000),
      });
      const body: unknown = await res.json().catch(() => null);
      if (!res.ok || (body as { nominated?: unknown } | null)?.nominated !== false) {
        setToast({ type: 'error', message: '解除に失敗しました。時間をおいて再度お試しください。' });
        return;
      }
      setStaff((prev) => prev.filter((s) => s.id !== target.id));
      setToast({ type: 'success', message: '指名を解除しました' });
    } catch {
      setToast({ type: 'error', message: '解除に失敗しました。通信状況を確認して再度お試しください。' });
    } finally {
      setRemoving(null);
    }
  };

  if (loading) {
    return <div className="animate-pulse space-y-4"><div className="h-8 bg-gray-200 rounded-sm w-1/3" /><div className="h-64 bg-gray-200 rounded-xl" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-xs p-6">
        <h1 className="text-xl font-bold">指名スタッフ</h1>
        <p className="text-sm text-gray-500 mt-1">指名登録したスタッフを確認・解除できます。</p>
      </div>

      {loadError ? (
        <LoadError onRetry={() => setReloadKey((k) => k + 1)} message="指名スタッフの読み込みに失敗しました" />
      ) : staff.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-xs p-12 text-center">
          <p className="text-gray-500 mb-4">指名スタッフが登録されていません</p>
          <p className="text-sm text-gray-500 mb-6">施設ページの「スタッフ」で、スタッフごとの「指名登録」ボタンから登録できます。</p>
          <Button href="/search" prefetch="auto">施設を探す</Button>
        </div>
      ) : (
        <div className="space-y-3">
          {staff.map((s) => (
            <div key={s.id} className="bg-white rounded-xl shadow-xs p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-sky-100 overflow-hidden shrink-0 flex items-center justify-center relative">
                {s.staff_photo ? (
                  <Image src={s.staff_photo} alt={s.staff_name} fill className="object-cover" sizes="48px" />
                ) : (
                  <span className="text-sky-700 font-bold">{s.staff_name.charAt(0)}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                {s.profile_href ? (
                  <Link href={s.profile_href} className="font-bold text-sm text-gray-900 hover:underline inline-flex min-h-[24px] items-center">{s.staff_name}</Link>
                ) : (
                  <p className="font-bold text-sm">{s.staff_name}</p>
                )}
                {s.position && <p className="text-xs text-gray-500">{s.position}</p>}
                {s.facility_slug && (
                  <Link href={`/facility/${s.facility_slug}`} className="text-xs text-sky-700 hover:underline inline-flex min-h-[24px] items-center">{s.facility_name}</Link>
                )}
                {s.notice && <p className="text-xs text-gray-500">{s.notice}</p>}
              </div>
              <button
                type="button"
                onClick={() => handleRemove(s)}
                disabled={removing !== null}
                aria-busy={removing === s.id}
                aria-label={`指名を解除（${s.staff_name}さん）`}
                className="text-xs text-red-700 px-3 py-1.5 min-h-[32px] border border-red-200 rounded-full hover:bg-red-50 transition-colors disabled:opacity-60"
              >
                指名を解除
              </button>
            </div>
          ))}
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
