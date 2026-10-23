import Button from '@/components/ui/Button';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ページが見つかりません',
  description: 'お探しのページは存在しないか、公開が終了した可能性があります。',
  robots: { index: false, follow: false },
};

export default function FacilityNotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center">
        <p className="text-6xl font-bold text-gray-200 mb-4">404</p>
        <h1 className="text-xl font-bold mb-2">ページが見つかりません</h1>
        <p className="text-gray-500 text-sm mb-8">
          お探しのページは存在しないか、公開が終了した可能性があります。
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button href="/search">
            サロン・クリニックを探す
          </Button>
          <Button href="/" variant="secondary">
            トップへ戻る
          </Button>
        </div>
      </div>
    </div>
  );
}
