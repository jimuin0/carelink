import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export default async function AdminDashboard() {
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

  const today = new Date().toISOString().split('T')[0];

  // オンボーディング進捗チェック
  const [
    { count: menuCount },
    { count: staffCount },
    { count: photoCount },
    { count: scheduleCount },
    { data: facilityData },
  ] = await Promise.all([
    supabase.from('facility_menus').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId),
    supabase.from('staff_profiles').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId),
    supabase.from('facility_photos').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId),
    supabase.from('staff_schedules').select('id', { count: 'exact', head: true }).in('staff_id',
      (await supabase.from('staff_profiles').select('id').eq('facility_id', facilityId)).data?.map(s => s.id) || []
    ),
    supabase.from('facility_profiles').select('status').eq('id', facilityId).single(),
  ]);

  const isPublished = facilityData?.status === 'published';
  const onboardingSteps = [
    { label: 'メニュー登録', done: (menuCount ?? 0) > 0, href: '/admin/menus' },
    { label: 'スタッフ登録', done: (staffCount ?? 0) > 0, href: '/admin/staff' },
    { label: '写真アップロード', done: (photoCount ?? 0) > 0, href: '/admin/photos' },
    { label: 'スケジュール設定', done: (scheduleCount ?? 0) > 0, href: '/admin/staff' },
    { label: '店舗を公開', done: isPublished, href: '/admin/settings' },
  ];
  const completedSteps = onboardingSteps.filter(s => s.done).length;
  const showOnboarding = completedSteps < 5;

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

      {/* オンボーディング進捗 */}
      {showOnboarding && (
        <div className="mb-6 bg-sky-50 border border-sky-200 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-sky-800">店舗セットアップ</h2>
            <span className="text-xs text-sky-600 font-bold">{completedSteps}/5 完了</span>
          </div>
          <div className="w-full bg-sky-100 rounded-full h-2 mb-4">
            <div className="bg-sky-500 h-2 rounded-full transition-all" style={{ width: `${(completedSteps / 5) * 100}%` }} />
          </div>
          <div className="space-y-2">
            {onboardingSteps.map((step) => (
              <Link
                key={step.label}
                href={step.href}
                className={`flex items-center gap-2 text-sm ${step.done ? 'text-sky-400 line-through' : 'text-sky-800 font-medium hover:underline'}`}
              >
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs ${step.done ? 'bg-sky-400 text-white' : 'bg-white border-2 border-sky-300 text-sky-300'}`}>
                  {step.done ? '✓' : ''}
                </span>
                {step.label}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* 承認待ちアラート */}
      {(pendingBookings ?? 0) > 0 && (
        <Link href="/admin/bookings?status=pending" className="block mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <div>
              <p className="text-sm font-bold text-amber-800">{pendingBookings}件の予約が承認待ちです</p>
              <p className="text-xs text-amber-600">クリックして確認・承認してください</p>
            </div>
            <svg className="w-5 h-5 text-amber-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </div>
        </Link>
      )}

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
            <Link href="/admin/menus" className="block p-3 rounded-lg hover:bg-gray-50 text-sm">
              メニューを管理する →
            </Link>
            <Link href="/admin/settings" className="block p-3 rounded-lg hover:bg-gray-50 text-sm">
              施設情報を編集する →
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
  const supabase = await createServerSupabaseAuthClient();
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
    no_show: 'bg-red-100 text-red-800',
  };
  const statusLabels: Record<string, string> = {
    pending: '確認待ち', confirmed: '確定', completed: '完了', cancelled: 'キャンセル', no_show: '無断',
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
          <span className={`text-micro px-2 py-0.5 rounded-full font-bold ${statusColors[b.status] ?? ''}`}>
            {statusLabels[b.status] ?? b.status}
          </span>
        </Link>
      ))}
    </div>
  );
}
