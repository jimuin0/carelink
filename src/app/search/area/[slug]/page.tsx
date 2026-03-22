import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getAreaBySlug, getAreasByParent, getAreaBreadcrumb } from '@/lib/areas';
import { searchFacilities } from '@/lib/facilities';
import FacilityCard from '@/components/search/FacilityCard';

interface Props {
  params: { slug: string };
}

export default async function AreaResultPage({ params }: Props) {
  const area = await getAreaBySlug(params.slug);
  if (!area) notFound();

  const [children, breadcrumb] = await Promise.all([
    getAreasByParent(area.id),
    getAreaBreadcrumb(area),
  ]);

  // Search facilities by prefecture or city
  const searchParam = area.area_type === 'prefecture'
    ? { prefecture: area.name }
    : area.area_type === 'city'
    ? { keyword: area.name }
    : {};

  const { facilities } = await searchFacilities({ ...searchParam, sort: 'rating' });

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
          <div className="grid sm:grid-cols-2 gap-6">
            {facilities.map((f) => (
              <FacilityCard key={f.id} facility={f} />
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            <p className="text-gray-400">このエリアにはまだサロン・クリニックが登録されていません</p>
          </div>
        )}
      </div>
    </div>
  );
}
