import type { Metadata } from 'next';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { notFound } from 'next/navigation';
import { jstMonthStartIso, jstMonthInfo } from '@/lib/admin-date';
import { SbPageHeader } from '@/components/admin/SbUi';

export const metadata: Metadata = { title: 'コンバージョンファネル' };
export const dynamic = 'force-dynamic';

export default async function FunnelPage() {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: mem } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .limit(1).single();
  if (!mem) notFound();

  const facilityId = mem.facility_id;
  const admin = createServiceRoleClient();

  const since = jstMonthStartIso(-1);

  // ファネル各ステップのデータ。ページ閲覧は facility_page_views（時系列記録）を
  // 同じ期間窓で集計し、ファネルの最上段に置く（view_count は累積値のため期間窓に使わない）。
  const [
    { count: pageViews },
    { count: bookingStarts },
    { count: bookingCompleted },
    { count: reviewPosted },
  ] = await Promise.all([
    // ページ閲覧（施設ページの閲覧記録）
    admin.from('facility_page_views').select('id', { count: 'exact', head: true })
      .eq('facility_id', facilityId).gte('created_at', since),
    // 予約開始（全ステータス）
    admin.from('bookings').select('id', { count: 'exact', head: true })
      .eq('facility_id', facilityId).gte('created_at', since),
    // 予約確定（確定以降＝confirmed/arrived/completed）。arrived（受付＝確定後に来店中）の
    // 取りこぼしで確定数を過少集計しない。cancelled/no_show は pending からの遷移も有り得て
    // 「確定した」とは断定できないため除外する。
    admin.from('bookings').select('id', { count: 'exact', head: true })
      .eq('facility_id', facilityId).gte('created_at', since)
      .in('status', ['confirmed', 'arrived', 'completed']),
    // レビュー投稿
    admin.from('facility_reviews').select('id', { count: 'exact', head: true })
      .eq('facility_id', facilityId).gte('created_at', since),
  ]);

  const views = pageViews ?? 0;
  const totalBookings = bookingStarts ?? 0;
  const confirmedBookings = bookingCompleted ?? 0;
  const reviews = reviewPosted ?? 0;

  // ファネル（ページ閲覧を基準）
  const steps = [
    {
      label: 'ページ閲覧',
      count: views,
      color: 'bg-sky-500',
      description: '施設ページの閲覧',
    },
    {
      label: '予約開始',
      count: totalBookings,
      color: 'bg-indigo-500',
      description: '予約フォームから',
    },
    {
      label: '予約確定',
      count: confirmedBookings,
      color: 'bg-green-500',
      description: '確定・受付・完了',
    },
    {
      label: 'レビュー投稿',
      count: reviews,
      color: 'bg-amber-500',
      description: '来店後のフィードバック',
    },
  ];

  const maxCount = Math.max(...steps.map((s) => s.count), 1);

  // 各ステップの転換率
  const conversionRates = steps.map((step, i) => {
    if (i === 0) return null;
    const prev = steps[i - 1].count;
    if (prev === 0) return null;
    return Math.round((step.count / prev) * 100);
  });

  // 月別予約推移（過去6ヶ月・JST 月境界）
  const monthlyBookings: { month: string; total: number; confirmed: number }[] = [];

  const { data: allBookings } = await admin
    .from('bookings')
    .select('created_at, status')
    .eq('facility_id', facilityId)
    .gte('created_at', jstMonthStartIso(-6));

  for (let i = 5; i >= 0; i--) {
    const start = jstMonthStartIso(-i);
    const end = jstMonthStartIso(-i + 1);
    const label = `${jstMonthInfo(-i).month}月`;
    const month = (allBookings ?? []).filter((b) => b.created_at >= start && b.created_at < end);
    monthlyBookings.push({
      month: label,
      total: month.length,
      confirmed: month.filter((b) => ['confirmed', 'arrived', 'completed'].includes(b.status)).length,
    });
  }

  const maxMonthly = Math.max(...monthlyBookings.map((m) => m.total), 1);

  return (
    <div className="space-y-6 max-w-4xl">
      <SbPageHeader title="コンバージョンファネル" description="ページ閲覧から予約開始・確定・レビューまでの転換率" />

      {/* ファネルチャート */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="font-bold text-sm mb-5">過去30日間のファネル</h2>
        <div className="space-y-3">
          {steps.map((step, i) => {
            const pct = Math.round((step.count / maxCount) * 100);
            const cvRate = conversionRates[i];
            return (
              <div key={step.label}>
                {cvRate !== null && (
                  <div className="flex items-center gap-2 mb-1 ml-4">
                    <div className="w-px h-4 bg-gray-200 mx-2" />
                    <span className={`text-xs font-medium ${cvRate >= 50 ? 'text-green-600' : cvRate >= 20 ? 'text-yellow-600' : 'text-red-500'}`}>
                      ↓ 転換率 {cvRate}%
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className="w-28 shrink-0 text-right">
                    <p className="text-sm font-medium text-gray-700">{step.label}</p>
                    <p className="text-xs text-gray-400">{step.description}</p>
                  </div>
                  <div className="flex-1 bg-gray-100 rounded-lg h-10 overflow-hidden relative">
                    <div
                      className={`h-full ${step.color} rounded-lg transition-all flex items-center justify-end pr-3`}
                      style={{ width: `${Math.max(pct, 3)}%` }}
                    >
                      <span className="text-white text-sm font-bold">{step.count.toLocaleString()}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 総合コンバージョン率 */}
        {totalBookings > 0 && confirmedBookings > 0 && (
          <div className="mt-5 p-3 bg-green-50 rounded-lg">
            <p className="text-sm font-medium text-green-800">
              予約開始→予約確定の総合転換率:{' '}
              <span className="text-lg font-bold">{Math.round((confirmedBookings / totalBookings) * 100)}%</span>
            </p>
          </div>
        )}
      </div>

      {/* 月別予約推移 */}
      <div className="bg-white rounded-xl border border-gray-100 p-6">
        <h2 className="font-bold text-sm mb-5">月別予約推移（6ヶ月）</h2>
        <div className="space-y-2">
          {monthlyBookings.map((m) => (
            <div key={m.month} className="flex items-center gap-3">
              <span className="text-xs text-gray-500 w-8 shrink-0">{m.month}</span>
              <div className="flex-1 bg-gray-100 rounded-lg h-8 overflow-hidden relative">
                {/* 総予約（薄） */}
                <div
                  className="absolute inset-y-0 left-0 bg-sky-200 rounded-lg transition-all"
                  style={{ width: `${Math.max((m.total / maxMonthly) * 100, 0)}%` }}
                />
                {/* 確定予約（濃） */}
                <div
                  className="absolute inset-y-0 left-0 bg-sky-500 rounded-lg transition-all flex items-center justify-end pr-2"
                  style={{ width: `${Math.max((m.confirmed / maxMonthly) * 100, 0)}%` }}
                >
                  {m.confirmed > 0 && <span className="text-white text-xs font-bold">{m.confirmed}</span>}
                </div>
              </div>
              <span className="text-xs text-gray-400 w-14 text-right shrink-0">
                計 {m.total}件
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
          <div className="flex items-center gap-1"><div className="w-3 h-3 bg-sky-500 rounded" /><span>確定予約</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-3 bg-sky-200 rounded" /><span>総予約数</span></div>
        </div>
      </div>
    </div>
  );
}
