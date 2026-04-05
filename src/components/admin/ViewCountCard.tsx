'use client';

import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';

export default function ViewCountCard({ facilityId }: { facilityId: string }) {
  const [viewCount, setViewCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const supabase = createBrowserSupabaseClient();
      const { data } = await supabase
        .from('facility_profiles')
        .select('view_count')
        .eq('id', facilityId)
        .maybeSingle();

      setViewCount(data?.view_count ?? 0);
      setLoading(false);
    };
    load();
  }, [facilityId]);

  if (loading) return <div className="h-20 bg-gray-50 rounded-lg animate-pulse" />;

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
