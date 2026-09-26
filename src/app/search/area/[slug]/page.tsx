import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getAreaBySlug, getAreasByParent, getAreaBreadcrumb, buildAreaSearchParam } from '@/lib/areas';
import { searchAreaFacilities } from '@/lib/area-facilities';
import FacilityCard from '@/components/search/FacilityCard';
import Pagination from '@/components/search/Pagination';

export const revalidate = 3600;

export async function generateStaticParams() {
  const { createServerSupabaseClient } = await import('@/lib/supabase-server');
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase.from('areas').select('slug');
  if (error || !Array.isArray(data)) throw new Error('Static area list unavailable');
  return data.map((a) => ({ slug: a.slug }));
}

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const area = await getAreaBySlug(params.slug);
  if (!area) return {};
  // ルート layout の title.template '%s | CareLink' が自動付与するため、
  // metadata.title には「| CareLink」を付けない（付けると二重化する）。openGraph.title はテンプレ非適用のため付与する。
  const title = `${area.name}のサロン・クリニック`;
  const description = `${area.name}エリアの美容・医療・福祉施設を検索。口コミ・メニュー・クーポン情報も掲載。`;
  return {
    title,
    description,
    alternates: { canonical: `/search/area/${params.slug}` },
    openGraph: { title: `${title} | CareLink`, description, type: 'website' },
  };
}

export default async function AreaResultPage(props: Props) {
  const params = await props.params;
  const searchParams = await props.searchParams;
  const area = await getAreaBySlug(params.slug);
  if (!area) notFound();

  const [children, breadcrumb] = await Promise.all([
    getAreasByParent(area.id),
    getAreaBreadcrumb(area),
  ]);

  // Search facilities by prefecture or city（フィルタ組み立ては buildAreaSearchParam 参照）
  const searchParam = buildAreaSearchParam(area, breadcrumb, children);

  let currentPage = 1;
  if (searchParams.page !== undefined) {
    const rawPage = searchParams.page;
    if (Array.isArray(rawPage) || !/^[1-9]\d{0,5}$/.test(rawPage) || Number(rawPage) > 100000) notFound();
    currentPage = Number(rawPage);
  }
  // 【2026年7月8日 恒久根治】従来はページネーションが一切なく、PER_PAGE(20件)超のエリアで
  // 21件目以降が無言で切り捨てられ、ユーザーが残りの施設を確認する手段が無かった。
  // /search と同じ Pagination コンポーネントを使い、total 件数に基づくページ送りを提供する。
  const { facilities, total, perPage } = await searchAreaFacilities(searchParam, currentPage);
  const totalPages = Math.ceil(total / perPage);
  const baseUrl = `/search/area/${params.slug}`;

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Breadcrumb */}
        <nav className="mb-4" aria-label="パンくずリスト">
          <ol className="flex items-center gap-1.5 text-xs text-gray-400 flex-wrap">
            <li>
              <Link href="/search/area" className="hover:text-sky-600">エリア検索</Link>
            </li>
            {breadcrumb.map((b, i) => (
              <li key={b.id} className="flex items-center gap-1.5">
                <span>/</span>
                {i === breadcrumb.length - 1 ? (
                  <span className="text-gray-600 font-medium">{b.name}</span>
                ) : (
                  <Link href={`/search/area/${b.slug}`} className="hover:text-sky-600">{b.name}</Link>
                )}
              </li>
            ))}
          </ol>
        </nav>

        <h1 className="text-2xl font-bold mb-6">{area.name}のサロン・クリニック</h1>
        {area.area_type === 'station' && <p className="text-sm mb-4">祖先エリア内で、最寄駅欄に「{area.name}」を含む施設を表示します。駅名の部分一致検索であり、同じ文字を含む別の駅も該当する場合があります。</p>}
        {area.area_type === 'region' && <p className="text-sm mb-4">このエリアに登録された都道府県を対象に表示します。</p>}

        {/* Sub-areas */}
        {children.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-bold text-gray-500 mb-3">エリアを絞り込む</h2>
            <div className="flex flex-wrap gap-2">
              {children.map((child) => (
                <Link
                  key={child.id}
                  href={`/search/area/${child.slug}`}
                  className="text-sm px-4 py-2 rounded-full bg-white border border-gray-200 hover:bg-sky-50 hover:text-primary transition-colors"
                >
                  {child.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Results */}
        {facilities.length > 0 ? (
          <>
            <div className="grid sm:grid-cols-2 gap-6">
              {facilities.map((f) => (
                <FacilityCard key={f.id} facility={f} />
              ))}
            </div>
            <Pagination currentPage={currentPage} totalPages={totalPages} baseUrl={baseUrl} />
          </>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            <p className="text-gray-400">{searchParam.kind === 'region' && searchParam.prefectures.length === 0
              ? '下位エリアの登録準備中です。キーワード検索をご利用ください。'
              : total > 0 ? 'このページに該当する施設はありません。前のページをご確認ください。'
                : 'このエリアにはまだサロン・クリニックが登録されていません'}</p>
            {total > 0 && <Pagination currentPage={currentPage} totalPages={totalPages} baseUrl={baseUrl} />}
          </div>
        )}
      </div>
    </div>
  );
}
