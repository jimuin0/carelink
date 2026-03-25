import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { searchFacilities } from '@/lib/facilities';
import SearchBar from '@/components/search/SearchBar';
import FacilityCard from '@/components/search/FacilityCard';
import Pagination from '@/components/search/Pagination';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://carelink-ruddy-psi.vercel.app';

interface Props {
  searchParams: { keyword?: string; type?: string; area?: string; sort?: string; page?: string };
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const parts: string[] = [];
  if (searchParams.area) parts.push(searchParams.area);
  if (searchParams.type) parts.push(searchParams.type);
  if (searchParams.keyword) parts.push(`「${searchParams.keyword}」`);

  const titlePrefix = parts.length > 0 ? `${parts.join('の')}` : 'サロン・クリニック';
  const title = `${titlePrefix}検索`;
  const description = parts.length > 0
    ? `${titlePrefix}の一覧。メニュー・料金・口コミを比較して予約できます。`
    : '美容サロン・鍼灸院・整骨院・介護施設・病院を検索。エリア・業種で簡単に探せます。メニュー・料金・口コミもチェック。';

  const params = new URLSearchParams();
  if (searchParams.type) params.set('type', searchParams.type);
  if (searchParams.area) params.set('area', searchParams.area);
  if (searchParams.keyword) params.set('keyword', searchParams.keyword);
  const canonical = params.toString() ? `/search?${params.toString()}` : '/search';

  return {
    title,
    description,
    alternates: { canonical },
  };
}

export default async function SearchPage({ searchParams }: Props) {
  const params = {
    keyword: searchParams.keyword,
    type: searchParams.type,
    prefecture: searchParams.area,
    sort: (['rating', 'newest', 'popular'] as const).includes(searchParams.sort as 'rating' | 'newest' | 'popular') ? (searchParams.sort as 'rating' | 'newest' | 'popular') : 'newest',
    page: searchParams.page ? (parseInt(searchParams.page) || 1) : 1,
  };

  const { facilities, total, perPage } = await searchFacilities(params);
  const totalPages = Math.ceil(total / perPage);

  // Build base URL for pagination
  const baseParams = new URLSearchParams();
  if (searchParams.keyword) baseParams.set('keyword', searchParams.keyword);
  if (searchParams.type) baseParams.set('type', searchParams.type);
  if (searchParams.area) baseParams.set('area', searchParams.area);
  if (searchParams.sort) baseParams.set('sort', searchParams.sort);
  const baseUrl = `/search?${baseParams.toString()}`;

  // Breadcrumb items
  const breadcrumbs: { label: string; href?: string }[] = [{ label: 'トップ', href: '/' }];
  if (searchParams.type) {
    breadcrumbs.push({ label: searchParams.type, href: `/search?type=${encodeURIComponent(searchParams.type)}` });
  }
  if (searchParams.area) {
    const areaHref = searchParams.type
      ? `/search?type=${encodeURIComponent(searchParams.type)}&area=${encodeURIComponent(searchParams.area)}`
      : `/search?area=${encodeURIComponent(searchParams.area)}`;
    breadcrumbs.push({ label: searchParams.area, href: areaHref });
  }
  if (searchParams.keyword) {
    breadcrumbs.push({ label: `「${searchParams.keyword}」` });
  }
  if (breadcrumbs.length === 1) {
    breadcrumbs.push({ label: 'サロン・クリニック検索' });
  }

  // BreadcrumbList JSON-LD
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbs.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.label,
      ...(item.href && { item: `${SITE_URL}${item.href}` }),
    })),
  };

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* JSON-LD: BreadcrumbList */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd).replace(/</g, '\\u003c') }}
      />

      {/* Hero */}
      <section className="bg-gradient-to-br from-sky-50 to-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
          {/* Visible Breadcrumbs */}
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
          <Suspense>
            <SearchBar />
          </Suspense>
        </div>
      </section>

      {/* Results */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <p className="text-gray-600 text-sm">
            <span className="font-bold text-gray-900 text-lg">{total}</span> 件見つかりました
          </p>
          <div className="flex items-center gap-2">
            <SortLink current={params.sort} value="newest" label="新着順" searchParams={searchParams} />
            <SortLink current={params.sort} value="rating" label="評価順" searchParams={searchParams} />
            <SortLink current={params.sort} value="popular" label="人気順" searchParams={searchParams} />
          </div>
        </div>

        {/* Cards */}
        {facilities.length > 0 ? (
          <div className="grid sm:grid-cols-2 gap-6">
            {facilities.map((f) => (
              <FacilityCard key={f.id} facility={f} />
            ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-white rounded-2xl shadow-sm">
            <p className="text-gray-400 text-lg mb-2">該当するサロン・クリニックが見つかりませんでした</p>
            <p className="text-gray-400 text-sm">条件を変えて再度お試しください</p>
          </div>
        )}

        <Pagination currentPage={params.page} totalPages={totalPages} baseUrl={baseUrl} />
      </div>
    </div>
  );
}

function SortLink({
  current,
  value,
  label,
  searchParams,
}: {
  current: string;
  value: string;
  label: string;
  searchParams: Props['searchParams'];
}) {
  const params = new URLSearchParams();
  if (searchParams.keyword) params.set('keyword', searchParams.keyword);
  if (searchParams.type) params.set('type', searchParams.type);
  if (searchParams.area) params.set('area', searchParams.area);
  params.set('sort', value);

  const isActive = current === value;
  return (
    <a
      href={`/search?${params.toString()}`}
      className={`text-sm px-3 py-1.5 rounded-full ${
        isActive ? 'bg-sky-100 text-sky-700 font-bold' : 'text-gray-500 hover:bg-gray-100'
      }`}
    >
      {label}
    </a>
  );
}
