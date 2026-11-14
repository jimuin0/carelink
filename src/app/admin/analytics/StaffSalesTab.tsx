'use client';

import { useState, useEffect } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import LoadError from '@/components/admin/LoadError';
import { jstMonthInfo } from '@/lib/admin-date';
import { fetchAllPaged } from '@/lib/paginate';

function ymdOfMonth({ year, month }: { year: number; month: number }): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

interface StaffSales {
  staff_id: string;
  staff_name: string;
  revenue: number;
  count: number;
}

export default function StaffSalesTab({ facilityId }: { facilityId: string }) {
  const [data, setData] = useState<StaffSales[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // retry は再取得を state 経由で駆動する（load をイベントハンドラからも effect からも
  // 呼べる形にすると Compiler の検出対象になるため、キーの変化で effect 側だけに寄せる）
  const [reloadKey, setReloadKey] = useState(0);

  // アンマウント後の setState を防ぐため cancelled フラグで守りつつ、非同期処理を effect 内へ inline する
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const supabase = createBrowserSupabaseClient();
        setLoadError(false);
        // 今月の範囲は JST の月境界で作る（ブラウザのローカル時刻だと海外端末で月がずれる）。
        // 上限（翌月1日未満）も付け、PostgREST の既定上限（1000行）を越える分はページングで全件読む。
        const startDate = ymdOfMonth(jstMonthInfo(0));
        const endDate = ymdOfMonth(jstMonthInfo(1));

        const { rows: bookings, error: bErr } = await fetchAllPaged<{ staff_id: string | null; total_price: number | null }>(
          async (offset, limit) =>
            await supabase
              .from('bookings')
              .select('staff_id, total_price')
              .eq('facility_id', facilityId)
              .eq('status', 'completed')
              .gte('booking_date', startDate)
              .lt('booking_date', endDate)
              .order('id', { ascending: true })
              .range(offset, offset + limit - 1),
          { failOnTruncation: true },
        );

        if (bErr) {
          if (!cancelled) { setLoadError(true); setLoading(false); }
          return;
        }

        // スタッフ名は補助表示。取得失敗時は「不明」にフォールバックし売上集計本体は表示継続。
        // eslint-disable-next-line carelink-safety/no-discarded-supabase-error
        const { data: staffList } = await supabase
          .from('staff_profiles')
          .select('id, name')
          .eq('facility_id', facilityId)
          .eq('is_active', true);

        const staffMap = Object.fromEntries((staffList || []).map((s) => [s.id, s.name]));
        const salesMap: Record<string, { revenue: number; count: number }> = {};

        for (const b of bookings) {
          if (!b.staff_id) continue;
          if (!salesMap[b.staff_id]) salesMap[b.staff_id] = { revenue: 0, count: 0 };
          salesMap[b.staff_id].revenue += b.total_price ?? 0;
          salesMap[b.staff_id].count += 1;
        }

        const result = Object.entries(salesMap)
          .map(([id, v]) => ({ staff_id: id, staff_name: staffMap[id] || '不明', ...v }))
          .sort((a, b) => b.revenue - a.revenue);

        if (cancelled) return;
        setData(result);
        setLoading(false);
      } catch {
        if (!cancelled) { setLoadError(true); setLoading(false); }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [facilityId, reloadKey]);

  const maxRevenue = Math.max(...data.map((d) => d.revenue), 1);

  if (loading) return <div className="bg-white rounded-xl p-6 shadow-xs mt-6 animate-pulse"><div className="h-6 bg-gray-200 rounded-sm w-1/3" /></div>;

  return (
    <div className="bg-white rounded-xl p-6 shadow-xs mt-6">
      <h2 className="font-bold mb-4">スタッフ別売上（今月）</h2>
      {loadError ? (
        <LoadError onRetry={() => setReloadKey((k) => k + 1)} message="スタッフ別売上の読み込みに失敗しました" />
      ) : data.length === 0 ? (
        <p className="text-gray-500 text-sm text-center py-4">データがありません</p>
      ) : (
        <div className="space-y-3">
          {data.map((s) => (
            <div key={s.staff_id} className="flex items-center gap-3">
              <span className="text-sm font-medium w-20 truncate">{s.staff_name}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(s.revenue / maxRevenue) * 100}%` }} />
              </div>
              <span className="text-sm font-medium w-24 text-right">¥{s.revenue.toLocaleString()}</span>
              <span className="text-xs text-gray-500 w-12 text-right">{s.count}件</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
