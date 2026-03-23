import Link from 'next/link';
import { businessTypes, regionGroups } from '@/lib/constants';
import HomeSearchForm from '@/components/search/HomeSearchForm';

const regionShortNames = ['北海道・東北', '関東', '中部', '近畿', '中国・四国', '九州・沖縄'];

const typeColors: Record<string, string> = {
  '美容サロン・アイラッシュ': 'bg-pink-50 border-pink-200 hover:bg-pink-100',
  '鍼灸院': 'bg-amber-50 border-amber-200 hover:bg-amber-100',
  '整骨院': 'bg-blue-50 border-blue-200 hover:bg-blue-100',
  '介護施設・デイサービス': 'bg-green-50 border-green-200 hover:bg-green-100',
  '病院・クリニック': 'bg-purple-50 border-purple-200 hover:bg-purple-100',
  'その他': 'bg-gray-50 border-gray-200 hover:bg-gray-100',
};

export default function Home() {
  return (
    <>
      {/* Hero + Search */}
      <section className="bg-sky-600 text-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14 text-center">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">
            医療・福祉・美容の<br className="sm:hidden" />サロン・クリニック検索
          </h1>
          <p className="text-sky-100 text-sm mb-6">
            全国の施設をかんたんに探せる・予約できるポータルサイト
          </p>
          <div className="max-w-2xl mx-auto">
            <HomeSearchForm />
          </div>
        </div>
      </section>

      {/* Features strip */}
      <section className="bg-sky-700 text-white border-t border-sky-500">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex justify-center flex-wrap gap-x-8 gap-y-1 text-xs">
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              24時間ネット予約
            </span>
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
              口コミ・評価で比較
            </span>
            <span className="flex items-center gap-1.5">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              掲載・利用すべて無料
            </span>
          </div>
        </div>
      </section>

      {/* Business Type Cards */}
      <section className="bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h2 className="font-bold text-lg mb-5">業種から探す</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {businessTypes.map((type) => (
              <Link
                key={type}
                href={`/search?type=${encodeURIComponent(type)}`}
                className={`block border rounded-xl p-4 transition-colors ${typeColors[type] || 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}
              >
                <p className="font-bold text-gray-800 text-sm mb-2">{type}</p>
                <div className="flex flex-wrap gap-x-1 text-[11px] text-gray-400">
                  {regionShortNames.map((region, i) => (
                    <span key={region}>
                      {i > 0 && <span className="mx-0.5">|</span>}
                      {region}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Area Search */}
      <section className="bg-gray-50 border-t border-gray-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h2 className="font-bold text-lg mb-5">エリアから探す</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {regionGroups.map((region) => (
              <Link
                key={region.name}
                href={`/search?area=${encodeURIComponent(region.prefectures[0])}`}
                className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-sky-300 hover:shadow-sm transition-all"
              >
                <p className="font-bold text-gray-800 text-sm mb-1">{region.name}</p>
                <p className="text-[11px] text-gray-400 leading-relaxed">
                  {region.prefectures.join(' / ')}
                </p>
              </Link>
            ))}
          </div>
          <div className="text-center mt-4">
            <Link href="/search/area" className="text-sm text-sky-600 hover:underline">
              都道府県から探す &rarr;
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
