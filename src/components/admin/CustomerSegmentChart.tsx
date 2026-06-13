'use client';

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';

const SEGMENT_LABELS: Record<string, string> = {
  vip: 'VIP（5回以上・30日以内）',
  regular: '常連（2回以上・60日以内）',
  at_risk: '離脱リスク（2回以上・120日以内）',
  lost: '離脱（120日超）',
  new: '新規（1回のみ）',
};

const SEGMENT_COLORS: Record<string, string> = {
  vip: '#0284C7',
  regular: '#059669',
  at_risk: '#F59E0B',
  lost: '#EF4444',
  new: '#8B5CF6',
};

export default function CustomerSegmentChart({ facilityId }: { facilityId: string }) {
  const [data, setData] = useState<{ name: string; value: number; color: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [total, setTotal] = useState(0);

  const load = useCallback(async () => {
      const supabase = createBrowserSupabaseClient();
      setLoadError(false);
      const { data: segments, error } = await supabase
        .from('customer_segments')
        .select('segment')
        .eq('facility_id', facilityId);

      if (error) { setLoadError(true); setLoading(false); return; }
      if (segments) {
        const counts: Record<string, number> = {};
        for (const s of segments) {
          counts[s.segment] = (counts[s.segment] || 0) + 1;
        }
        const chartData = Object.entries(counts).map(([key, value]) => ({
          name: SEGMENT_LABELS[key] || key,
          value,
          color: SEGMENT_COLORS[key] || '#999',
        }));
        setData(chartData);
        setTotal(segments.length);
      }
      setLoading(false);
  }, [facilityId]);

  useEffect(() => { load().catch(() => { setLoadError(true); setLoading(false); }); }, [load]);

  if (loading) return <div className="h-64 bg-gray-50 rounded-lg animate-pulse" />;
  // 取得失敗時は「顧客データがありません」に偽装せず失敗として明示する
  if (loadError) return (
    <div className="text-center py-8" role="alert">
      <p className="text-sm text-rose-600 font-bold">顧客セグメントの読み込みに失敗しました</p>
      <button type="button" onClick={() => load()} className="text-xs text-sky-600 underline mt-1">再試行</button>
    </div>
  );
  if (data.length === 0) return <p className="text-sm text-gray-400 text-center py-8">顧客データがありません</p>;

  return (
    <div className="bg-white rounded-xl p-4">
      <h3 className="text-sm font-bold text-gray-800 mb-1">顧客セグメント</h3>
      <p className="text-xs text-gray-400 mb-4">総顧客数: {total}人</p>
      <ResponsiveContainer width="100%" height={250}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={80}
            label={false}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
