'use client';

import { useState, useEffect } from 'react';
import { isPushSupported, usePushSubscription } from '@/hooks/usePushSubscription';

export default function PushPermissionBanner() {
  const [show, setShow] = useState(false);
  // 登録処理は管理画面の通知設定と共通（src/hooks/usePushSubscription.ts）。
  const { subscribe, busy: subscribing, error } = usePushSubscription();

  useEffect(() => {
    if (!isPushSupported()) return;
    if (Notification.permission === 'granted' || Notification.permission === 'denied') return;

    // Show banner after a short delay
    const timer = setTimeout(() => setShow(true), 3000);
    return () => clearTimeout(timer);
  }, []);

  const handleSubscribe = async () => {
    const outcome = await subscribe();
    // サーバ保存に失敗したときはバナーを残してエラー表示し、再試行できるようにする
    // （失敗でも消すと、購読済みに見えて二度と案内されない）。許可されなかった場合は閉じる。
    if (outcome !== 'failed') setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-24 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-40 bg-white rounded-2xl shadow-2xl border border-gray-100 p-4 animate-slideUp">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-sky-100 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-sky-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="font-bold text-sm">予約通知を受け取る</p>
          <p className="text-xs text-gray-500 mt-0.5">予約確認・リマインドをプッシュ通知でお届けします</p>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={handleSubscribe}
              disabled={subscribing}
              className="min-h-[44px] px-4 py-1.5 bg-sky-700 text-white text-xs font-bold rounded-lg hover:bg-sky-800 transition-colors"
            >
              {subscribing ? '設定中...' : '通知を許可'}
            </button>
            <button
              type="button"
              onClick={() => setShow(false)}
              className="min-h-[44px] px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              後で
            </button>
          </div>
          {error === 'subscribe' && <p className="text-xs text-red-600 mt-2" role="alert">通知の登録に失敗しました。時間をおいて再度お試しください。</p>}
        </div>
      </div>
    </div>
  );
}
