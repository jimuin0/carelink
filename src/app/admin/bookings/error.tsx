'use client';

import { useEffect } from 'react';
import { safeCaptureException } from '@/lib/safe';

export default function BookingsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    safeCaptureException(error, 'admin-bookings');
  }, [error]);
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <p className="text-gray-700 font-bold mb-1">予約一覧の読み込みに失敗しました</p>
      <p className="text-xs text-gray-400 mb-4">通信状況をご確認のうえ、再読み込みしてください。</p>
      <button
        type="button"
        onClick={reset}
        className="btn-primary !px-4 !py-1.5 text-sm"
      >
        再読み込み
      </button>
    </div>
  );
}
