import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import Link from 'next/link';

export default async function AdminDashboard() {
  const supabase = createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();

  const { data: membership } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user!.id)
    .single();

  const facilityId = membership?.facility_id;
  if (!facilityId) return <p>施設が見つかりません</p>;

  const today = new Date().toISOString().split('T')[0];

  const [{ count: todayBookings }, { count: pendingBookings }, { count: totalCustomers }] = await Promise.all([
    supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId).eq('booking_date', today),
    supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId).eq('status', 'pending'),
    supabase.from('customer_visits').select('customer_email', { count: 'exact', head: true }).eq('facility_id', facilityId),
  ]);

  const stats = [
    { label: '今日の予約', value: todayBookings ?? 0, href: '/admin/bookings', color: 'bg-sky-50 text-sky-700' },
    { label: '確認待ち', value: pendingBookings ?? 0, href: '/admin/bookings?status=pending', color: 'bg-yellow-50 text-yellow-700' },
    { label: '来店数', value: totalCustomers ?? 0, href: '/admin/customers', color: 'bg-green-50 text-green-700' },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">ダッシュボード</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className={`rounded-xl p-6 ${stat.color} hover:shadow-md transition-shadow`}
          >
            <p className="text-sm font-medium opacity-80">{stat.label}</p>
            <p className="text-3xl font-bold mt-1">{stat.value}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6 shadow-sm">
          <h2 className="font-bold mb-4">クイックアクション</h2>
          <div className="space-y-2">
            <Link href="/admin/bookings" className="block p-3 rounded-lg hover:bg-gray-50 text-sm">
              予約を確認する →
            </Link>
            <Link href="/admin/customers" className="block p-3 rounded-lg hover:bg-gray-50 text-sm">
              顧客を管理する →
            </Link>
            <Link href="/admin/analytics" className="block p-3 rounded-lg hover:bg-gray-50 text-sm">
              売上を分析する →
            </Link>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm">
          <h2 className="font-bold mb-4">最近の予約</h2>
          <RecentBookings facilityId={facilityId} />
        </div>
      </div>
    </div>
  );
}

async function RecentBookings({ facilityId }: { facilityId: string }) {
  const supabase = createServerSupabaseAuthClient();
  const { data } = await supabase
    .from('bookings')
    .select('id, customer_name, booking_date, start_time, status')
    .eq('facility_id', facilityId)
    .order('created_at', { ascending: false })
    .limit(5);

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    confirmed: 'bg-green-100 text-green-800',
    completed: 'bg-gray-100 text-gray-800',
    cancelled: 'bg-red-100 text-red-800',
  };

  if (!data || data.length === 0) {
    return <p className="text-sm text-gray-400">まだ予約がありません</p>;
  }

  return (
    <div className="space-y-2">
      {data.map((b) => (
        <Link
          key={b.id}
          href={`/admin/bookings/${b.id}`}
          className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50"
        >
          <div>
            <p className="text-sm font-medium">{b.customer_name}</p>
            <p className="text-xs text-gray-500">{b.booking_date} {b.start_time?.slice(0, 5)}</p>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${statusColors[b.status] ?? ''}`}>
            {b.status}
          </span>
        </Link>
      ))}
    </div>
  );
}
