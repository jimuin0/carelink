'use client';

import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

export default function RepeatRateCard({ facilityId }: { facilityId: string }) {
  const [rate, setRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data: segments } = await supabase
        .from('customer_segments')
        .select('total_visits')
        .eq('facility_id', facilityId);

      if (segments && segments.length > 0) {
        const repeaters = segments.filter(s => s.total_visits >= 2).length;
        setRate(Math.round((repeaters / segments.length) * 100));
      }
      setLoading(false);
    };
    load();
  }, [facilityId]);

  if (loading) return <div className="h-20 bg-gray-50 rounded-lg animate-pulse" />;

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
