'use client';

import Link from 'next/link';

export default function FacilityError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center">
        <p className="text-5xl font-bold text-gray-200 mb-4">Error</p>
        <h1 className="text-xl font-bold mb-2">ページを表示できません</h1>
        <p className="text-gray-500 text-sm mb-8">
          一時的な問題が発生しています。しばらくしてからもう一度お試しください。
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button onClick={reset} className="btn-primary text-sm px-6 py-3">
            もう一度試す
          </button>
          <Link href="/search" className="btn-outline text-sm px-6 py-3">
            サロン・クリニックを探す
          </Link>
        </div>
      </div>
    </div>
  );
}
