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
              採用×集客プラットフォーム
            </p>
          </div>

          {/* Service Links */}
          <div>
            <h3 className="text-white font-bold text-sm mb-4">サービス</h3>
            <nav className="flex flex-col gap-2 text-sm">
              <Link href="/salon" className="hover:text-white transition-colors">
                施設・サロンの方
              </Link>
              <Link href="/jobs" className="hover:text-white transition-colors">
                求職者の方
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
        </div>

        <div className="mt-10 pt-8 border-t border-gray-700 text-center text-sm text-gray-500">
          &copy; {new Date().getFullYear()} CareLink All rights reserved.
        </div>
      </div>
    </footer>
  );
}
