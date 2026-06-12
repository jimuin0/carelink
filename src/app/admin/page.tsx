import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SbPageHeader, SbStatCard, SbCard, SbStatusChip, SbButtonLink } from '@/components/admin/SbUi';

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
  // staff_profiles IDs are fetched with data (not head-only) so we can reuse
  // them for the staff_schedules query without a second sequential round-trip.
  const [
    { count: menuCount },
    { data: staffData },
    { count: photoCount },
    { data: facilityData },
  ] = await Promise.all([
    supabase.from('facility_menus').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId),
    supabase.from('staff_profiles').select('id').eq('facility_id', facilityId),
    supabase.from('facility_photos').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId),
    supabase.from('facility_profiles').select('status').eq('id', facilityId).single(),
  ]);

  const staffIds = staffData?.map((s: { id: string }) => s.id) ?? [];
  const staffCount = staffIds.length;

  const scheduleCount = staffIds.length > 0
    ? (await supabase.from('staff_schedules').select('id', { count: 'exact', head: true }).in('staff_id', staffIds)).count ?? 0
    : 0;

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

  return (
    <div>
      <SbPageHeader
        title="ダッシュボード"
        description="本日の予約状況と店舗セットアップの概要"
        actions={<SbButtonLink href="/admin/schedule">サロンボードを見る</SbButtonLink>}
      />

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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <SbStatCard label="今日の予約" value={todayBookings ?? 0} unit="件" href="/admin/bookings" accent="sky" />
        <SbStatCard label="確認待ち" value={pendingBookings ?? 0} unit="件" href="/admin/bookings?status=pending" accent="amber" />
        <SbStatCard label="来店数" value={totalCustomers ?? 0} unit="人" href="/admin/customers" accent="emerald" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SbCard title="クイックアクション">
          <div className="space-y-1">
            <Link href="/admin/bookings" className="block p-2.5 rounded-md hover:bg-sky-50 text-sm text-gray-700">
              予約を確認する →
            </Link>
            <Link href="/admin/menus" className="block p-2.5 rounded-md hover:bg-sky-50 text-sm text-gray-700">
              メニューを管理する →
            </Link>
            <Link href="/admin/settings" className="block p-2.5 rounded-md hover:bg-sky-50 text-sm text-gray-700">
              施設情報を編集する →
            </Link>
            <Link href="/admin/analytics" className="block p-2.5 rounded-md hover:bg-sky-50 text-sm text-gray-700">
              売上を分析する →
            </Link>
          </div>
        </SbCard>

        <SbCard
          title="最近の予約"
          action={<Link href="/admin/bookings" className="text-xs font-bold text-sky-600 hover:underline">すべて見る →</Link>}
        >
          <RecentBookings facilityId={facilityId} />
        </SbCard>
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

  if (!data || data.length === 0) {
    return <p className="text-sm text-gray-400">まだ予約がありません</p>;
  }

  return (
    <div className="space-y-1">
      {data.map((b) => (
        <Link
          key={b.id}
          href={`/admin/bookings/${b.id}`}
          className="flex items-center justify-between p-2 rounded-md hover:bg-sky-50"
        >
          <div>
            <p className="text-sm font-medium text-gray-800">{b.customer_name}</p>
            <p className="text-xs text-gray-500">{b.booking_date} {b.start_time?.slice(0, 5)}</p>
          </div>
          <SbStatusChip status={b.status} />
        </Link>
      ))}
    </div>
  );
}
