import Link from 'next/link';
import { getRankedFacilities } from '@/lib/rankings';
import FacilityCard from '@/components/search/FacilityCard';
import { prefectures } from '@/lib/constants';

export default async function RankingPage() {
  const facilities = await getRankedFacilities();

  return (
    <div className="bg-gray-50 min-h-screen">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold mb-2">人気ランキング</h1>
        <p className="text-sm text-gray-500 mb-6">口コミ評価の高い施設をランキング形式でご紹介</p>

        {/* Prefecture links */}
        <div className="flex flex-wrap gap-2 mb-8">
          {prefectures.slice(0, 10).map((pref) => (
            <Link
              key={pref}
              href={`/ranking/${encodeURIComponent(pref)}`}
              className="text-xs px-3 py-1.5 rounded-full bg-white border border-gray-200 hover:bg-sky-50 hover:text-primary transition-colors"
            >
              {pref}
            </Link>
          ))}
        </div>

        {facilities.length > 0 ? (
          <div className="space-y-4">
            {facilities.map((f, i) => (
              <div key={f.id} className="flex items-start gap-4">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
                  i === 0 ? 'bg-yellow-400 text-white' :
                  i === 1 ? 'bg-gray-300 text-white' :
                  i === 2 ? 'bg-amber-600 text-white' :
                  'bg-gray-100 text-gray-500'
                }`}>
                  {i + 1}
                </div>
                <div className="flex-1">
                  <FacilityCard facility={f} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-2xl p-8 text-center">
            <p className="text-gray-400">ランキングデータがありません</p>
          </div>
        )}
      </div>
    </div>
  );
}
