import Link from 'next/link';
import { businessTypes, regionGroups } from '@/lib/constants';
import HomeSearchForm from '@/components/search/HomeSearchForm';

export default function Home() {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* Search */}
      <div className="py-6 border-b border-gray-200">
        <h1 className="text-lg sm:text-xl font-bold mb-3">全国のサロン・クリニック検索・予約</h1>
        <HomeSearchForm />
      </div>

      {/* 2-column layout */}
      <div className="flex flex-col md:flex-row gap-0 md:gap-8 py-6">
        {/* Left: Area + Features */}
        <div className="md:w-64 flex-shrink-0 mb-6 md:mb-0">
          <h2 className="font-bold text-sm mb-3 pb-2 border-b-2 border-sky-500">エリアからサロンを探す</h2>
          <nav className="space-y-0">
            {regionGroups.map((region) => (
              <Link
                key={region.name}
                href={`/search?area=${encodeURIComponent(region.prefectures[0])}`}
                className="flex items-center justify-between py-2.5 border-b border-gray-100 text-sm text-gray-700 hover:text-sky-600 transition-colors group"
              >
                <span className="group-hover:underline">{region.name}</span>
                <svg className="w-3.5 h-3.5 text-gray-300 group-hover:text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            ))}
          </nav>

          <div className="mt-6 space-y-3 text-xs text-gray-500">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              24時間ネット予約・空席確認
            </div>
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
              口コミで比較できる
            </div>
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              掲載・利用すべて無料
            </div>
          </div>
        </div>

        {/* Right: Business Types */}
        <div className="flex-1 min-w-0">
          {businessTypes.map((type) => (
            <div key={type} className="py-3 border-b border-gray-100">
              <Link
                href={`/search?type=${encodeURIComponent(type)}`}
                className="text-sky-600 font-bold text-[15px] hover:underline"
              >
                {type}を探す
              </Link>
              <div className="flex flex-wrap items-center mt-1.5 text-[13px]">
                {regionGroups.map((region, i) => (
                  <span key={region.name}>
                    {i > 0 && <span className="text-gray-300 mx-1">|</span>}
                    <Link
                      href={`/search?type=${encodeURIComponent(type)}&area=${encodeURIComponent(region.prefectures[0])}`}
                      className="text-gray-500 hover:text-sky-600 hover:underline"
                    >
                      {region.name}
                    </Link>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
