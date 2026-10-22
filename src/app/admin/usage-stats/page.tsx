import { readPageResult } from '@/lib/page-read-verification';
import { verifyAuthUser } from '@/lib/auth-verification';
import AccessVerificationUnavailable from '@/components/admin/AccessVerificationUnavailable';
import type { Metadata } from 'next';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { bookingStatusLabel } from '@/lib/booking-status';
import { jstMonthStartIso } from '@/lib/admin-date';
import { fetchAllPaged } from '@/lib/paginate';
import { computeUsageStats, type UsageBooking } from '@/lib/usage-stats';
import { SbPageHeader, SbStatCard } from '@/components/admin/SbUi';

export const metadata: Metadata = { title: '利用状況分析' };
export const dynamic = 'force-dynamic';

export default async function UsageStatsPage() {
  const supabase = await createServerSupabaseAuthClient();
  const identity = await verifyAuthUser(supabase.auth);
  if (identity.state === 'unavailable') return <AccessVerificationUnavailable />;
  if (identity.state !== 'verified') notFound();
  const user = identity.user;

  const { data: mem } = await readPageResult(() => supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
      .in('role', ['owner', 'admin'])
    .limit(1).maybeSingle(), '/admin/usage-stats');
  if (!mem) notFound();

  const facilityId = mem.facility_id;
  const admin = createServiceRoleClient();

  // 直近 12 か月（JST）の予約。集計（今月・前月同期・月別・リピート率）は computeUsageStats が
  // JST の暦月境界で行う（src/lib/usage-stats.ts）。1 施設で 1000 件を超えると PostgREST の
  // max_rows で黙って打ち切られるので、created_at・id 順にページングして全件読む
  // （読み切れないときは部分的な数字を出さず、読み取り失敗として扱う）。
  const { rows: bookings } = await readPageResult(() => fetchAllPaged<UsageBooking>(async (offset, limit) => {
    const { data, error } = await admin
      .from('bookings')
      .select('user_id, created_at, status')
      .eq('facility_id', facilityId)
      .gte('created_at', jstMonthStartIso(-12))
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + limit - 1);
    return { data, error };
  }, { failOnTruncation: true }), '/admin/usage-stats');

  const {
    dau, wau, mau, mauGrowth, repeatUsers, totalUsers, repeatRate,
    monthly: monthlyData, statusCount,
  } = computeUsageStats(bookings);

  // NPS
  const { data: npsData } = await readPageResult(() => admin
    .from('nps_surveys')
    .select('score')
    .eq('facility_id', facilityId), '/admin/usage-stats');

  const npsScores = (npsData ?? []).map((n) => n.score);
  const npsPromoters = npsScores.filter((s) => s >= 9).length;
  const npsDetractors = npsScores.filter((s) => s <= 6).length;
  const nps = npsScores.length > 0 ? Math.round(((npsPromoters - npsDetractors) / npsScores.length) * 100) : null;

  const maxMau = Math.max(...monthlyData.map((m) => m.mau), 1);

  return (
    <div className="space-y-6 max-w-4xl">
      <SbPageHeader title="利用状況分析" description="ユーザーの利用頻度・継続率を可視化" />

      {/* KPIカード */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SbStatCard label="DAU（今日）" value={dau} unit="人" accent="sky" sub="今日予約したユーザー" />
        <SbStatCard label="WAU（週間）" value={wau} unit="人" accent="sky" sub="過去7日間" />
        {/* 今月 1 日からの人数。比較は前月の同じ日数分（月の途中で前月 1 か月分と比べない） */}
        <SbStatCard
          label="MAU（月間）"
          value={mau}
          unit="人"
          accent="emerald"
          sub={mauGrowth !== null ? `前月同期比 ${mauGrowth > 0 ? '+' : ''}${mauGrowth}%` : '今月'}
        />
        <SbStatCard label="リピート率" value={`${repeatRate}%`} accent="amber" sub={`${repeatUsers}/${totalUsers}人`} />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {/* 月別 MAU */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h2 className="font-bold text-sm mb-4">月別 MAU（過去6ヶ月）</h2>
          <div className="space-y-2">
            {monthlyData.map((m) => (
              <div key={m.month} className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-8 shrink-0">{m.month}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                  <div
                    className="h-full bg-sky-500 rounded-full transition-all flex items-center justify-end pr-2"
                    style={{ width: `${Math.max((m.mau / maxMau) * 100, 3)}%` }}
                  >
                    {m.mau > 0 && <span className="text-xs text-white font-bold">{m.mau}</span>}
                  </div>
                </div>
                <span className="text-xs text-gray-400 w-12 text-right shrink-0">{m.bookings}件</span>
              </div>
            ))}
          </div>
        </div>

        {/* NPS + ステータス分布 */}
        <div className="space-y-4">
          {/* NPS */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="font-bold text-sm mb-3">NPS スコア</h2>
            {nps !== null ? (
              <div className="flex items-center gap-4">
                <div className={`text-4xl font-bold ${nps >= 50 ? 'text-green-600' : nps >= 0 ? 'text-yellow-600' : 'text-red-500'}`}>
                  {nps > 0 ? '+' : ''}{nps}
                </div>
                <div>
                  <p className="text-xs text-gray-500">{npsScores.length}件の回答</p>
                  <p className="text-xs text-gray-400">推奨者 {npsPromoters}人 / 批判者 {npsDetractors}人</p>
                  <p className={`text-xs font-medium mt-1 ${nps >= 50 ? 'text-green-600' : nps >= 0 ? 'text-yellow-600' : 'text-red-500'}`}>
                    {nps >= 50 ? '優良' : nps >= 0 ? '普通' : '要改善'}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-400">まだデータがありません</p>
            )}
          </div>

          {/* ステータス分布 */}
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <h2 className="font-bold text-sm mb-3">今月の予約ステータス</h2>
            {Object.entries(statusCount).length === 0 ? (
              <p className="text-sm text-gray-400">データなし</p>
            ) : (
              <div className="space-y-1.5">
                {Object.entries(statusCount).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{bookingStatusLabel(status)}</span>
                    <span className="font-medium text-gray-800">{count}件</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="text-xs text-gray-600 text-center">
        ※ MAU/DAU は「予約を行ったユニークユーザー数」で計算しています。
        MAU は今月1日からの人数で、前月同期比は前月の同じ日数分と比べた増減です。
        より詳細なページビュー分析は
        <Link href="/admin/analytics" className="text-sky-700 hover:underline mx-1">分析ダッシュボード</Link>
        をご利用ください。
      </div>
    </div>
  );
}
