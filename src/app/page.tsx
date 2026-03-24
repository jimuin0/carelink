import Link from 'next/link';
import { businessTypes, regionGroups, facilityFeatures } from '@/lib/constants';
import HomeSearchForm from '@/components/search/HomeSearchForm';
import HomeUserPanel from '@/components/search/HomeUserPanel';

const popularAreas = ['東京都', '大阪府', '神奈川県', '愛知県', '福岡県', '埼玉県', '千葉県', '北海道', '京都府', '兵庫県'];

export default function Home() {
  return (
    <div className="min-h-screen">
      {/* Hero - colored background to break monotony */}
      <div className="bg-gradient-to-b from-sky-50 to-white">
        <div className="max-w-[1040px] mx-auto px-4 sm:px-6 py-12 text-center">
          <p className="text-[10px] tracking-[0.4em] text-sky-400 mb-3 uppercase">Search &amp; Booking</p>
          <h1 className="text-2xl tracking-wide text-gray-800 mb-2">
            全国のサロン・クリニック検索
          </h1>
          <p className="text-sm text-gray-500 mb-8">美容・医療・福祉、あなたにぴったりの施設が見つかる</p>
          <div className="max-w-[600px] mx-auto">
            <HomeSearchForm />
          </div>
        </div>
      </div>

      {/* Area grid - full width, visual impact */}
      <div className="max-w-[1040px] mx-auto px-4 sm:px-6 -mt-1">
        <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-gray-200 border border-gray-200 overflow-hidden">
          {regionGroups.map((region) => (
            <Link
              key={region.name}
              href={`/search?area=${encodeURIComponent(region.prefectures[0])}`}
              className="bg-white py-5 text-center hover:bg-sky-50 transition-colors group"
            >
              <span className="text-sm font-medium text-gray-800 group-hover:text-sky-700 block">{region.name}</span>
              <span className="text-[10px] text-gray-400 mt-1 block">{region.prefectures.length}都道府県</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Main 3-column */}
      <div className="max-w-[1040px] mx-auto px-4 sm:px-6">
        <div className="flex flex-col md:flex-row gap-6 py-8">
          {/* Left column */}
          <div className="md:w-[180px] flex-shrink-0 space-y-5">
            <div>
              <h2 className="text-xs font-medium text-gray-800 mb-2 flex items-center gap-2">
                <span className="w-4 h-px bg-sky-400" />エリアから探す
              </h2>
              <nav className="space-y-0.5">
                {regionGroups.map((region) => (
                  <Link
                    key={region.name}
                    href={`/search?area=${encodeURIComponent(region.prefectures[0])}`}
                    className="flex items-center justify-between py-2 text-xs text-gray-600 hover:text-sky-700 transition-colors border-b border-gray-100"
                  >
                    <span>{region.name}</span>
                    <span className="text-gray-300">&rsaquo;</span>
                  </Link>
                ))}
              </nav>
            </div>

            <div>
              <h2 className="text-xs font-medium text-gray-800 mb-2 flex items-center gap-2">
                <span className="w-4 h-px bg-sky-400" />ガイド
              </h2>
              <nav className="space-y-0.5">
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
                    className="flex items-center justify-between py-2 text-xs text-gray-500 hover:text-sky-700 transition-colors border-b border-gray-100"
                  >
                    <span>{item.label}</span>
                    <span className="text-gray-300">&rsaquo;</span>
                  </Link>
                ))}
              </nav>
            </div>
          </div>

          {/* Center column */}
          <div className="flex-1 min-w-0 space-y-6">
            {/* Business types - main visual section */}
            <div>
              <h2 className="text-xs font-medium text-gray-800 mb-3 flex items-center gap-2">
                <span className="w-4 h-px bg-sky-400" />業種から探す
              </h2>
              <div className="space-y-0">
                {businessTypes.map((type, idx) => (
                  <div key={type} className={`py-4 ${idx < businessTypes.length - 1 ? 'border-b border-gray-100' : ''}`}>
                    <Link
                      href={`/search?type=${encodeURIComponent(type)}`}
                      className="text-sky-700 text-[15px] font-medium hover:underline"
                    >
                      {type}を探す
                    </Link>
                    <div className="flex flex-wrap items-center mt-1.5">
                      {regionGroups.map((region, i) => (
                        <span key={region.name} className="text-xs">
                          {i > 0 && <span className="text-gray-300 mx-1.5">|</span>}
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
            </div>

            {/* Feature tags */}
            <div>
              <h2 className="text-xs font-medium text-gray-800 mb-3 flex items-center gap-2">
                <span className="w-4 h-px bg-sky-400" />こだわり条件から探す
              </h2>
              <div className="flex flex-wrap gap-2">
                {facilityFeatures.map((feature) => (
                  <Link
                    key={feature}
                    href={`/search?keyword=${encodeURIComponent(feature)}`}
                    className="px-3 py-1.5 bg-gray-50 text-xs text-gray-600 hover:bg-sky-50 hover:text-sky-700 transition-colors"
                  >
                    {feature}
                  </Link>
                ))}
              </div>
            </div>

            {/* Popular areas */}
            <div>
              <h2 className="text-xs font-medium text-gray-800 mb-3 flex items-center gap-2">
                <span className="w-4 h-px bg-sky-400" />人気のエリア
              </h2>
              <div className="flex flex-wrap items-center">
                {popularAreas.map((area, i) => (
                  <span key={area} className="text-xs">
                    {i > 0 && <span className="text-gray-300 mx-2">|</span>}
                    <Link
                      href={`/search?area=${encodeURIComponent(area)}`}
                      className="text-gray-600 hover:text-sky-700 transition-colors"
                    >
                      {area}
                    </Link>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="md:w-[200px] flex-shrink-0 space-y-4">
            <HomeUserPanel />

            <nav className="space-y-0.5">
              {[
                { href: '/mypage/favorites', label: 'お気に入り一覧' },
                { href: '/contact', label: 'よくある質問' },
                { href: '/contact', label: 'ヘルプ' },
              ].map((item) => (
                <Link
                  key={`${item.href}-${item.label}`}
                  href={item.href}
                  className="flex items-center justify-between py-2 text-xs text-gray-500 hover:text-sky-700 transition-colors border-b border-gray-100"
                >
                  <span>{item.label}</span>
                  <span className="text-gray-300">&rsaquo;</span>
                </Link>
              ))}
            </nav>

            {/* Features */}
            <div className="pt-2 space-y-3">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-sky-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="text-[11px] text-gray-500">24時間ネット予約</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-sky-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                <span className="text-[11px] text-gray-500">口コミで比較できる</span>
              </div>
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-sky-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="text-[11px] text-gray-500">掲載・利用すべて無料</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
