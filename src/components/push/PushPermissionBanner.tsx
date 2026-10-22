'use client';

import { useState, useEffect } from 'react';
import { readThisDevicePushStatus, usePushSubscription } from '@/hooks/usePushSubscription';

/**
 * 予約完了画面の「予約通知を受け取る」バナー。
 *
 * 出すのは【登録すれば実際に届く】ときだけ（2026年10月23日 見直し）：
 * - ログイン中のお客様だけ。ゲストの予約は宛先の利用者が無く、登録 API も 401 を返すため、
 *   以前は「時間をおいて再度お試しください」が何度押しても出続けた。
 * - この端末がまだ登録されていない（または登録が消えた）とき。以前はブラウザの許可だけを見ていたので、
 *   一度許可すると、その後サーバー側の登録が消えても二度と出ず、登録し直せなかった。
 * - 別の端末が登録済みのときは出さない（ここで押すと、いつも使っている端末に届かなくなるため）。
 *   切り替えはマイページの設定から行える。
 */
export default function PushPermissionBanner() {
  const [show, setShow] = useState(false);
  // 登録処理は管理画面の通知設定と共通（src/hooks/usePushSubscription.ts）。
  const { subscribe, busy: subscribing, error } = usePushSubscription();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    readThisDevicePushStatus()
      .then((status) => {
        if (cancelled || status.state !== 'unregistered' || status.otherDevice) return;
        // Show banner after a short delay
        timer = setTimeout(() => setShow(true), 3000);
      })
      // 登録状況を確認できないときは出さない（押しても登録できるか分からないため）。
      .catch(() => {});
    return () => { cancelled = true; clearTimeout(timer); };
  }, []);

  const handleSubscribe = async () => {
    const outcome = await subscribe();
    // 保存に失敗した・ログインを確認できなかったときはバナーを残して理由を出す
    // （失敗でも消すと、購読済みに見えて案内が消える）。許可されなかった場合は閉じる。
    if (outcome === 'subscribed' || outcome === 'denied') setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-24 left-4 right-4 sm:left-auto sm:right-4 sm:w-80 z-40 bg-white rounded-2xl shadow-2xl border border-gray-100 p-4 animate-slideUp">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-sky-100 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-sky-700" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="font-bold text-sm">予約通知を受け取る</p>
          {/* 実際にお客様へ送っている Push だけを書く（予約の受付・確定・キャンセル・日時変更・来店後の状態）。
              来店前のリマインドは Push では送っていないので約束しない。 */}
          <p className="text-xs text-gray-500 mt-0.5">予約の確定・キャンセル・日時の変更などを、この端末にプッシュ通知でお知らせします</p>
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
          {error === 'subscribe' && <p className="text-xs text-red-700 mt-2" role="alert">通知の登録に失敗しました。時間をおいて再度お試しください。</p>}
          {error === 'signed_out' && <p className="text-xs text-red-700 mt-2" role="alert">ログインを確認できませんでした。ログインし直してから、もう一度お試しください。</p>}
        </div>
      </div>
    </div>
  );
}
