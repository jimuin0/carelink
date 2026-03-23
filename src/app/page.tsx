import Link from 'next/link';
import { businessTypes, businessTypeIcons, regionGroups } from '@/lib/constants';
import HomeSearchForm from '@/components/search/HomeSearchForm';

export default function Home() {
  return (
    <>
      {/* Hero Search */}
      <section className="bg-gradient-to-br from-sky-50 to-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-16">
          <h1 className="text-2xl sm:text-3xl font-bold text-center mb-2">
            サロン・クリニックを探す
          </h1>
          <p className="text-gray-500 text-center text-sm mb-8">
            医療・福祉・美容の施設をかんたん検索
          </p>
          <HomeSearchForm />
        </div>
      </section>

      {/* Business Type Cards */}
      <section className="bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <h2 className="text-lg font-bold mb-6">業種から探す</h2>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {businessTypes.map((type) => (
              <Link
                key={type}
                href={`/search?type=${encodeURIComponent(type)}`}
                className="flex flex-col items-center gap-2 p-4 rounded-xl border border-gray-100 hover:border-sky-200 hover:bg-sky-50 transition-colors"
              >
                <span className="text-3xl" role="img" aria-label={type}>
                  {businessTypeIcons[type] || '🔍'}
                </span>
                <span className="text-xs font-medium text-gray-700 text-center leading-tight">
                  {type}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Area Search */}
      <section className="bg-gray-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <h2 className="text-lg font-bold mb-6">エリアから探す</h2>
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden divide-y divide-gray-100">
            {regionGroups.map((region) => (
              <div key={region.name} className="flex flex-col sm:flex-row">
                <div className="sm:w-36 flex-shrink-0 bg-gray-50 px-4 py-3 font-bold text-sm text-gray-700">
                  {region.name}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-3">
                  {region.prefectures.map((pref) => (
                    <Link
                      key={pref}
                      href={`/search?area=${encodeURIComponent(pref)}`}
                      className="text-sm text-gray-600 hover:text-primary transition-colors"
                    >
                      {pref}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

    </>
  );
}
