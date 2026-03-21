import Link from 'next/link';

export default function FacilityNotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center">
        <p className="text-6xl font-bold text-gray-200 mb-4">404</p>
        <h1 className="text-xl font-bold mb-2">施設が見つかりません</h1>
        <p className="text-gray-500 text-sm mb-8">
          お探しの施設は存在しないか、公開が終了した可能性があります。
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/search" className="btn-primary text-sm px-6 py-3">
            施設を探す
          </Link>
          <Link href="/" className="btn-outline text-sm px-6 py-3">
            トップへ戻る
          </Link>
        </div>
      </div>
    </div>
  );
}
