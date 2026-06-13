'use client';

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

export default function RepeatRateCard({ facilityId }: { facilityId: string }) {
  const [rate, setRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    setLoadError(false);
    const { data: segments, error } = await supabase
      .from('customer_segments')
      .select('total_visits')
      .eq('facility_id', facilityId);

    if (error) { setLoadError(true); setLoading(false); return; }
    if (segments && segments.length > 0) {
      const repeaters = segments.filter(s => s.total_visits >= 2).length;
      setRate(Math.round((repeaters / segments.length) * 100));
    }
    setLoading(false);
  }, [facilityId]);

  useEffect(() => { load().catch(() => { setLoadError(true); setLoading(false); }); }, [load]);

  if (loading) return <div className="h-20 bg-gray-50 rounded-lg animate-pulse" />;

  // 取得失敗時は 0%/- を表示せず失敗として明示する（誤った指標表示を防ぐ）
  if (loadError) {
    return (
      <div className="bg-white rounded-xl p-4 border border-rose-200" role="alert">
        <p className="text-xs text-gray-500">リピート率</p>
        <p className="text-sm text-rose-600 font-bold mt-1">取得に失敗しました</p>
        <button type="button" onClick={() => load()} className="text-xs text-sky-600 underline mt-1">再試行</button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-4 border border-gray-100">
      <p className="text-xs text-gray-500">リピート率</p>
      <p className="text-3xl font-bold text-sky-600 mt-1">
        {rate !== null ? `${rate}%` : '-'}
      </p>
      <p className="text-xs text-gray-400 mt-1">2回以上来店した顧客の割合</p>
    </div>
  );
}
