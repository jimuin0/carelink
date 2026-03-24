import Link from 'next/link';
import { businessTypes, regionGroups, facilityFeatures } from '@/lib/constants';
import HomeSearchForm from '@/components/search/HomeSearchForm';
import HomeUserPanel from '@/components/search/HomeUserPanel';

const popularAreas = ['東京都', '大阪府', '神奈川県', '愛知県', '福岡県', '埼玉県', '千葉県', '北海道', '京都府', '兵庫県'];

/* SVG icons for each business type */
const typeIcons: Record<string, JSX.Element> = {
  '美容サロン・アイラッシュ': (
    <svg viewBox="0 0 40 40" fill="none" className="w-10 h-10"><circle cx="20" cy="20" r="19" stroke="currentColor" strokeWidth="1" /><path d="M14 26c0-4 3-7 6-7s6 3 6 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><circle cx="20" cy="15" r="4" stroke="currentColor" strokeWidth="1.2" /><path d="M11 13c2-3 4-2 5 0M25 13c-2-3-4-2-5 0" stroke="currentColor" strokeWidth="1" strokeLinecap="round" /></svg>
  ),
  '鍼灸院': (
    <svg viewBox="0 0 40 40" fill="none" className="w-10 h-10"><circle cx="20" cy="20" r="19" stroke="currentColor" strokeWidth="1" /><path d="M20 8v24M15 12l5 4 5-4M15 28l5-4 5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="20" cy="20" r="2" fill="currentColor" opacity=".3" /></svg>
  ),
  '整骨院': (
    <svg viewBox="0 0 40 40" fill="none" className="w-10 h-10"><circle cx="20" cy="20" r="19" stroke="currentColor" strokeWidth="1" /><path d="M16 14h8l-1 6h-6l-1-6zM17 20v8M23 20v8M15 28h10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="20" cy="11" r="2.5" stroke="currentColor" strokeWidth="1.2" /></svg>
  ),
  '介護施設・デイサービス': (
    <svg viewBox="0 0 40 40" fill="none" className="w-10 h-10"><circle cx="20" cy="20" r="19" stroke="currentColor" strokeWidth="1" /><path d="M20 12c-5 4-9 8-9 13a9 9 0 0018 0c0-5-4-9-9-13z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><path d="M20 18v6M17 21h6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
  ),
  '病院・クリニック': (
    <svg viewBox="0 0 40 40" fill="none" className="w-10 h-10"><circle cx="20" cy="20" r="19" stroke="currentColor" strokeWidth="1" /><rect x="12" y="14" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.2" /><path d="M20 17v8M16 21h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /><path d="M17 14v-3h6v3" stroke="currentColor" strokeWidth="1.2" /></svg>
  ),
  'その他': (
    <svg viewBox="0 0 40 40" fill="none" className="w-10 h-10"><circle cx="20" cy="20" r="19" stroke="currentColor" strokeWidth="1" /><circle cx="13" cy="20" r="1.5" fill="currentColor" /><circle cx="20" cy="20" r="1.5" fill="currentColor" /><circle cx="27" cy="20" r="1.5" fill="currentColor" /></svg>
  ),
};

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <div className="bg-gradient-to-b from-sky-50 via-sky-50/50 to-white">
        <div className="max-w-[1040px] mx-auto px-4 sm:px-6 pt-10 pb-8 text-center">
          <h1 className="text-xl tracking-wide text-gray-800 mb-1">
            全国のサロン・クリニック検索
          </h1>
          <p className="text-sm text-gray-500 mb-6">美容・医療・福祉、あなたにぴったりの施設が見つかる</p>
          <div className="max-w-[580px] mx-auto">
            <HomeSearchForm />
          </div>
        </div>
      </div>

      {/* Business type cards - visual anchor */}
      <div className="max-w-[1040px] mx-auto px-4 sm:px-6 -mt-2">
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {businessTypes.map((type) => (
            <Link
              key={type}
              href={`/search?type=${encodeURIComponent(type)}`}
              className="flex flex-col items-center gap-2 py-5 px-2 bg-white border border-gray-100 rounded-lg hover:border-sky-200 hover:shadow-md transition-all group text-center"
            >
              <span className="text-sky-300 group-hover:text-sky-500 transition-colors">
                {typeIcons[type]}
              </span>
              <span className="text-[11px] text-gray-700 group-hover:text-sky-700 leading-tight transition-colors">{type}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Area bar */}
      <div className="max-w-[1040px] mx-auto px-4 sm:px-6 mt-6">
        <div className="flex border border-gray-100 rounded-lg overflow-hidden">
          {regionGroups.map((region, i) => (
            <Link
              key={region.name}
              href={`/search?area=${encodeURIComponent(region.prefectures[0])}`}
              className={`flex-1 py-3 text-center hover:bg-sky-50 transition-colors ${i < regionGroups.length - 1 ? 'border-r border-gray-100' : ''}`}
            >
              <span className="text-xs font-medium text-gray-700 block">{region.name}</span>
              <span className="text-[10px] text-gray-400">{region.prefectures.length}都道府県</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Main 3-column */}
      <div className="max-w-[1040px] mx-auto px-4 sm:px-6">
        <div className="flex flex-col md:flex-row gap-6 py-8">
          {/* Left column */}
          <div className="md:w-[170px] flex-shrink-0 space-y-5">
            <div>
              <h2 className="text-xs font-medium text-gray-800 mb-2">エリアから探す</h2>
              <nav>
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
              <h2 className="text-xs font-medium text-gray-800 mb-2">ガイド</h2>
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
            {/* Business types with region links */}
            <div>
              <h2 className="text-xs font-medium text-gray-800 mb-3">業種 &times; エリアで探す</h2>
              {businessTypes.map((type, idx) => (
                <div key={type} className={`py-3 ${idx < businessTypes.length - 1 ? 'border-b border-gray-100' : ''}`}>
                  <Link
                    href={`/search?type=${encodeURIComponent(type)}`}
                    className="text-sky-700 text-sm font-medium hover:underline"
                  >
                    {type}を探す
                  </Link>
                  <div className="flex flex-wrap items-center mt-1">
                    {regionGroups.map((region, i) => (
                      <span key={region.name} className="text-xs">
                        {i > 0 && <span className="text-gray-200 mx-1.5">|</span>}
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
            <div>
              <h2 className="text-xs font-medium text-gray-800 mb-3">こだわり条件から探す</h2>
              <div className="flex flex-wrap gap-2">
                {facilityFeatures.map((feature) => (
                  <Link
                    key={feature}
                    href={`/search?keyword=${encodeURIComponent(feature)}`}
                    className="px-3 py-1.5 bg-gray-50 border border-gray-100 rounded text-xs text-gray-600 hover:bg-sky-50 hover:border-sky-200 hover:text-sky-700 transition-colors"
                  >
                    {feature}
                  </Link>
                ))}
              </div>
            </div>

            {/* Popular areas */}
            <div>
              <h2 className="text-xs font-medium text-gray-800 mb-3">人気のエリア</h2>
              <div className="flex flex-wrap items-center">
                {popularAreas.map((area, i) => (
                  <span key={area} className="text-xs">
                    {i > 0 && <span className="text-gray-200 mx-2">|</span>}
                    <Link href={`/search?area=${encodeURIComponent(area)}`} className="text-gray-600 hover:text-sky-700 transition-colors">{area}</Link>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Right column */}
          <div className="md:w-[200px] flex-shrink-0 space-y-4">
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
                  className="flex items-center justify-between py-2.5 text-xs text-gray-500 hover:text-sky-700 transition-colors border-b border-gray-100"
                >
                  <span>{item.label}</span>
                  <span className="text-gray-300">&rsaquo;</span>
                </Link>
              ))}
            </nav>
            <div className="pt-2 space-y-2.5 text-[11px] text-gray-500">
              <p className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                24時間ネット予約
              </p>
              <p className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
                口コミで比較できる
              </p>
              <p className="flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                掲載・利用すべて無料
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
