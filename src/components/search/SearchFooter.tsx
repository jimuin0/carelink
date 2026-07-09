import Link from 'next/link';
import { regionGroups, businessTypes } from '@/lib/constants';
import { getPrefectureSlug, getBusinessTypeSlug } from '@/lib/seo-constants';

// 神奈川・愛知・福岡・京都は src/data/city-slugs.ts に区レベルのslugが存在せず市レベルのみ
// （東京・大阪だけが区レベルを持つ）。旧実装は区レベルの名称・slugをハードコードしており、
// [prefectureSlug]/[secondSlug]/page.tsx で isValidCitySlug に該当せず notFound() になっていた
// （実データ確認: /kanagawa/yokohama-nishi 等でnot-found.tsxのレンダリングを確認済み）。
// 全エントリを city-slugs.ts に実在するslugに置換する。
export const majorCities: { pref: string; cities: { slug: string; name: string }[] }[] = [
  { pref: 'tokyo', cities: [{ slug: 'shibuya', name: '渋谷区' }, { slug: 'shinjuku', name: '新宿区' }, { slug: 'minato', name: '港区' }, { slug: 'setagaya', name: '世田谷区' }, { slug: 'meguro', name: '目黒区' }] },
  { pref: 'osaka', cities: [{ slug: 'kita', name: '北区' }, { slug: 'chuo', name: '中央区' }, { slug: 'tennoji', name: '天王寺区' }, { slug: 'naniwa', name: '浪速区' }] },
  { pref: 'kanagawa', cities: [{ slug: 'yokohama', name: '横浜市' }, { slug: 'kawasaki', name: '川崎市' }, { slug: 'fujisawa', name: '藤沢市' }] },
  { pref: 'aichi', cities: [{ slug: 'nagoya', name: '名古屋市' }, { slug: 'toyota', name: '豊田市' }, { slug: 'toyohashi', name: '豊橋市' }] },
  { pref: 'fukuoka', cities: [{ slug: 'fukuoka-city', name: '福岡市' }, { slug: 'kitakyushu', name: '北九州市' }, { slug: 'kurume', name: '久留米市' }] },
  { pref: 'hokkaido', cities: [{ slug: 'sapporo', name: '札幌市' }, { slug: 'asahikawa', name: '旭川市' }] },
  { pref: 'kyoto', cities: [{ slug: 'kyoto-city', name: '京都市' }, { slug: 'uji', name: '宇治市' }] },
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
                          className="text-xs text-gray-400 hover:text-white transition-colors py-1 inline-block"
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
                      className="text-xs text-gray-400 hover:text-white transition-colors py-1 inline-block"
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
                            className="text-tiny text-gray-400 hover:text-gray-300 transition-colors py-1 inline-block"
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

        <div className="mt-8 pt-6 border-t border-gray-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <p className="text-xs text-gray-400">&copy; {new Date().getFullYear()} CareLink All rights reserved.</p>
          <div className="flex flex-col items-end gap-2">
            <Link href="/salon" className="text-xs text-gray-300 hover:text-white transition-colors">
              施設掲載をご希望のオーナー様はこちら →
            </Link>
            <div className="flex gap-4 text-[11px] text-gray-400">
              <Link href="/privacy" className="hover:text-white transition-colors">プライバシーポリシー</Link>
              <Link href="/terms" className="hover:text-white transition-colors">利用規約</Link>
              <Link href="/legal" className="hover:text-white transition-colors">特定商取引法に基づく表記</Link>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
