import type { Metadata } from 'next';
import { createServerSupabaseAuthClient } from '@/lib/supabase-server-auth';
import { createClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import BulkActions from './BulkActions';
import { jstMonthStartIso } from '@/lib/admin-date';
import { SbTable, SbThead, SbTh, SbTbody, SbTd, SbPageHeader } from '@/components/admin/SbUi';
import { formatFacilityLocality } from '@/lib/facility-location';
import { formatReviewAverage, readFacilitiesReviewRatings, type ReviewRatingSummary } from '@/lib/review-rating-summary';
import { z } from 'zod';

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
  monthly_bookings: number;
  /** 公開中の口コミの総合・項目別評価（旧 NPS 列の置き換え・2026年10月22日） */
  ratings: ReviewRatingSummary;
}

export default async function ChainManagementPage() {
  const supabase = await createServerSupabaseAuthClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect('/auth/login?redirect=/admin/chain');

  const { data: memberships, error: membershipError } = await supabase
    .from('facility_members')
    .select('facility_id')
    .eq('user_id', user.id)
    .in('role', ['owner', 'admin']);
  if (membershipError || !Array.isArray(memberships) || memberships.length > 100) throw new Error('管理店舗の取得に失敗しました');

  if (!memberships || memberships.length < 2) {
    return (
      <div className="space-y-4 max-w-2xl">
        <SbPageHeader title="チェーン一括管理" />
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
  const { data: facilities, error: facilityError } = await admin
    .from('facility_profiles')
    .select('id, name, slug, prefecture, city, status')
    .in('id', facilityIds)
    .order('name');

  // 予約数（全期間・今月＝JST 月境界）
  const monthStart = jstMonthStartIso(0);

  const { data: measured, error: statisticsError } = await admin.rpc('get_chain_statistics', {
    p_actor_id: user.id, p_facility_ids: facilityIds, p_month_start: monthStart,
  });
  // RPC は review_count / rating_avg / nps_score も返すが使わない。口コミの数と評価は下の
  // readFacilitiesReviewRatings（公開中の口コミの総合＋項目別）を単一ソースにする。NPS は回答の
  // 経路がどこにも無く常に空だった（2026年10月22日に口コミ評価へ置き換え）。
  const statistics = z.array(z.object({ id: z.uuid(), booking_count: z.number().int().nonnegative(),
    monthly_bookings: z.number().int().nonnegative(),
  })).safeParse(measured);

  // 所属（owner/admin）を確かめた店舗 ID だけを service role で読む（上の facility_members と同じ集合）。
  const { summaries: ratings, error: ratingsError } = await readFacilitiesReviewRatings(admin, facilityIds);

  // An unavailable source is not a measured zero. Do not publish partially
  // fabricated statistics when any of the required reads failed.
  if (facilityError || statisticsError || ratingsError || !Array.isArray(facilities) || !statistics.success
    || facilities.length !== facilityIds.length || statistics.data.length !== facilityIds.length
    || new Set(statistics.data.map(s => s.id)).size !== facilityIds.length
    || statistics.data.some(s => !facilityIds.includes(s.id))) {
    throw new Error('店舗別集計の取得に失敗しました');
  }

  // 集計
  const stats: FacilityStat[] = (facilities ?? []).map((f) => {
    const measured = statistics.data.find(s => s.id === f.id);
    const rating = ratings.get(f.id);
    if (!measured || !rating) throw new Error('店舗別集計の対応関係を確認できません');

    return {
      id: f.id,
      name: f.name,
      slug: f.slug,
      prefecture: f.prefecture ?? '',
      city: f.city ?? '',
      is_published: f.status === 'published',
      booking_count: measured.booking_count,
      monthly_bookings: measured.monthly_bookings,
      ratings: rating,
    };
  });

  const totalBookings = stats.reduce((s, f) => s + f.booking_count, 0);
  const totalMonthly = stats.reduce((s, f) => s + f.monthly_bookings, 0);
  const totalReviews = stats.reduce((s, f) => s + f.ratings.count, 0);
  const publishedCount = stats.filter((f) => f.is_published).length;

  return (
    <div className="space-y-6 max-w-5xl">
      <SbPageHeader title="チェーン一括管理" description={`${stats.length}施設の統合レポート`} />

      {/* サマリーカード */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: '管理施設数', value: stats.length, sub: `公開中 ${publishedCount}施設`, color: 'text-sky-600' },
          { label: '総予約数', value: totalBookings.toLocaleString(), sub: `今月 ${totalMonthly}件`, color: 'text-green-600' },
          { label: '総口コミ数', value: totalReviews.toLocaleString(), sub: '公開中', color: 'text-amber-600' },
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
        <SbTable>
          <SbThead>
            <SbTh>施設名</SbTh>
            <SbTh>エリア</SbTh>
            <SbTh align="center">公開</SbTh>
            <SbTh align="right">今月予約</SbTh>
            <SbTh align="right">累計予約</SbTh>
            <SbTh align="right">口コミ</SbTh>
            <SbTh align="right">総合評価</SbTh>
            <SbTh>項目別評価</SbTh>
            <SbTh />
          </SbThead>
          <SbTbody>
            {stats.map((f) => (
              <tr key={f.id} className="hover:bg-gray-50/50">
                <SbTd>
                  <Link href={`/admin?fid=${f.id}`} className="font-medium text-gray-800 hover:text-sky-600 transition-colors">
                    {f.name}
                  </Link>
                </SbTd>
                <SbTd className="text-gray-500 text-xs">{f.prefecture} {formatFacilityLocality(f.prefecture, f.city)}</SbTd>
                <SbTd align="center">
                  <span className={`inline-block w-2 h-2 rounded-full ${f.is_published ? 'bg-green-500' : 'bg-gray-300'}`} />
                </SbTd>
                <SbTd align="right" className="font-medium text-gray-800">{f.monthly_bookings}</SbTd>
                <SbTd align="right" className="text-gray-500">{f.booking_count.toLocaleString()}</SbTd>
                <SbTd align="right" className="text-gray-500">{f.ratings.count}</SbTd>
                <SbTd align="right">
                  {f.ratings.count > 0 ? (
                    <span className="font-medium text-gray-800 whitespace-nowrap">
                      <span className="text-amber-500" aria-hidden="true">★</span>{formatReviewAverage(f.ratings.overall)}
                    </span>
                  ) : (
                    <span className="text-gray-500">—</span>
                  )}
                </SbTd>
                <SbTd className="text-xs">
                  {f.ratings.count > 0 ? (
                    <dl className="grid grid-cols-[auto_auto] gap-x-2 gap-y-0.5 whitespace-nowrap">
                      {f.ratings.items.map((item) => (
                        <div key={item.key} className="contents">
                          <dt className="text-gray-600">{item.label}</dt>
                          <dd className="text-right font-medium text-gray-800">{formatReviewAverage(item.average)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <span className="text-gray-500 whitespace-nowrap">まだ口コミがありません</span>
                  )}
                </SbTd>
                <SbTd>
                  <div className="flex gap-2 mb-2">
                    <Link href={`/admin/settings?facility_id=${f.id}`} className="text-xs text-sky-600 underline">店舗情報</Link>
                    <Link href={`/admin/photos?facility_id=${f.id}`} className="text-xs text-sky-600 underline">写真管理</Link>
                  </div>
                  <Link href={`/facility/${f.slug}`} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-sky-600 hover:underline">公開ページ →</Link>
                </SbTd>
              </tr>
            ))}
          </SbTbody>
        </SbTable>
      </div>

      {/* 一括操作 */}
      <BulkActions
        facilityIds={facilityIds}
        facilityNames={(facilities ?? []).map((f) => ({ id: f.id, name: f.name }))}
      />
    </div>
  );
}
