'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function RankingAreaError({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">エラーが発生しました</h2>
        <p className="text-gray-600 mb-8">ランキングの読み込みに失敗しました。再度お試しください。</p>
        <button type="button" onClick={reset} className="btn-primary">もう一度試す</button>
      </div>
    </div>
  );
}
