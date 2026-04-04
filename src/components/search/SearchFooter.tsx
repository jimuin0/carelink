import Link from 'next/link';
import { regionGroups, businessTypes } from '@/lib/constants';
import { getPrefectureSlug, getBusinessTypeSlug } from '@/lib/seo-constants';

const majorCities: { pref: string; cities: { slug: string; name: string }[] }[] = [
  { pref: 'tokyo', cities: [{ slug: 'shibuya', name: '渋谷区' }, { slug: 'shinjuku', name: '新宿区' }, { slug: 'minato', name: '港区' }, { slug: 'setagaya', name: '世田谷区' }, { slug: 'meguro', name: '目黒区' }] },
  { pref: 'osaka', cities: [{ slug: 'kita', name: '北区' }, { slug: 'chuo', name: '中央区' }, { slug: 'tennoji', name: '天王寺区' }, { slug: 'naniwa', name: '浪速区' }] },
  { pref: 'kanagawa', cities: [{ slug: 'yokohama-nishi', name: '横浜市西区' }, { slug: 'kawasaki', name: '川崎市' }, { slug: 'fujisawa', name: '藤沢市' }] },
  { pref: 'aichi', cities: [{ slug: 'nagoya-naka', name: '名古屋市中区' }, { slug: 'nagoya-chikusa', name: '名古屋市千種区' }, { slug: 'toyohashi', name: '豊橋市' }] },
  { pref: 'fukuoka', cities: [{ slug: 'hakata', name: '博多区' }, { slug: 'chuo', name: '中央区' }, { slug: 'tenjin', name: '天神' }] },
  { pref: 'hokkaido', cities: [{ slug: 'sapporo', name: '札幌市' }, { slug: 'asahikawa', name: '旭川市' }] },
  { pref: 'kyoto', cities: [{ slug: 'shimogyo', name: '下京区' }, { slug: 'nakagyo', name: '中京区' }] },
];

export default function SearchFooter() {
  return (
    <footer className="bg-gray-900 text-gray-300">
      {/* SEO: エリア×業種 内部リンク（details内だがHTML上は存在→Googlebot クロール可能） */}
      <div className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <details>
            <summary className="text-white font-bold text-sm cursor-pointer list-none flex items-center gap-2">
              エリアから探す
              <svg className="w-4 h-4 text-gray-400 transition-transform [[open]>&]:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </summary>
            <div className="mt-5 space-y-3">
              {regionGroups.map((region) => (
                <div key={region.name}>
                  <h3 className="text-gray-400 text-tiny font-bold mb-1">{region.name}</h3>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                    {region.prefectures.map((pref) => {
                      const slug = getPrefectureSlug(pref);
                      return (
                        <Link
                          key={pref}
                          href={slug ? `/${slug}` : `/search?area=${encodeURIComponent(pref)}`}
                          className="text-xs text-gray-400 hover:text-white transition-colors"
                        >
                          {pref}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <h2 className="text-white font-bold text-sm mt-8 mb-5">主要都市から探す</h2>
            <div className="space-y-3 mb-8">
              {majorCities.map(({ pref, cities }) => (
                <div key={pref} className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {cities.map((c) => (
                    <Link
                      key={`${pref}-${c.slug}`}
                      href={`/${pref}/${c.slug}`}
                      className="text-xs text-gray-400 hover:text-white transition-colors"
                    >
                      {c.name}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </details>

          <details className="mt-8">
            <summary className="text-white font-bold text-sm cursor-pointer list-none flex items-center gap-2">
              業種×エリアから探す
              <svg className="w-4 h-4 text-gray-400 transition-transform [[open]>&]:rotate-180" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </summary>
            <div className="space-y-4">
              {businessTypes.map((type) => (
                <div key={type}>
                  <h3 className="text-xs font-bold mb-1.5">
                    <Link
                      href={`/search?type=${encodeURIComponent(type)}`}
                      className="text-gray-300 hover:text-white transition-colors"
                    >
                      {type}
                    </Link>
                  </h3>
                  <div className="flex flex-wrap gap-x-2.5 gap-y-0.5">
                    {regionGroups.flatMap((region) =>
                      region.prefectures.map((pref) => {
                        const pSlug = getPrefectureSlug(pref);
                        const tSlug = getBusinessTypeSlug(type);
                        const href = pSlug && tSlug
                          ? `/${pSlug}/${tSlug}`
                          : `/search?type=${encodeURIComponent(type)}&area=${encodeURIComponent(pref)}`;
                        return (
                          <Link
                            key={`${type}-${pref}`}
                            href={href}
                            className="text-tiny text-gray-400 hover:text-gray-300 transition-colors"
                          >
                            {pref}
                          </Link>
                        );
                      })
                    )}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>

      {/* メインフッター */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid sm:grid-cols-2 gap-8">
          <div>
            <Link href="/" className="text-lg font-bold text-white">
              CareLink
            </Link>
            <p className="text-gray-400 text-sm mt-2">
              美容サロン・クリニックの検索・予約
            </p>
          </div>

          <div>
            <h3 className="text-white font-bold text-sm mb-3">業種から探す</h3>
            <nav className="flex flex-col gap-1.5 text-sm">
              {businessTypes.map((type) => (
                <Link
                  key={type}
                  href={`/search?type=${encodeURIComponent(type)}`}
                  className="hover:text-white transition-colors"
                >
                  {type}
                </Link>
              ))}
            </nav>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-700 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-400">
          <p>&copy; {new Date().getFullYear()} CareLink All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-white transition-colors">プライバシーポリシー</Link>
            <Link href="/terms" className="hover:text-white transition-colors">利用規約</Link>
            <Link href="/legal" className="hover:text-white transition-colors">特定商取引法に基づく表記</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
