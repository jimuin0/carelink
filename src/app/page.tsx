import Link from 'next/link';
import { businessTypes, regionGroups, facilityFeatures } from '@/lib/constants';
import HomeSearchForm from '@/components/search/HomeSearchForm';
import HomeUserPanel from '@/components/search/HomeUserPanel';

const popularAreas = ['東京都', '大阪府', '神奈川県', '愛知県', '福岡県', '埼玉県', '千葉県', '北海道', '京都府', '兵庫県', '広島県', '宮城県'];

export default function Home() {
  return (
    <div className="max-w-[1040px] mx-auto px-4">
      {/* Search */}
      <div className="py-3 border-b border-gray-300">
        <h1 className="text-sm font-bold text-gray-800 mb-2">全国のサロン・クリニック検索・予約</h1>
        <HomeSearchForm />
      </div>

      {/* Main 3-column */}
      <div className="flex flex-col md:flex-row py-3 gap-0 md:gap-0">
        {/* Left column - Area navigation */}
        <div className="md:w-[200px] flex-shrink-0 md:border-r md:border-gray-200 md:pr-3">
          <div className="mb-3">
            <h2 className="text-xs font-bold px-2 py-1.5 bg-[#f7f5f0] border border-gray-300 border-b-0 text-gray-800">エリアから探す</h2>
            <nav className="border border-gray-300">
              {regionGroups.map((region, i) => (
                <Link
                  key={region.name}
                  href={`/search?area=${encodeURIComponent(region.prefectures[0])}`}
                  className={`flex items-center justify-between px-2 py-1.5 text-xs text-gray-700 hover:bg-[#f7f5f0] transition-colors ${i < regionGroups.length - 1 ? 'border-b border-gray-200' : ''}`}
                >
                  <span>{region.name}</span>
                  <span className="text-gray-400 text-[10px]">&rsaquo;</span>
                </Link>
              ))}
            </nav>
          </div>

          <div className="mb-3">
            <h2 className="text-xs font-bold px-2 py-1.5 bg-[#f7f5f0] border border-gray-300 border-b-0 text-gray-800">ガイド</h2>
            <nav className="border border-gray-300">
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
                  className={`flex items-center justify-between px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50 transition-colors ${i < arr.length - 1 ? 'border-b border-gray-200' : ''}`}
                >
                  <span>{item.label}</span>
                  <span className="text-gray-400 text-[10px]">&rsaquo;</span>
                </Link>
              ))}
            </nav>
          </div>
        </div>

        {/* Center column - Main content */}
        <div className="flex-1 min-w-0 md:px-3">
          {/* Business types */}
          <div className="mb-3">
            <h2 className="text-xs font-bold px-2 py-1.5 bg-[#f7f5f0] border border-gray-300 border-b-0 text-gray-800">業種から探す</h2>
            <div className="border border-gray-300">
              {businessTypes.map((type, idx) => (
                <div key={type} className={`px-2 py-2 ${idx < businessTypes.length - 1 ? 'border-b border-gray-200' : ''}`}>
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="w-0.5 h-3.5 bg-sky-600 inline-block" />
                    <Link
                      href={`/search?type=${encodeURIComponent(type)}`}
                      className="text-sky-700 font-bold text-xs hover:underline"
                    >
                      {type}を探す
                    </Link>
                  </div>
                  <div className="flex flex-wrap items-center pl-2 text-[11px] leading-relaxed">
                    {regionGroups.map((region, i) => (
                      <span key={region.name}>
                        {i > 0 && <span className="text-gray-300 mx-0.5">|</span>}
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

          {/* Feature search */}
          <div className="mb-3">
            <h2 className="text-xs font-bold px-2 py-1.5 bg-[#f7f5f0] border border-gray-300 border-b-0 text-gray-800">こだわり条件から探す</h2>
            <div className="border border-gray-300 px-2 py-2 flex flex-wrap gap-1">
              {facilityFeatures.map((feature) => (
                <Link
                  key={feature}
                  href={`/search?keyword=${encodeURIComponent(feature)}`}
                  className="inline-block px-2 py-0.5 border border-gray-300 text-[11px] text-gray-600 hover:bg-[#f7f5f0] hover:text-sky-700 transition-colors"
                >
                  {feature}
                </Link>
              ))}
            </div>
          </div>

          {/* Popular areas */}
          <div className="mb-3">
            <h2 className="text-xs font-bold px-2 py-1.5 bg-[#f7f5f0] border border-gray-300 border-b-0 text-gray-800">人気のエリア</h2>
            <div className="border border-gray-300 px-2 py-2">
              <div className="flex flex-wrap items-center text-[11px] leading-loose">
                {popularAreas.map((area, i) => (
                  <span key={area}>
                    {i > 0 && <span className="text-gray-300 mx-1">|</span>}
                    <Link
                      href={`/search?area=${encodeURIComponent(area)}`}
                      className="text-gray-600 hover:text-sky-700 hover:underline"
                    >
                      {area}
                    </Link>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Info strip */}
          <div className="border border-gray-300 px-2 py-1.5 text-[11px] text-gray-500 flex flex-wrap gap-x-4 gap-y-0.5">
            <span>24時間ネット予約・空席確認</span>
            <span>口コミ数で比較できる</span>
            <span>掲載・利用すべて無料</span>
          </div>
        </div>

        {/* Right column - User panel */}
        <div className="md:w-[200px] flex-shrink-0 md:border-l md:border-gray-200 md:pl-3 mt-3 md:mt-0">
          <HomeUserPanel />

          <div className="mt-3">
            <nav className="border border-gray-300">
              {[
                { href: '/mypage/favorites', label: 'お気に入り一覧' },
                { href: '/contact', label: 'よくある質問' },
                { href: '/contact', label: 'ヘルプ' },
              ].map((item, i, arr) => (
                <Link
                  key={`${item.href}-${item.label}`}
                  href={item.href}
                  className={`flex items-center justify-between px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50 transition-colors ${i < arr.length - 1 ? 'border-b border-gray-200' : ''}`}
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
  );
}
