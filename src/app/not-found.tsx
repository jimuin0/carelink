import Link from 'next/link';
import type { Metadata } from 'next';

// ルート layout の title.template '%s | CareLink' が自動付与するため「| CareLink」は付けない（二重化防止）。
// 本番実測で確認済み：ルートに一致するルートファイルが無い純粋な404は本ファイルが直接描画されテンプレが適用される
// （generateStaticParams配下のnotFound()呼び出し経由の404は各ページ側のgenerateMetadataが使われ本ファイルの
// metadataは使われないため対象外）。
export const metadata: Metadata = {
  title: 'ページが見つかりません',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-primary mb-4">404</h1>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">
          ページが見つかりません
        </h2>
        <p className="text-gray-600 mb-8">
          お探しのページは存在しないか、移動した可能性があります。
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/" className="btn-primary">
            トップページへ戻る
          </Link>
          <Link href="/search" className="btn-outline">
            サロンを探す
          </Link>
        </div>
      </div>
    </div>
  );
}
