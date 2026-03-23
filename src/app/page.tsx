import Link from 'next/link';
import { businessTypes, regionGroups } from '@/lib/constants';
import HomeSearchForm from '@/components/search/HomeSearchForm';

export default function Home() {
  return (
    <div className="max-w-[960px] mx-auto px-4">
      {/* Search */}
      <div className="py-4 border-b border-gray-300">
        <h1 className="text-base font-bold text-gray-800 mb-2">全国のサロン・クリニック検索・予約</h1>
        <HomeSearchForm />
      </div>

      {/* Main 2-column */}
      <div className="flex flex-col md:flex-row md:gap-6 py-4">
        {/* Left column */}
        <div className="md:w-[280px] flex-shrink-0">
          {/* Area nav */}
          <div className="border border-gray-300 bg-[#f7f5f0] mb-4">
            <h2 className="text-sm font-bold px-3 py-2 border-b border-gray-300 text-gray-800">エリアから探す</h2>
            <nav>
              {regionGroups.map((region, i) => (
                <Link
                  key={region.name}
                  href={`/search?area=${encodeURIComponent(region.prefectures[0])}`}
                  className={`flex items-center justify-between px-3 py-2 text-sm text-gray-700 hover:bg-[#ede9e1] transition-colors ${i < regionGroups.length - 1 ? 'border-b border-gray-200' : ''}`}
                >
                  <span>{region.name}</span>
                  <span className="text-gray-400 text-xs">&rsaquo;</span>
                </Link>
              ))}
            </nav>
          </div>

          {/* Features */}
          <div className="border border-gray-300 mb-4">
            <div className="px-3 py-2 text-xs text-gray-600 space-y-2">
              <p className="flex gap-2"><span className="text-gray-400">&#9201;</span>24時間ネット予約・空席確認</p>
              <p className="flex gap-2"><span className="text-gray-400">&#9733;</span>口コミ数で比較できる</p>
              <p className="flex gap-2"><span className="text-gray-400">&#165;</span>掲載・利用すべて無料</p>
            </div>
          </div>

          {/* Sidebar links */}
          <div className="border border-gray-300 mb-4 md:mb-0">
            <h2 className="text-sm font-bold px-3 py-2 border-b border-gray-300 text-gray-800">ガイド</h2>
            <nav>
              {[
                { href: '/search/area', label: '都道府県から探す' },
                { href: '/contact', label: 'お問い合わせ' },
                { href: '/terms', label: '利用規約' },
                { href: '/privacy', label: 'プライバシーポリシー' },
              ].map((item, i, arr) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center justify-between px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors ${i < arr.length - 1 ? 'border-b border-gray-200' : ''}`}
                >
                  <span>{item.label}</span>
                  <span className="text-gray-400 text-xs">&rsaquo;</span>
                </Link>
              ))}
            </nav>
          </div>
        </div>

        {/* Right column: Categories */}
        <div className="flex-1 min-w-0">
          {businessTypes.map((type, idx) => (
            <div key={type} className={`py-3 ${idx < businessTypes.length - 1 ? 'border-b border-gray-200' : ''}`}>
              <div className="flex items-center gap-1 mb-1">
                <span className="w-1 h-4 bg-sky-600 inline-block" />
                <Link
                  href={`/search?type=${encodeURIComponent(type)}`}
                  className="text-sky-700 font-bold text-sm hover:underline"
                >
                  {type}を探す
                </Link>
              </div>
              <div className="flex flex-wrap items-center pl-2 text-xs leading-relaxed">
                {regionGroups.map((region, i) => (
                  <span key={region.name}>
                    {i > 0 && <span className="text-gray-300 mx-1">|</span>}
                    <Link
                      href={`/search?type=${encodeURIComponent(type)}&area=${encodeURIComponent(region.prefectures[0])}`}
                      className="text-gray-500 hover:text-sky-700 hover:underline"
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
