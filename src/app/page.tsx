import Link from 'next/link';
import { businessTypes, regionGroups, facilityFeatures } from '@/lib/constants';
import HomeSearchForm from '@/components/search/HomeSearchForm';
import HomeUserPanel from '@/components/search/HomeUserPanel';

const popularAreas = ['東京都', '大阪府', '神奈川県', '愛知県', '福岡県', '埼玉県', '千葉県', '北海道', '京都府', '兵庫県', '広島県', '宮城県'];

export default function Home() {
  return (
    <div className="bg-gray-50/80 min-h-screen">
      <div className="max-w-[1040px] mx-auto px-4 sm:px-6">
        {/* Hero */}
        <div className="py-10 text-center">
          <p className="text-[10px] tracking-[0.35em] text-gray-400 mb-2">SEARCH &amp; BOOKING</p>
          <h1 className="text-base font-light tracking-[0.15em] text-gray-700 mb-6">
            全国のサロン・クリニック検索・予約
          </h1>
          <div className="max-w-[580px] mx-auto">
            <HomeSearchForm />
          </div>
        </div>

        {/* 3-column */}
        <div className="flex flex-col md:flex-row gap-5 pb-10">
          {/* Left column */}
          <div className="md:w-[175px] flex-shrink-0">
            <div className="bg-white rounded shadow-sm overflow-hidden mb-4">
              <h2 className="text-[11px] tracking-[0.1em] text-gray-600 font-medium px-4 py-2.5 border-b border-gray-100">エリアから探す</h2>
              <nav>
                {regionGroups.map((region, i) => (
                  <Link
                    key={region.name}
                    href={`/search?area=${encodeURIComponent(region.prefectures[0])}`}
                    className={`flex items-center justify-between px-4 py-2.5 text-xs text-gray-700 hover:text-sky-700 hover:bg-sky-50/50 transition-colors ${i < regionGroups.length - 1 ? 'border-b border-gray-100' : ''}`}
                  >
                    <span>{region.name}</span>
                    <span className="text-gray-400 text-[10px]">&rsaquo;</span>
                  </Link>
                ))}
              </nav>
            </div>

            <div className="bg-white rounded shadow-sm overflow-hidden">
              <h2 className="text-[11px] tracking-[0.1em] text-gray-600 font-medium px-4 py-2.5 border-b border-gray-100">ガイド</h2>
              <nav>
                {[
                  { href: '/search/area', label: '都道府県から探す' },
                  { href: '/ranking', label: 'ランキング' },
                  { href: '/contact', label: 'お問い合わせ' },
                  { href: '/terms', label: '利用規約' },
                  { href: '/privacy', label: 'プライバシーポリシー' },
                ].map((item, i, arr) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center justify-between px-4 py-2.5 text-xs text-gray-600 hover:text-sky-700 hover:bg-sky-50/50 transition-colors ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}
                  >
                    <span>{item.label}</span>
                    <span className="text-gray-400 text-[10px]">&rsaquo;</span>
                  </Link>
                ))}
              </nav>
            </div>
          </div>

          {/* Center column */}
          <div className="flex-1 min-w-0">
            {/* Area cards */}
            <div className="bg-white rounded shadow-sm p-5 mb-4">
              <h2 className="text-[11px] tracking-[0.1em] text-gray-600 font-medium mb-4">エリアからサロン・クリニックを探す</h2>
              <div className="grid grid-cols-3 gap-3">
                {regionGroups.map((region) => (
                  <Link
                    key={region.name}
                    href={`/search?area=${encodeURIComponent(region.prefectures[0])}`}
                    className="block bg-gray-50/80 rounded p-4 text-center hover:shadow-sm hover:bg-sky-50/40 transition-all group"
                  >
                    <span className="text-[13px] text-gray-700 group-hover:text-sky-700 transition-colors block mb-1">{region.name}</span>
                    <span className="text-[10px] text-gray-400 block leading-snug">{region.prefectures.slice(0, 3).join(' / ')}</span>
                  </Link>
                ))}
              </div>

              <div className="flex justify-center gap-8 mt-5 pt-4 border-t border-gray-100">
                <span className="text-[10px] text-gray-500 tracking-wide">24時間ネット予約</span>
                <span className="text-[10px] text-gray-500 tracking-wide">口コミで比較</span>
                <span className="text-[10px] text-gray-500 tracking-wide">掲載・利用無料</span>
              </div>
            </div>

            {/* Business types */}
            <div className="bg-white rounded shadow-sm overflow-hidden mb-4">
              <h2 className="text-[11px] tracking-[0.1em] text-gray-600 font-medium px-5 py-3 border-b border-gray-100">業種から探す</h2>
              {businessTypes.map((type, idx) => (
                <div key={type} className={`px-5 py-3.5 ${idx < businessTypes.length - 1 ? 'border-b border-gray-100' : ''}`}>
                  <Link
                    href={`/search?type=${encodeURIComponent(type)}`}
                    className="text-sky-700 text-sm hover:underline transition-colors"
                  >
                    {type}を探す
                  </Link>
                  <div className="flex flex-wrap items-center gap-0 mt-1">
                    {regionGroups.map((region, i) => (
                      <span key={region.name} className="text-[11px]">
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

            {/* Feature tags */}
            <div className="bg-white rounded shadow-sm p-5 mb-4">
              <h2 className="text-[11px] tracking-[0.1em] text-gray-600 font-medium mb-3">こだわり条件から探す</h2>
              <div className="flex flex-wrap gap-2">
                {facilityFeatures.map((feature) => (
                  <Link
                    key={feature}
                    href={`/search?keyword=${encodeURIComponent(feature)}`}
                    className="px-3 py-1 rounded-full border border-gray-200 text-[11px] text-gray-600 hover:border-sky-300 hover:text-sky-700 transition-colors"
                  >
                    {feature}
                  </Link>
                ))}
              </div>
            </div>

            {/* Popular areas */}
            <div className="bg-white rounded shadow-sm p-5">
              <h2 className="text-[11px] tracking-[0.1em] text-gray-600 font-medium mb-3">人気のエリア</h2>
              <div className="flex flex-wrap items-center gap-0">
                {popularAreas.map((area, i) => (
                  <span key={area} className="text-[11px]">
                    {i > 0 && <span className="text-gray-300 mx-1.5">|</span>}
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
          <div className="md:w-[200px] flex-shrink-0">
            <HomeUserPanel />

            <div className="bg-white rounded shadow-sm overflow-hidden mt-4">
              <nav>
                {[
                  { href: '/mypage/favorites', label: 'お気に入り一覧' },
                  { href: '/contact', label: 'よくある質問' },
                  { href: '/contact', label: 'ヘルプ' },
                ].map((item, i, arr) => (
                  <Link
                    key={`${item.href}-${item.label}`}
                    href={item.href}
                    className={`flex items-center justify-between px-4 py-2.5 text-xs text-gray-600 hover:text-sky-700 hover:bg-sky-50/50 transition-colors ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}
                  >
                    <span>{item.label}</span>
                    <span className="text-gray-400 text-[10px]">&rsaquo;</span>
                  </Link>
                ))}
              </nav>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
