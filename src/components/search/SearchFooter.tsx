import Link from 'next/link';
import { regionGroups, businessTypes } from '@/lib/constants';

export default function SearchFooter() {
  return (
    <footer className="bg-gray-900 text-gray-300">
      {/* SEO: エリア×業種 内部リンク */}
      <div className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <h2 className="text-white font-bold text-sm mb-5">エリアから探す</h2>
          <div className="space-y-3">
            {regionGroups.map((region) => (
              <div key={region.name}>
                <h3 className="text-gray-500 text-[11px] font-bold mb-1">{region.name}</h3>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {region.prefectures.map((pref) => (
                    <Link
                      key={pref}
                      href={`/search?area=${encodeURIComponent(pref)}`}
                      className="text-xs text-gray-400 hover:text-white transition-colors"
                    >
                      {pref}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <h2 className="text-white font-bold text-sm mt-8 mb-5">業種×エリアから探す</h2>
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
                    region.prefectures.map((pref) => (
                      <Link
                        key={`${type}-${pref}`}
                        href={`/search?type=${encodeURIComponent(type)}&area=${encodeURIComponent(pref)}`}
                        className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
                      >
                        {pref}
                      </Link>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
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

        <div className="mt-8 pt-6 border-t border-gray-700 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-500">
          <p>&copy; {new Date().getFullYear()} CareLink All rights reserved.</p>
          <div className="flex gap-4">
            <Link href="/privacy" className="hover:text-white transition-colors">プライバシーポリシー</Link>
            <Link href="/terms" className="hover:text-white transition-colors">利用規約</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
