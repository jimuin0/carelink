import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';

export default async function AdminAnalyticsPage() {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user!.id)
    .single();

  const facilityId = membership!.facility_id;

  // 月別売上（直近6ヶ月）
  const months: { month: string; revenue: number; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endD = new Date(year, month, 0);
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(endD.getDate()).padStart(2, '0')}`;

    const { data } = await supabase
      .from('bookings')
      .select('total_price')
      .eq('facility_id', facilityId)
      .eq('status', 'completed')
      .gte('booking_date', startDate)
      .lte('booking_date', endDate);

    const revenue = (data ?? []).reduce((sum, b) => sum + (b.total_price ?? 0), 0);
    months.push({
      month: `${month}月`,
      revenue,
      count: data?.length ?? 0,
    });
  }

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
    </div>
  );
}
