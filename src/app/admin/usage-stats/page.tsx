import type { Metadata } from 'next';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createServiceRoleClient } from '@/lib/supabase-server';
import { notFound } from 'next/navigation';
import Link from 'next/link';

export const metadata: Metadata = { title: '利用状況分析' };
export const dynamic = 'force-dynamic';

function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function monthsAgo(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default async function UsageStatsPage() {
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

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekAgo = daysAgo(7);
  const monthAgo = monthsAgo(1);
  const prevMonthAgo = monthsAgo(2);

  // 予約データ
  const { data: allBookings } = await admin
    .from('bookings')
    .select('user_id, created_at, status')
    .eq('facility_id', facilityId)
    .gte('created_at', monthsAgo(12));

  const bookings = allBookings ?? [];

  // DAU (今日の予約ユニークユーザー)
  const dauUsers = new Set(bookings.filter((b) => b.created_at >= today).map((b) => b.user_id));
  const wauUsers = new Set(bookings.filter((b) => b.created_at >= weekAgo).map((b) => b.user_id));
  const mauUsers = new Set(bookings.filter((b) => b.created_at >= monthAgo).map((b) => b.user_id));
  const prevMauUsers = new Set(bookings.filter((b) => b.created_at >= prevMonthAgo && b.created_at < monthAgo).map((b) => b.user_id));

  const mauGrowth = prevMauUsers.size > 0 ? Math.round(((mauUsers.size - prevMauUsers.size) / prevMauUsers.size) * 100) : null;

  // リピート率
  const userBookingCount: Record<string, number> = {};
  for (const b of bookings) {
    userBookingCount[b.user_id] = (userBookingCount[b.user_id] ?? 0) + 1;
  }
  const totalUsers = Object.keys(userBookingCount).length;
  const repeatUsers = Object.values(userBookingCount).filter((c) => c > 1).length;
  const repeatRate = totalUsers > 0 ? Math.round((repeatUsers / totalUsers) * 100) : 0;

  // 月別 MAU（直近6ヶ月）
  const monthlyData: { month: string; mau: number; bookings: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const label = `${start.getMonth() + 1}月`;
    const monthBookings = bookings.filter((b) => b.created_at >= start.toISOString() && b.created_at < end.toISOString());
    const uniqueUsers = new Set(monthBookings.map((b) => b.user_id));
    monthlyData.push({ month: label, mau: uniqueUsers.size, bookings: monthBookings.length });
  }

  // 予約ステータス分布
  const statusCount: Record<string, number> = {};
  for (const b of bookings.filter((b) => b.created_at >= monthAgo)) {
    statusCount[b.status] = (statusCount[b.status] ?? 0) + 1;
  }

  // NPS
  const { data: npsData } = await admin
    .from('nps_surveys')
    .select('score')
    .eq('facility_id', facilityId);

  const npsScores = (npsData ?? []).map((n) => n.score);
  const npsPromoters = npsScores.filter((s) => s >= 9).length;
  const npsDetractors = npsScores.filter((s) => s <= 6).length;
  const nps = npsScores.length > 0 ? Math.round(((npsPromoters - npsDetractors) / npsScores.length) * 100) : null;

  const maxMau = Math.max(...monthlyData.map((m) => m.mau), 1);

  const STATUS_LABELS: Record<string, string> = {
    confirmed: '確定',
    pending: '保留',
    cancelled: 'キャンセル',
    completed: '完了',
    no_show: '無断キャンセル',
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold">利用状況分析</h1>
        <p className="text-xs text-gray-400 mt-0.5">ユーザーの利用頻度・継続率を可視化</p>
      </div>

      {/* KPIカード */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'DAU（今日）', value: dauUsers.size, sub: '今日予約したユーザー', color: 'text-sky-600' },
          { label: 'WAU（週間）', value: wauUsers.size, sub: '過去7日間', color: 'text-indigo-600' },
          { label: 'MAU（月間）', value: mauUsers.size, sub: mauGrowth !== null ? `前月比 ${mauGrowth > 0 ? '+' : ''}${mauGrowth}%` : '今月', color: 'text-green-600' },
          { label: 'リピート率', value: `${repeatRate}%`, sub: `${repeatUsers}/${totalUsers}人`, color: 'text-amber-600' },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs text-gray-500 mb-1">{card.label}</p>
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{card.sub}</p>
          </div>
        ))}
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
                    <span className="text-gray-600">{STATUS_LABELS[status] ?? status}</span>
                    <span className="font-medium text-gray-800">{count}件</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="text-xs text-gray-400 text-center">
        ※ MAU/DAU は「予約を行ったユニークユーザー数」で計算しています。
        より詳細なページビュー分析は
        <Link href="/admin/analytics" className="text-sky-600 hover:underline mx-1">分析ダッシュボード</Link>
        をご利用ください。
      </div>
    </div>
  );
}
