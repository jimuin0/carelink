import Link from 'next/link';
import { regionGroups, businessTypes } from '@/lib/constants';
import { getPrefectureSlug, getBusinessTypeSlug } from '@/lib/seo-constants';

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-300">
      {/* SEO: エリア×業種 内部リンク */}
      <div className="border-b border-gray-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          {/* 全47都道府県リンク */}
          <h2 className="text-white font-bold text-sm mb-5">エリアから探す</h2>
          <div className="space-y-4">
            {regionGroups.map((region) => (
              <div key={region.name}>
                <h3 className="text-gray-500 text-[11px] font-bold mb-1.5">{region.name}</h3>
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

          {/* 業種×都道府県リンク (5業種 × 47都道府県 = 235リンク) */}
          <h2 className="text-white font-bold text-sm mt-10 mb-5">業種×エリアから探す</h2>
          <div className="space-y-5">
            {businessTypes.map((type) => (
              <div key={type}>
                <h3 className="text-xs font-bold mb-2">
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
                          className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
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
        </div>
      </div>

      {/* メインフッター */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid sm:grid-cols-3 gap-8">
          {/* Brand */}
          <div>
            <Link href="/" className="text-xl font-bold text-white">
              CareLink
            </Link>
            <p className="text-gray-400 text-sm mt-3 leading-relaxed">
              医療・福祉・美容に特化した<br />
              集客プラットフォーム
            </p>
          </div>

          {/* Service Links */}
          <div>
            <h3 className="text-white font-bold text-sm mb-4">サービス</h3>
            <nav className="flex flex-col gap-2 text-sm">
              <Link href="/search" className="hover:text-white transition-colors">
                サロンを探す
              </Link>
              <Link href="/salon" className="hover:text-white transition-colors">
                集客したい方
              </Link>
              <Link href="/contact" className="hover:text-white transition-colors">
                お問い合わせ
              </Link>
            </nav>
          </div>

          {/* Legal Links */}
          <div>
            <h3 className="text-white font-bold text-sm mb-4">その他</h3>
            <nav className="flex flex-col gap-2 text-sm">
              <Link href="/privacy" className="hover:text-white transition-colors">
                プライバシーポリシー
              </Link>
              <Link href="/terms" className="hover:text-white transition-colors">
                利用規約
              </Link>
              <Link href="/legal" className="hover:text-white transition-colors">
                特定商取引法に基づく表記
              </Link>
            </nav>
          </div>

          {/* Company Info */}
          <div className="sm:col-span-3 pt-6 border-t border-gray-700 mt-2">
            <h3 className="text-white font-bold text-sm mb-3">運営会社</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm text-gray-400">
              <dt>運営</dt>
              <dd>神原良祐（HALグループ）</dd>
              <dt>所在地</dt>
              <dd>大阪府堺市</dd>
              <dt>事業内容</dt>
              <dd>美容・医療・福祉分野の集客支援</dd>
              <dt>お問い合わせ</dt>
              <dd><Link href="/contact" className="text-gray-300 hover:text-white transition-colors underline">お問い合わせフォーム</Link></dd>
            </dl>
          </div>
        </div>

        <div className="mt-10 pt-8 border-t border-gray-700 text-center text-sm text-gray-500">
          &copy; {new Date().getFullYear()} CareLink All rights reserved.
        </div>
      </div>
    </footer>
  );
}
