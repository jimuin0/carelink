import Link from 'next/link';
import { getAreasByParent } from '@/lib/areas';

export default async function AreaSearchPage() {
  const regions = await getAreasByParent(null);

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold mb-6">エリアから探す</h1>

        {regions.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            <p className="text-gray-400">エリアデータが登録されていません</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {regions.map((region) => (
              <Link
                key={region.id}
                href={`/search/area/${region.slug}`}
                className="bg-white rounded-xl shadow-sm p-4 hover:shadow-md transition-shadow text-center"
              >
                <p className="font-bold text-sm">{region.name}</p>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8">
          <Link href="/search" className="text-sm text-primary hover:underline">
            キーワード検索に戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
