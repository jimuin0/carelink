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
  const [loadError, setLoadError] = useState(false);

  // React Compiler の set-state-in-effect 対策：useCallback + 呼び出し という形は
  // 「effect が外部関数を呼び、その中で setState する」構造として検出されるため、
  // 取得処理を effect 本体へ直接 inline し、再取得は reloadKey（state）で駆動する。
  // 挙動は従来と同一（マウント時取得・facilityId 変化時再取得・再試行ボタンで再取得）。
  const [reloadKey, setReloadKey] = useState(0);
  const retry = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createBrowserSupabaseClient();
      setLoadError(false);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data: rows, error } = await supabase
        .from('daily_revenue_summary')
        .select('date, booking_count, completed_count, cancelled_count')
        .eq('facility_id', facilityId)
        .gte('date', thirtyDaysAgo.toISOString().split('T')[0])
        .order('date', { ascending: true });

      if (cancelled) return;
      if (error) { setLoadError(true); setLoading(false); return; }
      // daily_revenue_summary の booking_count/completed_count/cancelled_count は
      // migration 上 NOT NULL 制約が無く DEFAULT 0（supabase/migrations/20260404000002_dashboard_enhancement.sql）。
      // 集計 RPC（aggregate_daily_revenue）は常に非 null で UPSERT するため実運用で null にはならない想定だが、
      // 型上は number | null となるため、DB の既定値と同じ 0 に倒してグラフ描画の型を満たす（表示挙動は変えない）。
      setData((rows || []).map((r) => ({
        date: r.date,
        booking_count: r.booking_count ?? 0,
        completed_count: r.completed_count ?? 0,
        cancelled_count: r.cancelled_count ?? 0,
      })));
      setLoading(false);
    })().catch(() => {
      if (!cancelled) { setLoadError(true); setLoading(false); }
    });
    // アンマウント後（cleanup 実行後）の setState を発生させないための cancelled ガード。
    return () => { cancelled = true; };
  }, [facilityId, reloadKey]);

  if (loading) return <div className="h-64 bg-gray-50 rounded-lg animate-pulse" />;
  // 取得失敗時は「データがありません」に偽装せず失敗として明示する
  if (loadError) return (
    <div className="text-center py-8" role="alert">
      <p className="text-sm text-rose-600 font-bold">予約数推移の読み込みに失敗しました</p>
      <button type="button" onClick={retry} className="text-xs text-sky-600 underline mt-1">再試行</button>
    </div>
  );
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
