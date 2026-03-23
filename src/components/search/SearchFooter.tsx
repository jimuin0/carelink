import Link from 'next/link';
import { businessTypes } from '@/lib/constants';

export default function SearchFooter() {
  return (
    <footer className="bg-gray-900 text-gray-300">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid sm:grid-cols-2 gap-8">
          <div>
            <Link href="/" className="text-lg font-bold text-white">
              CareLink
            </Link>
            <p className="text-gray-400 text-sm mt-2">
              美容・医療・福祉のサロン・クリニック検索
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
