'use client';

import { useEffect } from 'react';

import Button from '@/components/ui/Button';

import { safeCaptureException } from '@/lib/safe';

export default function FacilityError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    safeCaptureException(error, 'facility-slug');
  }, [error]);
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center">
        <p className="text-5xl font-bold text-gray-500 mb-4">Error</p>
        <h1 className="text-xl font-bold mb-2">ページを表示できません</h1>
        <p className="text-gray-500 text-sm mb-8">
          一時的な問題が発生しています。しばらくしてからもう一度お試しください。
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={reset}>
            もう一度試す
          </Button>
          <Button href="/search" variant="secondary">
            サロン・クリニックを探す
          </Button>
        </div>
      </div>
    </div>
  );
}
