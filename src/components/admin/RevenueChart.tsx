'use client';

import { useEffect, useState } from 'react';
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

  useEffect(() => {
    const load = async () => {
      const supabase = createBrowserSupabaseClient();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: rows } = await supabase
        .from('daily_revenue_summary')
        .select('date, total_revenue, booking_count, completed_count')
        .eq('facility_id', facilityId)
        .gte('date', thirtyDaysAgo.toISOString().split('T')[0])
        .order('date', { ascending: true });

      setData(rows || []);
      setLoading(false);
    };
    load();
  }, [facilityId]);

  if (loading) return <div className="h-64 bg-gray-50 rounded-lg animate-pulse" />;
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
