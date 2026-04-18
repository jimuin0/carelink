'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Toast from '@/components/Toast';
import ConfirmDialog from '@/components/ConfirmDialog';

function SettingsContent() {
  const searchParams = useSearchParams();
  const gcalParam = searchParams.get('gcal');

  const [gcal, setGcal] = useState<{ connected: boolean; updatedAt?: string } | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [lineLinked, setLineLinked] = useState<boolean | null>(null);
  const [lineUnlinking, setLineUnlinking] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [showGcalDisconnect, setShowGcalDisconnect] = useState(false);
  const [showLineUnlink, setShowLineUnlink] = useState(false);

  useEffect(() => {
    fetch('/api/google-calendar')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setGcal)
      .catch(() => setGcal({ connected: false }));

    // LINE連携状態を確認
    fetch('/api/profile')
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => setLineLinked(!!d.profile?.line_user_id))
      .catch(() => setLineLinked(false));
  }, []);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await fetch('/api/google-calendar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'connect' }),
      });
      const data = await res.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      } else {
        setToast({ type: 'error', message: data.error || '接続できませんでした' });
        setConnecting(false);
      }
    } catch {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await fetch('/api/google-calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'disconnect' }),
    });
    setGcal({ connected: false });
  };

  const handleLineUnlink = async () => {
    setLineUnlinking(true);
    try {
      await fetch('/api/liff/link', { method: 'DELETE' });
      setLineLinked(false);
    } finally {
      setLineUnlinking(false);
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">設定</h1>

      {gcalParam === 'success' && (
        <div className="bg-green-50 text-green-700 p-4 rounded-xl text-sm">
          Googleカレンダーと連携しました。予約詳細ページから同期できます。
        </div>
      )}
      {gcalParam === 'error' && (
        <div className="bg-red-50 text-red-700 p-4 rounded-xl text-sm">
          Googleカレンダーの連携に失敗しました。もう一度お試しください。
        </div>
      )}

      {/* Google Calendar */}
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="font-semibold text-gray-900 mb-1">Googleカレンダー連携</h2>
        <p className="text-sm text-gray-500 mb-4">
          予約をGoogleカレンダーに自動で追加・同期できます。
        </p>
        {gcal === null ? (
          <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
        ) : gcal.connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-600 text-sm">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              連携中 {gcal.updatedAt && `（最終更新: ${new Date(gcal.updatedAt).toLocaleDateString('ja-JP')}）`}
            </div>
            <button
              type="button"
              onClick={() => setShowGcalDisconnect(true)}
              className="text-sm text-red-600 hover:text-red-700 underline"
            >
              連携を解除する
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleConnect}
            disabled={connecting}
            className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            {connecting ? '接続中...' : 'Googleカレンダーと連携する'}
          </button>
        )}
      </div>

      {/* LINE連携 */}
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="font-semibold text-gray-900 mb-1">LINE連携</h2>
        <p className="text-sm text-gray-500 mb-4">
          LINEアプリからの予約確認・ポイント確認・クーポン閲覧ができるようになります。
        </p>
        {lineLinked === null ? (
          <div className="h-10 bg-gray-100 rounded-lg animate-pulse" />
        ) : lineLinked ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-600 text-sm">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              LINEと連携中
            </div>
            <button
              type="button"
              onClick={() => setShowLineUnlink(true)}
              disabled={lineUnlinking}
              className="text-sm text-red-600 hover:text-red-700 underline disabled:opacity-50"
            >
              {lineUnlinking ? '解除中...' : '連携を解除する'}
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            LINE連携はLINEアプリのリッチメニューから行えます。施設からQRコードをご案内します。
          </p>
        )}
      </div>

      {/* Notifications */}
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="font-semibold text-gray-900 mb-1">通知設定</h2>
        <p className="text-sm text-gray-500 mb-4">
          メール通知の配信設定はプロフィールページから変更できます。
        </p>
        <Link href="/mypage/profile" className="text-sm text-sky-600 hover:underline">
          プロフィールを編集 →
        </Link>
      </div>

      {/* Account */}
      <div className="bg-white rounded-2xl shadow-sm p-6">
        <h2 className="font-semibold text-gray-900 mb-1">アカウント</h2>
        <div className="space-y-3 mt-3">
          <Link href="/mypage/profile" className="block text-sm text-gray-700 hover:text-sky-600 transition-colors">
            プロフィール編集 →
          </Link>
          <Link href="/mypage/profile#delete" className="block text-sm text-red-600 hover:text-red-700 transition-colors">
            アカウントを削除する →
          </Link>
        </div>
      </div>

      {toast && <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
      <ConfirmDialog
        open={showGcalDisconnect}
        title="Googleカレンダー連携を解除"
        message="Googleカレンダーとの連携を解除しますか？予約の同期ができなくなります。"
        confirmLabel="解除する"
        cancelLabel="キャンセル"
        onConfirm={() => { setShowGcalDisconnect(false); handleDisconnect(); }}
        onCancel={() => setShowGcalDisconnect(false)}
      />
      <ConfirmDialog
        open={showLineUnlink}
        title="LINE連携を解除"
        message="LINE連携を解除しますか？LINEからの通知が届かなくなります。"
        confirmLabel="解除する"
        cancelLabel="キャンセル"
        onConfirm={() => { setShowLineUnlink(false); handleLineUnlink(); }}
        onCancel={() => setShowLineUnlink(false)}
      />
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-400">読み込み中...</div>}>
      <SettingsContent />
    </Suspense>
  );
}
