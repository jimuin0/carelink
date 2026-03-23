import Link from 'next/link';
import { businessTypes, regionGroups } from '@/lib/constants';
import { searchFacilities } from '@/lib/facilities';
import FacilityCard from '@/components/search/FacilityCard';
import FadeIn from '@/components/FadeIn';
import HomeSearchForm from '@/components/search/HomeSearchForm';

const regionShortNames = ['関東', '関西', '中部', '北海道・東北', '中国・四国', '九州・沖縄'];

export default async function Home() {
  const { facilities } = await searchFacilities({ sort: 'newest', page: 1 });

  return (
    <>
      {/* Hero + Search */}
      <section className="bg-sky-600 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
          <h1 className="text-xl sm:text-2xl font-bold mb-1">
            医療・福祉・美容のサロン・クリニック検索・予約
          </h1>
          <p className="text-sky-100 text-sm mb-4">
            全国の施設をかんたんに探せるポータルサイト
          </p>
          <HomeSearchForm />
          <div className="flex flex-wrap gap-x-6 gap-y-1 mt-4 text-sky-100 text-xs">
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              24時間ネット予約
            </span>
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
              口コミ・評価で比較
            </span>
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
              掲載・利用すべて無料
            </span>
          </div>
        </div>
      </section>

      {/* New Facilities */}
      {facilities.length > 0 && (
        <section className="bg-white border-b border-gray-100">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <span className="w-1 h-5 bg-sky-500 rounded-sm" />
                <h2 className="font-bold text-base">新着施設</h2>
              </div>
              <Link href="/search?sort=newest" className="text-sm text-sky-600 hover:underline">
                一覧を見る &rarr;
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {facilities.slice(0, 8).map((f, i) => (
                <FadeIn key={f.id} delay={i * 60}>
                  <FacilityCard facility={f} />
                </FadeIn>
              ))}
            </div>
          </div>
        </section>
      )}

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Business Types with Region Links */}
        <section className="py-6">
          {businessTypes.map((type) => (
            <div key={type} className="py-3 border-b border-gray-100 last:border-b-0">
              <div className="flex items-center gap-2">
                <span className="w-1 h-5 bg-sky-500 rounded-sm flex-shrink-0" />
                <Link
                  href={`/search?type=${encodeURIComponent(type)}`}
                  className="text-sky-700 font-bold text-[15px] hover:underline"
                >
                  {type}を探す
                </Link>
              </div>
              <div className="flex flex-wrap items-center ml-3 mt-1.5 text-[13px]">
                {regionShortNames.map((region, i) => (
                  <span key={region}>
                    {i > 0 && <span className="text-gray-300 mx-1">|</span>}
                    <Link
                      href={`/search?type=${encodeURIComponent(type)}&area=${encodeURIComponent(regionGroups.find(r => r.name === region)?.prefectures[0] || '')}`}
                      className="text-gray-500 hover:text-sky-600 hover:underline"
                    >
                      {region}
                    </Link>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </section>

        {/* Area Search (compact) */}
        <section className="pb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-1 h-5 bg-sky-500 rounded-sm" />
            <h2 className="font-bold text-[15px]">エリアから探す</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {regionGroups.map((region) => (
              <Link
                key={region.name}
                href={`/search?area=${encodeURIComponent(region.prefectures[0])}`}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-700 hover:border-sky-300 hover:text-sky-600 hover:bg-sky-50 transition-colors"
              >
                {region.name}
              </Link>
            ))}
            <Link
              href="/search/area"
              className="px-4 py-2 text-sm text-sky-600 hover:underline"
            >
              都道府県から探す &rarr;
            </Link>
          </div>
        </section>
      </div>
    </>
  );
}
