import { Suspense } from 'react';
import { searchFacilities } from '@/lib/facilities';
import SearchBar from '@/components/search/SearchBar';
import FacilityCard from '@/components/search/FacilityCard';
import Pagination from '@/components/search/Pagination';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { keyword?: string; type?: string; area?: string; sort?: string; page?: string };
}

export default async function SearchPage({ searchParams }: Props) {
  const params = {
    keyword: searchParams.keyword,
    type: searchParams.type,
    prefecture: searchParams.area,
    sort: (searchParams.sort as 'rating' | 'newest' | 'popular') || 'newest',
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

  return (
    <div className="bg-gray-50 min-h-screen">
      {/* Hero */}
      <section className="bg-gradient-to-br from-sky-50 to-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
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
