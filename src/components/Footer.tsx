import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="bg-gray-900 text-gray-300">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
          <Link href="/" className="text-xl font-bold text-white">
            CareLink
          </Link>
          <nav className="flex flex-wrap items-center justify-center gap-6 text-sm">
            <Link href="/privacy" className="hover:text-white transition-colors">
              プライバシーポリシー
            </Link>
            <Link href="/terms" className="hover:text-white transition-colors">
              利用規約
            </Link>
            <Link href="/contact" className="hover:text-white transition-colors">
              お問い合わせ
            </Link>
          </nav>
        </div>
        <div className="mt-8 pt-8 border-t border-gray-700 text-center text-sm text-gray-500">
          &copy; {new Date().getFullYear()} CareLink All rights reserved.
        </div>
      </div>
    </footer>
  );
}
