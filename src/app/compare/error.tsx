'use client';

import { useEffect } from 'react';

import Button from '@/components/ui/Button';

import { safeCaptureException } from '@/lib/safe';

export default function CompareError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    safeCaptureException(error, 'compare');
  }, [error]);
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">エラーが発生しました</h2>
        <p className="text-gray-600 mb-8">比較ページの読み込みに失敗しました。再度お試しください。</p>
        <Button onClick={reset}>もう一度試す</Button>
      </div>
    </div>
  );
}
