import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SbPageHeader, SbStatCard, SbCard, SbStatusChip, SbButtonLink } from '@/components/admin/SbUi';
import { todayJst, addDays, dayOfWeekUtc } from '@/lib/admin-date';

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];

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

  const today = todayJst();

  // オンボーディング進捗チェック
  // staff_profiles IDs are fetched with data (not head-only) so we can reuse
  // them for the staff_schedules query without a second sequential round-trip.
  const [
    { count: menuCount, error: menuErr },
    { data: staffData, error: staffErr },
    { count: photoCount, error: photoErr },
    { data: facilityData, error: facilityErr },
  ] = await Promise.all([
    supabase.from('facility_menus').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId),
    supabase.from('staff_profiles').select('id').eq('facility_id', facilityId),
    supabase.from('facility_photos').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId),
    supabase.from('facility_profiles').select('status').eq('id', facilityId).single(),
  ]);
  // 取得失敗を 0/未完了 に偽装しない（error.tsx に委ねる）
  if (menuErr || staffErr || photoErr || facilityErr) {
    throw new Error(`ダッシュボードの取得に失敗しました: ${(menuErr ?? staffErr ?? photoErr ?? facilityErr)?.message}`);
  }

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

  // 週間予約状況（本日から7日間）の日付一覧。各日の件数は1クエリ取得→JST日付で JS 集計する
  // （PostgREST は GROUP BY 非対応のため。範囲は7日固定で転送量は小さい）。
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(today, i));

  const [
    { count: todayBookings, error: todayErr },
    { count: pendingBookings, error: pendingErr },
    { count: totalCustomers, error: customerErr },
    { data: weekRows, error: weekErr },
  ] = await Promise.all([
    supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId).eq('booking_date', today),
    supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId).eq('status', 'pending'),
    supabase.from('customer_visits').select('customer_email', { count: 'exact', head: true }).eq('facility_id', facilityId),
    supabase.from('bookings').select('booking_date').eq('facility_id', facilityId).neq('status', 'cancelled')
      .gte('booking_date', weekDates[0]).lte('booking_date', weekDates[6]),
  ]);
  // KPI の取得失敗を 0 に偽装しない（error.tsx に委ねる）
  if (todayErr || pendingErr || customerErr || weekErr) {
    throw new Error(`ダッシュボードの取得に失敗しました: ${(todayErr ?? pendingErr ?? customerErr ?? weekErr)?.message}`);
  }

  // 週間予約状況: 日付→件数。cancelled は除外済み。
  const weekCounts = new Map<string, number>();
  for (const r of (weekRows ?? []) as { booking_date: string }[]) {
    weekCounts.set(r.booking_date, (weekCounts.get(r.booking_date) ?? 0) + 1);
  }
  const weekData = weekDates.map((d) => ({
    date: d,
    dow: dayOfWeekUtc(d),
    count: weekCounts.get(d) ?? 0,
  }));

  return (
    <div>
      <SbPageHeader
        title="ダッシュボード"
        description="本日の予約状況と店舗セットアップの概要"
        actions={<SbButtonLink href="/admin/schedule">サロンボードを見る</SbButtonLink>}
      />

      {/* ヒーローアクションカード（サロンボード型・CareLink 色） */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <Link
          href="/admin/schedule"
          className="group flex items-center gap-4 rounded-2xl bg-gradient-to-br from-sky-500 to-sky-600 text-white p-5 shadow-sm hover:shadow-md transition-shadow"
        >
          <span className="shrink-0 w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </span>
          <span className="min-w-0">
            <span className="block text-lg font-bold">本日のスケジュール</span>
            <span className="block text-xs text-white/70 tracking-widest">TODAY&apos;S SCHEDULE</span>
          </span>
          <svg className="w-5 h-5 text-white/80 ml-auto shrink-0 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
        </Link>
        <Link
          href={`/admin/bookings?date=${today}`}
          className="group flex items-center gap-4 rounded-2xl bg-gradient-to-br from-sky-600 to-sky-700 text-white p-5 shadow-sm hover:shadow-md transition-shadow"
        >
          <span className="shrink-0 w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
          </span>
          <span className="min-w-0">
            <span className="block text-lg font-bold">本日の予約一覧</span>
            <span className="block text-xs text-white/70 tracking-widest">TODAY&apos;S RESERVE LIST</span>
          </span>
          <span className="ml-auto shrink-0 flex items-center gap-1">
            <span className="text-2xl font-extrabold tabular-nums">{todayBookings ?? 0}</span>
            <span className="text-xs text-white/80">件</span>
          </span>
        </Link>
      </div>

      {/* 週間予約状況（本日から7日間） */}
      <SbCard title="週間予約状況" className="mb-6">
        <div className="grid grid-cols-7 gap-1.5">
          {weekData.map(({ date, dow, count }) => {
            const isToday = date === today;
            const [, m, d] = date.split('-');
            return (
              <Link
                key={date}
                href={`/admin/schedule?date=${date}`}
                className={`flex flex-col items-center justify-center rounded-lg border py-2 transition-colors ${
                  isToday ? 'border-sky-400 bg-sky-50 ring-1 ring-sky-200' : 'border-gray-100 hover:bg-sky-50'
                }`}
              >
                <span className="text-[11px] text-gray-400">{Number(m)}/{Number(d)}</span>
                <span className={`text-xs font-bold ${dow === 0 ? 'text-red-500' : dow === 6 ? 'text-sky-600' : 'text-gray-600'}`}>
                  {WEEKDAY_LABELS[dow]}
                </span>
                <span className="mt-1 text-base font-extrabold text-gray-800 tabular-nums leading-none">{count}</span>
                <span className="text-[10px] text-gray-400">件</span>
              </Link>
            );
          })}
        </div>
      </SbCard>

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

      {/* 確認待ちアラート */}
      {(pendingBookings ?? 0) > 0 && (
        <Link href="/admin/bookings?status=pending" className="block mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 hover:shadow-md transition-shadow">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
            <div>
              <p className="text-sm font-bold text-amber-800">{pendingBookings}件の予約が確認待ちです</p>
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
