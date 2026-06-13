import { notFound } from 'next/navigation';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import StaffSalesTab from './StaffSalesTab';
import { RevenueChart, BookingTrendChart, CustomerSegmentChart, RepeatRateCard, ViewCountCard } from '@/components/admin/DynamicAnalyticsCharts';
import { jstMonthInfo } from '@/lib/admin-date';

export default async function AdminAnalyticsPage() {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .limit(1)
    .single();
  if (!membership) notFound();

  const facilityId = membership.facility_id;

  // 月別設定を事前生成（JST 月基準。booking_date は date-only のため YYYY-MM-DD で範囲指定）
  const monthConfigs = Array.from({ length: 6 }, (_, i) => {
    const { year, month } = jstMonthInfo(-(5 - i));
    const mm = String(month).padStart(2, '0');
    const startDate = `${year}-${mm}-01`;
    // 当月末日（month は 1-12、Date.UTC(year, month, 0) は当月末日＝純粋な暦演算で TZ 非依存）
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const endDate = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
    return { label: `${month}月`, startDate, endDate };
  });

  // 並列クエリ（N+1解消）
  const results = await Promise.all(
    monthConfigs.map(({ startDate, endDate }) =>
      supabase
        .from('bookings')
        .select('total_price')
        .eq('facility_id', facilityId)
        .eq('status', 'completed')
        .gte('booking_date', startDate)
        .lte('booking_date', endDate)
    )
  );

  const months = monthConfigs.map((config, i) => {
    const data = results[i].data ?? [];
    const revenue = data.reduce((sum, b) => sum + (b.total_price ?? 0), 0);
    return { month: config.label, revenue, count: data.length };
  });

  const totalRevenue = months.reduce((sum, m) => sum + m.revenue, 0);
  const totalBookings = months.reduce((sum, m) => sum + m.count, 0);
  const maxRevenue = Math.max(...months.map((m) => m.revenue), 1);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">売上分析</h1>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <p className="text-sm text-gray-500">直近6ヶ月の売上</p>
          <p className="text-2xl font-bold">¥{totalRevenue.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <p className="text-sm text-gray-500">完了予約数</p>
          <p className="text-2xl font-bold">{totalBookings}件</p>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h2 className="font-bold mb-4">月別売上</h2>
        <div className="space-y-3">
          {months.map((m) => (
            <div key={m.month} className="flex items-center gap-3">
              <span className="text-sm text-gray-500 w-10">{m.month}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${(m.revenue / maxRevenue) * 100}%` }}
                />
              </div>
              <span className="text-sm font-medium w-24 text-right">
                ¥{m.revenue.toLocaleString()}
              </span>
              <span className="text-xs text-gray-400 w-12 text-right">
                {m.count}件
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* recharts チャート（v8.1） */}
      <div className="grid sm:grid-cols-2 gap-4 mt-6">
        <RevenueChart facilityId={facilityId} />
        <BookingTrendChart facilityId={facilityId} />
      </div>
      <div className="grid sm:grid-cols-3 gap-4 mt-4">
        <CustomerSegmentChart facilityId={facilityId} />
        <RepeatRateCard facilityId={facilityId} />
        <ViewCountCard facilityId={facilityId} />
      </div>

      <div className="mt-6">
        <StaffSalesTab facilityId={facilityId} />
      </div>
    </div>
  );
}
