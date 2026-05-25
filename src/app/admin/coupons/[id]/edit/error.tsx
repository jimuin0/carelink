'use client';

import { useEffect } from 'react';

import { safeCaptureException } from '@/lib/safe';

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    safeCaptureException(error, 'admin-coupons-id-edit');
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
