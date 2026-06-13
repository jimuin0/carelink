'use client';

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

export default function ViewCountCard({ facilityId }: { facilityId: string }) {
  const [viewCount, setViewCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
      const supabase = createBrowserSupabaseClient();
      setLoadError(false);
      const { data, error } = await supabase
        .from('facility_profiles')
        .select('view_count')
        .eq('id', facilityId)
        .maybeSingle();

      if (error) { setLoadError(true); setLoading(false); return; }
      setViewCount(data?.view_count ?? 0);
      setLoading(false);
  }, [facilityId]);

  useEffect(() => { load().catch(() => { setLoadError(true); setLoading(false); }); }, [load]);

  if (loading) return <div className="h-20 bg-gray-50 rounded-lg animate-pulse" />;

  // 取得失敗時は 0 を表示せず失敗として明示する（閲覧数0の誤認を防ぐ）
  if (loadError) {
    return (
      <div className="bg-white rounded-xl p-4 border border-rose-200" role="alert">
        <p className="text-xs text-gray-500">施設ページ閲覧数</p>
        <p className="text-sm text-rose-600 font-bold mt-1">取得に失敗しました</p>
        <button type="button" onClick={() => load()} className="text-xs text-sky-600 underline mt-1">再試行</button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-4 border border-gray-100">
      <p className="text-xs text-gray-500">施設ページ閲覧数</p>
      <p className="text-3xl font-bold text-sky-600 mt-1">
        {viewCount !== null ? viewCount.toLocaleString() : '-'}
      </p>
      <p className="text-xs text-gray-400 mt-1">累計閲覧数</p>
    </div>
  );
}
