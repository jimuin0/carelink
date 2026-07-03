import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { SbPageHeader, SbCard, SbStatusChip, SbButtonLink, SbStatCard } from '@/components/admin/SbUi';
import { todayJst, addDays, dayOfWeekUtc, jstMonthInfo } from '@/lib/admin-date';

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

  // 予約状況（本日から14日間＝2週間）の日付一覧。各日の件数は1クエリ取得→JST日付で JS 集計する
  // （PostgREST は GROUP BY 非対応のため。範囲は14日固定で転送量は小さい）。
  const weekDates = Array.from({ length: 14 }, (_, i) => addDays(today, i));

  // 当月の経営KPI範囲（JST 当月。売上の定義は /admin/analytics と完全一致＝
  // status='completed' の total_price 合計。お金の定義を二重化しないため同一式を踏襲）。
  const { year: curY, month: curM } = jstMonthInfo(0);
  const curMM = String(curM).padStart(2, '0');
  const monthStart = `${curY}-${curMM}-01`;
  // 当月末日（Date.UTC(year, month, 0) は当月末日＝純粋な暦演算で TZ 非依存・analytics と同手法）
  const monthLastDay = new Date(Date.UTC(curY, curM, 0)).getUTCDate();
  const monthEnd = `${curY}-${curMM}-${String(monthLastDay).padStart(2, '0')}`;

  const [
    { count: todayBookings, error: todayErr },
    { count: pendingBookings, error: pendingErr },
    { data: weekRows, error: weekErr },
    { data: todayRevRows, error: todayRevErr },
    { data: monthCompletedRows, error: monthRevErr },
    { count: monthNoShowCount, error: noShowErr },
  ] = await Promise.all([
    supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId).eq('booking_date', today),
    supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId).eq('status', 'pending'),
    supabase.from('bookings').select('booking_date').eq('facility_id', facilityId).neq('status', 'cancelled')
      .gte('booking_date', weekDates[0]).lte('booking_date', weekDates[13]),
    // 本日の売上（完了予約の total_price 合計）
    supabase.from('bookings').select('total_price').eq('facility_id', facilityId).eq('status', 'completed').eq('booking_date', today),
    // 当月の完了予約（売上合計・件数・客単価の母数）
    supabase.from('bookings').select('total_price').eq('facility_id', facilityId).eq('status', 'completed')
      .gte('booking_date', monthStart).lte('booking_date', monthEnd),
    // 当月の無断キャンセル件数（無断キャンセル率の分子）
    supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('facility_id', facilityId).eq('status', 'no_show')
      .gte('booking_date', monthStart).lte('booking_date', monthEnd),
  ]);
  // 取得失敗を 0 に偽装しない（error.tsx に委ねる）。売上・率を過少表示で実績誤認させない。
  if (todayErr || pendingErr || weekErr || todayRevErr || monthRevErr || noShowErr) {
    throw new Error(`ダッシュボードの取得に失敗しました: ${(todayErr ?? pendingErr ?? weekErr ?? todayRevErr ?? monthRevErr ?? noShowErr)?.message}`);
  }

  // 経営KPI算出（analytics と同一定義）。母数0の指標は数値を捏造せず null＝「—」表示にする。
  const todayRevenue = (todayRevRows ?? []).reduce((sum, b: { total_price: number | null }) => sum + (b.total_price ?? 0), 0);
  const monthRevenue = (monthCompletedRows ?? []).reduce((sum, b: { total_price: number | null }) => sum + (b.total_price ?? 0), 0);
  const monthCompletedCount = (monthCompletedRows ?? []).length;
  const avgTicket = monthCompletedCount > 0 ? Math.round(monthRevenue / monthCompletedCount) : null;
  const noShowCount = monthNoShowCount ?? 0;
  const noShowDenom = monthCompletedCount + noShowCount; // 来店予定だった件数（事前キャンセルは除外）
  const noShowRate = noShowDenom > 0 ? Math.round((noShowCount / noShowDenom) * 1000) / 10 : null;

  // 予約状況（2週間）: 日付→件数。cancelled は除外済み。
  const weekCounts = new Map<string, number>();
  for (const r of (weekRows ?? []) as { booking_date: string }[]) {
    weekCounts.set(r.booking_date, (weekCounts.get(r.booking_date) ?? 0) + 1);
  }
  const weekData = weekDates.map((d) => ({
    date: d,
    dow: dayOfWeekUtc(d),
    count: weekCounts.get(d) ?? 0,
  }));

  // 公開中なのに「構造的に予約を受け付けられない」状態の検知。
  // 予約フローの空き枠は 100% スタッフ＋勤務スケジュール起点で導出される
  // （BookingFlow はスタッフ0で枠取得をスキップ・/api/slots は staffId 必須で
  // staff_schedules からスロットを算出）。公開はメニュー＋写真のみで可能なため、
  // スタッフ未登録／スケジュール未設定のまま公開すると、来院者は予約ページに
  // 到達しても枠が1つも出ず「公開したのに予約が来ない」という無音の機会損失になる。
  // 公開ゲートは既存施設に影響するため掛けず、経営者に明示警告して気づけるようにする。
  const publishBlocker = isPublished && staffCount === 0
    ? { message: '公開中ですが、スタッフが未登録のため予約を受け付けられません。', cta: 'スタッフを登録する', href: '/admin/staff' }
    : isPublished && scheduleCount === 0
    ? { message: '公開中ですが、スタッフの勤務スケジュールが未設定のため予約を受け付けられません。', cta: 'スケジュールを設定する', href: '/admin/staff' }
    : null;

  return (
    <div>
      <SbPageHeader
        title="ダッシュボード"
        description="本日の予約状況と店舗セットアップの概要"
        actions={<SbButtonLink href="/admin/schedule">サロンボードを見る</SbButtonLink>}
      />

      {/* 公開中なのに予約不能な状態の警告（無音の機会損失を防ぐ・最優先で表示） */}
      {publishBlocker && (
        <Link href={publishBlocker.href} className="block mb-6 bg-red-50 border border-red-200 rounded-xl p-4 hover:shadow-md transition-shadow" role="alert">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <div>
              <p className="text-sm font-bold text-red-800">{publishBlocker.message}</p>
              <p className="text-xs text-red-600">{publishBlocker.cta}（このままでは集客しても予約が入りません）</p>
            </div>
            <svg className="w-5 h-5 text-red-400 ml-auto shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </div>
        </Link>
      )}

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

      {/* 経営KPI（当月・売上は /admin/analytics と同一定義）。経営者が毎日見たい数値を集約。 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <SbStatCard
          label="本日の売上"
          value={`¥${todayRevenue.toLocaleString()}`}
          href={`/admin/bookings?date=${today}`}
          accent="sky"
          sub="完了予約ベース"
        />
        <SbStatCard
          label="今月の売上"
          value={`¥${monthRevenue.toLocaleString()}`}
          href="/admin/analytics"
          accent="emerald"
          sub={`${curM}月・完了${monthCompletedCount}件`}
        />
        <SbStatCard
          label="客単価"
          value={avgTicket !== null ? `¥${avgTicket.toLocaleString()}` : '—'}
          href="/admin/analytics"
          accent="amber"
          sub="今月の平均"
        />
        <SbStatCard
          label="無断キャンセル率"
          value={noShowRate !== null ? `${noShowRate}%` : '—'}
          href="/admin/bookings?status=no_show"
          accent={noShowRate !== null && noShowRate >= 10 ? 'rose' : 'gray'}
          sub={`今月${noShowCount > 0 ? `・${noShowCount}件` : ''}`}
        />
      </div>

      {/* 予約状況（本日から14日間＝2週間・grid-cols-7 で2行に並ぶ） */}
      <SbCard title="予約状況（2週間）" className="mb-6">
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
                <span className="flex items-baseline gap-0.5">
                  <span className="text-[11px] text-gray-400">{Number(m)}/{Number(d)}</span>
                  <span className={`text-xs font-bold ${dow === 0 ? 'text-red-500' : dow === 6 ? 'text-sky-600' : 'text-gray-600'}`}>
                    ({WEEKDAY_LABELS[dow]})
                  </span>
                </span>
                <span className="flex items-baseline gap-0.5 mt-1">
                  <span className="text-base font-extrabold text-gray-800 tabular-nums leading-none">{count}</span>
                  <span className="text-[10px] text-gray-400">件</span>
                </span>
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
  const { data, error } = await supabase
    .from('bookings')
    .select('id, customer_name, booking_date, start_time, status')
    .eq('facility_id', facilityId)
    .order('created_at', { ascending: false })
    .limit(5);

  // 取得失敗を「まだ予約がありません」に偽装しない（通信/権限エラーを予約ゼロと誤認させる）。
  // 副次カードのためページ全体は落とさず、空とは区別してカード内でエラーを明示する。
  if (error) {
    return <p role="alert" className="text-sm text-red-500">予約の取得に失敗しました。ページを再読み込みしてください。</p>;
  }
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
