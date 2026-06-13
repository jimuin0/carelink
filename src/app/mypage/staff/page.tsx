'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import Link from 'next/link';
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
}

export default function PreferredStaffPage() {
  const [staff, setStaff] = useState<PreferredStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const load = useCallback(async () => {
      const supabase = createBrowserSupabaseClient();
      setLoadError(false);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data: prefs, error: prefsErr } = await supabase
        .from('user_preferred_staff')
        .select('id, staff_id')
        .eq('user_id', user.id);

      if (prefsErr) { setLoadError(true); setLoading(false); return; }
      if (!prefs || prefs.length === 0) { setLoading(false); return; }

      const staffIds = prefs.map((p) => p.staff_id);
      // スタッフ詳細は補助（失敗時は名称「不明」表示で本体は継続）。
      // eslint-disable-next-line carelink-safety/no-discarded-supabase-error
      const { data: staffData } = await supabase
        .from('staff_profiles')
        .select('id, name, photo_url, position, facility_id')
        .in('id', staffIds);

      const facilityIds = Array.from(new Set((staffData || []).map((s) => s.facility_id)));
      // 施設名は補助（失敗時は空表示で本体は継続）。
      // eslint-disable-next-line carelink-safety/no-discarded-supabase-error
      const { data: facilities } = await supabase
        .from('facility_profiles')
        .select('id, name, slug')
        .in('id', facilityIds);
      const facilityMap = Object.fromEntries((facilities || []).map((f) => [f.id, f]));

      setStaff(prefs.map((p) => {
        const s = staffData?.find((st) => st.id === p.staff_id);
        const f = s ? facilityMap[s.facility_id] : null;
        return {
          id: p.id,
          staff_id: p.staff_id,
          staff_name: s?.name || '不明',
          staff_photo: s?.photo_url || null,
          facility_name: f?.name || '',
          facility_slug: f?.slug || '',
          position: s?.position || null,
        };
      }));
      setLoading(false);
  }, []);

  useEffect(() => { load().catch(() => { setLoadError(true); setLoading(false); }); }, [load]);

  const handleRemove = async (id: string) => {
    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.from('user_preferred_staff').delete().eq('id', id);
    if (error) { setToast({ type: 'error', message: '解除に失敗しました' }); return; }
    setStaff((prev) => prev.filter((s) => s.id !== id));
    setToast({ type: 'success', message: '解除しました' });
  };

  if (loading) {
    return <div className="animate-pulse space-y-4"><div className="h-8 bg-gray-200 rounded w-1/3" /><div className="h-64 bg-gray-200 rounded-xl" /></div>;
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h1 className="text-xl font-bold">指名スタッフ</h1>
        <p className="text-sm text-gray-500 mt-1">お気に入りのスタッフを管理できます。</p>
      </div>

      {loadError ? (
        <LoadError onRetry={() => { load().catch(() => { setLoadError(true); setLoading(false); }); }} message="指名スタッフの読み込みに失敗しました" />
      ) : staff.length === 0 ? (
        <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
          <p className="text-gray-400 mb-4">指名スタッフが登録されていません</p>
          <p className="text-sm text-gray-500 mb-6">施設のスタッフページから「指名登録」できます。</p>
          <Link href="/search" className="btn-primary text-sm">施設を探す</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {staff.map((s) => (
            <div key={s.id} className="bg-white rounded-xl shadow-sm p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-sky-100 overflow-hidden shrink-0 flex items-center justify-center relative">
                {s.staff_photo ? (
                  <Image src={s.staff_photo} alt={s.staff_name} fill className="object-cover" sizes="48px" />
                ) : (
                  <span className="text-sky-500 font-bold">{s.staff_name.charAt(0)}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">{s.staff_name}</p>
                {s.position && <p className="text-xs text-gray-400">{s.position}</p>}
                {s.facility_slug && (
                  <Link href={`/facility/${s.facility_slug}`} className="text-xs text-sky-600 hover:underline">{s.facility_name}</Link>
                )}
              </div>
              <button
                type="button"
                onClick={() => handleRemove(s.id)}
                className="text-xs text-red-500 hover:text-red-600 px-3 py-1.5 border border-red-200 rounded-full hover:bg-red-50 transition-colors"
              >
                解除
              </button>
            </div>
          ))}
        </div>
      )}

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
