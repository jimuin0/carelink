'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center">
        <p className="text-gray-500 mb-4">ページの読み込みに失敗しました</p>
        <button type="button" onClick={() => reset()} className="text-sm text-sky-600 hover:underline">
          再読み込み
        </button>
      </div>
    </div>
  );
}
