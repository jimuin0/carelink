import { notFound } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { createServerSupabaseClient } from '@/lib/supabase-server';
import type { Facility } from '@/types';

// 【2026年7月8日 恒久根治】比較対象(searchParams.ids)はリクエスト毎に変わるため、他の
// DB駆動ページ(revalidate=3600で統一)とは異なりキャッシュしてはいけない。明示指定が無いのは
// 他ページとの一貫性を欠いていたため、意図を明確化する（Next.jsはsearchParams利用で実質的には
// 動的レンダリングされるが、明示宣言により将来の変更でも挙動が保証される）。
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  // ルート layout の title.template '%s | CareLink' が自動付与するため「| CareLink」は付けない（二重化防止）。
  title: '施設比較',
  robots: { index: false, follow: false },
};

interface Props {
  searchParams: Promise<{ ids?: string }>;
}

export default async function ComparePage(props: Props) {
  const searchParams = await props.searchParams;
  const ids = searchParams.ids?.split(',').filter(Boolean).slice(0, 3) || [];
  if (ids.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-12 text-center">
        <h1 className="text-xl font-bold mb-4">施設比較</h1>
        <p className="text-gray-500 mb-6">比較する施設を選んでください。検索結果で「比較」ボタンを押すと追加できます。</p>
        <Link href="/search" className="btn-primary">施設を探す</Link>
      </div>
    );
  }

  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from('facility_profiles')
    .select('id, name, slug, business_type, prefecture, city, access_info, nearest_station, rating_avg, rating_count, main_photo_url, seat_count, phone, parking, credit_card, features, regular_holiday, business_hours')
    .in('id', ids)
    .eq('status', 'published');

  const facilities = (data || []) as Facility[];
  if (facilities.length === 0) notFound();

  // Get min/max prices
  // 【2026年7月8日 恒久根治】従来は比較対象施設(最大3件)ごとに facility_menus を個別クエリする
  // N+1 だった。.in('facility_id', ids) 一発で全施設分をまとめて取得し、JS側で facility_id ごとに
  // グルーピングする（.order('price') は結果セット全体への適用だが、facility_id で絞り込んでも
  // 元の相対順序は保たれるため、施設ごとの min/max 抽出は従来と同じ結果になる）。
  const { data: allMenus } = await supabase
    .from('facility_menus')
    .select('facility_id, price')
    .in('facility_id', facilities.map((f) => f.id))
    .not('price', 'is', null)
    // 非公開メニューは比較ページの価格帯に含めない。null/true は表示(既存維持)。
    .or('is_published.is.null,is_published.eq.true')
    .order('price');
  const priceMap = Object.fromEntries(
    facilities.map((f) => {
      const prices = (allMenus || [])
        .filter((m) => m.facility_id === f.id)
        .map((m) => m.price)
        .filter((p): p is number => p !== null && p > 0);
      return [f.id, { min: prices[0] ?? null, max: prices[prices.length - 1] ?? null }];
    })
  );

  const rows: { label: string; render: (f: Facility) => React.ReactNode }[] = [
    { label: '業種', render: (f) => f.business_type },
    { label: '評価', render: (f) => f.rating_count > 0 ? `${Number(f.rating_avg).toFixed(1)} (${f.rating_count}件)` : '-' },
    { label: '価格帯', render: (f) => {
      const p = priceMap[f.id];
      if (!p?.min) return '-';
      return p.min === p.max ? `¥${p.min.toLocaleString()}` : `¥${p.min.toLocaleString()}〜¥${p.max!.toLocaleString()}`;
    }},
    { label: '所在地', render: (f) => `${f.prefecture}${f.city}` },
    { label: '最寄り駅', render: (f) => f.nearest_station || '-' },
    { label: '席数', render: (f) => f.seat_count ? `${f.seat_count}席` : '-' },
    { label: '駐車場', render: (f) => f.parking ? 'あり' : '-' },
    { label: 'クレカ', render: (f) => f.credit_card ? '利用可' : '-' },
    { label: '定休日', render: (f) => f.regular_holiday || '-' },
    { label: '特徴', render: (f) => f.features?.length > 0 ? (
      <div className="flex flex-wrap gap-1">
        {f.features.slice(0, 5).map((t) => (
          <span key={t} className="text-micro bg-gray-100 px-1.5 py-0.5 rounded">{t}</span>
        ))}
      </div>
    ) : '-' },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-xl font-bold mb-6">施設比較</h1>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="w-24 sticky left-0 bg-white z-20" />
              {facilities.map((f) => (
                <th key={f.id} className="p-2 text-center min-w-[200px]">
                  <Link href={`/facility/${f.slug}`} className="block group">
                    <div className="relative aspect-[16/10] rounded-lg overflow-hidden bg-gray-100 mb-2">
                      {f.main_photo_url ? (
                        <Image src={f.main_photo_url} alt={f.name} fill className="object-cover" sizes="200px" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300">
                          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" /></svg>
                        </div>
                      )}
                    </div>
                    <p className="font-bold text-sm group-hover:text-sky-600 transition-colors">{f.name}</p>
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-t border-gray-100">
                <td className="py-3 pr-3 text-gray-500 font-medium whitespace-nowrap sticky left-0 bg-white z-10">{row.label}</td>
                {facilities.map((f) => (
                  <td key={f.id} className="py-3 px-2 text-center">{row.render(f)}</td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-gray-100">
              <td className="py-3 sticky left-0 bg-white z-10" />
              {facilities.map((f) => (
                <td key={f.id} className="py-3 px-2 text-center">
                  <Link href={`/facility/${f.slug}/booking`} className="btn-primary text-xs !py-2 !px-4">
                    予約する
                  </Link>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
