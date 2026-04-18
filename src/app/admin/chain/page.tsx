import type { Metadata } from 'next';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import BulkActions from './BulkActions';

export const metadata: Metadata = { title: 'チェーン一括管理' };
export const dynamic = 'force-dynamic';

interface FacilityStat {
  id: string;
  name: string;
  slug: string;
  prefecture: string;
  city: string;
  is_published: boolean;
  booking_count: number;
  review_count: number;
  rating_avg: number;
  monthly_bookings: number;
  nps_score: number | null;
}

export default async function ChainManagementPage() {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login?redirect=/admin/chain');

  const { data: memberships } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin']);

  if (!memberships || memberships.length < 2) {
    return (
      <div className="space-y-4 max-w-2xl">
        <h1 className="text-xl font-bold">チェーン一括管理</h1>
        <div className="bg-white rounded-xl p-8 text-center text-gray-500 text-sm">
          複数の施設を管理している場合にご利用いただける機能です。
          <br />
          <Link href="/admin" className="text-sky-600 hover:underline mt-2 inline-block">管理画面に戻る</Link>
        </div>
      </div>
    );
  }

  const facilityIds = memberships.map((m) => m.facility_id);

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 施設基本情報
  const { data: facilities } = await admin
    .from('facility_profiles')
    .select('id, name, slug, prefecture, city, is_published')
    .in('id', facilityIds)
    .order('name');

  // 予約数（全期間・今月）
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data: allBookings } = await admin
    .from('bookings')
    .select('facility_id, created_at')
    .in('facility_id', facilityIds);

  // レビュー統計
  const { data: reviews } = await admin
    .from('reviews')
    .select('facility_id, rating')
    .in('facility_id', facilityIds)
    .eq('is_approved', true);

  // NPS
  const { data: npsData } = await admin
    .from('nps_surveys')
    .select('facility_id, score')
    .in('facility_id', facilityIds);

  // 集計
  const stats: FacilityStat[] = (facilities ?? []).map((f) => {
    const fBookings = (allBookings ?? []).filter((b) => b.facility_id === f.id);
    const fReviews = (reviews ?? []).filter((r) => r.facility_id === f.id);
    const fNps = (npsData ?? []).filter((n) => n.facility_id === f.id);
    const monthlyBookings = fBookings.filter((b) => b.created_at >= monthStart).length;
    const avgRating = fReviews.length > 0 ? fReviews.reduce((s, r) => s + r.rating, 0) / fReviews.length : 0;

    let npsScore: number | null = null;
    if (fNps.length > 0) {
      const promoters = fNps.filter((n) => n.score >= 9).length;
      const detractors = fNps.filter((n) => n.score <= 6).length;
      npsScore = Math.round(((promoters - detractors) / fNps.length) * 100);
    }

    return {
      id: f.id,
      name: f.name,
      slug: f.slug,
      prefecture: f.prefecture ?? '',
      city: f.city ?? '',
      is_published: f.is_published,
      booking_count: fBookings.length,
      review_count: fReviews.length,
      rating_avg: avgRating,
      monthly_bookings: monthlyBookings,
      nps_score: npsScore,
    };
  });

  const totalBookings = stats.reduce((s, f) => s + f.booking_count, 0);
  const totalMonthly = stats.reduce((s, f) => s + f.monthly_bookings, 0);
  const totalReviews = stats.reduce((s, f) => s + f.review_count, 0);
  const publishedCount = stats.filter((f) => f.is_published).length;

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold">チェーン一括管理</h1>
        <p className="text-xs text-gray-400 mt-0.5">{stats.length}施設の統合レポート</p>
      </div>

      {/* サマリーカード */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: '管理施設数', value: stats.length, sub: `公開中 ${publishedCount}施設`, color: 'text-sky-600' },
          { label: '総予約数', value: totalBookings.toLocaleString(), sub: `今月 ${totalMonthly}件`, color: 'text-green-600' },
          { label: '総口コミ数', value: totalReviews.toLocaleString(), sub: '承認済み', color: 'text-amber-600' },
          { label: '今月の予約', value: totalMonthly, sub: '全施設合計', color: 'text-purple-600' },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs text-gray-500 mb-1">{card.label}</p>
            <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
            <p className="text-xs text-gray-400 mt-0.5">{card.sub}</p>
          </div>
        ))}
      </div>

      {/* 施設一覧テーブル */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="font-bold text-sm">施設別パフォーマンス</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">施設名</th>
                <th className="text-left px-4 py-2.5 text-xs text-gray-500 font-medium">エリア</th>
                <th className="text-center px-3 py-2.5 text-xs text-gray-500 font-medium">公開</th>
                <th className="text-right px-3 py-2.5 text-xs text-gray-500 font-medium">今月予約</th>
                <th className="text-right px-3 py-2.5 text-xs text-gray-500 font-medium">累計予約</th>
                <th className="text-right px-3 py-2.5 text-xs text-gray-500 font-medium">口コミ</th>
                <th className="text-right px-3 py-2.5 text-xs text-gray-500 font-medium">評価</th>
                <th className="text-right px-3 py-2.5 text-xs text-gray-500 font-medium">NPS</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {stats.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50/50">
                  <td className="px-4 py-3">
                    <Link href={`/admin?fid=${f.id}`} className="font-medium text-gray-800 hover:text-sky-600 transition-colors">
                      {f.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{f.prefecture} {f.city}</td>
                  <td className="px-3 py-3 text-center">
                    <span className={`inline-block w-2 h-2 rounded-full ${f.is_published ? 'bg-green-500' : 'bg-gray-300'}`} />
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-gray-800">{f.monthly_bookings}</td>
                  <td className="px-3 py-3 text-right text-gray-500">{f.booking_count.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right text-gray-500">{f.review_count}</td>
                  <td className="px-3 py-3 text-right">
                    {f.review_count > 0 ? (
                      <span className="text-amber-500 font-medium">
                        ★{f.rating_avg.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {f.nps_score !== null ? (
                      <span className={`font-medium ${f.nps_score >= 50 ? 'text-green-600' : f.nps_score >= 0 ? 'text-yellow-600' : 'text-red-500'}`}>
                        {f.nps_score > 0 ? '+' : ''}{f.nps_score}
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/facility/${f.slug}`} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-sky-600 hover:underline">公開ページ →</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 一括操作 */}
      <BulkActions
        facilityIds={facilityIds}
        facilityNames={(facilities ?? []).map((f) => ({ id: f.id, name: f.name }))}
      />
    </div>
  );
}
