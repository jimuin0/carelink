import Link from 'next/link';
import { businessTypes, regionGroups, facilityFeatures } from '@/lib/constants';
import { getRankedFacilities } from '@/lib/rankings';
import { searchFacilities } from '@/lib/facilities';
import FacilityCard from '@/components/search/FacilityCard';
import FadeIn from '@/components/FadeIn';
import HomeSearchForm from '@/components/search/HomeSearchForm';
import HomeUserPanel from '@/components/search/HomeUserPanel';

const popularAreas = ['東京都', '大阪府', '神奈川県', '愛知県', '福岡県', '埼玉県', '千葉県', '北海道', '京都府', '兵庫県'];

const rankBadgeColors = ['bg-amber-400 text-white', 'bg-gray-300 text-white', 'bg-amber-600 text-white'];

export default async function Home() {
  const [ranked, newest] = await Promise.all([
    getRankedFacilities(undefined, 6),
    searchFacilities({ sort: 'newest', page: 1 }),
  ]);

  const rankedFacilities = ranked;
  const newFacilities = newest.facilities.slice(0, 4);

  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <div className="bg-gradient-to-b from-sky-50 via-sky-50/50 to-white">
        <div className="max-w-[1040px] mx-auto px-4 sm:px-6 pt-12 pb-8 text-center">
          <h1 className="text-xl tracking-wide text-gray-800 mb-1">
            全国の美容サロン・クリニック検索・予約
          </h1>
          <p className="text-sm text-gray-500 mb-8">ヘア・ネイル・まつげ・リラク・エステ・美容クリニック</p>
          <div className="max-w-[580px] mx-auto">
            <HomeSearchForm />
          </div>
        </div>
      </div>

      {/* Business type tabs */}
      <div className="border-b border-gray-200">
        <div className="max-w-[1040px] mx-auto px-4 sm:px-6">
          <nav className="flex">
            {businessTypes.map((type) => (
              <Link
                key={type}
                href={`/search?type=${encodeURIComponent(type)}`}
                className="flex-1 py-4 text-center text-sm text-gray-600 hover:text-sky-700 border-b-2 border-transparent hover:border-sky-500 transition-colors"
              >
                {type}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {/* Popular Ranking Section */}
      {rankedFacilities.length > 0 && (
        <section className="bg-gray-50/60 border-b border-gray-100">
          <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-10">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-gray-800">人気サロンランキング</h2>
              <Link href="/ranking" className="text-sm text-sky-600 hover:text-sky-700 hover:underline">
                全ランキングを見る &rarr;
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {rankedFacilities.map((facility, idx) => (
                <FadeIn key={facility.id} delay={idx * 80}>
                  <div className="relative bg-white rounded-lg shadow-sm overflow-hidden hover:shadow-md transition-shadow">
                    {idx < 3 && (
                      <span className={`absolute top-3 right-3 z-10 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${rankBadgeColors[idx]}`}>
                        {idx + 1}
                      </span>
                    )}
                    <FacilityCard facility={facility} />
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Main 3-column */}
      <div className="max-w-[1040px] mx-auto px-4 sm:px-6">
        <div className="flex flex-col md:flex-row gap-8 py-10">
          {/* Left column */}
          <div className="md:w-[170px] flex-shrink-0 space-y-8">
            <div>
              <h2 className="text-xs font-medium text-gray-800 mb-3">エリアから探す</h2>
              <nav>
                {regionGroups.map((region) => (
                  <Link
                    key={region.name}
                    href={`/search?area=${encodeURIComponent(region.prefectures[0])}`}
                    className="flex items-center justify-between py-2.5 text-xs text-gray-600 hover:text-sky-700 transition-colors border-b border-gray-100"
                  >
                    <span>{region.name}</span>
                    <span className="text-gray-300">&rsaquo;</span>
                  </Link>
                ))}
              </nav>
            </div>
            <div>
              <h2 className="text-xs font-medium text-gray-800 mb-3">ガイド</h2>
              <nav>
                {[
                  { href: '/search/area', label: '都道府県から探す' },
                  { href: '/ranking', label: 'ランキング' },
                  { href: '/contact', label: 'お問い合わせ' },
                  { href: '/terms', label: '利用規約' },
                  { href: '/privacy', label: 'プライバシーポリシー' },
                ].map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex items-center justify-between py-2.5 text-xs text-gray-500 hover:text-sky-700 transition-colors border-b border-gray-100"
                  >
                    <span>{item.label}</span>
                    <span className="text-gray-300">&rsaquo;</span>
                  </Link>
                ))}
              </nav>
            </div>
          </div>

          {/* Center column */}
          <div className="flex-1 min-w-0 space-y-10">
            {/* Business types x area */}
            <div>
              <h2 className="text-sm font-bold text-gray-800 mb-4">業種 &times; エリアで探す</h2>
              {businessTypes.map((type, idx) => (
                <div key={type} className={`py-4 ${idx < businessTypes.length - 1 ? 'border-b border-gray-100' : ''}`}>
                  <Link
                    href={`/search?type=${encodeURIComponent(type)}`}
                    className="text-sky-700 text-[15px] font-medium hover:underline"
                  >
                    {type}を探す
                  </Link>
                  <div className="flex flex-wrap items-center mt-2 gap-y-1">
                    {regionGroups.map((region, i) => (
                      <span key={region.name} className="text-xs">
                        {i > 0 && <span className="text-gray-200 mx-2">|</span>}
                        <Link
                          href={`/search?type=${encodeURIComponent(type)}&area=${encodeURIComponent(region.prefectures[0])}`}
                          className="text-gray-500 hover:text-sky-700 transition-colors"
                        >
                          {region.name}
                        </Link>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* New facilities */}
            {newFacilities.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-gray-800 mb-4">新着サロン</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {newFacilities.map((facility, idx) => (
                    <FadeIn key={facility.id} delay={idx * 80}>
                      <div className="bg-white rounded-lg border border-gray-100 overflow-hidden hover:shadow-sm transition-shadow">
                        <FacilityCard facility={facility} />
                      </div>
                    </FadeIn>
                  ))}
                </div>
              </div>
            )}

            {/* Feature tags */}
            <div>
              <h2 className="text-sm font-bold text-gray-800 mb-4">こだわり条件から探す</h2>
              <div className="flex flex-wrap gap-2.5">
                {facilityFeatures.map((feature) => (
                  <Link
                    key={feature}
                    href={`/search?keyword=${encodeURIComponent(feature)}`}
                    className="px-4 py-2 bg-gray-50 border border-gray-100 rounded text-xs text-gray-600 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-700 transition-colors"
                  >
                    {feature}
                  </Link>
                ))}
              </div>
            </div>

            {/* Popular areas */}
            <div>
              <h2 className="text-sm font-bold text-gray-800 mb-4">人気のエリア</h2>
              <div className="flex flex-wrap items-center gap-y-2">
                {popularAreas.map((area, i) => (
                  <span key={area} className="text-xs">
                    {i > 0 && <span className="text-gray-200 mx-2.5">|</span>}
                    <Link href={`/search?area=${encodeURIComponent(area)}`} className="text-gray-600 hover:text-sky-700 transition-colors">{area}</Link>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="md:w-[200px] flex-shrink-0 space-y-6">
            <HomeUserPanel />
            <nav>
              {[
                { href: '/mypage/favorites', label: 'お気に入り一覧' },
                { href: '/contact', label: 'よくある質問' },
                { href: '/contact', label: 'ヘルプ' },
              ].map((item) => (
                <Link
                  key={`${item.href}-${item.label}`}
                  href={item.href}
                  className="flex items-center justify-between py-3 text-xs text-gray-500 hover:text-sky-700 transition-colors border-b border-gray-100"
                >
                  <span>{item.label}</span>
                  <span className="text-gray-300">&rsaquo;</span>
                </Link>
              ))}
            </nav>
            <div className="space-y-3 text-[11px] text-gray-500">
              <p className="flex items-center gap-2.5">
                <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                24時間ネット予約
              </p>
              <p className="flex items-center gap-2.5">
                <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                口コミで比較できる
              </p>
              <p className="flex items-center gap-2.5">
                <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                掲載・利用すべて無料
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
