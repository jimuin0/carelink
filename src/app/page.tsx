import Link from 'next/link';
import { businessTypes, regionGroups } from '@/lib/constants';
import HomeSearchForm from '@/components/search/HomeSearchForm';

const regionShortNames = ['関東', '関西', '中部', '北海道・東北', '中国・四国', '九州・沖縄'];

export default function Home() {
  return (
    <>
      {/* Search */}
      <section className="bg-gradient-to-b from-sky-50 to-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-xl sm:text-2xl font-bold mb-1">
            全国のサロン・クリニック検索・予約
          </h1>
          <HomeSearchForm />
        </div>
      </section>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Business Types with Region Links */}
        <div className="space-y-0 divide-y divide-gray-100">
          {businessTypes.map((type) => (
            <div key={type} className="py-4">
              <Link
                href={`/search?type=${encodeURIComponent(type)}`}
                className="text-primary font-bold hover:underline"
              >
                {type}を探す
              </Link>
              <div className="flex flex-wrap gap-x-1 mt-1.5 text-sm">
                {regionShortNames.map((region, i) => (
                  <span key={region} className="flex items-center">
                    {i > 0 && <span className="text-gray-300 mx-1">|</span>}
                    <Link
                      href={`/search?type=${encodeURIComponent(type)}&area=${encodeURIComponent(regionGroups.find(r => r.name === region)?.prefectures[0] || '')}`}
                      className="text-gray-600 hover:text-primary hover:underline"
                    >
                      {region}
                    </Link>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Area Search */}
        <div className="mt-8">
          <h2 className="text-lg font-bold mb-4">エリアから探す</h2>
          <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-200">
            {regionGroups.map((region) => (
              <div key={region.name} className="flex">
                <div className="w-28 sm:w-36 flex-shrink-0 bg-gray-50 px-3 py-2.5 font-bold text-sm text-gray-700 border-r border-gray-200">
                  {region.name}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2.5">
                  {region.prefectures.map((pref) => (
                    <Link
                      key={pref}
                      href={`/search?area=${encodeURIComponent(pref)}`}
                      className="text-sm text-gray-600 hover:text-primary hover:underline"
                    >
                      {pref}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
