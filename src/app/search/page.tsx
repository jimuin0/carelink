import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { searchFacilities, getMonthlyBookingCounts, getAvailableFacilityIds } from '@/lib/facilities';
import SearchBar from '@/components/search/SearchBar';
import nextDynamic from 'next/dynamic';
import Pagination from '@/components/search/Pagination';
const SearchFilters = nextDynamic(() => import('@/components/search/SearchFilters'));
const MobileFilterButton = nextDynamic(() => import('@/components/search/MobileFilterButton'), { ssr: false });
const ViewToggle = nextDynamic(() => import('@/components/search/ViewToggle'), { ssr: false });

export const dynamic = 'force-dynamic';

import { SITE_URL } from '@/lib/constants';

interface Props {
  searchParams: {
    keyword?: string; type?: string; area?: string; sort?: string; page?: string;
    rating_min?: string; price_min?: string; price_max?: string; features?: string;
    lat?: string; lng?: string; available_date?: string; available_time?: string;
  };
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const parts: string[] = [];
  if (searchParams.area) parts.push(searchParams.area);
  if (searchParams.type) parts.push(searchParams.type);
  if (searchParams.keyword) parts.push(`「${searchParams.keyword}」`);

  const titlePrefix = parts.length > 0 ? `${parts.join('の')}` : 'サロン・クリニック';
  const currentPage = parseInt(searchParams.page || '1');
  const title = currentPage > 1 ? `${titlePrefix}検索（${currentPage}ページ目）` : `${titlePrefix}検索`;
  const description = parts.length > 0
    ? `${titlePrefix}の一覧。メニュー・料金・口コミを比較して予約できます。`
    : '美容サロン・鍼灸院・整骨院・介護施設・病院を検索。エリア・業種で簡単に探せます。メニュー・料金・口コミもチェック。';

  const params = new URLSearchParams();
  if (searchParams.type) params.set('type', searchParams.type);
  if (searchParams.area) params.set('area', searchParams.area);
  if (searchParams.keyword) params.set('keyword', searchParams.keyword);
  const canonical = params.toString() ? `/search?${params.toString()}` : '/search';

  const hasFilters = !!(searchParams.rating_min || searchParams.price_min || searchParams.price_max || searchParams.features);
  const shouldNoIndex = hasFilters || currentPage > 1;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description },
    robots: shouldNoIndex ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const validSorts = ['rating', 'newest', 'popular'] as const;
  const sort = validSorts.includes(searchParams.sort as typeof validSorts[number])
    ? (searchParams.sort as typeof validSorts[number])
    : 'newest';

  const params = {
    keyword: searchParams.keyword,
    type: searchParams.type,
    prefecture: searchParams.area,
    sort,
    page: searchParams.page ? (parseInt(searchParams.page) || 1) : 1,
    city: undefined as string | undefined,
    rating_min: searchParams.rating_min ? parseFloat(searchParams.rating_min) : undefined,
    price_min: searchParams.price_min ? parseInt(searchParams.price_min) : undefined,
    price_max: searchParams.price_max ? parseInt(searchParams.price_max) : undefined,
    features: searchParams.features?.split(',').filter(Boolean),
    lat: searchParams.lat ? parseFloat(searchParams.lat) : undefined,
    lng: searchParams.lng ? parseFloat(searchParams.lng) : undefined,
    available_date: searchParams.available_date,
    available_time: searchParams.available_time,
  };

  const { facilities, total, perPage } = await searchFacilities(params);
  const totalPages = Math.ceil(total / perPage);

  // 緊急性シグナル: 当月予約件数 + 空き検索
  const facilityIds = facilities.map((f) => f.id);
  const [bookingCounts, availableIds] = await Promise.all([
    facilityIds.length > 0 ? getMonthlyBookingCounts(facilityIds) : Promise.resolve({}),
    searchParams.available_date && facilityIds.length > 0
      ? getAvailableFacilityIds(facilityIds, searchParams.available_date, searchParams.available_time)
      : Promise.resolve(null),
  ]);

  // Build base URL for pagination
  const baseParams = new URLSearchParams();
  if (searchParams.keyword) baseParams.set('keyword', searchParams.keyword);
  if (searchParams.type) baseParams.set('type', searchParams.type);
  if (searchParams.area) baseParams.set('area', searchParams.area);
  if (searchParams.sort) baseParams.set('sort', searchParams.sort);
  if (searchParams.rating_min) baseParams.set('rating_min', searchParams.rating_min);
  if (searchParams.price_min) baseParams.set('price_min', searchParams.price_min);
  if (searchParams.price_max) baseParams.set('price_max', searchParams.price_max);
  if (searchParams.features) baseParams.set('features', searchParams.features);
  if (searchParams.available_date) baseParams.set('available_date', searchParams.available_date);
  if (searchParams.available_time) baseParams.set('available_time', searchParams.available_time);
  const baseUrl = `/search?${baseParams.toString()}`;

  // Breadcrumb
  const breadcrumbs: { label: string; href?: string }[] = [{ label: 'トップ', href: '/' }];
  if (searchParams.type) breadcrumbs.push({ label: searchParams.type, href: `/search?type=${encodeURIComponent(searchParams.type)}` });
  if (searchParams.area) breadcrumbs.push({ label: searchParams.area });
  if (searchParams.keyword) breadcrumbs.push({ label: `「${searchParams.keyword}」` });
  if (breadcrumbs.length === 1) breadcrumbs.push({ label: 'サロン・クリニック検索' });

  const breadcrumbJsonLd = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: breadcrumbs.map((item, i) => ({
      "@type": "ListItem", position: i + 1, name: item.label,
      ...(item.href && { item: `${SITE_URL}${item.href}` }),
    })),
  };

  // Active filter count
  const filterCount = [searchParams.rating_min, searchParams.price_min, searchParams.price_max, searchParams.features].filter(Boolean).length;

  return (
    <div className="bg-gray-50 min-h-screen">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd).replace(/</g, '\\u003c').replace(/>/g, '\\u003e') }} />

      {/* Hero */}
      <section className="bg-gradient-to-br from-sky-50 to-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
          <nav className="mb-4" aria-label="パンくずリスト">
            <ol className="flex items-center gap-1.5 text-xs text-gray-400 flex-wrap">
              {breadcrumbs.map((item, i) => (
                <li key={i} className="flex items-center gap-1.5">
                  {i > 0 && <span>/</span>}
                  {item.href && i < breadcrumbs.length - 1 ? (
                    <Link href={item.href} className="hover:text-sky-600 transition-colors">{item.label}</Link>
                  ) : (
                    <span className="text-gray-600 font-medium">{item.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
          <h1 className="text-2xl sm:text-3xl font-bold text-center mb-6">サロン・クリニックを探す</h1>
          <Suspense fallback={null}><SearchBar /></Suspense>
        </div>
      </section>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-8">
          {/* デスクトップ: サイドバー */}
          <aside className="hidden lg:block w-64 shrink-0">
            <div className="sticky top-4">
              <Suspense fallback={null}>
                <SearchFilters className="bg-white rounded-2xl shadow-sm p-5" />
              </Suspense>
            </div>
          </aside>

          {/* メインコンテンツ */}
          <div className="flex-1 min-w-0">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <p className="text-gray-600 text-sm">
                <span className="font-bold text-gray-900 text-lg">{total}</span> 件見つかりました
                {filterCount > 0 && <span className="ml-2 text-xs text-sky-600">(フィルター{filterCount}件適用中)</span>}
              </p>
              <div className="flex items-center gap-2">
                <SortLink current={sort} value="newest" label="新着順" searchParams={searchParams} />
                <SortLink current={sort} value="rating" label="評価順" searchParams={searchParams} />
                <SortLink current={sort} value="popular" label="人気順" searchParams={searchParams} />
              </div>
            </div>

            {/* Cards/Map with view toggle */}
            {facilities.length > 0 ? (
              <>
                <ViewToggle facilities={facilities} bookingCounts={bookingCounts} availableIds={availableIds ? Array.from(availableIds) : undefined} />
                <Pagination currentPage={params.page} totalPages={totalPages} baseUrl={baseUrl} />
              </>
            ) : (
              <div className="space-y-6">
                {/* 0件メッセージ */}
                <div className="text-center py-12 bg-white rounded-xl">
                  <svg className="w-14 h-14 text-gray-200 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <p className="text-gray-700 font-bold mb-1">該当する施設が見つかりませんでした</p>
                  <p className="text-gray-400 text-sm mb-6">検索条件を変えて、もう一度お試しください</p>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center flex-wrap">
                    <Link href="/search" className="px-5 py-2.5 bg-sky-500 text-white rounded-lg text-sm font-bold hover:bg-sky-600 transition-colors">すべての施設を見る</Link>
                    {searchParams.type && (
                      <Link
                        href={`/search?${searchParams.area ? `area=${encodeURIComponent(searchParams.area)}` : ''}`}
                        className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-50 transition-colors"
                      >
                        業種を外して検索
                      </Link>
                    )}
                    {searchParams.area && (
                      <Link
                        href={`/search?${searchParams.type ? `type=${encodeURIComponent(searchParams.type)}` : ''}`}
                        className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-bold hover:bg-gray-50 transition-colors"
                      >
                        エリアを外して検索
                      </Link>
                    )}
                  </div>
                </div>

                {/* 人気エリア・業種 */}
                <div className="bg-white rounded-xl p-6">
                  <h3 className="text-sm font-bold text-gray-700 mb-4">人気の検索</h3>
                  <div className="flex flex-wrap gap-2">
                    {['大阪府', '東京都', '愛知県', '福岡県', '神奈川県'].map((area) => (
                      <Link
                        key={area}
                        href={`/search?area=${encodeURIComponent(area)}`}
                        className="px-3 py-1.5 bg-sky-50 text-sky-700 text-xs font-medium rounded-full hover:bg-sky-100 transition-colors"
                      >
                        {area}
                      </Link>
                    ))}
                    {['まつげ', '鍼灸院', '整骨院', 'ネイル', 'エステ'].map((type) => (
                      <Link
                        key={type}
                        href={`/search?type=${encodeURIComponent(type)}`}
                        className="px-3 py-1.5 bg-gray-100 text-gray-600 text-xs font-medium rounded-full hover:bg-gray-200 transition-colors"
                      >
                        {type}
                      </Link>
                    ))}
                  </div>
                </div>

                {/* 施設掲載CTA */}
                <div className="bg-gradient-to-r from-sky-50 to-indigo-50 rounded-xl p-6 flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-bold text-gray-800">お探しの施設が見つかりませんでしたか？</p>
                    <p className="text-sm text-gray-500 mt-0.5">CareLink は施設の無料掲載を受け付けています。オーナー様はぜひご登録を。</p>
                  </div>
                  <Link
                    href="/salon"
                    className="shrink-0 px-5 py-2.5 bg-sky-500 text-white text-sm font-bold rounded-lg hover:bg-sky-600 transition-colors"
                  >
                    無料で施設を掲載する
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* モバイル: フィルターボタン */}
      <MobileFilterButton filterCount={filterCount} />
    </div>
  );
}

function SortLink({ current, value, label, searchParams }: {
  current: string; value: string; label: string; searchParams: Props['searchParams'];
}) {
  const params = new URLSearchParams();
  if (searchParams.keyword) params.set('keyword', searchParams.keyword);
  if (searchParams.type) params.set('type', searchParams.type);
  if (searchParams.area) params.set('area', searchParams.area);
  if (searchParams.rating_min) params.set('rating_min', searchParams.rating_min);
  if (searchParams.price_min) params.set('price_min', searchParams.price_min);
  if (searchParams.price_max) params.set('price_max', searchParams.price_max);
  if (searchParams.features) params.set('features', searchParams.features);
  if (searchParams.available_date) params.set('available_date', searchParams.available_date);
  if (searchParams.available_time) params.set('available_time', searchParams.available_time);
  params.set('sort', value);

  return (
    <a
      href={`/search?${params.toString()}`}
      className={`text-sm px-3 py-1.5 rounded-full ${
        current === value ? 'bg-sky-100 text-sky-700 font-bold' : 'text-gray-500 hover:bg-gray-100'
      }`}
    >
      {label}
    </a>
  );
}

// MobileFilterButton moved to src/components/search/MobileFilterButton.tsx (Client Component)
