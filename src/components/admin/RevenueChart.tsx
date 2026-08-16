'use client';

import { useEffect, useState, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface DayData {
  date: string;
  total_revenue: number;
  booking_count: number;
  completed_count: number;
}

export default function RevenueChart({ facilityId }: { facilityId: string }) {
  const [data, setData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    const supabase = createBrowserSupabaseClient();
    setLoadError(false);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: rows, error } = await supabase
      .from('daily_revenue_summary')
      .select('date, total_revenue, booking_count, completed_count')
      .eq('facility_id', facilityId)
      .gte('date', thirtyDaysAgo.toISOString().split('T')[0])
      .order('date', { ascending: true });

    if (error) { setLoadError(true); setLoading(false); return; }
    // daily_revenue_summary の total_revenue/booking_count/completed_count は
    // migration 上 NOT NULL 制約が無く DEFAULT 0（supabase/migrations/20260404000002_dashboard_enhancement.sql）。
    // 集計 RPC（aggregate_daily_revenue）は常に非 null で UPSERT するため実運用で null にはならない想定だが、
    // 型上は number | null となるため、DB の既定値と同じ 0 に倒してグラフ描画の型を満たす（表示挙動は変えない）。
    setData((rows || []).map((r) => ({
      date: r.date,
      total_revenue: r.total_revenue ?? 0,
      booking_count: r.booking_count ?? 0,
      completed_count: r.completed_count ?? 0,
    })));
    setLoading(false);
  }, [facilityId]);

  useEffect(() => { load().catch(() => { setLoadError(true); setLoading(false); }); }, [load]);

  if (loading) return <div className="h-64 bg-gray-50 rounded-lg animate-pulse" />;
  // 取得失敗時は「データがありません」に偽装せず失敗として明示する
  if (loadError) return (
    <div className="text-center py-8" role="alert">
      <p className="text-sm text-rose-600 font-bold">日別売上の読み込みに失敗しました</p>
      <button type="button" onClick={() => load()} className="text-xs text-sky-600 underline mt-1">再試行</button>
    </div>
  );
  if (data.length === 0) return <p className="text-sm text-gray-400 text-center py-8">データがありません</p>;

  return (
    <div className="bg-white rounded-xl p-4">
      <h3 className="text-sm font-bold text-gray-800 mb-4">日別売上（過去30日）</h3>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis
            dataKey="date"
            tickFormatter={(v: string) => v.slice(5)}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            tickFormatter={(v: number) => `¥${(v / 1000).toFixed(0)}k`}
            tick={{ fontSize: 11 }}
            width={50}
          />
          <Tooltip />
          <Line type="monotone" dataKey="total_revenue" stroke="#0284C7" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
