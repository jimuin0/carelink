'use client';

import { useEffect, useState } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

interface DayData {
  date: string;
  booking_count: number;
  completed_count: number;
  cancelled_count: number;
}

export default function BookingTrendChart({ facilityId }: { facilityId: string }) {
  const [data, setData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const supabase = createBrowserSupabaseClient();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: rows } = await supabase
        .from('daily_revenue_summary')
        .select('date, booking_count, completed_count, cancelled_count')
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
      <h3 className="text-sm font-bold text-gray-800 mb-4">予約数推移（過去30日）</h3>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tickFormatter={(v: string) => v.slice(5)} tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={30} />
          <Tooltip labelFormatter={(label) => String(label)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="completed_count" name="完了" fill="#0284C7" radius={[2, 2, 0, 0]} />
          <Bar dataKey="cancelled_count" name="キャンセル" fill="#F87171" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
