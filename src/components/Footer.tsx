import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-300">
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
